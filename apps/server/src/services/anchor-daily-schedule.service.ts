import { prisma } from '../lib/prisma'
import { buildScheduleBounds, detectScheduleConflicts, type ScheduleConflict } from '../utils/anchor-schedule-time.util'
import {
  validateScheduleDraft,
  xiaobaiWarningForDate,
} from './anchor-schedule-template.service'
import { invalidateBusinessBoardCacheForDate } from './anchor-schedule-cache.service'
import { confirmDailySchedules } from './anchor-schedule-confirm.service'
import { isDateScheduleConfirmed } from './anchor-schedule-confirm.service'
import { buildEffectiveScheduleRowsForDate } from '../utils/anchor-effective-schedule.util'
import { listActiveTemplatesForDate } from './anchor-schedule-template.service'

export type DailyScheduleSource = 'manual' | 'generated_default' | 'virtual_template'

export type EffectiveScheduleSource = 'manual' | 'generated_default' | 'virtual_template'

export interface EffectiveScheduleRow {
  rowId: string
  source: EffectiveScheduleSource
  anchorName: string
  shopName: string
  liveRoomName: string
  startTime: string
  endTime: string
  startAt: string
  endAt: string
  enabled: boolean
  confirmed: boolean
  note?: string
}

export interface EffectiveScheduleTable {
  date: string
  confirmed: boolean
  sourceSummary: {
    manualCount: number
    generatedCount: number
    virtualCount: number
  }
  rows: EffectiveScheduleRow[]
  warnings: string[]
}

export interface ScheduleMutationResult {
  changed: boolean
  affectedDate: string
  shouldRefreshPerformance: boolean
}

export class ScheduleSaveError extends Error {
  conflicts: ScheduleConflict[]

  constructor(conflicts: ScheduleConflict[]) {
    super('当前排班有冲突，不能保存')
    this.conflicts = conflicts
  }
}

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
  confirmed: boolean
  confirmedAt: string | null
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
  confirmed: boolean
  confirmedAt: Date | null
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
    source: (row.source === 'virtual_template'
      ? 'virtual_template'
      : row.source === 'manual'
        ? 'manual'
        : 'generated_default') as DailyScheduleSource,
    enabled: row.enabled,
    locked: row.locked,
    confirmed: row.confirmed,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    note: row.note,
  }
}

function hmFromDate(d: Date, scheduleDate: string): string {
  const endDateKey = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  const isMidnightEnd =
    d.getHours() === 0 && d.getMinutes() === 0 && endDateKey > scheduleDate
  if (isMidnightEnd) return '24:00'
  return d.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function dbRowToEffective(
  row: {
    id: string
    scheduleDate: string
    anchorName: string
    shopName: string
    liveRoomName: string
    startAt: Date
    endAt: Date
    source: string
    enabled: boolean
    confirmed: boolean
    note: string | null
  },
  source: EffectiveScheduleSource,
  dateConfirmed: boolean,
): EffectiveScheduleRow {
  return {
    rowId: row.id,
    source,
    anchorName: row.anchorName,
    shopName: row.shopName,
    liveRoomName: row.liveRoomName,
    startTime: hmFromDate(row.startAt, row.scheduleDate),
    endTime: hmFromDate(row.endAt, row.scheduleDate),
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    enabled: row.enabled,
    confirmed: dateConfirmed,
    note: row.note ?? undefined,
  }
}

export async function getEffectiveScheduleTableForDate(dateKey: string): Promise<EffectiveScheduleTable> {
  const warnings: string[] = []
  const xb = xiaobaiWarningForDate(dateKey)
  if (xb) warnings.push(xb)

  const dateConfirmed = await isDateScheduleConfirmed(dateKey)
  const dbRows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: dateKey, enabled: true },
    orderBy: { startAt: 'asc' },
  })

  const templates = await listActiveTemplatesForDate(dateKey)
  const built = buildEffectiveScheduleRowsForDate({
    dateKey,
    dateConfirmed,
    dbRows,
    templates: templates.map((t) => ({
      anchorName: t.anchorName,
      shopName: t.shopName,
      liveRoomName: t.liveRoomName,
      startTime: t.startTime,
      endTime: t.endTime,
      effectiveFrom: t.effectiveFrom,
      effectiveTo: t.effectiveTo,
      sortOrder: t.sortOrder,
      note: t.note ?? undefined,
    })),
    templateRecords: templates,
  })

  warnings.push(...built.warnings)

  const effectiveRows = built.rows

  const conflicts = detectScheduleConflicts(
    effectiveRows.map((r) => ({
      anchorName: r.anchorName,
      shopName: r.shopName,
      liveRoomName: r.liveRoomName,
      startAt: new Date(r.startAt),
      endAt: new Date(r.endAt),
    })),
  )
  for (const c of conflicts) warnings.push(c.message)

  return {
    date: dateKey,
    confirmed: dateConfirmed,
    sourceSummary: built.sourceSummary,
    rows: effectiveRows,
    warnings,
  }
}

