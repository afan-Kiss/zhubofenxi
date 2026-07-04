import assert from 'node:assert/strict'
import {
  buildActualLivePeriodText,
  calculateAnchorLivePeriodStatus,
  deriveSessionLabelFromSchedule,
  formatDisplaySessionLabel,
  matchManualSchedule,
  matchEffectiveScheduleRow,
  sessionOverlapsEffectiveScheduleRow,
  pickEarliestValidSession,
  pickLatestValidSessionEnd,
  type AnchorLivePeriodStatus,
} from '../src/utils/anchor-attendance-status.util'
import {
  DEFAULT_SCHEDULE_TEMPLATE_SEEDS,
  NEW_SCHEDULE_START_DATE,
  NEW_SCHEDULE_TEMPLATE_SEEDS_20260701,
  templateAppliesOnDate,
} from '../src/services/anchor-schedule-template.service'
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

function runCase(name: string, status: AnchorLivePeriodStatus, expect: Partial<AnchorLivePeriodStatus>) {
  for (const [key, value] of Object.entries(expect)) {
    assert.equal((status as Record<string, unknown>)[key], value, `${name}: ${key}`)
  }
  console.log(`[verify-anchor-attendance] PASS ${name}`)
}

const NEW_SCHEDULES: EffectiveScheduleRow[] = [
  row({
    rowId: 'zijie',
    anchorName: '子杰',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '09:30',
    endTime: '14:00',
    startAt: '2026-07-01T09:30:00+08:00',
    endAt: '2026-07-01T14:00:00+08:00',
    note: '早场·拾玉居和田玉',
  }),
  row({
    rowId: 'xiaohong',
    anchorName: '小红',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '09:30',
    endTime: '14:00',
    startAt: '2026-07-01T09:30:00+08:00',
    endAt: '2026-07-01T14:00:00+08:00',
    note: '早场·和田雅玉',
  }),
  row({
    rowId: 'xiaobai',
    anchorName: '小白',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '14:00',
    endTime: '18:30',
    startAt: '2026-07-01T14:00:00+08:00',
    endAt: '2026-07-01T18:30:00+08:00',
    note: '午场·XY祥钰珠宝',
  }),
  row({
    rowId: 'xiaoyi',
    anchorName: '小艺',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '14:00',
    endTime: '18:30',
    startAt: '2026-07-01T14:00:00+08:00',
    endAt: '2026-07-01T18:30:00+08:00',
    note: '午场·和田雅玉',
  }),
  row({
    rowId: 'feiyun',
    anchorName: '飞云',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '18:30',
    endTime: '23:00',
    startAt: '2026-07-01T18:30:00+08:00',
    endAt: '2026-07-01T23:00:00+08:00',
    note: '晚场·拾玉居和田玉',
  }),
]

const templates0630 = DEFAULT_SCHEDULE_TEMPLATE_SEEDS.filter((seed) => templateAppliesOnDate(seed, '2026-06-30'))
assert.ok(templates0630.length >= 5, '2026-06-30 legacy templates')
assert.equal(
  DEFAULT_SCHEDULE_TEMPLATE_SEEDS.filter((seed) => templateAppliesOnDate(seed, NEW_SCHEDULE_START_DATE)).length,
  NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.length,
  '2026-07-01 template count',
)
assert.equal(
  DEFAULT_SCHEDULE_TEMPLATE_SEEDS.filter((seed) => templateAppliesOnDate(seed, '2026-07-02')).length,
  NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.length,
  '2026-07-02 template count',
)
console.log('[verify-anchor-attendance] PASS default-templates-by-date')

const SESSION_CASES: Array<{ anchor: string; shop: string; expect: string; schedule: EffectiveScheduleRow }> = [
  { anchor: '子杰', shop: '拾玉居和田玉', expect: '早场·拾玉居和田玉', schedule: NEW_SCHEDULES[0]! },
  { anchor: '小红', shop: '和田雅玉', expect: '早场·和田雅玉', schedule: NEW_SCHEDULES[1]! },
  { anchor: '小白', shop: 'XY祥钰珠宝', expect: '午场·XY祥钰珠宝', schedule: NEW_SCHEDULES[2]! },
  { anchor: '小艺', shop: '和田雅玉', expect: '午场·和田雅玉', schedule: NEW_SCHEDULES[3]! },
  { anchor: '飞云', shop: '拾玉居和田玉', expect: '晚场·拾玉居和田玉', schedule: NEW_SCHEDULES[4]! },
]

for (const { anchor, shop, expect: expectLabel, schedule } of SESSION_CASES) {
  const sessionLabel = deriveSessionLabelFromSchedule(schedule, NEW_SCHEDULE_START_DATE)
  const display = formatDisplaySessionLabel(sessionLabel, shop)
  assert.equal(display, expectLabel, `session-label ${anchor}`)
  assert.notEqual(sessionLabel, '下午场', `${anchor} should not use 下午场 on 2026-07-01`)
  console.log(`[verify-anchor-attendance] PASS session-label ${anchor}`)
}

const zijie = NEW_SCHEDULES[0]!
const xiaohong = NEW_SCHEDULES[1]!
const xiaobai = NEW_SCHEDULES[2]!
const xiaoyi = NEW_SCHEDULES[3]!
const feiyun = NEW_SCHEDULES[4]!

runCase(
  'zijie-late-early',
  calculateAnchorLivePeriodStatus(
    zijie,
    Date.parse('2026-07-01T09:35:00+08:00'),
    '2026-07-01T09:35:00+08:00',
    Date.parse('2026-07-01T13:50:00+08:00'),
    '2026-07-01T13:50:00+08:00',
  ),
  {
    hasSchedule: true,
    actualStartText: '09:35',
    actualEndText: '13:50',
    scheduledPeriodText: '09:30~14:00',
  },
)

