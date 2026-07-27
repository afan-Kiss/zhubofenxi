/**
 * 离职后幽灵主播归属验收（7 场景）
 * 与正式规则对齐：7.1 起和田早场固定回退→小白；橙橙仅 7.17 一日试播、不进固定回退。
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
const TRIAL = '2026-07-17'
const AFTER = '2026-07-18'
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
        enabled: false,
        attributionMode: 'schedule',
        effectiveFrom: TRIAL,
        effectiveTo: TRIAL,
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

  // 1) 店铺场次：离职次日和田雅玉早场不得归小红，应归小白；橙橙不进固定回退
  assert.equal(resolveShopSessionAnchorName('hetian', 'morning', TRIAL), '小白')
  assert.equal(resolveShopSessionAnchorName('hetian', 'morning', AFTER), '小白')
  const shopTrial = resolveShopSessionAnchorFromLiveAccount(
    '和田雅玉',
    new Date(`${TRIAL}T10:00:00+08:00`),
  )
  assert.equal(shopTrial?.anchorName, '小白')
  assert.equal(isAnchorAutoAttributableOnDate('小红', TRIAL), false)
  assert.equal(isAnchorAutoAttributableOnDate('橙橙', TRIAL), true)
  assert.equal(isAnchorAutoAttributableOnDate('橙橙', AFTER), false)
  console.log('  ✓ 1 店铺场次：离职后和田早场→小白；橙橙仅试播日可归因')

  // 2) 离职当天仍可自动归属（含软删 + enabled=false）；固定回退仍归小白（非小红）
  assert.equal(isAnchorEffectiveOnDate({ effectiveTo: OFFBOARD_TO, enabled: false }, OFFBOARD_TO), true)
  assert.equal(isAnchorAutoAttributableOnDate('小红', OFFBOARD_TO), true)
  assert.equal(isAnchorAutoAttributableOnDate('小艺', OFFBOARD_TO), true)
  const shopLastDay = resolveShopSessionAnchorFromLiveAccount(
    '和田雅玉',
    new Date(`${OFFBOARD_TO}T10:30:00+08:00`),
  )
  assert.equal(shopLastDay?.anchorName, '小白')
  assert.equal(shopLastDay?.anchorId, 'a-xiaobai')
  console.log('  ✓ 2 离职当天小红仍可归因；和田早场固定回退仍→小白')

  // 3) 晚场：7.1 起和田无固定回退；离职次日禁止小艺
  assert.equal(isAnchorAutoAttributableOnDate('小艺', TRIAL), false)
  assert.equal(resolveShopSessionAnchorName('hetian', 'evening', TRIAL), null)
  const eveAfter = resolveShopSessionAnchorFromLiveAccount(
    '和田雅玉',
    new Date(`${TRIAL}T20:00:00+08:00`),
  )
  assert.equal(eveAfter, null)
  console.log('  ✓ 3 和田晚场无固定回退；离职后小艺不可归因')

  // 4) 空卡：离职后不补小红/小艺；橙橙仅试播日有空卡；今日补小白
  assert.equal(
    shouldPadEmptyAnchorSlot(
      { enabled: false, effectiveFrom: '2026-01-01', effectiveTo: OFFBOARD_TO },
      AFTER,
    ),
    false,
  )
  const paddedTrial = ensureAnchorPerformanceLeaderboardSlots([], TRIAL)
  const trialNames = paddedTrial.map((r) => r.anchorName)
  assert.ok(trialNames.includes('橙橙'), '试播日橙橙应有空卡')
  assert.ok(trialNames.includes('小白'), '试播日小白应有空卡')

  const padded = ensureAnchorPerformanceLeaderboardSlots([], TODAY)
  const names = padded.map((r) => r.anchorName)
  assert.ok(!names.includes('小红'), `unexpected 小红 in ${names.join(',')}`)
  assert.ok(!names.includes('小艺'), `unexpected 小艺 in ${names.join(',')}`)
  assert.ok(!names.includes('橙橙'), '试播日后不得再补橙橙空卡')
  assert.ok(names.includes('小白'), '小白应有空卡')
  assert.ok(!padded.some((r) => String(r.anchorId).startsWith('extra-')), '禁止 extra-*')
  console.log('  ✓ 4 空卡：试播日含橙橙；之后不含小红/小艺/橙橙')

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

  assert.match(
    CANONICAL_ATTRIBUTION_VERSION,
    /^canonical-v8-xiaobai-hetian-morning-chengcheng-trial-2026-07-27$/,
  )
  console.log('  ✓ CANONICAL_ATTRIBUTION_VERSION v8\n')
  console.log('ALL PASS')
  setAnchorConfigCacheForTests(null)
}

main()
