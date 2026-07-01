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
  anchorName?: string
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

function intervalsOverlapSameAnchor(a: ScheduleOverlapInterval, b: ScheduleOverlapInterval): boolean {
  if (!a.anchorName?.trim() || !b.anchorName?.trim()) return false
  return (
    a.anchorName.trim() === b.anchorName.trim() &&
    scheduleIntervalsOverlap(a.startAt, a.endAt, b.startAt, b.endAt)
  )
}

export function filterVirtualSchedulesAgainstOccupied<T extends ScheduleOverlapInterval>(
  virtualRows: T[],
  occupiedRows: ScheduleOverlapInterval[],
): { kept: T[]; skipped: T[] } {
  const kept: T[] = []
  const skipped: T[] = []
  const accepted: ScheduleOverlapInterval[] = [...occupiedRows]

  for (const v of virtualRows) {
    const roomConflict = accepted.some((row) => scheduleIntervalsOverlapSameRoom(row, v))
    const anchorConflict = accepted.some((row) => intervalsOverlapSameAnchor(row, v))
    if (roomConflict || anchorConflict) {
      skipped.push(v)
    } else {
      kept.push(v)
      accepted.push(v)
    }
  }
  return { kept, skipped }
}

/** 结束时间为次日 00:00 时显示 24:00；开始时间 00:00 仍显示 00:00 */
export function formatHmFromDate(d: Date, scheduleDate: string, role: 'start' | 'end' = 'start'): string {
  const dateKey = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const hm = d.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  if (role === 'end' && hm === '00:00' && dateKey > scheduleDate) return '24:00'
  return hm
}

function scheduleDateFromInterval(row: IntervalLike): string {
  return row.startAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function formatIntervalRange(row: IntervalLike, scheduleDate?: string): string {
  const dateKey = scheduleDate ?? scheduleDateFromInterval(row)
  return `${formatHmFromDate(row.startAt, dateKey, 'start')}-${formatHmFromDate(row.endAt, dateKey, 'end')}`
}

function roomLabel(row: IntervalLike): string {
  return row.liveRoomName.trim() || row.shopName.trim()
}

export function detectScheduleConflicts(rows: IntervalLike[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = []
  const enabled = rows.filter((r) => r.startAt < r.endAt)

  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const a = enabled[i]!
      const b = enabled[j]!
      if (!scheduleIntervalsOverlap(a.startAt, a.endAt, b.startAt, b.endAt)) continue

      const dateKey = scheduleDateFromInterval(a)
      if (sameShop(a, b)) {
        conflicts.push({
          type: 'shop_overlap',
          message: `${roomLabel(a)} ${formatIntervalRange(a, dateKey)} 同时安排了${a.anchorName}和${b.anchorName}，请保留一个。`,
        })
      } else if (a.anchorName === b.anchorName) {
        conflicts.push({
          type: 'anchor_overlap',
          message: `${a.anchorName}在 ${formatIntervalRange(a, dateKey)} 已排 ${roomLabel(a)}，同时又排了 ${roomLabel(b)} ${formatIntervalRange(b, dateKey)}，请删掉一条或调整时间。`,
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
