import { getTimeMinutes } from '../utils/time'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import { ANCHOR_NEW_SCHEDULE_START_DATE } from '../config/anchor-schedule.constants'

/** 2026-06-18 起小白入职；午场按日期切换 */
export const XIAOBAI_ANCHOR_CUTOFF_MS = Date.parse('2026-06-18T00:00:00+08:00')
/** @deprecated 历史默认 14:30；请用 resolveXiaoBaiSlotMinutesForDate */
export const XIAOBAI_SLOT_START_MINUTES = 14 * 60 + 30
/** @deprecated 历史默认 18:00；请用 resolveXiaoBaiSlotMinutesForDate */
export const XIAOBAI_SLOT_END_MINUTES = 18 * 60

/** 左闭右开 [start, end) 分钟（距当天 00:00） */
export function resolveXiaoBaiSlotMinutesForDate(dateKey: string): {
  startMinutes: number
  endMinutes: number
} {
  if (dateKey >= ANCHOR_NEW_SCHEDULE_START_DATE) {
    // 2026-07-01 起：14:00–18:30
    return { startMinutes: 14 * 60, endMinutes: 18 * 60 + 30 }
  }
  // 2026-06-18～06-30：14:30–18:00
  return { startMinutes: 14 * 60 + 30, endMinutes: 18 * 60 }
}

export function isInXiaoBaiOrderSlot(date: Date): boolean {
  if (!Number.isFinite(date.getTime()) || date.getTime() < XIAOBAI_ANCHOR_CUTOFF_MS) return false
  const dateKey = formatDateKeyShanghai(date)
  const minutes = getTimeMinutes(date)
  const { startMinutes, endMinutes } = resolveXiaoBaiSlotMinutesForDate(dateKey)
  return minutes >= startMinutes && minutes < endMinutes
}

/** 是否落在小白生效午场（传入应对应为下单时间 ms，禁止用支付时间正式归属） */
export function isXiaoBaiAttributionActive(orderCreateMs: number): boolean {
  return (
    Number.isFinite(orderCreateMs) &&
    orderCreateMs >= XIAOBAI_ANCHOR_CUTOFF_MS &&
    isInXiaoBaiOrderSlot(new Date(orderCreateMs))
  )
}
