import { addDaysShanghai, startOfDayMsShanghai } from './business-timezone'

const HM_RE = /^(\d{1,2}):(\d{2})$/

export function parseHmToMinutes(hm: string): number {
  const m = HM_RE.exec(hm.trim())
  if (!m) throw new Error(`无效时间格式: ${hm}`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 24 || min < 0 || min > 59) throw new Error(`无效时间: ${hm}`)
  if (h === 24 && min !== 0) throw new Error(`24:00 仅支持整点`)
  return h * 60 + min
}

export function formatMinutesToHm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 左闭右开 [startAt, endAt)；endTime=24:00 存为次日 00:00 */
export function buildScheduleBounds(
  scheduleDate: string,
  startTime: string,
  endTime: string,
): { startAt: Date; endAt: Date } {
  const startMin = parseHmToMinutes(startTime)
  const endMin = parseHmToMinutes(endTime)
  if (startMin >= endMin && endTime.trim() !== '24:00') {
    throw new Error(`开始时间必须早于结束时间（${startTime}–${endTime}）`)
  }

  const startH = Math.floor(startMin / 60)
  const startM = startMin % 60
  const startAt = new Date(
    Date.parse(
      `${scheduleDate}T${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00+08:00`,
    ),
  )

  let endDate = scheduleDate
  let endHm = endTime.trim()
  if (endHm === '24:00') {
    endDate = addDaysShanghai(scheduleDate, 1)
    endHm = '00:00'
  }
  const endParts = parseHmToMinutes(endHm)
  const endH = Math.floor(endParts / 60)
  const endM = endParts % 60
  const endAt = new Date(
    Date.parse(
      `${endDate}T${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00+08:00`,
    ),
  )

  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error(`排班结束时间必须晚于开始时间（${startTime}–${endTime}）`)
  }

  return { startAt, endAt }
}

export function isPayTimeInSchedule(
  payMs: number,
  startAt: Date,
  endAt: Date,
): boolean {
  const start = startAt.getTime()
  const end = endAt.getTime()
  return payMs >= start && payMs < end
}

export interface IntervalLike {
  anchorName: string
  shopName: string
  liveRoomName: string
  startAt: Date
  endAt: Date
}

export interface ScheduleConflict {
  type: 'shop_overlap' | 'anchor_overlap'
  message: string
}

function sameShop(a: IntervalLike, b: IntervalLike): boolean {
  const aKey = `${a.shopName}::${a.liveRoomName}`
  const bKey = `${b.shopName}::${b.liveRoomName}`
  return aKey === bKey
}

export function scheduleIntervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()
}

export interface ScheduleOverlapInterval {
  shopName: string
  liveRoomName: string
  startAt: Date
  endAt: Date
}

export function scheduleIntervalsOverlapSameRoom(
  a: ScheduleOverlapInterval,
  b: ScheduleOverlapInterval,
): boolean {
  return (
    a.shopName === b.shopName &&
    a.liveRoomName === b.liveRoomName &&
    scheduleIntervalsOverlap(a.startAt, a.endAt, b.startAt, b.endAt)
  )
}

export function filterVirtualSchedulesAgainstOccupied<T extends ScheduleOverlapInterval>(
  virtualRows: T[],
  occupiedRows: ScheduleOverlapInterval[],
): { kept: T[]; skipped: T[] } {
  const kept: T[] = []
  const skipped: T[] = []
  for (const v of virtualRows) {
    const overlaps = occupiedRows.some((row) => scheduleIntervalsOverlapSameRoom(row, v))
    if (overlaps) skipped.push(v)
    else kept.push(v)
  }
  return { kept, skipped }
}

function formatHmFromDate(d: Date): string {
  const hm = d.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const endDateKey = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const startDateKey = new Date(d.getTime() - 60000).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Shanghai',
  })
  if (hm === '00:00' && endDateKey > startDateKey) return '24:00'
  return hm
}

function formatIntervalRange(row: IntervalLike): string {
  return `${formatHmFromDate(row.startAt)}-${formatHmFromDate(row.endAt)}`
}

export function detectScheduleConflicts(rows: IntervalLike[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = []
  const enabled = rows.filter((r) => r.startAt < r.endAt)

  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const a = enabled[i]!
      const b = enabled[j]!
      if (!scheduleIntervalsOverlap(a.startAt, a.endAt, b.startAt, b.endAt)) continue

      if (sameShop(a, b)) {
        conflicts.push({
          type: 'shop_overlap',
          message: `${a.liveRoomName} ${formatIntervalRange(a)} 已经排给${a.anchorName}，不能同时再排给${b.anchorName}（${formatIntervalRange(b)}）`,
        })
      } else if (a.anchorName === b.anchorName) {
        conflicts.push({
          type: 'anchor_overlap',
          message: `主播「${a.anchorName}」在 ${formatIntervalRange(a)} 已排 ${a.liveRoomName}，与 ${b.liveRoomName} ${formatIntervalRange(b)} 时间重叠`,
        })
      }
    }
  }

  return conflicts
}

export function scheduleDateFromPayMs(payMs: number): string {
  return new Date(payMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

export function isDateOnOrAfter(dateKey: string, cutoffDateKey: string): boolean {
  return startOfDayMsShanghai(dateKey) >= startOfDayMsShanghai(cutoffDateKey)
}
