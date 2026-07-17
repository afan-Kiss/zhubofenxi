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
import { writeOperationLog } from './audit.service'
import {
  validateScheduleHardRules,
  type ScheduleHardConflict,
} from '../utils/schedule-hard-validation.util'

const HISTORICAL_SCHEDULE_OVERRIDE_MESSAGE =
  '历史已确认排班不能直接覆盖，请先明确选择「修改历史排班」并填写原因'

function shanghaiTodayDateKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

async function assertHistoricalScheduleChangeAllowed(params: {
  date: string
  forceHistoricalScheduleChange?: boolean
  changeReason?: string
  createdBy?: string
}): Promise<string | undefined> {
  if (params.date >= shanghaiTodayDateKey()) return undefined
  const confirmed = await isDateScheduleConfirmed(params.date)
  if (!confirmed) return undefined
  const reason = params.changeReason?.trim()
  if (!params.forceHistoricalScheduleChange || !reason) {
    throw new Error(HISTORICAL_SCHEDULE_OVERRIDE_MESSAGE)
  }
  console.warn('[anchor-schedule] historical confirmed schedule override', {
    date: params.date,
    reason,
    createdBy: params.createdBy ?? null,
  })
  await writeOperationLog({
    username: params.createdBy ?? null,
    action: 'unknown',
    module: 'admin',
    description: `历史已确认排班强制修改：${params.date}`,
    meta: {
      operationType: 'historical_schedule_override',
      date: params.date,
      changeReason: reason,
      createdBy: params.createdBy ?? null,
    },
  })
  return `历史修改原因：${reason}`
}

function appendHistoricalOverrideNote(
  baseNote: string | null | undefined,
  overrideNote: string | undefined,
): string | null {
  const parts = [baseNote?.trim(), overrideNote].filter((s) => s && s.length > 0)
  return parts.length > 0 ? parts.join('；') : null
}

export type DailyScheduleSource = 'manual' | 'generated_default' | 'virtual_template'

export type EffectiveScheduleSource = 'manual' | 'generated_default' | 'virtual_template'

export interface EffectiveScheduleRow {
  rowId: string
  source: EffectiveScheduleSource
  anchorId?: string | null
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
  isTemporaryAnchor?: boolean
  temporaryAnchorKey?: string | null
  anchorColorSnapshot?: string | null
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
  confirmPreviewLines?: string[]
  hardValidationWarnings?: string[]
}

export class ScheduleSaveError extends Error {
  conflicts: Array<ScheduleConflict | ScheduleHardConflict>

  constructor(conflicts: Array<ScheduleConflict | ScheduleHardConflict>, message?: string) {
    super(message ?? conflicts[0]?.message ?? '当前排班有冲突，不能保存')
    this.conflicts = conflicts
  }
}

export interface DailyScheduleDto {
  id: string
  scheduleDate: string
  anchorId?: string | null
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
  isTemporaryAnchor?: boolean
  temporaryAnchorKey?: string | null
  anchorColorSnapshot?: string | null
}

