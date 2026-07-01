import assert from 'node:assert/strict'
import {
  calculateAnchorLateStatus,
  matchManualSchedule,
  pickEarliestValidSession,
  type AnchorLateStatus,
} from '../src/utils/anchor-schedule-late.util'
import type { EffectiveScheduleRow } from '../src/services/anchor-daily-schedule.service'

function row(partial: Partial<EffectiveScheduleRow> & Pick<EffectiveScheduleRow, 'rowId' | 'startAt' | 'endAt' | 'startTime' | 'endTime'>): EffectiveScheduleRow {
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

function runCase(name: string, status: AnchorLateStatus, expect: Partial<AnchorLateStatus>) {
  for (const [key, value] of Object.entries(expect)) {
    assert.equal((status as Record<string, unknown>)[key], value, `${name}: ${key}`)
  }
  console.log(`[verify-anchor-late] PASS ${name}`)
}

const scheduleRows: EffectiveScheduleRow[] = [
  row({
    rowId: 'a',
    anchorName: '主播A',
    startTime: '10:00',
    endTime: '14:00',
    startAt: '2026-06-30T10:00:00+08:00',
    endAt: '2026-06-30T14:00:00+08:00',
  }),
  row({
    rowId: 'b',
    anchorName: '主播B',
    startTime: '10:00',
    endTime: '14:00',
    startAt: '2026-06-30T10:00:00+08:00',
    endAt: '2026-06-30T14:00:00+08:00',
  }),
]

const used = new Set<string>()

const scheduleA = matchManualSchedule(scheduleRows, '主播A', 'XY祥钰珠宝', Date.parse('2026-06-30T10:00:00+08:00'), used)
used.add(scheduleA!.rowId)
runCase('on-time', calculateAnchorLateStatus(scheduleA, Date.parse('2026-06-30T10:00:00+08:00'), '2026-06-30T10:00:00+08:00'), {
  isLate: false,
  lateMinutes: 0,
  label: '准时开播',
})

const scheduleB = matchManualSchedule(scheduleRows, '主播B', 'XY祥钰珠宝', Date.parse('2026-06-30T10:18:00+08:00'), used)
runCase('late-18m', calculateAnchorLateStatus(scheduleB, Date.parse('2026-06-30T10:18:00+08:00'), '2026-06-30T10:18:00+08:00'), {
  isLate: true,
  lateMinutes: 18,
  label: '迟播 18 分钟',
})

runCase('no-schedule', calculateAnchorLateStatus(undefined, Date.parse('2026-06-30T11:00:00+08:00'), '2026-06-30T11:00:00+08:00'), {
  hasSchedule: false,
  isLate: false,
  reason: '未排班',
})

runCase('no-actual', calculateAnchorLateStatus(scheduleA, null, null), {
  hasSchedule: true,
  hasActualStartTime: false,
  isLate: false,
  label: '未读取开播时间',
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
  const sorted = [...actualStarts].sort(
    (a, b) => Date.parse(a.iso) - Date.parse(b.iso),
  )
  for (const { iso, expectRowId } of sorted) {
    const matched = matchManualSchedule(
      twoShiftRows,
      '主播C',
      'XY祥钰珠宝',
      Date.parse(iso),
      usedIds,
    )
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

matchTwoShiftsInStableOrder([
  { iso: '2026-06-30T14:12:00+08:00', expectRowId: 'c-afternoon' },
  { iso: '2026-06-30T10:05:00+08:00', expectRowId: 'c-morning' },
])

const sessions = [
  { liveId: '2', liveName: 'XY', startTime: '2026-06-30T14:00:00+08:00', endTime: '—', durationMinutes: 60, durationText: '1小时' },
  { liveId: '1', liveName: 'XY', startTime: '2026-06-30T10:00:00+08:00', endTime: '—', durationMinutes: 60, durationText: '1小时' },
] as const
const earliest = pickEarliestValidSession([...sessions])
assert.equal(earliest?.startTime, '2026-06-30T10:00:00+08:00', 'earliest-session')
console.log('[verify-anchor-late] PASS two-shift-stable')
console.log('[verify-anchor-late] PASS earliest-session')

console.log('[verify-anchor-late] ALL PASS')
