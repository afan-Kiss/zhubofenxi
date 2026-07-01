import assert from 'node:assert/strict'
import {
  buildActualLivePeriodText,
  calculateAnchorAttendanceStatus,
  deriveSessionLabelFromSchedule,
  formatDisplaySessionLabel,
  matchManualSchedule,
  pickEarliestValidSession,
  pickLatestValidSessionEnd,
  type AnchorAttendanceStatus,
} from '../src/utils/anchor-attendance-status.util'
import type { EffectiveScheduleRow } from '../src/services/anchor-daily-schedule.service'
import type { AnchorLiveSessionBrief } from '../src/services/anchor-live-sessions.service'

function row(
  partial: Partial<EffectiveScheduleRow> &
    Pick<EffectiveScheduleRow, 'rowId' | 'startAt' | 'endAt' | 'startTime' | 'endTime'>,
): EffectiveScheduleRow {
  return {
    source: 'manual',
    anchorName: '测试主播',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    enabled: true,
    confirmed: true,
    ...partial,
  }
}

function runCase(name: string, status: AnchorAttendanceStatus, expect: Partial<AnchorAttendanceStatus>) {
  for (const [key, value] of Object.entries(expect)) {
    assert.equal((status as Record<string, unknown>)[key], value, `${name}: ${key}`)
  }
  console.log(`[verify-anchor-attendance] PASS ${name}`)
}

const STANDARD_SCHEDULES: EffectiveScheduleRow[] = [
  row({
    rowId: 'zijie',
    anchorName: '子杰',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '09:30',
    endTime: '14:30',
    startAt: '2026-07-01T09:30:00+08:00',
    endAt: '2026-07-01T14:30:00+08:00',
    note: '早场',
  }),
  row({
    rowId: 'xiaohong',
    anchorName: '小红',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '09:30',
    endTime: '14:30',
    startAt: '2026-07-01T09:30:00+08:00',
    endAt: '2026-07-01T14:30:00+08:00',
    note: '早场',
  }),
  row({
    rowId: 'xiaobai',
    anchorName: '小白',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '14:30',
    endTime: '18:30',
    startAt: '2026-07-01T14:30:00+08:00',
    endAt: '2026-07-01T18:30:00+08:00',
    note: '下午场',
  }),
  row({
    rowId: 'xiaoyi',
    anchorName: '小艺',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '14:30',
    endTime: '18:30',
    startAt: '2026-07-01T14:30:00+08:00',
    endAt: '2026-07-01T18:30:00+08:00',
    note: '下午场',
  }),
  row({
    rowId: 'feiyun',
    anchorName: '飞云',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '18:30',
    endTime: '22:30',
    startAt: '2026-07-01T18:30:00+08:00',
    endAt: '2026-07-01T22:30:00+08:00',
    note: '晚场',
  }),
]

const SESSION_CASES: Array<{ anchor: string; shop: string; expect: string }> = [
  { anchor: '子杰', shop: '拾玉居和田玉', expect: '早场·拾玉居和田玉' },
  { anchor: '小红', shop: '和田雅玉', expect: '早场·和田雅玉' },
  { anchor: '小白', shop: 'XY祥钰珠宝', expect: '下午场·XY祥钰珠宝' },
  { anchor: '小艺', shop: '和田雅玉', expect: '下午场·和田雅玉' },
  { anchor: '飞云', shop: '拾玉居和田玉', expect: '晚场·拾玉居和田玉' },
]

for (const { anchor, shop, expect: expectLabel } of SESSION_CASES) {
  const schedule = STANDARD_SCHEDULES.find((s) => s.anchorName === anchor)!
  const sessionLabel = deriveSessionLabelFromSchedule(schedule)
  const display = formatDisplaySessionLabel(sessionLabel, shop)
  assert.equal(display, expectLabel, `session-label ${anchor}`)
  console.log(`[verify-anchor-attendance] PASS session-label ${anchor}`)
}

const zijieSchedule = STANDARD_SCHEDULES.find((s) => s.anchorName === '子杰')!
runCase(
  'on-time-start',
  calculateAnchorAttendanceStatus(
    zijieSchedule,
    Date.parse('2026-07-01T09:30:00+08:00'),
    '2026-07-01T09:30:00+08:00',
    Date.parse('2026-07-01T14:30:00+08:00'),
    '2026-07-01T14:30:00+08:00',
  ),
  { isLate: false, lateMinutes: 0, isEarlyLeave: false, earlyLeaveMinutes: 0 },
)

runCase(
  'late-10m',
  calculateAnchorAttendanceStatus(
    zijieSchedule,
    Date.parse('2026-07-01T09:40:00+08:00'),
    '2026-07-01T09:40:00+08:00',
    Date.parse('2026-07-01T14:30:00+08:00'),
    '2026-07-01T14:30:00+08:00',
  ),
  { isLate: true, lateMinutes: 10, isEarlyLeave: false },
)

runCase(
  'early-not-late-before-start',
  calculateAnchorAttendanceStatus(
    STANDARD_SCHEDULES.find((s) => s.anchorName === '小白')!,
    Date.parse('2026-07-01T14:20:00+08:00'),
    '2026-07-01T14:20:00+08:00',
    Date.parse('2026-07-01T18:30:00+08:00'),
    '2026-07-01T18:30:00+08:00',
  ),
  { isLate: false, lateMinutes: 0 },
)