function rowToDto(row: {
  id: string
  scheduleDate: string
  anchorId?: string | null
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
  isTemporaryAnchor?: boolean
  temporaryAnchorKey?: string | null
  anchorColorSnapshot?: string | null
}): DailyScheduleDto {
  const startTime = row.startAt.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
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
    anchorId: row.anchorId ?? null,
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
    isTemporaryAnchor: Boolean(row.isTemporaryAnchor),
    temporaryAnchorKey: row.temporaryAnchorKey ?? null,
    anchorColorSnapshot: row.anchorColorSnapshot ?? null,
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
    anchorId?: string | null
    anchorName: string
    shopName: string
    liveRoomName: string
    startAt: Date
    endAt: Date
    source: string
    enabled: boolean
    confirmed: boolean
    note: string | null
    isTemporaryAnchor?: boolean
    temporaryAnchorKey?: string | null
    anchorColorSnapshot?: string | null
  },
  source: EffectiveScheduleSource,
  dateConfirmed: boolean,
): EffectiveScheduleRow {
  return {
    rowId: row.id,
    source,
    anchorId: row.anchorId ?? null,
    anchorName: row.anchorName,
    shopName: row.shopName,
    liveRoomName: row.liveRoomName,
    startTime: hmFromDate(row.startAt, row.scheduleDate),
    endTime: hmFromDate(row.endAt, row.scheduleDate),
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    enabled: row.enabled,
    confirmed: dateConfirmed || row.confirmed,
    note: row.note ?? undefined,
    isTemporaryAnchor: Boolean(row.isTemporaryAnchor),
    temporaryAnchorKey: row.temporaryAnchorKey ?? null,
    anchorColorSnapshot: row.anchorColorSnapshot ?? null,
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

export function buildScheduleMutationResult(
  dateKey: string,
  extra?: { confirmPreviewLines?: string[]; hardValidationWarnings?: string[] },
): ScheduleMutationResult {
  return {
    changed: true,
    affectedDate: dateKey,
    shouldRefreshPerformance: true,
    confirmPreviewLines: extra?.confirmPreviewLines,
    hardValidationWarnings: extra?.hardValidationWarnings,
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
  forceHistoricalScheduleChange?: boolean
  changeReason?: string
}): Promise<{ date: string; schedules: DailyScheduleDto[]; warnings: string[] }> {
  const { date, overwrite } = params
  const templates = await listActiveTemplatesForDate(date)
  const warnings: string[] = []
  const xb = xiaobaiWarningForDate(date)
  if (xb) warnings.push(xb)

  const existing = await prisma.anchorDailySchedule.findMany({ where: { scheduleDate: date } })
  const hasManualOrLocked = existing.some((r) => r.source === 'manual' || r.locked)
  const isHistoricalConfirmed =
    date < shanghaiTodayDateKey() && (await isDateScheduleConfirmed(date))

  let historicalOverrideNote: string | undefined
  if (overwrite && isHistoricalConfirmed) {
    historicalOverrideNote = await assertHistoricalScheduleChangeAllowed({
      date,
      forceHistoricalScheduleChange: params.forceHistoricalScheduleChange,
      changeReason: params.changeReason,
      createdBy: params.createdBy,
    })
  }

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

  if (!overwrite && templatesToCreate.length > 0 && isHistoricalConfirmed) {
    historicalOverrideNote = await assertHistoricalScheduleChangeAllowed({
      date,
      forceHistoricalScheduleChange: params.forceHistoricalScheduleChange,
      changeReason: params.changeReason,
      createdBy: params.createdBy,
    })
  }

  if (templatesToCreate.length === 0 && refreshedExisting.length > 0) {
    return listDailySchedulesForDate(date)
  }

  const toCreate = templatesToCreate.map((t) => {
    const { startAt, endAt } = buildScheduleBounds(date, t.startTime, t.endTime)
    return {
      scheduleDate: date,
      anchorId: t.anchorId ?? null,
      anchorName: t.anchorName,
      shopName: t.shopName,
      liveRoomName: t.liveRoomName,
      startAt,
      endAt,
      source: 'generated_default',
      enabled: true,
      locked: false,
      confirmed: false,
      note: appendHistoricalOverrideNote(t.note, historicalOverrideNote),
      createdBy: params.createdBy ?? null,
      isTemporaryAnchor: false,
      temporaryAnchorKey: null,
      anchorColorSnapshot: null,
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
    anchorId?: string | null
    anchorName: string
    shopName: string
    liveRoomName: string
    startTime: string
    endTime: string
    enabled?: boolean
    note?: string
    isTemporaryAnchor?: boolean
    temporaryAnchorKey?: string | null
    anchorColorSnapshot?: string | null
  }>
  createdBy?: string
  confirm?: boolean
  forceHistoricalScheduleChange?: boolean
  changeReason?: string
  allowCrossShopOverlap?: boolean
}): Promise<{
  date: string
  schedules: DailyScheduleDto[]
  warnings: string[]
  confirmPreviewLines: string[]
}> {
  const { randomUUID } = await import('node:crypto')
  const { assertTemporaryAnchorDateAllowed } = await import('../utils/anchor-effective-date.util')
  const { canScheduleFormalAnchorOnDate } = await import('./anchor-offboard.service')

  const historicalOverrideNote = await assertHistoricalScheduleChangeAllowed({
    date: params.date,
    forceHistoricalScheduleChange: params.forceHistoricalScheduleChange,
    changeReason: params.changeReason,
    createdBy: params.createdBy,
  })

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

  const hard = validateScheduleHardRules({
    date: params.date,
    schedules: params.schedules,
    allowCrossShopOverlap: params.allowCrossShopOverlap,
    changeReason: params.changeReason,
    forConfirm: Boolean(params.confirm),
  })
  if (!hard.ok) {
    throw new ScheduleSaveError(hard.conflicts)
  }

  const draftEnabled = params.schedules.filter((s) => s.enabled !== false)
  const formalAnchors = await prisma.anchor.findMany({
    where: { deletedAt: null, attributionMode: 'schedule', systemKey: null },
  })
  const byId = new Map(formalAnchors.map((a) => [a.id, a]))
  const byName = new Map(formalAnchors.map((a) => [a.name.trim().toLowerCase(), a]))

  // 预校验正式 / 临时主播
  const existingTempKeys = new Set(
    (
      await prisma.anchorDailySchedule.findMany({
        where: {
          scheduleDate: params.date,
          isTemporaryAnchor: true,
          temporaryAnchorKey: { not: null },
        },
        select: { temporaryAnchorKey: true },
      })
    )
      .map((r) => r.temporaryAnchorKey)
      .filter((k): k is string => Boolean(k?.trim())),
  )

  for (const s of draftEnabled) {
    const name = s.anchorName.trim()
    const isTemp = Boolean(s.isTemporaryAnchor)
    if (isTemp) {
      const key = (s.temporaryAnchorKey && String(s.temporaryAnchorKey).trim()) || ''
      const isExistingHistoricalTemp = Boolean(key && existingTempKeys.has(key))
      // 新建临时主播：仅今天/昨天；已存在的历史临时行允许随整表保存回写
      if (!isExistingHistoricalTemp) {
        assertTemporaryAnchorDateAllowed(params.date)
      }
      if (!name || name === '未归属') {
        throw new ScheduleSaveError([{ type: 'anchor_overlap', message: '临时主播姓名不能为空' }])
      }
      const formalDup = byName.get(name.toLowerCase())
      if (formalDup) {
        throw new ScheduleSaveError([
          {
            type: 'anchor_overlap',
            message: `临时主播不能与正式主播「${formalDup.name}」重名`,
          },
        ])
      }
      continue
    }

    let anchor =
      s.anchorId && byId.get(String(s.anchorId).trim())
        ? byId.get(String(s.anchorId).trim())!
        : null
    if (!anchor && name) {
      anchor = byName.get(name.toLowerCase()) ?? null
    }
    if (anchor) {
      const check = canScheduleFormalAnchorOnDate(anchor, params.date)
      if (!check.ok) {
        throw new ScheduleSaveError([
          {
            type: 'anchor_overlap',
            message: check.message?.includes('最后工作日')
              ? `主播“${anchor.name}”最后工作日为${anchor.effectiveTo}，不能安排到${params.date}。`
              : (check.message ?? `主播“${anchor.name}”不能安排到${params.date}`),
          },
        ])
      }
    }
  }

  await prisma.anchorDailySchedule.deleteMany({
    where: { scheduleDate: params.date },
  })

  for (const s of draftEnabled) {
    const { startAt, endAt } = buildScheduleBounds(params.date, s.startTime, s.endTime)
    const name = s.anchorName.trim()
    const isTemp = Boolean(s.isTemporaryAnchor)

    if (isTemp) {
      const key =
        (s.temporaryAnchorKey && String(s.temporaryAnchorKey).trim()) ||
        `temp:${params.date}:${randomUUID()}`
      await prisma.anchorDailySchedule.create({
        data: {
          scheduleDate: params.date,
          anchorId: null,
          anchorName: name,
          shopName: s.shopName.trim(),
          liveRoomName: s.liveRoomName.trim(),
          startAt,
          endAt,
          source: 'manual',
          enabled: true,
          locked: false,
          confirmed: false,
          note: appendHistoricalOverrideNote(s.note?.trim() || null, historicalOverrideNote),
          createdBy: params.createdBy ?? null,
          isTemporaryAnchor: true,
          temporaryAnchorKey: key,
          anchorColorSnapshot: s.anchorColorSnapshot?.trim() || null,
        },
      })
      continue
    }

    let anchorId =
      'anchorId' in s && typeof s.anchorId === 'string' ? s.anchorId.trim() || null : null
    let anchor = anchorId ? byId.get(anchorId) ?? null : null
    if (!anchor && name) {
      anchor = byName.get(name.toLowerCase()) ?? null
      if (anchor) anchorId = anchor.id
    }
    await prisma.anchorDailySchedule.create({
      data: {
        scheduleDate: params.date,
        anchorId,
        anchorName: name,
        shopName: s.shopName.trim(),
        liveRoomName: s.liveRoomName.trim(),
        startAt,
        endAt,
        source: 'manual',
        enabled: true,
        locked: false,
        confirmed: false,
        note: appendHistoricalOverrideNote(s.note?.trim() || null, historicalOverrideNote),
        createdBy: params.createdBy ?? null,
        isTemporaryAnchor: false,
        temporaryAnchorKey: null,
        anchorColorSnapshot: null,
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
  result.warnings.push(...validation.warnings, ...hard.warnings)
  return {
    ...result,
    confirmPreviewLines: hard.confirmPreviewLines,
  }
}

export async function copyDailySchedules(params: {
  fromDate: string
  toDate: string
  createdBy?: string
  forceHistoricalScheduleChange?: boolean
  changeReason?: string
}): Promise<{ date: string; schedules: DailyScheduleDto[]; warnings: string[] }> {
  const { canScheduleFormalAnchorOnDate } = await import('./anchor-offboard.service')

  const historicalOverrideNote = await assertHistoricalScheduleChangeAllowed({
    date: params.toDate,
    forceHistoricalScheduleChange: params.forceHistoricalScheduleChange,
    changeReason: params.changeReason,
    createdBy: params.createdBy,
  })

  const source = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: params.fromDate, enabled: true },
    orderBy: { startAt: 'asc' },
  })
  if (!source.length) {
    throw new Error(`${params.fromDate} 没有可复制的排班，请先生成或保存排班`)
  }

  const warnings: string[] = []
  const formalAnchors = await prisma.anchor.findMany({
    where: { deletedAt: null, attributionMode: 'schedule', systemKey: null },
  })
  const byId = new Map(formalAnchors.map((a) => [a.id, a]))
  const byName = new Map(formalAnchors.map((a) => [a.name.trim().toLowerCase(), a]))

  const toCopy = []
  for (const row of source) {
    if (row.isTemporaryAnchor) {
      warnings.push(
        `已跳过临时主播“${row.anchorName}”，临时主播仅在${params.fromDate}有效。`,
      )
      continue
    }
    const anchor =
      (row.anchorId && byId.get(row.anchorId)) ||
      byName.get(row.anchorName.trim().toLowerCase()) ||
      null
    if (anchor) {
      const check = canScheduleFormalAnchorOnDate(anchor, params.toDate)
      if (!check.ok) {
        warnings.push(
          `已跳过主播“${anchor.name}”，其最后工作日为${anchor.effectiveTo ?? '未知'}。`,
        )
        continue
      }
    }
    toCopy.push(row)
  }

  await prisma.anchorDailySchedule.deleteMany({
    where: { scheduleDate: params.toDate, locked: false },
  })

  for (const row of toCopy) {
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
        anchorId: row.anchorId,
        anchorName: row.anchorName,
        shopName: row.shopName,
        liveRoomName: row.liveRoomName,
        startAt,
        endAt,
        source: 'manual',
        enabled: row.enabled,
        locked: false,
        confirmed: false,
        note: appendHistoricalOverrideNote(
          row.note ? `复制自 ${params.fromDate}：${row.note}` : `复制自 ${params.fromDate}`,
          historicalOverrideNote,
        ),
        createdBy: params.createdBy ?? null,
        isTemporaryAnchor: false,
        temporaryAnchorKey: null,
        anchorColorSnapshot: null,
      },
    })
  }

  await invalidateBusinessBoardCacheForDate(params.toDate)
  const result = await listDailySchedulesForDate(params.toDate)
  result.warnings.push(...warnings)
  return result
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
    note?: string
  }>
  allowCrossShopOverlap?: boolean
  changeReason?: string
  forConfirm?: boolean
}) {
  const validation = validateScheduleDraft(params.date, params.schedules)
  const hard = validateScheduleHardRules({
    date: params.date,
    schedules: params.schedules,
    allowCrossShopOverlap: params.allowCrossShopOverlap,
    changeReason: params.changeReason,
    forConfirm: params.forConfirm,
  })
  return {
    ok: validation.ok && hard.ok,
    conflicts: [...validation.conflicts, ...hard.conflicts],
    warnings: [...validation.warnings, ...hard.warnings],
    confirmPreviewLines: hard.confirmPreviewLines,
  }
}
