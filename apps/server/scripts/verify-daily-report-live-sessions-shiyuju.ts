/**
 * 拾玉居单店 sellerLiveDetailData 样本验收（不代表全系统场次总数）
 * 用法: npx tsx apps/server/scripts/verify-daily-report-live-sessions-shiyuju.ts
 */
import assert from 'node:assert/strict'
import type { EffectiveScheduleRow } from '../src/services/anchor-daily-schedule.service'
import type { DailyReportLiveSession } from '../src/services/daily-report-live-sessions.service'
import {
  assignDailyReportLiveSessionsToAnchors,
  buildDailyReportLiveSessionDedupeKey,
  dedupeDailyReportLiveSessions,
} from '../src/services/daily-report-live-sessions.service'
import {
  buildDailyReportLiveScheduleFields,
  buildLiveSessionCountSummary,
  buildPerSessionLivePeriodText,
} from '../src/services/daily-report-live-schedule-match.service'

const DATE = '2026-07-01'

function scheduleRow(
  partial: Partial<EffectiveScheduleRow> &
    Pick<EffectiveScheduleRow, 'rowId' | 'anchorName' | 'shopName' | 'startTime' | 'endTime' | 'startAt' | 'endAt'>,
): EffectiveScheduleRow {
  return {
    source: 'manual',
    liveRoomName: partial.shopName,
    enabled: true,
    confirmed: true,
    ...partial,
  }
}

const SCHEDULES: EffectiveScheduleRow[] = [
  scheduleRow({
    rowId: 'zijie',
    anchorName: '子杰',
    shopName: '拾玉居和田玉',
    startTime: '09:30',
    endTime: '14:00',
    startAt: `${DATE}T09:30:00+08:00`,
    endAt: `${DATE}T14:00:00+08:00`,
    note: '早场·拾玉居和田玉',
  }),
  scheduleRow({
    rowId: 'xiaohong',
    anchorName: '小红',
    shopName: '和田雅玉',
    startTime: '09:30',
    endTime: '14:00',
    startAt: `${DATE}T09:30:00+08:00`,
    endAt: `${DATE}T14:00:00+08:00`,
    note: '早场·和田雅玉',
  }),
  scheduleRow({
    rowId: 'xiaobai',
    anchorName: '小白',
    shopName: 'XY祥钰珠宝',
    startTime: '14:00',
    endTime: '18:30',
    startAt: `${DATE}T14:00:00+08:00`,
    endAt: `${DATE}T18:30:00+08:00`,
    note: '午场·XY祥钰珠宝',
  }),
  scheduleRow({
    rowId: 'xiaoyi',
    anchorName: '小艺',
    shopName: '和田雅玉',
    startTime: '14:00',
    endTime: '18:30',
    startAt: `${DATE}T14:00:00+08:00`,
    endAt: `${DATE}T18:30:00+08:00`,
    note: '午场·和田雅玉',
  }),
  scheduleRow({
    rowId: 'feiyun',
    anchorName: '飞云',
    shopName: '拾玉居和田玉',
    startTime: '18:30',
    endTime: '23:00',
    startAt: `${DATE}T18:30:00+08:00`,
    endAt: `${DATE}T23:00:00+08:00`,
    note: '晚场·拾玉居和田玉',
  }),
]

function harSession(params: {
  liveId: string
  liveStart: string
  liveEnd: string
  durationMinutes: number
  sellerRealIncomeAmtYuan: number
  dealOrderCnt: number
  refundAmtYuan: number
}): DailyReportLiveSession {
  return {
    liveId: params.liveId,
    liveName: '拾玉居和田玉',
    startTime: params.liveStart,
    endTime: params.liveEnd,
    durationMinutes: params.durationMinutes,
    durationText: `${Math.floor(params.durationMinutes / 60)}小时${params.durationMinutes % 60}分`,
    sourceShopCode: 'shiyuju',
    sourceShopName: '拾玉居和田玉',
    sellerRealIncomeAmtYuan: params.sellerRealIncomeAmtYuan,
    dealOrderCnt: params.dealOrderCnt,
    refundAmtYuan: params.refundAmtYuan,
    viewSessionCount: null,
    joinUserCount: null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: null,
    dealUserCount: null,
  }
}