runCase(
  'early-leave-20m',
  calculateAnchorAttendanceStatus(
    zijieSchedule,
    Date.parse('2026-07-01T09:30:00+08:00'),
    '2026-07-01T09:30:00+08:00',
    Date.parse('2026-07-01T14:10:00+08:00'),
    '2026-07-01T14:10:00+08:00',
  ),
  { isEarlyLeave: true, earlyLeaveMinutes: 20, isLate: false },
)

runCase(
  'late-and-early-leave',
  calculateAnchorAttendanceStatus(
    STANDARD_SCHEDULES.find((s) => s.anchorName === '小白')!,
    Date.parse('2026-07-01T14:40:00+08:00'),
    '2026-07-01T14:40:00+08:00',
    Date.parse('2026-07-01T18:00:00+08:00'),
    '2026-07-01T18:00:00+08:00',
  ),
  { isLate: true, lateMinutes: 10, isEarlyLeave: true, earlyLeaveMinutes: 30 },
)

const durationSession: AnchorLiveSessionBrief = {
  liveId: 'd1',
  liveName: 'XY',
  startTime: '2026-07-01T09:30:00+08:00',
  endTime: '—',
  durationMinutes: 240,
  durationText: '4小时',
}
const durationEnd = pickLatestValidSessionEnd([durationSession])
assert.equal(durationEnd?.endMs, Date.parse('2026-07-01T13:30:00+08:00'), 'duration-end-fallback')
console.log('[verify-anchor-attendance] PASS duration-end-fallback')

runCase('no-end-no-early', calculateAnchorAttendanceStatus(
  zijieSchedule,
  Date.parse('2026-07-01T09:30:00+08:00'),
  '2026-07-01T09:30:00+08:00',
  null,
  null,
), {
  isEarlyLeave: false,
  hasActualEndTime: false,
})

const multiSegments: AnchorLiveSessionBrief[] = [
  {
    liveId: '1',
    liveName: '拾玉居',
    startTime: '2026-07-01T09:30:00+08:00',
    endTime: '2026-07-01T11:00:00+08:00',
    durationMinutes: 90,
    durationText: '1.5小时',
  },
  {
    liveId: '2',
    liveName: '拾玉居',
    startTime: '2026-07-01T11:10:00+08:00',
    endTime: '2026-07-01T14:20:00+08:00',
    durationMinutes: 190,
    durationText: '3小时',
  },
]
assert.equal(
  buildActualLivePeriodText(multiSegments),
  '09:30~14:20',
  'multi-segment-period',
)
const multiStatus = calculateAnchorAttendanceStatus(
  zijieSchedule,
  Date.parse('2026-07-01T09:30:00+08:00'),
  '2026-07-01T09:30:00+08:00',
  pickLatestValidSessionEnd(multiSegments)!.endMs,
  pickLatestValidSessionEnd(multiSegments)!.endAt,
)
runCase('multi-segment-early-10m', multiStatus, {
  isEarlyLeave: true,
  earlyLeaveMinutes: 10,
  isLate: false,
})

const twoShiftRows: EffectiveScheduleRow[] = [
  row({
    rowId: 'c-morning',
    anchorName: '主播C',
    startTime: '10:00',
    endTime: '12:00',
    startAt: '2026-06-30T10:00:00+08:00',
    endAt: '2026-06-30T12:00:00+08:00',
  }),
  row({
    rowId: 'c-afternoon',
    anchorName: '主播C',
    startTime: '14:00',
    endTime: '18:00',
    startAt: '2026-06-30T14:00:00+08:00',
    endAt: '2026-06-30T18:00:00+08:00',
  }),
]

function matchTwoShiftsInStableOrder(
  actualStarts: Array<{ iso: string; expectRowId: string }>,
): void {
  const usedIds = new Set<string>()
  const sorted = [...actualStarts].sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso))
  for (const { iso, expectRowId } of sorted) {
    const matched = matchManualSchedule(twoShiftRows, '主播C', 'XY祥钰珠宝', Date.parse(iso), usedIds)
    assert.ok(matched, `two-shift: expected match for ${iso}`)
    assert.equal(matched!.rowId, expectRowId, `two-shift row for ${iso}`)
    usedIds.add(matched!.rowId)
  }
  assert.equal(usedIds.size, 2, 'two-shift: each schedule used once')
}

matchTwoShiftsInStableOrder([
  { iso: '2026-06-30T10:05:00+08:00', expectRowId: 'c-morning' },
  { iso: '2026-06-30T14:12:00+08:00', expectRowId: 'c-afternoon' },
])
console.log('[verify-anchor-attendance] PASS two-shift-stable')

const sessions = [
  {
    liveId: '2',
    liveName: 'XY',
    startTime: '2026-06-30T14:00:00+08:00',
    endTime: '—',
    durationMinutes: 60,
    durationText: '1小时',
  },
  {
    liveId: '1',
    liveName: 'XY',
    startTime: '2026-06-30T10:00:00+08:00',
    endTime: '—',
    durationMinutes: 60,
    durationText: '1小时',
  },
] as AnchorLiveSessionBrief[]
assert.equal(pickEarliestValidSession(sessions)?.startTime, '2026-06-30T10:00:00+08:00', 'earliest-session')
console.log('[verify-anchor-attendance] PASS earliest-session')

console.log('[verify-anchor-attendance] ALL PASS')
