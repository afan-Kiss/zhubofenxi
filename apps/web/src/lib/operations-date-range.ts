import { addDaysShanghai } from './business-timezone'

/** 订单明细下钻允许的最大日历天数（含起止日） */
export const MAX_DRILL_RANGE_DAYS = 31

export const DRILL_RANGE_TOO_LONG_MESSAGE =
  '这个范围订单较多，请缩小日期或分批查看明细。'

/** 含起止日的日历天数，与后端 eachDayInShanghaiRange 一致 */
export function daysInclusiveBetween(startDate: string, endDate: string): number {
  if (startDate > endDate) return 0
  let count = 0
  let cursor = startDate
  while (cursor <= endDate) {
    count++
    if (cursor === endDate) break
    cursor = addDaysShanghai(cursor, 1)
  }
  return count
}

export function isDrillRangeTooLong(startDate: string, endDate: string): boolean {
  return daysInclusiveBetween(startDate, endDate) > MAX_DRILL_RANGE_DAYS
}