/** 拾玉居 HAR sellerLiveDetailData 真实两场 */
const SHIYUJU_REAL_SESSIONS: DailyReportLiveSession[] = [
  harSession({
    liveId: '570343544189288405',
    liveStart: `${DATE}T09:44:18+08:00`,
    liveEnd: `${DATE}T14:12:55+08:00`,
    durationMinutes: 269,
    sellerRealIncomeAmtYuan: 7179,
    dealOrderCnt: 5,
    refundAmtYuan: 0,
  }),
  harSession({
    liveId: '570344088694093157',
    liveStart: `${DATE}T18:35:24+08:00`,
    liveEnd: `${DATE}T23:09:16+08:00`,
    durationMinutes: 274,
    sellerRealIncomeAmtYuan: 11347,
    dealOrderCnt: 5,
    refundAmtYuan: 1999,
  }),
]

/** 历史错误数据：非 sellerLiveDetailData 真实场次（不应进入日报） */
const PSEUDO_SESSIONS: DailyReportLiveSession[] = [
  harSession({
    liveId: 'pseudo-0955',
    liveStart: `${DATE}T09:55:00+08:00`,
    liveEnd: `${DATE}T13:57:00+08:00`,
    durationMinutes: 242,
    sellerRealIncomeAmtYuan: 0,
    dealOrderCnt: 0,
    refundAmtYuan: 0,
  }),
  harSession({
    liveId: 'pseudo-1419',
    liveStart: `${DATE}T14:19:00+08:00`,
    liveEnd: `${DATE}T14:30:00+08:00`,
    durationMinutes: 11,
    sellerRealIncomeAmtYuan: 0,
    dealOrderCnt: 0,
    refundAmtYuan: 0,
  }),
  harSession({
    liveId: 'pseudo-1420',
    liveStart: `${DATE}T14:20:00+08:00`,
    liveEnd: `${DATE}T14:30:00+08:00`,
    durationMinutes: 10,
    sellerRealIncomeAmtYuan: 0,
    dealOrderCnt: 0,
    refundAmtYuan: 0,
  }),
]

function assertAnchorSessions(
  anchorName: string,
  sessions: DailyReportLiveSession[],
  expected: {
    count: number
    liveId?: string
    timeLines: string[]
    forbiddenTimeLines?: string[]
    incomeYuan?: number
    dealOrderCnt?: number
    refundAmtYuan?: number
  },
) {
  assert.equal(sessions.length, expected.count, `${anchorName} session count`)
  if (expected.liveId) {
    assert.equal(sessions[0]!.liveId, expected.liveId, `${anchorName} liveId`)
  }
  const built = buildDailyReportLiveScheduleFields({
    anchorName,
    allSessions: sessions,
    scheduleRows: SCHEDULES,
  })
  const periodText = buildPerSessionLivePeriodText(sessions)
  const timeRange = built.liveTimeRange
  for (const line of expected.timeLines) {
    assert.ok(
      periodText.includes(line.replace(/–/g, '~')) || timeRange.includes(line.replace(/~/g, '–')),
      `${anchorName} should include live time ${line}, got period=${periodText} range=${timeRange}`,
    )
  }
  for (const bad of expected.forbiddenTimeLines ?? []) {
    assert.ok(
      !periodText.includes(bad) && !timeRange.includes(bad),
      `${anchorName} must not include pseudo time ${bad}`,
    )
  }
  const summary = buildLiveSessionCountSummary(sessions)
  if (expected.count > 1) {
    assert.match(summary, /直播 \d+ 场 · 合计/, `${anchorName} multi-session summary`)
  }
  if (expected.incomeYuan != null) {
    assert.equal(
      sessions.reduce((s, x) => s + x.sellerRealIncomeAmtYuan, 0),
      expected.incomeYuan,
      `${anchorName} income`,
    )
  }
  if (expected.dealOrderCnt != null) {
    assert.equal(
      sessions.reduce((s, x) => s + x.dealOrderCnt, 0),
      expected.dealOrderCnt,
      `${anchorName} deal orders`,
    )
  }
  if (expected.refundAmtYuan != null) {
    assert.equal(
      sessions.reduce((s, x) => s + x.refundAmtYuan, 0),
      expected.refundAmtYuan,
      `${anchorName} refund`,
    )
  }
  console.log(`PASS ${anchorName}: ${sessions.length} session(s), times=${periodText}`)
}

