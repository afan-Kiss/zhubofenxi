/**
 * 小白·和田早场 + 橙橙一日试播边界验收
 * npm run verify:xiaobai-hetian-chengcheng-boundary
 */
import assert from 'node:assert/strict'
import {
  resolveShopSessionFallbackForDate,
  normalizeShopSessionKey,
} from '../src/services/shop-session-fallback.service'
import {
  isXiaoBaiOrderAttribution,
  ANCHOR_SESSION_DISPLAY_FROM_0613,
} from '../src/services/anchor-performance-attribution.service'
import {
  NEW_SCHEDULE_TEMPLATE_SEEDS_20260701,
  templateAppliesOnDate,
  OBSOLETE_JULY_SCHEDULE_TEMPLATE_CUTOFFS,
} from '../src/services/anchor-schedule-template.service'
import { CANONICAL_ATTRIBUTION_VERSION } from '../src/services/business-cache-fingerprint'
import type { AnalyzedOrderView } from '../src/types/analysis'

function ms(s: string): number {
  return Date.parse(`${s}+08:00`)
}

function view(liveAccountName: string): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return { liveAccountName, raw: { liveAccountName } } as AnalyzedOrderView & {
    raw?: Record<string, unknown>
  }
}

function main(): void {
  console.log('verify-xiaobai-hetian-chengcheng-boundary\n')
  assert.match(CANONICAL_ATTRIBUTION_VERSION, /^canonical-v8-/)
  console.log(`  ✓ version=${CANONICAL_ATTRIBUTION_VERSION}`)

  const hetian = normalizeShopSessionKey('和田雅玉')
  assert.equal(hetian, 'hetian')

  assert.equal(
    resolveShopSessionFallbackForDate(hetian, ms('2026-07-01T09:30:00'))?.anchorName,
    '小白',
  )
  assert.equal(
    resolveShopSessionFallbackForDate(hetian, ms('2026-07-01T13:59:59'))?.anchorName,
    '小白',
  )
  assert.equal(resolveShopSessionFallbackForDate(hetian, ms('2026-07-01T14:00:00')), null)
  assert.equal(
    resolveShopSessionFallbackForDate(hetian, ms('2026-07-16T10:00:00'))?.anchorName,
    '小白',
  )
  assert.equal(
    resolveShopSessionFallbackForDate(hetian, ms('2026-07-18T10:00:00'))?.anchorName,
    '小白',
  )
  // 橙橙不得出现在固定回退
  assert.notEqual(
    resolveShopSessionFallbackForDate(hetian, ms('2026-07-17T10:00:00'))?.anchorName,
    '橙橙',
  )
  assert.equal(
    resolveShopSessionFallbackForDate(hetian, ms('2026-07-17T10:00:00'))?.anchorName,
    '小白',
  )
  assert.equal(resolveShopSessionFallbackForDate(hetian, ms('2026-07-17T15:00:00')), null)
  console.log('  ✓ 7 月和田早场→小白；14:00 后无固定回退；橙橙不进固定回退')

  // 6 月 XY 午场专用路径仍在；7 月关闭
  assert.equal(isXiaoBaiOrderAttribution(view('XY祥钰珠宝'), ms('2026-06-20T15:00:00')), true)
  assert.equal(isXiaoBaiOrderAttribution(view('XY祥钰珠宝'), ms('2026-07-02T15:00:00')), false)
  assert.equal(isXiaoBaiOrderAttribution(view('和田雅玉'), ms('2026-07-02T10:00:00')), false)
  console.log('  ✓ 小白专用路径仅 6 月 XY 午场')

  assert.equal(ANCHOR_SESSION_DISPLAY_FROM_0613['小白']?.shopName, '和田雅玉')

  const julySeeds = NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.filter((s) =>
    templateAppliesOnDate(s, '2026-07-01'),
  )
  assert.deepEqual(
    julySeeds.map((s) => `${s.anchorName}|${s.shopName}|${s.startTime}`).sort(),
    ['子杰|拾玉居和田玉|09:30', '小白|和田雅玉|09:30', '飞云|拾玉居和田玉|18:30'].sort(),
  )
  assert.equal(
    NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.some((s) => s.anchorName === '橙橙'),
    false,
  )
  assert.ok(
    OBSOLETE_JULY_SCHEDULE_TEMPLATE_CUTOFFS.some(
      (c) => c.anchorName === '小白' && c.shopName === 'XY祥钰珠宝',
    ),
  )
  assert.ok(OBSOLETE_JULY_SCHEDULE_TEMPLATE_CUTOFFS.some((c) => c.anchorName === '橙橙'))
  console.log('  ✓ 正式种子仅子杰/小白/飞云（7.1）；橙橙不在长期种子')

  // 未来月：橙橙模板不得生效
  assert.equal(
    templateAppliesOnDate(
      {
        anchorName: '橙橙',
        shopName: '和田雅玉',
        liveRoomName: '和田雅玉',
        startTime: '09:30',
        endTime: '18:30',
        effectiveFrom: '2026-07-17',
        effectiveTo: '2026-07-17',
        sortOrder: 1,
      },
      '2026-08-01',
    ),
    false,
  )
  console.log('  ✓ 未来月橙橙模板不生效')

  console.log('\nPASS')
}

main()
