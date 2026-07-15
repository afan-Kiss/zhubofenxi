/**
 * 日报：真实直播场次时间 vs 排班匹配验收
 * 用法: npx tsx apps/server/scripts/verify-daily-report-live-schedule-match.ts
 */
import assert from 'node:assert/strict'
import type { EffectiveScheduleRow } from '../src/services/anchor-daily-schedule.service'
import type { AnchorLiveSessionBrief } from '../src/services/anchor-live-sessions.service'
import {
  buildDailyReportLiveScheduleFields,
  computeScheduleOverlapMinutes,
  matchLiveSessionToBestScheduleRow,
  pickBestScheduleRowByOverlapForTest,
} from '../src/services/daily-report-live-schedule-match.service'

function scheduleRow(partial: Partial<EffectiveScheduleRow> & Pick<EffectiveScheduleRow, 'rowId' | 'anchorName' | 'shopName' | 'startTime' | 'endTime' | 'startAt' | 'endAt'>): EffectiveScheduleRow {
  return {
    source: 'manual',
    liveRoomName: partial.shopName,
    enabled: true,
    confirmed: true,
    ...partial,
  }
}

function session(
  liveName: string,
  start: string,
  end: string,
): AnchorLiveSessionBrief {
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  return {
    liveId: `${liveName}-${start}`,
    liveName,
    startTime: start,
    endTime: end,
    durationMinutes: Math.round((endMs - startMs) / 60_000),
    durationText: 'test',
    viewSessionCount: null,
    joinUserCount: null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: null,
    dealUserCount: null,
    coverClickRate: null,
    stay60sUserCount: null,
    impressionCount: null,
    viewPayRate: null,
  }
}

const DATE = '2026-07-01'
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

function assertLiveDisplay(
  name: string,
  anchorName: string,
  liveSession: AnchorLiveSessionBrief,
  expectLiveRange: string,
  expectScheduleRange: string,
) {
  const built = buildDailyReportLiveScheduleFields({
    anchorName,
    allSessions: [liveSession],
    scheduleRows: SCHEDULES,
  })
  assert.equal(built.liveTimeRange, expectLiveRange, `${name} liveTimeRange`)
  assert.notEqual(built.liveTimeRange, expectScheduleRange, `${name} must not use schedule as live time`)
  assert.equal(built.scheduleTimeRange, expectScheduleRange, `${name} scheduleTimeRange`)
  assert.equal(built.scheduleMatched, true, `${name} scheduleMatched`)
  console.log(`PASS ${name}: live=${built.liveTimeRange} schedule=${built.scheduleTimeRange}`)
}

assertLiveDisplay(
  '子杰/拾玉居',
  '子杰',
  session('拾玉居和田玉', `${DATE}T09:42:00+08:00`, `${DATE}T13:58:00+08:00`),
  '09:42–13:58',
  '09:30–14:00',
)

assertLiveDisplay(
  '小红/和田雅玉',
  '小红',
  session('和田雅玉', `${DATE}T10:05:00+08:00`, `${DATE}T13:40:00+08:00`),
  '10:05–13:40',
  '09:30–14:00',
)

assertLiveDisplay(
  '小艺/和田雅玉午场',
  '小艺',
  session('和田雅玉', `${DATE}T14:15:00+08:00`, `${DATE}T18:10:00+08:00`),
  '14:15–18:10',
  '14:00–18:30',
)

assertLiveDisplay(
  '飞云/拾玉居晚场',
  '飞云',
  session('拾玉居和田玉', `${DATE}T18:40:00+08:00`, `${DATE}T22:55:00+08:00`),
  '18:40–22:55',
  '18:30–23:00',
)

const boundaryStart = Date.parse(`${DATE}T13:50:00+08:00`)
const boundaryEnd = Date.parse(`${DATE}T14:20:00+08:00`)
const morningOverlap = computeScheduleOverlapMinutes(
  boundaryStart,
  boundaryEnd,
  Date.parse(`${DATE}T09:30:00+08:00`),
  Date.parse(`${DATE}T14:00:00+08:00`),
)
const afternoonOverlap = computeScheduleOverlapMinutes(
  boundaryStart,
  boundaryEnd,
  Date.parse(`${DATE}T14:00:00+08:00`),
  Date.parse(`${DATE}T18:30:00+08:00`),
)
assert.ok(afternoonOverlap > morningOverlap, 'boundary: afternoon overlap should win')
const boundaryRow = pickBestScheduleRowByOverlapForTest(
  boundaryStart,
  boundaryEnd,
  '和田雅玉',
  SCHEDULES,
)
assert.equal(boundaryRow?.anchorName, '小艺', 'boundary session maps to 小艺 afternoon')
console.log('PASS boundary 13:50–14:20 → 小艺')

const unmatched = buildDailyReportLiveScheduleFields({
  anchorName: '子杰',
  allSessions: [session('未知店铺', `${DATE}T08:00:00+08:00`, `${DATE}T09:00:00+08:00`)],
  scheduleRows: SCHEDULES,
})
assert.equal(unmatched.scheduleMatched, false, 'unmatched schedule')
assert.equal(unmatched.liveTimeRange, '—', 'unmatched anchor row has no forced live time')
const rawUnmatched = matchLiveSessionToBestScheduleRow(
  session('未知店铺', `${DATE}T08:00:00+08:00`, `${DATE}T09:00:00+08:00`),
  SCHEDULES,
)
assert.equal(rawUnmatched.scheduleRow, null, 'session without shop match')
assert.equal(rawUnmatched.matchReason, '未匹配排班')
console.log('PASS unmatched session not forced to schedule')

console.log('verify-daily-report-live-schedule-match OK')