// 拾玉居单店真实场次 = 2
const dedupedReal = dedupeDailyReportLiveSessions(SHIYUJU_REAL_SESSIONS)
assert.equal(dedupedReal.length, 2, '拾玉居真实直播场次总数 = 2')
console.log('PASS 拾玉居真实场次总数 = 2')

// liveId 去重键含店铺
const key1 = buildDailyReportLiveSessionDedupeKey({
  sourceShopCode: 'shiyuju',
  liveId: '570343544189288405',
})
const key2 = buildDailyReportLiveSessionDedupeKey({
  sourceShopCode: 'hetianyayu',
  liveId: '570343544189288405',
})
assert.notEqual(key1, key2, 'dedupe key must include shop code')
console.log('PASS dedupe key = sourceShopCode + liveId')

const assignment = assignDailyReportLiveSessionsToAnchors(dedupedReal, SCHEDULES, DATE)
const zijieSessions = assignment.byAnchor.get('子杰') ?? []
const feiyunSessions = assignment.byAnchor.get('飞云') ?? []

assertAnchorSessions('子杰', zijieSessions, {
  count: 1,
  liveId: '570343544189288405',
  timeLines: ['09:44~14:12'],
  forbiddenTimeLines: ['09:55~13:57', '14:19~14:30', '14:20~14:30'],
  incomeYuan: 7179,
  dealOrderCnt: 5,
  refundAmtYuan: 0,
})

assertAnchorSessions('飞云', feiyunSessions, {
  count: 1,
  liveId: '570344088694093157',
  timeLines: ['18:35~23:09'],
  incomeYuan: 11347,
  dealOrderCnt: 5,
  refundAmtYuan: 1999,
})

// 若误混入伪场次，子杰不应出现 4 场
const polluted = dedupeDailyReportLiveSessions([...SHIYUJU_REAL_SESSIONS, ...PSEUDO_SESSIONS])
assert.equal(polluted.length, 5, 'polluted input has 5 distinct liveIds')
const pollutedAssignment = assignDailyReportLiveSessionsToAnchors(polluted, SCHEDULES, DATE)
const pollutedZijie = pollutedAssignment.byAnchor.get('子杰') ?? []
// 伪场次 14:19/14:20 与早场排班无重叠，不应归子杰；09:55 伪场次若存在会误归子杰
// 验收重点：仅真实 HAR 两场时子杰=1；伪场次不应让子杰变成 4 场
assert.ok(
  pollutedZijie.length < 4,
  `子杰 must not show 4 sessions when pseudo data mixed in, got ${pollutedZijie.length}`,
)
console.log(`PASS polluted mix: 子杰 has ${pollutedZijie.length} sessions (not 4)`)

// 全系统合并：四店各 2 场 → 合计 8（模拟，非写死全系统=2）
const allShopsMock: DailyReportLiveSession[] = []
for (const shopKey of ['shiyuju', 'hetianyayu', 'xiangyu', 'xyxiangyu'] as const) {
  allShopsMock.push(
    harSession({
      liveId: `${shopKey}-morning`,
      liveStart: `${DATE}T09:44:00+08:00`,
      liveEnd: `${DATE}T14:12:00+08:00`,
      durationMinutes: 268,
      sellerRealIncomeAmtYuan: 100,
      dealOrderCnt: 1,
      refundAmtYuan: 0,
    }),
    {
      ...harSession({
        liveId: `${shopKey}-evening`,
        liveStart: `${DATE}T18:35:00+08:00`,
        liveEnd: `${DATE}T23:09:00+08:00`,
        durationMinutes: 274,
        sellerRealIncomeAmtYuan: 200,
        dealOrderCnt: 2,
        refundAmtYuan: 0,
      }),
      sourceShopCode: shopKey,
      sourceShopName:
        shopKey === 'shiyuju'
          ? '拾玉居和田玉'
          : shopKey === 'hetianyayu'
            ? '和田雅玉'
            : shopKey === 'xiangyu'
              ? '祥钰珠宝'
              : 'XY祥钰珠宝',
    },
  )
}
const allDeduped = dedupeDailyReportLiveSessions(allShopsMock)
assert.equal(allDeduped.length, 8, '四店各两场合并 = 8')
console.log('PASS 四店合并日报场次 = 各店 sellerLiveDetailData 之和 (mock 8)')

console.log('verify-daily-report-live-sessions-shiyuju OK')
