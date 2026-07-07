/**
 * 同主播同一天多场直播保留验收
 *
 * npm run verify:anchor-multi-session-same-anchor
 */
import assert from 'node:assert/strict'
import type { EffectiveScheduleRow } from '../src/services/anchor-daily-schedule.service'
import type { DailyReportLiveSession } from '../src/services/daily-report-live-sessions.service'
import {
  assignDailyReportLiveSessionsToAnchors,
  sumUniqueDailyReportLiveDurationMinutes,
} from '../src/services/daily-report-live-sessions.service'
import {
  clearLiveSessionOrderAttributionCache,
  parseDailyReportLiveSessionBounds,
} from '../src/services/anchor-live-session-order-attribution.service'
import type { GoodReviewShopKey } from '../src/config/good-review-shops.constants'

const DATE = '2026-07-08'
const SHOP = '和田雅玉'

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

function liveSession(liveId: string, startHm: string, endHm: string): DailyReportLiveSession {
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
    sourceShopCode: 'hetianyayu' as GoodReviewShopKey,
    sourceShopName: SHOP,
    sellerRealIncomeAmtYuan: 1000,
    dealOrderCnt: 10,
    refundAmtYuan: 0,
  }
}

function resolveAnchorFromAssignment(
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
  console.log('verify-anchor-multi-session-same-anchor\n')

  const schedules = [
    scheduleRow({
      rowId: 'morning',
      anchorName: '小艺',
      shopName: SHOP,
      startTime: '09:30',
      endTime: '14:00',
      startAt: `${DATE}T09:30:00+08:00`,
      endAt: `${DATE}T14:00:00+08:00`,
    }),
    scheduleRow({
      rowId: 'evening',
      anchorName: '小艺',
      shopName: SHOP,
      startTime: '14:00',
      endTime: '18:30',
      startAt: `${DATE}T14:00:00+08:00`,
      endAt: `${DATE}T18:30:00+08:00`,
    }),
  ]

  const morningLive = liveSession('live-morning', '09:35', '13:55')
  const eveningLive = liveSession('live-evening', '14:05', '18:10')
  const duplicateEvening = { ...eveningLive }

  const assignment = assignDailyReportLiveSessionsToAnchors(
    [morningLive, eveningLive, duplicateEvening],
    schedules,
    DATE,
  )

  const xiaoyiSessions = assignment.byAnchor.get('小艺') ?? []
  assert.equal(xiaoyiSessions.length, 2, '同主播两场不重叠直播都应保留')
  console.log('  ✓ 同主播同一天两场不重叠直播都被保留')

  const totalDuration = sumUniqueDailyReportLiveDurationMinutes(assignment.assignedSessions)
  const expectedDuration = xiaoyiSessions.reduce((s, x) => s + x.durationMinutes, 0)
  assert.ok(totalDuration >= expectedDuration, '两场时长都应计入')
  console.log(`  ✓ 两场时长合计 ${totalDuration} 分钟`)

  clearLiveSessionOrderAttributionCache()
  const paySecondSession = Date.parse(`${DATE}T16:30:00+08:00`)
  const hit = resolveAnchorFromAssignment(assignment, paySecondSession)
  assert.equal(hit, '小艺', '支付时间落在第二场应命中 live_session')
  console.log('  ✓ 第二场时段内订单命中 live_session')

  const assignmentDup = assignDailyReportLiveSessionsToAnchors(
    [eveningLive, { ...eveningLive }],
    [schedules[1]!],
    DATE,
  )
  const dupDuration = sumUniqueDailyReportLiveDurationMinutes(assignmentDup.assignedSessions)
  assert.equal(dupDuration, eveningLive.durationMinutes, '完全重复 liveId 不重复计时')
  console.log('  ✓ 完全重复 liveId 不重复计时')

  console.log('\nPASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
