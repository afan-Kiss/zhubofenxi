/**
 * 真实直播按排班交集切段验收
 * 用法: npm run verify:anchor-live-session-schedule-segment
 */
import assert from 'node:assert/strict'
import type { EffectiveScheduleRow } from '../src/services/anchor-daily-schedule.service'
import type { DailyReportLiveSession } from '../src/services/daily-report-live-sessions.service'
import {
  assignDailyReportLiveSessionsToAnchors,
  buildDailyReportLiveSessionDedupeKey,
} from '../src/services/daily-report-live-sessions.service'
import {
  buildPerSessionLivePeriodText,
} from '../src/services/daily-report-live-schedule-match.service'
import { detectScheduleConflicts, buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'
import { validateScheduleDraft } from '../src/services/anchor-schedule-template.service'
import {
  clearLiveSessionOrderAttributionCache,
  parseDailyReportLiveSessionBounds,
} from '../src/services/anchor-live-session-order-attribution.service'
import type { GoodReviewShopKey } from '../src/config/good-review-shops.constants'

const DATE = '2026-07-04'
const SHOP = 'XY祥钰珠宝'

function scheduleRow(
  partial: Partial<EffectiveScheduleRow> &
    Pick<
      EffectiveScheduleRow,
      'rowId' | 'anchorName' | 'shopName' | 'startTime' | 'endTime' | 'startAt' | 'endAt'
    >,
): EffectiveScheduleRow {
  return {
    source: 'manual',
    liveRoomName: partial.shopName,
    enabled: true,
    confirmed: true,
    ...partial,
  }
}

function liveSession(
  liveId: string,
  startHm: string,
  endHm: string,
): DailyReportLiveSession {
  const startTime = `${DATE} ${startHm}:00`
  const endTime = `${DATE} ${endHm}:00`
  const startMs = Date.parse(`${DATE}T${startHm}:00+08:00`)
  const endMs = Date.parse(`${DATE}T${endHm}:00+08:00`)
  return {
    liveId,
    liveName: SHOP,
    liveAccountName: SHOP,
    startTime,
    endTime,
    durationMinutes: Math.round((endMs - startMs) / 60_000),
    durationText: 'test',
    viewSessionCount: null,
    joinUserCount: null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: null,
    dealUserCount: null,
    sourceShopCode: 'xyxiangyu' as GoodReviewShopKey,
    sourceShopName: SHOP,
    sellerRealIncomeAmtYuan: 1000,
    dealOrderCnt: 10,
    refundAmtYuan: 0,
  }
}

function schedulesForScenario1And2(): EffectiveScheduleRow[] {
  return [
    scheduleRow({
      rowId: 'a-morning',
      anchorName: 'A',
      shopName: SHOP,
      startTime: '09:00',
      endTime: '14:00',
      startAt: `${DATE}T09:00:00+08:00`,
      endAt: `${DATE}T14:00:00+08:00`,
    }),
    scheduleRow({
      rowId: 'b-afternoon',
      anchorName: 'B',
      shopName: SHOP,
      startTime: '14:00',
      endTime: '18:00',
      startAt: `${DATE}T14:00:00+08:00`,
      endAt: `${DATE}T18:00:00+08:00`,
    }),
  ]
}

function anchorLivePeriod(
  assignment: ReturnType<typeof assignDailyReportLiveSessionsToAnchors>,
  anchorName: string,
): string {
  const sessions = assignment.byAnchor.get(anchorName) ?? []
  assert.equal(sessions.length, 1, `${anchorName} 应只有一段直播`)
  return buildPerSessionLivePeriodText(sessions)
}

function resolveAnchorFromClippedAssignment(
  assignment: ReturnType<typeof assignDailyReportLiveSessionsToAnchors>,
  payMs: number,
): string | null {
  for (const [anchorName, sessions] of assignment.byAnchor.entries()) {
    for (const session of sessions) {
      const bounds = parseDailyReportLiveSessionBounds(session)
      if (!bounds) continue
      if (payMs >= bounds.startMs && payMs <= bounds.endMs) return anchorName
    }
  }
  return null
}

async function main(): Promise<void> {
  const schedules = schedulesForScenario1And2()

  // 场景 1：整场 09:00-18:00 按排班切给 A/B
  const s1 = liveSession('live-full-day', '09:00', '18:00')
  const assign1 = assignDailyReportLiveSessionsToAnchors([s1], schedules, DATE)
  assert.equal(anchorLivePeriod(assign1, 'A'), '09:00~14:00', '场景1 A 时段')
  assert.equal(anchorLivePeriod(assign1, 'B'), '14:00~18:00', '场景1 B 时段')
  assert.equal(assign1.unassignedSessions.length, 0, '场景1 不应有未归属场次')
  console.log('PASS 场景1: 09:00-18:00 → A 09:00~14:00, B 14:00~18:00')

  // 场景 2：13:40-16:20 跨排班边界
  const s2 = liveSession('live-cross', '13:40', '16:20')
  const assign2 = assignDailyReportLiveSessionsToAnchors([s2], schedules, DATE)
  assert.equal(anchorLivePeriod(assign2, 'A'), '13:40~14:00', '场景2 A 时段')
  assert.equal(anchorLivePeriod(assign2, 'B'), '14:00~16:20', '场景2 B 时段')
  console.log('PASS 场景2: 13:40-16:20 → A 13:40~14:00, B 14:00~16:20')

  // 场景 3：同一主播两条 enabled 排班 → 保存失败
  const duplicateAnchorDraft = validateScheduleDraft(DATE, [
    {
      anchorName: '小红',
      shopName: SHOP,
      liveRoomName: SHOP,
      startTime: '09:00',
      endTime: '12:00',
    },
    {
      anchorName: '小红',
      shopName: SHOP,
      liveRoomName: SHOP,
      startTime: '14:00',
      endTime: '18:00',
    },
  ])
  assert.equal(duplicateAnchorDraft.ok, false, '场景3 应校验失败')
  assert.ok(
    duplicateAnchorDraft.conflicts.some((c) => c.message.includes('小红今天已经有一条排班了')),
    '场景3 应有清晰报错文案',
  )

  const shopOverlap = detectScheduleConflicts([
    {
      anchorName: '小艺',
      shopName: SHOP,
      liveRoomName: SHOP,
      ...buildScheduleBounds(DATE, '14:00', '18:00'),
    },
    {
      anchorName: '小白',
      shopName: SHOP,
      liveRoomName: SHOP,
      ...buildScheduleBounds(DATE, '15:00', '17:00'),
    },
  ])
  assert.ok(
    shopOverlap.some(
      (c) =>
        c.message.includes('不能再排其他主播') &&
        (c.message.includes('已经排了小艺') || c.message.includes('已经排了小白')),
    ),
    `场景3 同店重叠应有店铺冲突文案，got: ${shopOverlap.map((c) => c.message).join('; ')}`,
  )
  console.log('PASS 场景3: 同一主播多条排班 / 同店重叠保存失败')

  // 场景 4：订单按裁剪时段归属
  clearLiveSessionOrderAttributionCache()
  const pay1350 = Date.parse(`${DATE}T13:50:00+08:00`)
  const pay1430 = Date.parse(`${DATE}T14:30:00+08:00`)

  const mockAssignment = assignDailyReportLiveSessionsToAnchors([s2], schedules, DATE)
  assert.equal(mockAssignment.byAnchor.get('A')?.length, 1)
  assert.equal(mockAssignment.byAnchor.get('B')?.length, 1)

  const aSession = mockAssignment.byAnchor.get('A')![0]!
  const bSession = mockAssignment.byAnchor.get('B')![0]!
  assert.ok(aSession.startTime.includes('13:40') && aSession.endTime.includes('14:00:00'))
  assert.ok(bSession.startTime.includes('14:00:00') && bSession.endTime.includes('16:20:00'))

  assert.equal(resolveAnchorFromClippedAssignment(mockAssignment, pay1350), 'A', '13:50 应归 A')
  assert.equal(resolveAnchorFromClippedAssignment(mockAssignment, pay1430), 'B', '14:30 应归 B')
  console.log('PASS 场景4: 13:50→A, 14:30→B')

  // 切段 liveId 不应互相去重
  const keyA = buildDailyReportLiveSessionDedupeKey(aSession)
  const keyB = buildDailyReportLiveSessionDedupeKey(bSession)
  assert.notEqual(keyA, keyB, 'A/B 切段 dedupe key 应不同')

  console.log('verify-anchor-live-session-schedule-segment: ALL PASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