runCase(
  'xiaohong-on-time',
  calculateAnchorLivePeriodStatus(
    xiaohong,
    Date.parse('2026-07-01T09:30:00+08:00'),
    '2026-07-01T09:30:00+08:00',
    Date.parse('2026-07-01T14:00:00+08:00'),
    '2026-07-01T14:00:00+08:00',
  ),
  {
    hasSchedule: true,
    actualStartText: '09:30',
    actualEndText: '14:00',
  },
)

runCase(
  'xiaobai-late-early',
  calculateAnchorLivePeriodStatus(
    xiaobai,
    Date.parse('2026-07-01T14:10:00+08:00'),
    '2026-07-01T14:10:00+08:00',
    Date.parse('2026-07-01T18:00:00+08:00'),
    '2026-07-01T18:00:00+08:00',
  ),
  {
    hasSchedule: true,
    actualStartText: '14:10',
    actualEndText: '18:00',
  },
)

runCase(
  'xiaoyi-early-only',
  calculateAnchorLivePeriodStatus(
    xiaoyi,
    Date.parse('2026-07-01T13:58:00+08:00'),
    '2026-07-01T13:58:00+08:00',
    Date.parse('2026-07-01T18:20:00+08:00'),
    '2026-07-01T18:20:00+08:00',
  ),
  {
    hasSchedule: true,
    actualStartText: '13:58',
    actualEndText: '18:20',
  },
)

runCase(
  'feiyun-late-early',
  calculateAnchorLivePeriodStatus(
    feiyun,
    Date.parse('2026-07-01T18:45:00+08:00'),
    '2026-07-01T18:45:00+08:00',
    Date.parse('2026-07-01T22:30:00+08:00'),
    '2026-07-01T22:30:00+08:00',
  ),
  {
    hasSchedule: true,
    actualStartText: '18:45',
    actualEndText: '22:30',
  },
)

const multiSegments: AnchorLiveSessionBrief[] = [
  {
    liveId: '1',
    liveName: '拾玉居',
    startTime: '2026-07-01T09:35:00+08:00',
    endTime: '2026-07-01T11:00:00+08:00',
    durationMinutes: 85,
    durationText: '1小时25分',
  },
  {
    liveId: '2',
    liveName: '拾玉居',
    startTime: '2026-07-01T11:20:00+08:00',
    endTime: '2026-07-01T13:50:00+08:00',
    durationMinutes: 150,
    durationText: '2小时30分',
  },
]
assert.equal(buildActualLivePeriodText(multiSegments), '09:35~13:50', 'multi-segment-period')
const multiEnd = pickLatestValidSessionEnd(multiSegments)!
runCase(
  'multi-segment-zijie',
  calculateAnchorLivePeriodStatus(
    zijie,
    Date.parse('2026-07-01T09:35:00+08:00'),
    '2026-07-01T09:35:00+08:00',
    multiEnd.endMs,
    multiEnd.endAt,
  ),
  {
    hasSchedule: true,
    actualStartText: '09:35',
    actualEndText: '13:50',
  },
)

const durationSession: AnchorLiveSessionBrief = {
  liveId: 'd1',
  liveName: 'XY',
  startTime: '2026-07-01T14:00:00+08:00',
  endTime: '—',
  durationMinutes: 240,
  durationText: '4小时',
}
const durationEnd = pickLatestValidSessionEnd([durationSession])
assert.equal(durationEnd?.endMs, Date.parse('2026-07-01T18:00:00+08:00'), 'duration-end-fallback')
console.log('[verify-anchor-attendance] PASS duration-end-fallback')

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

const legacyAfternoon = row({
  rowId: 'legacy',
  anchorName: '小白',
  startTime: '14:30',
  endTime: '18:00',
  startAt: '2026-06-30T14:30:00+08:00',
  endAt: '2026-06-30T18:00:00+08:00',
  note: '午场·XY祥钰',
})
assert.equal(deriveSessionLabelFromSchedule(legacyAfternoon, '2026-06-30'), '下午场', 'legacy 午场 -> 下午场')
assert.equal(deriveSessionLabelFromSchedule(xiaobai, NEW_SCHEDULE_START_DATE), '午场', 'new 午场 label')
console.log('[verify-anchor-attendance] PASS legacy-vs-new-session-label')

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

const virtualZijie = row({
  rowId: 'virtual-zijie',
  source: 'virtual_template',
  anchorName: '子杰',
  shopName: '拾玉居和田玉',
  liveRoomName: '拾玉居和田玉',
  startTime: '09:30',
  endTime: '14:00',
  startAt: '2026-07-02T09:30:00+08:00',
  endAt: '2026-07-02T14:00:00+08:00',
  note: '早场·拾玉居和田玉',
})
const matchedVirtual = matchEffectiveScheduleRow(
  [virtualZijie],
  '子杰',
  '拾玉居和田玉',
  Date.parse('2026-07-02T10:05:00+08:00'),
  new Set(),
)
assert.equal(matchedVirtual?.rowId, 'virtual-zijie', 'virtual-template schedule match')
assert.ok(
  sessionOverlapsEffectiveScheduleRow(
    [virtualZijie],
    '子杰',
    '拾玉居和田玉',
    Date.parse('2026-07-02T10:05:00+08:00'),
    Date.parse('2026-07-02T13:00:00+08:00'),
  ),
  'virtual-template session overlap',
)
console.log('[verify-anchor-attendance] PASS virtual-template-match')

console.log('[verify-anchor-attendance] ALL PASS')
