import { prisma } from '../lib/prisma'
import { buildScheduleBounds, detectScheduleConflicts } from '../utils/anchor-schedule-time.util'
import {
  buildVirtualSchedulesFromTemplates,
  listActiveTemplatesForDate,
  validateScheduleDraft,
  xiaobaiWarningForDate,
} from './anchor-schedule-template.service'
import { invalidateBusinessBoardCacheForDate } from './anchor-schedule-cache.service'

export type DailyScheduleSource = 'manual' | 'generated_default'

export interface DailyScheduleDto {
  id: string
  scheduleDate: string
  anchorName: string
  shopName: string
  liveRoomName: string
  startAt: string
  endAt: string
  startTime: string
  endTime: string
  source: DailyScheduleSource
  enabled: boolean
  locked: boolean
  note: string | null
  conflict?: boolean
}

function rowToDto(row: {
  id: string
  scheduleDate: string
  anchorName: string
  shopName: string
  liveRoomName: string
  startAt: Date
  endAt: Date
  source: string
  enabled: boolean
  locked: boolean
  note: string | null
}): DailyScheduleDto {
  const startTime = row.startAt.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const endMs = row.endAt.getTime()
  const endDateKey = row.endAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const isMidnightEnd =
    row.endAt.getHours() === 0 &&
    row.endAt.getMinutes() === 0 &&
    endDateKey > row.scheduleDate
  const endTime = isMidnightEnd
    ? '24:00'
    : row.endAt.toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
  return {
    id: row.id,
    scheduleDate: row.scheduleDate,
    anchorName: row.anchorName,
    shopName: row.shopName,
    liveRoomName: row.liveRoomName,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    startTime,
    endTime,
    source: row.source as DailyScheduleSource,
    enabled: row.enabled,
    locked: row.locked,
    note: row.note,
  }
}

export async function listDailySchedulesForDate(dateKey: string): Promise<{
  date: string
  schedules: DailyScheduleDto[]
  warnings: string[]
}> {
  const warnings: string[] = []
  const xb = xiaobaiWarningForDate(dateKey)
  if (xb) warnings.push(xb)

  const rows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: dateKey },
    orderBy: [{ startAt: 'asc' }, { anchorName: 'asc' }],
  })

  if (rows.length === 0) {
    const templates = await listActiveTemplatesForDate(dateKey)
    const virtual = buildVirtualSchedulesFromTemplates(dateKey, templates)
    return {
      date: dateKey,
      schedules: virtual.map((v) =>
        rowToDto({
          ...v,
          id: v.id,
          startAt: v.startAt,
          endAt: v.endAt,
          note: v.note ?? null,
        }),
      ),
      warnings,
    }
  }

  const dtos = rows.map(rowToDto)
  const conflicts = detectScheduleConflicts(
    rows.filter((r) => r.enabled).map((r) => ({
      anchorName: r.anchorName,
      shopName: r.shopName,
      liveRoomName: r.liveRoomName,
      startAt: r.startAt,
      endAt: r.endAt,
    })),
  )
  for (const c of conflicts) warnings.push(c.message)

  return { date: dateKey, schedules: dtos, warnings }
}

