import { prisma } from '../lib/prisma'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import { addDaysShanghai } from '../utils/business-timezone'

export async function isDateScheduleConfirmed(dateKey: string): Promise<boolean> {
  const rows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: dateKey, enabled: true },
    select: { confirmed: true },
  })
  if (rows.length === 0) return false
  return rows.every((r) => r.confirmed)
}

export async function listUnconfirmedScheduleDatesInRange(
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const unconfirmed: string[] = []
  let cursor = startDate
  while (cursor <= endDate) {
    const rows = await prisma.anchorDailySchedule.findMany({
      where: { scheduleDate: cursor, enabled: true },
      select: { confirmed: true },
    })
    if (rows.length > 0 && rows.some((r) => !r.confirmed)) {
      unconfirmed.push(cursor)
    } else if (rows.length === 0) {
      const today = formatDateKeyShanghai(new Date())
      const yesterday = addDaysShanghai(today, -1)
      if (cursor === today || cursor === yesterday) {
        unconfirmed.push(cursor)
      }
    }
    cursor = addDaysShanghai(cursor, 1)
  }
  return unconfirmed
}

export async function confirmDailySchedules(params: {
  date: string
  confirmedBy?: string
  confirmNote?: string
}): Promise<{
  date: string
  confirmed: boolean
  scheduleCount: number
  confirmPreviewLines: string[]
}> {
  const rows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: params.date, enabled: true },
    orderBy: { startAt: 'asc' },
  })
  if (!rows.length) {
    throw new Error(`${params.date} 没有排班可确认，请先生成或保存排班`)
  }

  const { validateScheduleHardRules } = await import('../utils/schedule-hard-validation.util')
  const draft = rows.map((r) => {
    const startTime = r.startAt.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    let endTime = r.endAt.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const endDay = r.endAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    if (endTime === '00:00' && endDay > params.date) endTime = '24:00'
    return {
      anchorName: r.anchorName,
      shopName: r.shopName,
      liveRoomName: r.liveRoomName,
      startTime,
      endTime,
      enabled: true,
      note: r.note,
    }
  })
  const hard = validateScheduleHardRules({
    date: params.date,
    schedules: draft,
    forConfirm: true,
  })
  if (!hard.ok) {
    throw new Error(hard.conflicts.map((c) => c.message).join('；') || '排班存在冲突，不能确认')
  }

  const now = new Date()
  await prisma.anchorDailySchedule.updateMany({
    where: { scheduleDate: params.date },
    data: {
      confirmed: true,
      confirmedAt: now,
      confirmedBy: params.confirmedBy ?? null,
      confirmNote: params.confirmNote?.trim() || null,
      locked: true,
    },
  })
  const { invalidateBusinessBoardCacheForDate } = await import('./anchor-schedule-cache.service')
  await invalidateBusinessBoardCacheForDate(params.date)
  return {
    date: params.date,
    confirmed: true,
    scheduleCount: rows.length,
    confirmPreviewLines: hard.confirmPreviewLines,
  }
}

export async function getScheduleConfirmStatus(dateKey: string): Promise<{
  date: string
  hasSchedule: boolean
  confirmed: boolean
  confirmedAt: string | null
  confirmedBy: string | null
}> {
  const rows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: dateKey, enabled: true },
    orderBy: { startAt: 'asc' },
  })
  if (!rows.length) {
    return {
      date: dateKey,
      hasSchedule: false,
      confirmed: false,
      confirmedAt: null,
      confirmedBy: null,
    }
  }
  const confirmed = rows.every((r) => r.confirmed)
  const confirmedRow = rows.find((r) => r.confirmedAt)
  return {
    date: dateKey,
    hasSchedule: true,
    confirmed,
    confirmedAt: confirmedRow?.confirmedAt?.toISOString() ?? null,
    confirmedBy: confirmedRow?.confirmedBy ?? null,
  }
}