export async function getEffectiveScheduleTablesForRange(
  startDate: string,
  endDate: string,
): Promise<EffectiveScheduleTable[]> {
  const out: EffectiveScheduleTable[] = []
  let cursor = startDate
  while (cursor <= endDate) {
    out.push(await getEffectiveScheduleTableForDate(cursor))
    const next = new Date(`${cursor}T12:00:00+08:00`)
    next.setDate(next.getDate() + 1)
    cursor = next.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
  }
  return out
}

function effectiveRowToDto(row: EffectiveScheduleRow, dateKey: string): DailyScheduleDto {
  return {
    id: row.rowId,
    scheduleDate: dateKey,
    anchorName: row.anchorName,
    shopName: row.shopName,
    liveRoomName: row.liveRoomName,
    startAt: row.startAt,
    endAt: row.endAt,
    startTime: row.startTime,
    endTime: row.endTime,
    source: row.source,
    enabled: row.enabled,
    locked: row.source === 'manual',
    confirmed: row.confirmed,
    confirmedAt: null,
    note: row.note ?? null,
  }
}

export function buildScheduleMutationResult(dateKey: string): ScheduleMutationResult {
  return {
    changed: true,
    affectedDate: dateKey,
    shouldRefreshPerformance: true,
  }
}

export async function listDailySchedulesForDate(dateKey: string): Promise<{
  date: string
  schedules: DailyScheduleDto[]
  warnings: string[]
  effectiveTable: EffectiveScheduleTable
  hasManualDay: boolean
}> {
  const table = await getEffectiveScheduleTableForDate(dateKey)
  const dbRows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: dateKey, enabled: true },
    orderBy: { startAt: 'asc' },
  })
  const hasManualDay = dbRows.some((r) => r.source === 'manual')
  const schedules = hasManualDay
    ? dbRows.filter((r) => r.source === 'manual').map(rowToDto)
    : table.rows.map((r) => effectiveRowToDto(r, dateKey))
  return {
    date: dateKey,
    schedules,
    warnings: table.warnings,
    effectiveTable: table,
    hasManualDay,
  }
}

