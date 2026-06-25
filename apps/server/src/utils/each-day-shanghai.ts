import { addDaysShanghai } from './business-timezone'

/** 上海时区逐日 dateKey（含起止日） */
export function eachDayInShanghaiRange(startDate: string, endDate: string): string[] {
  if (startDate > endDate) return []
  const days: string[] = []
  let cursor = startDate
  while (cursor <= endDate) {
    days.push(cursor)
    if (cursor === endDate) break
    cursor = addDaysShanghai(cursor, 1)
  }
  return days
}
