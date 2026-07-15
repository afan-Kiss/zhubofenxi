/**
 * 真实直播时段订单归属单元验收
 * 用法: npx tsx apps/server/scripts/verify-live-session-order-attribution.ts
 */
import type { DailyReportLiveSession } from '../src/services/daily-report-live-sessions.service'
import {
  parseDailyReportLiveSessionBounds,
} from '../src/services/anchor-live-session-order-attribution.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function makeSession(partial: Partial<DailyReportLiveSession>): DailyReportLiveSession {
  return {
    liveId: '1',
    liveName: '拾玉居和田玉',
    liveAccountName: '拾玉居和田玉',
    startTime: '2026-07-02 09:25:04',
    endTime: '2026-07-02 14:00:32',
    durationMinutes: 275,
    durationText: '4小时35分',
    sourceShopCode: 'shiyuju',
    sourceShopName: '拾玉居和田玉',
    sellerRealIncomeAmtYuan: 0,
    dealOrderCnt: 0,
    refundAmtYuan: 0,
    viewSessionCount: null,
    joinUserCount: null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: null,
    dealUserCount: null,
    dealConversionRate: null,
    newFollowerRate: null,
    coverClickRate: null,
    stay60sUserCount: null,
    impressionCount: null,
    viewPayRate: null,
    ...partial,
  }
}

function run(): void {
  const issues: string[] = []

  const bounds = parseDailyReportLiveSessionBounds(makeSession({}))
  assert(bounds != null, '应解析真实直播起止', issues)
  const payEarly = Date.parse('2026-07-02T09:25:04+08:00')
  const payBeforeSchedule = Date.parse('2026-07-02T09:20:00+08:00')
  const payAfter = Date.parse('2026-07-02T14:00:32+08:00')
  const payLate = Date.parse('2026-07-02T14:05:00+08:00')
  assert(bounds != null && payEarly >= bounds.startMs && payEarly <= bounds.endMs, '开播时刻应计入', issues)
  assert(
    bounds != null && payBeforeSchedule < bounds.startMs,
    '排班前但直播未开始的支付不应命中',
    issues,
  )
  assert(bounds != null && payAfter >= bounds.startMs && payAfter <= bounds.endMs, '下播时刻应计入', issues)
  assert(bounds != null && payLate > bounds.endMs, '下播后的支付不应命中该场', issues)

  const openEnded = parseDailyReportLiveSessionBounds(
    makeSession({ endTime: '—' }),
  )
  assert(openEnded != null, '无下播时间应回退到当日末', issues)

  if (issues.length) {
    console.error('verify:live-session-order-attribution FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:live-session-order-attribution OK')
}

run()