export async function getEffectiveSchedulesForDate(dateKey: string) {
  const table = await getEffectiveScheduleTableForDate(dateKey)
  const toRow = (r: EffectiveScheduleRow) => ({
    id: r.rowId,
    scheduleDate: dateKey,
    anchorName: r.anchorName,
    shopName: r.shopName,
    liveRoomName: r.liveRoomName,
    startAt: new Date(r.startAt),
    endAt: new Date(r.endAt),
    source: r.source,
    enabled: true,
    locked: r.source === 'manual',
    confirmed: r.confirmed,
    confirmedAt: null,
    note: r.note ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
  })
  return {
    manual: table.rows.filter((r) => r.source === 'manual').map(toRow),
    generated: table.rows.filter((r) => r.source === 'generated_default').map(toRow),
    virtual: table.rows.filter((r) => r.source === 'virtual_template').map(toRow),
    table,
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
  const hasManualOrLocked = existing.some((r) => r.source === 'manual' || r.locked)

  if (overwrite) {
    await prisma.anchorDailySchedule.deleteMany({
      where: {
        scheduleDate: date,
        locked: false,
        source: 'generated_default',
      },
    })
  }

  const refreshedExisting = overwrite
    ? await prisma.anchorDailySchedule.findMany({ where: { scheduleDate: date } })
    : existing

  const templateKey = (anchorName: string, shopName: string, startTime: string) =>
    `${anchorName}|${shopName}|${startTime}`

  const coveredKeys = new Set(
    refreshedExisting.map((r) => {
      const startTime = r.startAt.toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
      return templateKey(r.anchorName, r.shopName, startTime)
    }),
  )

  const templatesToCreate = templates.filter((t) => {
    if (hasManualOrLocked && !overwrite) {
      // 有人工/锁定排班时仍补缺失的默认 slot，但不删已有
    }
    return !coveredKeys.has(templateKey(t.anchorName, t.shopName, t.startTime))
  })

  if (templatesToCreate.length === 0 && refreshedExisting.length > 0) {
    return listDailySchedulesForDate(date)
  }

  const toCreate = templatesToCreate.map((t) => {
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
      confirmed: false,
      note: t.note,
      createdBy: params.createdBy ?? null,
    }
  })

  const validation = validateScheduleDraft(
    date,
    [...refreshedExisting.map((r) => ({
      anchorName: r.anchorName,
      shopName: r.shopName,
      liveRoomName: r.liveRoomName,
      startTime: r.startAt.toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
      endTime: r.endAt.toLocaleTimeString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
      enabled: r.enabled,
    })), ...toCreate.map((c) => ({
      anchorName: c.anchorName,
      shopName: c.shopName,
      liveRoomName: c.liveRoomName,
      startTime: templatesToCreate.find((t) => t.anchorName === c.anchorName && t.shopName === c.shopName)?.startTime ?? '00:00',
      endTime: templatesToCreate.find((t) => t.anchorName === c.anchorName && t.shopName === c.shopName)?.endTime ?? '24:00',
    }))],
  )
  if (!validation.ok) {
    throw new Error(validation.conflicts.map((c) => c.message).join('；'))
  }
  warnings.push(...validation.warnings)

  if (toCreate.length) {
    await prisma.anchorDailySchedule.createMany({ data: toCreate })
  }

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
  confirm?: boolean
}): Promise<{ date: string; schedules: DailyScheduleDto[]; warnings: string[] }> {
  let validation: ReturnType<typeof validateScheduleDraft>
  try {
    validation = validateScheduleDraft(params.date, params.schedules)
  } catch (err) {
    throw new ScheduleSaveError([
      {
        type: 'anchor_overlap',
        message: err instanceof Error ? err.message : '排班校验失败',
      },
    ])
  }
  if (!validation.ok) {
    throw new ScheduleSaveError(validation.conflicts)
  }

  const draftEnabled = params.schedules.filter((s) => s.enabled !== false)
  const draftConflicts = detectScheduleConflicts(
    draftEnabled.map((s) => {
      const { startAt, endAt } = buildScheduleBounds(params.date, s.startTime, s.endTime)
      return {
        anchorName: s.anchorName.trim(),
        shopName: s.shopName.trim(),
        liveRoomName: s.liveRoomName.trim(),
        startAt,
        endAt,
      }
    }),
  )
  if (draftConflicts.length) {
    throw new ScheduleSaveError(draftConflicts)
  }

  await prisma.anchorDailySchedule.deleteMany({
    where: { scheduleDate: params.date },
  })

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
        confirmed: false,
        note: s.note?.trim() || null,
        createdBy: params.createdBy ?? null,
      },
    })
  }

  await invalidateBusinessBoardCacheForDate(params.date)
  if (params.confirm) {
    await confirmDailySchedules({
      date: params.date,
      confirmedBy: params.createdBy,
      confirmNote: '保存并确认',
    })
  }
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
        confirmed: false,
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
