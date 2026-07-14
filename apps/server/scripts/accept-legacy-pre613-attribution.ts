/**
 * 6.13 前历史归属：保留原订单主播 / 时段规则，不得被 canonical 盖成未归属
 *
 * npx tsx apps/server/scripts/accept-legacy-pre613-attribution.ts
 */
import assert from 'node:assert/strict'
import {
  clearCanonicalAttributionCache,
  resolveCanonicalOrderAttribution,
  setCanonicalAttributionTestFixtures,
  CANONICAL_ATTRIBUTION_VERSION,
} from '../src/services/canonical-order-attribution.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

function stubView(
  partial: Partial<AnalyzedOrderView> & { raw?: Record<string, unknown> },
): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return {
    displayOrderNo: 'P-LEGACY',
    officialOrderNo: 'P-LEGACY',
    matchOrderId: 'P-LEGACY',
    liveAccountName: 'XY祥钰珠宝',
    anchorId: 'cmpoxhe5m0008wp0wxots1vpd',
    anchorName: '子杰',
    orderTimeText: '—',
    ...partial,
  } as AnalyzedOrderView & { raw?: Record<string, unknown> }
}

async function main(): Promise<void> {
  clearCanonicalAttributionCache()
  setCanonicalAttributionTestFixtures({ liveSessions: [], effectiveSchedules: [] })

  const r = await resolveCanonicalOrderAttribution(
    stubView({
      raw: { orderedAt: '2026-06-05 10:30:00', createTime: '2026-06-05 10:30:00' },
    }),
  )
  assert.equal(r.canonicalAnchorName, '子杰')
  assert.equal(r.attributionType, 'legacy_attribution')
  assert.match(r.attributionExplain, /原订单主播/)

  // 无原主播但时段规则可命中时（依赖当前配置中有 16:03 附近规则；小艺样本）
  setCanonicalAttributionTestFixtures({ liveSessions: [], effectiveSchedules: [] })
  const noOrig = await resolveCanonicalOrderAttribution(
    stubView({
      liveAccountName: '拾玉居和田玉',
      anchorId: '',
      anchorName: '未归属',
      raw: { orderedAt: '2026-06-05 10:30:00', createTime: '2026-06-05 10:30:00' },
    }),
  )
  // 至少不应崩溃；若配置有时段规则则应命中
  assert.notEqual(noOrig.attributionType, 'conflict')

  assert.match(CANONICAL_ATTRIBUTION_VERSION, /legacy-pre613/)
  setCanonicalAttributionTestFixtures(null)
  clearCanonicalAttributionCache()
  console.log('PASS: accept-legacy-pre613-attribution')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
