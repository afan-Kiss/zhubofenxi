/**
 * 同名小白不同 id / 空 id 聚合不得裂成两行
 * npx tsx apps/server/scripts/verify-xiaobai-leaderboard-dedupe.ts
 */
import assert from 'node:assert/strict'
import { setAnchorConfigCacheForTests } from '../src/services/anchor.service'
import { anchorGroupKey } from '../src/services/anchor-attribution.util'
import { aggregateAnchorLeaderboard } from '../src/services/board-metrics.service'
import type { AnalyzedOrderView, AnchorConfig } from '../src/types/analysis'

const XIAOBAI_ID = 'cmrlmeb1x0000ninpnh2o79wm'

function cfg(): AnchorConfig {
  return {
    anchors: [
      {
        id: XIAOBAI_ID,
        name: '小白',
        color: '#3B82F6',
        enabled: true,
        attributionMode: 'schedule',
        effectiveFrom: '2026-06-18',
        effectiveTo: null,
      },
    ],
    timeRules: [],
  }
}

function view(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderNo: partial.orderNo ?? 'o1',
    anchorId: partial.anchorId ?? '',
    anchorName: partial.anchorName ?? '小白',
    includedInGmv: true,
    paymentBaseCent: partial.paymentBaseCent ?? 10000,
    orderTimeText: '2026-07-10 15:00:00',
    ...partial,
  } as AnalyzedOrderView
}

function main() {
  setAnchorConfigCacheForTests(cfg())

  const kReal = anchorGroupKey(view({ anchorId: XIAOBAI_ID, anchorName: '小白' }))
  const kEmpty = anchorGroupKey(view({ anchorId: '', anchorName: '小白' }))
  const kExtra = anchorGroupKey(view({ anchorId: 'extra-小白', anchorName: '小白' }))
  assert.equal(kReal, `id:${XIAOBAI_ID}`)
  assert.equal(kEmpty, kReal)
  assert.equal(kExtra, kReal)
  console.log('  ✓ group key merges real / empty / extra-小白')

  const kTemp = anchorGroupKey(
    view({ anchorId: 'temp:2026-07-10:abc', anchorName: '小白' }),
  )
  assert.equal(kTemp, 'id:temp:2026-07-10:abc')
  console.log('  ✓ temp: id stays separate')

  const rows = aggregateAnchorLeaderboard(
    [
      view({ orderNo: 'a', anchorId: XIAOBAI_ID, paymentBaseCent: 3_602_990 }),
      view({ orderNo: 'b', anchorId: '', paymentBaseCent: 81_700 }),
      view({ orderNo: 'c', anchorId: 'extra-小白', paymentBaseCent: 100 }),
    ],
    undefined,
    { config: cfg() },
  )
  const xb = rows.filter((r) => r.anchorName === '小白')
  assert.equal(xb.length, 1, `expected 1 小白 row, got ${xb.length}`)
  assert.equal(xb[0]!.anchorId, XIAOBAI_ID)
  assert.equal(Number(xb[0]!.gmv ?? xb[0]!.totalGmv), 36029.9 + 817 + 1)
  console.log('  ✓ leaderboard single 小白 row with merged gmv')
  console.log('\nALL PASS')
  setAnchorConfigCacheForTests(null)
}

main()