export async function getEffectiveSchedulesForDate(dateKey: string) {
  const rows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: dateKey, enabled: true },
    orderBy: { startAt: 'asc' },
  })
  if (rows.length > 0) {
    const manual = rows.filter((r) => r.source === 'manual' || r.locked)
    const generated = rows.filter((r) => r.source === 'generated_default' && !r.locked)
    return { manual, generated, virtual: [] as typeof rows }
  }
  const templates = await listActiveTemplatesForDate(dateKey)
  const virtual = buildVirtualSchedulesFromTemplates(dateKey, templates)
  return {
    manual: [] as typeof rows,
    generated: [] as typeof rows,
    virtual: virtual.map((v) => ({
      ...v,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  }
}

export async function generateDefaultSchedulesForDate(params: {
  date: string
  overwrite: boolean
  createdBy?: string
}): Promise<{ date: string; schedules: DailyScheduleDto[]; warnings: string[] }> {
  const { date, overwrite } = params
  const templates = await listActiveTemplatesForDate(date)
  const warnings: string[] = []
  const xb = xiaobaiWarningForDate(date)
  if (xb) warnings.push(xb)

  const existing = await prisma.anchorDailySchedule.findMany({ where: { scheduleDate: date } })
  const protectedIds = new Set(
    existing.filter((r) => r.locked || r.source === 'manual').map((r) => r.id),
  )

  if (overwrite) {
    await prisma.anchorDailySchedule.deleteMany({
      where: {
        scheduleDate: date,
        locked: false,
        source: 'generated_default',
      },
    })
  } else if (existing.some((r) => r.source === 'generated_default' || r.source === 'manual')) {
    return listDailySchedulesForDate(date)
  }

  const toCreate = templates.map((t) => {
    const { startAt, endAt } = buildScheduleBounds(date, t.startTime, t.endTime)
    return {
      scheduleDate: date,
      anchorName: t.anchorName,
      shopName: t.shopName,
      liveRoomName: t.liveRoomName,
      startAt,
      endAt,
      source: 'generated_default',
      enabled: true,
      locked: false,
      note: t.note,
      createdBy: params.createdBy ?? null,
    }
  })

  const validation = validateScheduleDraft(
    date,
    toCreate.map((c) => ({
      anchorName: c.anchorName,
      shopName: c.shopName,
      liveRoomName: c.liveRoomName,
      startTime: templates.find((t) => t.anchorName === c.anchorName)?.startTime ?? '00:00',
      endTime: templates.find((t) => t.anchorName === c.anchorName)?.endTime ?? '24:00',
    })),
  )
  if (!validation.ok) {
    throw new Error(validation.conflicts.map((c) => c.message).join('；'))
  }
  warnings.push(...validation.warnings)

  if (toCreate.length) {
    await prisma.anchorDailySchedule.createMany({ data: toCreate })
  }
  void protectedIds

  await invalidateBusinessBoardCacheForDate(date)
  return listDailySchedulesForDate(date)
}

export async function saveDailySchedules(params: {
  date: string
  schedules: Array<{
    anchorName: string
    shopName: string
    liveRoomName: string
    startTime: string
    endTime: string
    enabled?: boolean
    note?: string
  }>
  createdBy?: string
}): Promise<{ date: string; schedules: DailyScheduleDto[]; warnings: string[] }> {
  const validation = validateScheduleDraft(params.date, params.schedules)
  if (!validation.ok) {
    throw new Error(validation.conflicts.map((c) => c.message).join('；'))
  }

  await prisma.anchorDailySchedule.deleteMany({
    where: { scheduleDate: params.date, locked: false },
  })

  const locked = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: params.date, locked: true },
  })

  const draftEnabled = params.schedules.filter((s) => s.enabled !== false)
  const allForConflict = [
    ...locked.map((r) => ({
      anchorName: r.anchorName,
      shopName: r.shopName,
      liveRoomName: r.liveRoomName,
      startAt: r.startAt,
      endAt: r.endAt,
    })),
    ...draftEnabled.map((s) => {
      const { startAt, endAt } = buildScheduleBounds(params.date, s.startTime, s.endTime)
      return {
        anchorName: s.anchorName.trim(),
        shopName: s.shopName.trim(),
        liveRoomName: s.liveRoomName.trim(),
        startAt,
        endAt,
      }
    }),
  ]
  const extraConflicts = detectScheduleConflicts(allForConflict)
  if (extraConflicts.length) {
    throw new Error(extraConflicts.map((c) => c.message).join('；'))
  }

  for (const s of draftEnabled) {
    const { startAt, endAt } = buildScheduleBounds(params.date, s.startTime, s.endTime)
    await prisma.anchorDailySchedule.create({
      data: {
        scheduleDate: params.date,
        anchorName: s.anchorName.trim(),
        shopName: s.shopName.trim(),
        liveRoomName: s.liveRoomName.trim(),
        startAt,
        endAt,
        source: 'manual',
        enabled: true,
        locked: false,
        note: s.note?.trim() || null,
        createdBy: params.createdBy ?? null,
      },
    })
  }

  await invalidateBusinessBoardCacheForDate(params.date)
  const result = await listDailySchedulesForDate(params.date)
  result.warnings.push(...validation.warnings)
  return result
}

export async function copyDailySchedules(params: {
  fromDate: string
  toDate: string
  createdBy?: string
}): Promise<{ date: string; schedules: DailyScheduleDto[]; warnings: string[] }> {
  const source = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: params.fromDate, enabled: true },
    orderBy: { startAt: 'asc' },
  })
  if (!source.length) {
    throw new Error(`${params.fromDate} 没有可复制的排班，请先生成或保存排班`)
  }

  await prisma.anchorDailySchedule.deleteMany({
    where: { scheduleDate: params.toDate, locked: false },
  })

  for (const row of source) {
    const startHm = row.startAt.toLocaleTimeString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const endDateKey = row.endAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    const endHm =
      endDateKey > row.scheduleDate
        ? '24:00'
        : row.endAt.toLocaleTimeString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          })
    const { startAt, endAt } = buildScheduleBounds(params.toDate, startHm, endHm)
    await prisma.anchorDailySchedule.create({
      data: {
        scheduleDate: params.toDate,
        anchorName: row.anchorName,
        shopName: row.shopName,
        liveRoomName: row.liveRoomName,
        startAt,
        endAt,
        source: 'manual',
        enabled: row.enabled,
        locked: false,
        note: row.note ? `复制自 ${params.fromDate}：${row.note}` : `复制自 ${params.fromDate}`,
        createdBy: params.createdBy ?? null,
      },
    })
  }

  await invalidateBusinessBoardCacheForDate(params.toDate)
  return listDailySchedulesForDate(params.toDate)
}

export async function validateDailySchedulesBody(params: {
  date: string
  schedules: Array<{
    anchorName: string
    shopName: string
    liveRoomName: string
    startTime: string
    endTime: string
    enabled?: boolean
  }>
}) {
  const validation = validateScheduleDraft(params.date, params.schedules)
  return {
    ok: validation.ok,
    conflicts: validation.conflicts,
    warnings: validation.warnings,
  }
}
