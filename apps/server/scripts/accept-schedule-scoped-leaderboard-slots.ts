/**
 * 单日主播业绩：未排班不补空卡；稀疏休假人工日不误裁；完整人工日认删班。
 */
import assert from 'node:assert/strict'
import {
  createEmptyAnchorLeaderboardRow,
  ensureAnchorPerformanceLeaderboardSlots,
  filterLeaderboardRowsBySingleDaySchedule,
  shouldUseManualOnlyScheduleForLeaderboardCards,
} from '../src/services/anchor-performance-attribution.service'

function main() {
  const padded = ensureAnchorPerformanceLeaderboardSlots([], '2026-08-17')
  assert.ok(padded.length >= 1, 'sync 路径仍可为在职主播补空卡（多日/兼容）')

  // —— 裁剪纯函数 ——
  const scheduled = new Set(['子杰', '飞云'])
  const original = new Set(['小小'])
  const merged = [
    createEmptyAnchorLeaderboardRow('1', '子杰', '#1'),
    createEmptyAnchorLeaderboardRow('2', '飞云', '#2'),
    createEmptyAnchorLeaderboardRow('3', '小白', '#3'),
    {
      ...createEmptyAnchorLeaderboardRow('4', '小小', '#4'),
      gmv: 50,
      totalGmv: 50,
      orderCount: 1,
    },
    createEmptyAnchorLeaderboardRow('5', '未归属', '#5'),
  ]
  const filtered = filterLeaderboardRowsBySingleDaySchedule(merged, original, scheduled)
  assert.deepEqual(
    filtered.map((r) => r.anchorName).sort(),
    ['子杰', '飞云', '小小', '未归属'].sort(),
  )
  assert.ok(!filtered.some((r) => r.anchorName === '小白'))

  // 读排班失败 fail-closed：空名单只留有业绩 / 未归属
  const none = filterLeaderboardRowsBySingleDaySchedule(merged, original, new Set())
  assert.deepEqual(none.map((r) => r.anchorName).sort(), ['小小', '未归属'].sort())

  // —— 是否切纯人工日 ——
  assert.equal(
    shouldUseManualOnlyScheduleForLeaderboardCards({
      manualRows: [],
      expectedTemplateCount: 6,
    }),
    false,
    '无人工行 → 不切纯人工',
  )

  assert.equal(
    shouldUseManualOnlyScheduleForLeaderboardCards({
      manualRows: [
        { enabled: true, isOnLeave: true, note: '业绩页标记休假' },
      ],
      expectedTemplateCount: 6,
    }),
    false,
    '仅业绩页占位请假 → 不切纯人工',
  )

  assert.equal(
    shouldUseManualOnlyScheduleForLeaderboardCards({
      manualRows: [
        { enabled: true, isOnLeave: true, note: null },
        { enabled: true, isOnLeave: true, note: '' },
      ],
      expectedTemplateCount: 6,
    }),
    false,
    '稀疏休假物化（全请假且少于模板数）→ 不切纯人工',
  )

  assert.equal(
    shouldUseManualOnlyScheduleForLeaderboardCards({
      manualRows: [
        { enabled: true, isOnLeave: false, note: null },
        { enabled: true, isOnLeave: false, note: null },
        { enabled: true, isOnLeave: false, note: null },
        { enabled: true, isOnLeave: false, note: null },
        { enabled: true, isOnLeave: false, note: null },
      ],
      expectedTemplateCount: 6,
    }),
    true,
    '删班后仍有工作班人工行 → 切纯人工（隐藏被删主播）',
  )

  assert.equal(
    shouldUseManualOnlyScheduleForLeaderboardCards({
      manualRows: [
        { enabled: true, isOnLeave: false, note: null },
        { enabled: true, isOnLeave: true, note: null },
      ],
      expectedTemplateCount: 6,
    }),
    true,
    '含工作班的人工日 → 切纯人工',
  )

  console.log('OK schedule-scoped single-day leaderboard slots')
}

main()
