/**
 * 离职后幽灵主播归属验收（7 场景）
 * npx tsx apps/server/scripts/verify-offboard-attribution-ghosts.ts
 */
import assert from 'node:assert/strict'
import {
  doesAnchorEffectiveIntervalOverlapRange,
  isAnchorEffectiveOnDate,
} from '../src/utils/anchor-effective-date.util'
import {
  isAnchorAutoAttributableOnDate,
  setAnchorConfigCacheForTests,
  setAttributionLifecycleExtrasForTests,
} from '../src/services/anchor.service'
import {
  ensureAnchorPerformanceLeaderboardSlots,
  resolveShopSessionAnchorFromLiveAccount,
  resolveShopSessionAnchorName,
  shouldKeepLeaderboardAnchorRow,
  shouldPadEmptyAnchorSlot,
} from '../src/services/anchor-performance-attribution.service'
import type { AnchorConfig } from '../src/types/analysis'
import { CANONICAL_ATTRIBUTION_VERSION } from '../src/services/business-cache-fingerprint'

const OFFBOARD_TO = '2026-07-16'
const AFTER = '2026-07-17'
const TODAY = '2026-07-19'

function buildConfig(): AnchorConfig {
  return {
    anchors: [
      {
        id: 'a-zijie',
        name: '子杰',
        color: '#f00',
        enabled: true,
        attributionMode: 'schedule',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
      {
        id: 'a-feiyun',
        name: '飞云',
        color: '#0f0',
        enabled: true,
        attributionMode: 'schedule',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
      {
        id: 'a-chengcheng',
        name: '橙橙',
        color: '#00f',
        enabled: true,
        attributionMode: 'schedule',
        effectiveFrom: AFTER,
        effectiveTo: null,
      },
      {
        id: 'a-xiaobai',
        name: '小白',
        color: '#abc',
        enabled: true,
        attributionMode: 'schedule',
        effectiveFrom: '2026-06-18',
        effectiveTo: null,
      },
    ],
    timeRules: [],
  }
}

function seedOffboarded() {
  setAnchorConfigCacheForTests(buildConfig())
  setAttributionLifecycleExtrasForTests([
    {
      id: 'a-xiaohong',
      name: '小红',
      color: '#f88',
      enabled: false,
      attributionMode: 'schedule',
      effectiveFrom: '2026-01-01',
      effectiveTo: OFFBOARD_TO,
      deletedAt: '2026-07-17T00:00:00.000Z',
    },
    {
      id: 'a-xiaoyi',
      name: '小艺',
      color: '#88f',
      enabled: false,
      attributionMode: 'schedule',
      effectiveFrom: '2026-01-01',
      effectiveTo: OFFBOARD_TO,
      deletedAt: '2026-07-17T00:00:00.000Z',
    },
  ])
}

function main() {
  console.log('verify-offboard-attribution-ghosts\n')
  seedOffboarded()

  // 1) 店铺场次：离职次日和田雅玉早场不得归小红，应归橙橙（或未命中软删）
  assert.equal(resolveShopSessionAnchorName('hetian', 'morning', AFTER), '橙橙')
  const shopAfter = resolveShopSessionAnchorFromLiveAccount(
    '和田雅玉',
    new Date(`${AFTER}T10:00:00+08:00`),
  )
  assert.equal(shopAfter?.anchorName, '橙橙')
  assert.equal(isAnchorAutoAttributableOnDate('小红', AFTER), false)
  console.log('  ✓ 1 店铺场次：离职次日不归小红，归橙橙')

  // 2) 离职当天仍可自动归属（含软删 + enabled=false）
  assert.equal(isAnchorEffectiveOnDate({ effectiveTo: OFFBOARD_TO, enabled: false }, OFFBOARD_TO), true)
  assert.equal(isAnchorAutoAttributableOnDate('小红', OFFBOARD_TO), true)
  assert.equal(isAnchorAutoAttributableOnDate('小艺', OFFBOARD_TO), true)
  const shopLastDay = resolveShopSessionAnchorFromLiveAccount(
    '和田雅玉',
    new Date(`${OFFBOARD_TO}T10:30:00+08:00`),
  )
  assert.equal(shopLastDay?.anchorName, '小红')
  assert.equal(shopLastDay?.anchorId, 'a-xiaohong')
  console.log('  ✓ 2 离职当天（含软删）仍可店铺场次归属')

  // 3) 晚场小艺：离职次日禁止
  assert.equal(isAnchorAutoAttributableOnDate('小艺', AFTER), false)
  const eveAfter = resolveShopSessionAnchorFromLiveAccount(
    '和田雅玉',
    new Date(`${AFTER}T20:00:00+08:00`),
  )
  assert.equal(eveAfter?.anchorName, '橙橙')
  const eveLast = resolveShopSessionAnchorFromLiveAccount(
    '和田雅玉',
    new Date(`${OFFBOARD_TO}T20:00:00+08:00`),
  )
  assert.equal(eveLast?.anchorName, '小艺')
  console.log('  ✓ 3 晚场：离职当天小艺 / 次日橙橙')

  // 4) 空卡：离职次日不补小红/小艺
  assert.equal(
    shouldPadEmptyAnchorSlot(
      { enabled: false, effectiveFrom: '2026-01-01', effectiveTo: OFFBOARD_TO },
      AFTER,
    ),
    false,
  )
  const padded = ensureAnchorPerformanceLeaderboardSlots([], TODAY)
  const names = padded.map((r) => r.anchorName)
  assert.ok(!names.includes('小红'), `unexpected 小红 in ${names.join(',')}`)
  assert.ok(!names.includes('小艺'), `unexpected 小艺 in ${names.join(',')}`)
  assert.ok(names.includes('橙橙'), '橙橙应有空卡')
  assert.ok(!padded.some((r) => String(r.anchorId).startsWith('extra-')), '禁止 extra-*')
  console.log('  ✓ 4 离职后不补小红/小艺空卡，无 extra-*')

  // 5) 历史日：区间重叠时保留业绩行
  assert.equal(
    doesAnchorEffectiveIntervalOverlapRange(
      { effectiveFrom: '2026-01-01', effectiveTo: OFFBOARD_TO },
      '2026-07-10',
      '2026-07-18',
    ),
    true,
  )
  assert.equal(
    shouldKeepLeaderboardAnchorRow(
      { anchorName: '小红', anchorId: 'a-xiaohong' },
      '2026-07-10',
      '2026-07-18',
    ),
    true,
  )
  assert.equal(isAnchorAutoAttributableOnDate('小红', '2026-07-15'), true)
  console.log('  ✓ 5 历史区间仍可展示/归属小红')

  // 6) 残留排班名：查询完全落在离职后 → 隐藏行
  assert.equal(
    shouldKeepLeaderboardAnchorRow(
      { anchorName: '小红', anchorId: 'a-xiaohong' },
      TODAY,
      TODAY,
    ),
    false,
  )
  const residual = ensureAnchorPerformanceLeaderboardSlots(
    [
      {
        anchorName: '小红',
        anchorId: 'a-xiaohong',
        color: '#f88',
        gmv: 100,
        totalGmv: 100,
        orderCount: 1,
        actualSignedCount: 0,
        actualSignedAmount: 0,
        qualityReturnCount: 0,
        qualityReturnAmount: 0,
        refundAmount: 0,
        onlineGmv: 100,
        offlineGmv: 0,
        offlineDealCount: 0,
      } as never,
    ],
    TODAY,
  )
  assert.ok(!residual.some((r) => r.anchorName === '小红'))
  console.log('  ✓ 6 离职后查询隐藏残留小红行')

  // 7) 日期区间：仅看 endDate 会误伤；重叠 helper + startDate 过滤正确
  const rangeRows = ensureAnchorPerformanceLeaderboardSlots(
    [
      {
        anchorName: '小红',
        anchorId: 'a-xiaohong',
        color: '#f88',
        gmv: 50,
        totalGmv: 50,
        orderCount: 1,
        actualSignedCount: 0,
        actualSignedAmount: 0,
        qualityReturnCount: 0,
        qualityReturnAmount: 0,
        refundAmount: 0,
        onlineGmv: 50,
        offlineGmv: 0,
        offlineDealCount: 0,
      } as never,
    ],
    '2026-07-18',
    { startDate: '2026-07-10' },
  )
  assert.ok(rangeRows.some((r) => r.anchorName === '小红'), '含在职日的区间应保留小红')
  const afterOnly = ensureAnchorPerformanceLeaderboardSlots(
    [
      {
        anchorName: '小红',
        anchorId: 'a-xiaohong',
        color: '#f88',
        gmv: 50,
        totalGmv: 50,
        orderCount: 1,
        actualSignedCount: 0,
        actualSignedAmount: 0,
        qualityReturnCount: 0,
        qualityReturnAmount: 0,
        refundAmount: 0,
        onlineGmv: 50,
        offlineGmv: 0,
        offlineDealCount: 0,
      } as never,
    ],
    TODAY,
    { startDate: AFTER },
  )
  assert.ok(!afterOnly.some((r) => r.anchorName === '小红'), '完全离职后区间应隐藏小红')
  console.log('  ✓ 7 日期区间重叠过滤正确')

  assert.equal(CANONICAL_ATTRIBUTION_VERSION, 'canonical-v5-offboard-date-2026-07-19')
  console.log('  ✓ CANONICAL_ATTRIBUTION_VERSION bumped\n')
  console.log('ALL PASS')
  setAnchorConfigCacheForTests(null)
}

main()
