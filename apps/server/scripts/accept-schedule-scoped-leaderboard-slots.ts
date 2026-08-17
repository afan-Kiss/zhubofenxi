/**
 * 单日主播业绩：未排班主播不补空卡；有业绩仍保留。
 */
import assert from 'node:assert/strict'
import {
  createEmptyAnchorLeaderboardRow,
  ensureAnchorPerformanceLeaderboardSlots,
  filterLeaderboardRowsBySingleDaySchedule,
} from '../src/services/anchor-performance-attribution.service'

function main() {
  const padded = ensureAnchorPerformanceLeaderboardSlots([], '2026-08-17')
  assert.ok(padded.length >= 1, 'sync 路径仍可为在职主播补空卡（多日/兼容）')

  const scheduled = new Set(['子杰', '飞云'])
  const original = new Set(['小小']) // 未排班但有聚合
  const merged = [
    createEmptyAnchorLeaderboardRow('1', '子杰', '#1'),
    createEmptyAnchorLeaderboardRow('2', '飞云', '#2'),
    createEmptyAnchorLeaderboardRow('3', '小白', '#3'), // 在职空卡但不在当日排班 → 应去掉
    {
      ...createEmptyAnchorLeaderboardRow('4', '小小', '#4'),
      gmv: 50,
      totalGmv: 50,
      orderCount: 1,
    },
    createEmptyAnchorLeaderboardRow('5', '未归属', '#5'),
  ]

  const filtered = filterLeaderboardRowsBySingleDaySchedule(merged, original, scheduled)
  const names = filtered.map((r) => r.anchorName)
  assert.deepEqual(names.sort(), ['子杰', '飞云', '小小', '未归属'].sort())
  assert.ok(!names.includes('小白'), '未排班空卡应隐藏')
  assert.ok(names.includes('小小'), '有业绩未排班仍保留')

  // 空排班日：只留有业绩 / 未归属
  const none = filterLeaderboardRowsBySingleDaySchedule(merged, original, new Set())
  assert.deepEqual(
    none.map((r) => r.anchorName).sort(),
    ['小小', '未归属'].sort(),
  )

  console.log('OK schedule-scoped single-day leaderboard slots')
}

main()
