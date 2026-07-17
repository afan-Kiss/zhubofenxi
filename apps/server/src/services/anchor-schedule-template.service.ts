import { prisma } from '../lib/prisma'
import {
  buildScheduleBounds,
  detectScheduleConflicts,
  isDateOnOrAfter,
  type ScheduleConflict,
} from '../utils/anchor-schedule-time.util'
import {
  ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE,
  ANCHOR_XIAOBAI_SCHEDULE_START_DATE,
  ANCHOR_NEW_SCHEDULE_START_DATE,
  ANCHOR_NEW_SCHEDULE_CUTOFF_DATE,
} from '../config/anchor-schedule.constants'
import { XIAOBAI_ANCHOR_CUTOFF_MS, SHOP_SESSION_ANCHOR_CUTOFF_MS } from './anchor-session-cutoff.util'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import { addDaysShanghai } from '../utils/business-timezone'

export const XIAOBAI_SCHEDULE_START_DATE = ANCHOR_XIAOBAI_SCHEDULE_START_DATE
export const SHOP_SESSION_SCHEDULE_START_DATE = ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE
export const NEW_SCHEDULE_START_DATE = ANCHOR_NEW_SCHEDULE_START_DATE
export const NEW_SCHEDULE_CUTOFF_DATE = ANCHOR_NEW_SCHEDULE_CUTOFF_DATE

export interface ScheduleTemplateSeed {
  anchorName: string
  shopName: string
  liveRoomName: string
  startTime: string
  endTime: string
  effectiveFrom: string | null
  effectiveTo: string | null
  sortOrder: number
  note?: string
}

/** 2026-07-01 起生效的新固定排班（5 行） */
export const NEW_SCHEDULE_TEMPLATE_SEEDS_20260701: ScheduleTemplateSeed[] = [
  {
    anchorName: '子杰',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '09:30',
    endTime: '14:00',
    effectiveFrom: NEW_SCHEDULE_START_DATE,
    effectiveTo: null,
    sortOrder: 10,
    note: '早场·拾玉居和田玉',
  },
  {
    anchorName: '小红',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '09:30',
    endTime: '14:00',
    effectiveFrom: NEW_SCHEDULE_START_DATE,
    effectiveTo: null,
    sortOrder: 20,
    note: '早场·和田雅玉',
  },
  {
    anchorName: '小白',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '14:00',
    endTime: '18:30',
    effectiveFrom: NEW_SCHEDULE_START_DATE,
    effectiveTo: null,
    sortOrder: 30,
    note: '午场·XY祥钰珠宝',
  },
  {
    anchorName: '小艺',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '14:00',
    endTime: '18:30',
    effectiveFrom: NEW_SCHEDULE_START_DATE,
    effectiveTo: null,
    sortOrder: 40,
    note: '午场·和田雅玉',
  },
  {
    anchorName: '飞云',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '18:30',
    endTime: '23:00',
    effectiveFrom: NEW_SCHEDULE_START_DATE,
    effectiveTo: null,
    sortOrder: 50,
    note: '晚场·拾玉居和田玉',
  },
]

/** 2026-06-30 及之前仍生效的历史模板 */
const LEGACY_SCHEDULE_TEMPLATE_SEEDS: ScheduleTemplateSeed[] = [
  {
    anchorName: '飞云',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '18:00',
    endTime: '24:00',
    effectiveFrom: null,
    effectiveTo: NEW_SCHEDULE_CUTOFF_DATE,
    sortOrder: 50,
    note: '晚场·拾玉居',
  },
  /** 6.13 店铺场次规则前：祥钰系早/午场由子杰承接（不得用 6.13 后模板反推） */
  {
    anchorName: '子杰',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '00:00',
    endTime: '18:00',
    effectiveFrom: null,
    effectiveTo: addDaysShanghai(SHOP_SESSION_SCHEDULE_START_DATE, -1),
    sortOrder: 8,
    note: '历史早场·XY祥钰（6.13 前）',
  },
  {
    anchorName: '子杰',
    shopName: '祥钰珠宝',
    liveRoomName: '祥钰珠宝',
    startTime: '00:00',
    endTime: '18:00',
    effectiveFrom: null,
    effectiveTo: addDaysShanghai(SHOP_SESSION_SCHEDULE_START_DATE, -1),
    sortOrder: 9,
    note: '历史早场·祥钰珠宝（6.13 前）',
  },
  {
    anchorName: '小红',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '00:00',
    endTime: '18:00',
    effectiveFrom: null,
    effectiveTo: addDaysShanghai(SHOP_SESSION_SCHEDULE_START_DATE, -1),
    sortOrder: 19,
    note: '历史早场·和田雅玉（6.13 前）',
  },
  {
    anchorName: '小红',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '00:00',
    endTime: '18:00',
    effectiveFrom: SHOP_SESSION_SCHEDULE_START_DATE,
    effectiveTo: NEW_SCHEDULE_CUTOFF_DATE,
    sortOrder: 20,
    note: '早场·和田雅玉',
  },
  {
    anchorName: '小艺',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '18:00',
    endTime: '24:00',
    effectiveFrom: SHOP_SESSION_SCHEDULE_START_DATE,
    effectiveTo: NEW_SCHEDULE_CUTOFF_DATE,
    sortOrder: 40,
    note: '晚场·和田雅玉',
  },
  {
    anchorName: '子杰',
    shopName: '祥钰珠宝',
    liveRoomName: '祥钰珠宝',
    startTime: '00:00',
    endTime: '18:00',
    effectiveFrom: SHOP_SESSION_SCHEDULE_START_DATE,
    effectiveTo: NEW_SCHEDULE_CUTOFF_DATE,
    sortOrder: 12,
    note: '早场·祥钰珠宝',
  },
  {
    anchorName: '子杰',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '00:00',
    endTime: '18:00',
    effectiveFrom: SHOP_SESSION_SCHEDULE_START_DATE,
    effectiveTo: addDaysShanghai(XIAOBAI_SCHEDULE_START_DATE, -1),
    sortOrder: 10,
    note: '早场·XY祥钰（小白上岗前）',
  },
  {
    anchorName: '子杰',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '00:00',
    endTime: '14:30',
    effectiveFrom: XIAOBAI_SCHEDULE_START_DATE,
    effectiveTo: NEW_SCHEDULE_CUTOFF_DATE,
    sortOrder: 11,
    note: '早场·XY祥钰（14:30 前）',
  },
  {
    anchorName: '小白',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '14:30',
    endTime: '18:00',
    effectiveFrom: XIAOBAI_SCHEDULE_START_DATE,
    effectiveTo: NEW_SCHEDULE_CUTOFF_DATE,
    sortOrder: 15,
    note: '午场·XY祥钰 14:30-18:00',
  },
]

export const DEFAULT_SCHEDULE_TEMPLATE_SEEDS: ScheduleTemplateSeed[] = [
  ...LEGACY_SCHEDULE_TEMPLATE_SEEDS,
  ...NEW_SCHEDULE_TEMPLATE_SEEDS_20260701,
]

export function templateAppliesOnDate(template: ScheduleTemplateSeed, dateKey: string): boolean {
  if (template.effectiveFrom && !isDateOnOrAfter(dateKey, template.effectiveFrom)) return false
  if (template.effectiveTo && dateKey > template.effectiveTo) return false
  return true
}

function templateSeedKey(seed: ScheduleTemplateSeed): string {
  return [
    seed.anchorName,
    seed.shopName,
    seed.startTime,
    seed.endTime,
    seed.effectiveFrom ?? '',
    seed.effectiveTo ?? '',
  ].join('|')
}

function isNewScheduleTemplateRow(
  row: Pick<ScheduleTemplateSeed, 'anchorName' | 'shopName' | 'startTime' | 'effectiveFrom'>,
): boolean {
  return NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.some(
    (seed) =>
      seed.anchorName === row.anchorName &&
      seed.shopName === row.shopName &&
      seed.startTime === row.startTime &&
      seed.effectiveFrom === row.effectiveFrom,
  )
}

export async function upsertScheduleTemplateSeed(seed: ScheduleTemplateSeed): Promise<'created' | 'updated' | 'unchanged'> {
  const existing = await prisma.anchorScheduleTemplate.findFirst({
    where: {
      anchorName: seed.anchorName,
      shopName: seed.shopName,
      startTime: seed.startTime,
      effectiveFrom: seed.effectiveFrom,
    },
  })

  if (!existing) {
    await prisma.anchorScheduleTemplate.create({
      data: {
        anchorName: seed.anchorName,
        shopName: seed.shopName,
        liveRoomName: seed.liveRoomName,
        startTime: seed.startTime,
        endTime: seed.endTime,
        effectiveFrom: seed.effectiveFrom,
        effectiveTo: seed.effectiveTo,
        enabled: true,
        sortOrder: seed.sortOrder,
        note: seed.note ?? null,
      },
    })
    return 'created'
  }

  // 已有行不再被种子静默覆盖（设置页可手改主播/班次/直播间；强制修复走 repair 脚本）
  return 'unchanged'
}

export async function repairScheduleTemplatesFrom20260701(options?: {
  dryRun?: boolean
  regenerateFromDate?: string
}): Promise<{
  truncatedTemplates: number
  upserted: { created: number; updated: number; unchanged: number }
  deletedGeneratedDefaults: number
  manualSchedulesKept: number
  regeneratedDates: string[]
}> {
  const dryRun = options?.dryRun ?? false
  const regenerateFromDate = options?.regenerateFromDate ?? NEW_SCHEDULE_START_DATE

  const before = await prisma.anchorScheduleTemplate.findMany({
    orderBy: [{ sortOrder: 'asc' }, { anchorName: 'asc' }],
  })

  let truncatedTemplates = 0
  for (const row of before) {
    const asSeed: ScheduleTemplateSeed = {
      anchorName: row.anchorName,
      shopName: row.shopName,
      liveRoomName: row.liveRoomName,
      startTime: row.startTime,
      endTime: row.endTime,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      sortOrder: row.sortOrder,
      note: row.note ?? undefined,
    }
    if (!templateAppliesOnDate(asSeed, NEW_SCHEDULE_START_DATE)) continue
    if (isNewScheduleTemplateRow(asSeed)) continue

    const nextEffectiveTo =
      !row.effectiveTo || row.effectiveTo > NEW_SCHEDULE_CUTOFF_DATE
        ? NEW_SCHEDULE_CUTOFF_DATE
        : row.effectiveTo
    if (row.effectiveTo !== nextEffectiveTo) {
      truncatedTemplates += 1
      if (!dryRun) {
        await prisma.anchorScheduleTemplate.update({
          where: { id: row.id },
          data: { effectiveTo: nextEffectiveTo },
        })
      }
    }
  }

  const upserted = { created: 0, updated: 0, unchanged: 0 }
  for (const seed of DEFAULT_SCHEDULE_TEMPLATE_SEEDS) {
    if (dryRun) continue
    const result = await upsertScheduleTemplateSeed(seed)
    upserted[result] += 1
  }

  const manualSchedulesKept = dryRun
    ? await prisma.anchorDailySchedule.count({
        where: { scheduleDate: { gte: regenerateFromDate }, source: 'manual' },
      })
    : 0

  let deletedGeneratedDefaults = 0
  if (!dryRun) {
    const deleted = await prisma.anchorDailySchedule.deleteMany({
      where: {
        scheduleDate: { gte: regenerateFromDate },
        source: 'generated_default',
        locked: false,
      },
    })
    deletedGeneratedDefaults = deleted.count
  }

  const regeneratedDates: string[] = []
  if (!dryRun) {
    const { generateDefaultSchedulesForDate } = await import('./anchor-daily-schedule.service')
    const dates = await prisma.anchorDailySchedule.findMany({
      where: { scheduleDate: { gte: regenerateFromDate } },
      select: { scheduleDate: true },
      distinct: ['scheduleDate'],
    })
    const dateKeys = new Set<string>([NEW_SCHEDULE_START_DATE, '2026-07-02'])
    for (const d of dates) dateKeys.add(d.scheduleDate)

    for (const dateKey of [...dateKeys].sort()) {
      const hasManual = await prisma.anchorDailySchedule.count({
        where: { scheduleDate: dateKey, source: 'manual' },
      })
      if (hasManual > 0) continue
      await generateDefaultSchedulesForDate({ date: dateKey, overwrite: true })
      regeneratedDates.push(dateKey)
    }

    const { invalidateBusinessBoardCacheForDate } = await import('./anchor-schedule-cache.service')
    for (const dateKey of regeneratedDates) {
      invalidateBusinessBoardCacheForDate(dateKey)
    }
  }

  return {
    truncatedTemplates,
    upserted,
    deletedGeneratedDefaults,
    manualSchedulesKept: dryRun
      ? manualSchedulesKept
      : await prisma.anchorDailySchedule.count({
          where: { scheduleDate: { gte: regenerateFromDate }, source: 'manual' },
        }),
    regeneratedDates,
  }
}

export async function ensureScheduleTemplatesSeeded(): Promise<void> {
  for (const seed of DEFAULT_SCHEDULE_TEMPLATE_SEEDS) {
    await upsertScheduleTemplateSeed(seed)
  }
}

export async function listActiveTemplatesForDate(dateKey: string) {
  await ensureScheduleTemplatesSeeded()
  const rows = await prisma.anchorScheduleTemplate.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { anchorName: 'asc' }],
  })
  const anchors = await prisma.anchor.findMany({
    where: { deletedAt: null, attributionMode: 'schedule', systemKey: null },
  })
  const byId = new Map(anchors.map((a) => [a.id, a]))
  const byName = new Map(anchors.map((a) => [a.name.trim().toLowerCase(), a]))
  const { isAnchorEffectiveOnDate } = await import('../utils/anchor-effective-date.util')
  const { isOffboardDateMissing } = await import('../utils/anchor-effective-date.util')

  return rows.filter((t) => {
    if (
      !templateAppliesOnDate(
        {
          anchorName: t.anchorName,
          shopName: t.shopName,
          liveRoomName: t.liveRoomName,
          startTime: t.startTime,
          endTime: t.endTime,
          effectiveFrom: t.effectiveFrom,
          effectiveTo: t.effectiveTo,
          sortOrder: t.sortOrder,
        },
        dateKey,
      )
    ) {
      return false
    }
    const anchor =
      (t.anchorId && byId.get(t.anchorId)) ||
      byName.get(t.anchorName.trim().toLowerCase()) ||
      null
    if (!anchor) return true
    if (isOffboardDateMissing(anchor)) return false
    return isAnchorEffectiveOnDate(anchor, dateKey)
  })
}

export function buildVirtualSchedulesFromTemplates(
  dateKey: string,
  templates: Awaited<ReturnType<typeof listActiveTemplatesForDate>>,
) {
  return templates.map((t) => {
    const { startAt, endAt } = buildScheduleBounds(dateKey, t.startTime, t.endTime)
    return {
      id: `virtual-${t.id}`,
      scheduleDate: dateKey,
      anchorId: t.anchorId ?? null,
      anchorName: t.anchorName,
      shopName: t.shopName,
      liveRoomName: t.liveRoomName,
      startAt,
      endAt,
      source: 'virtual_template' as const,
      enabled: true,
      locked: false,
      note: t.note,
      createdBy: null,
    }
  })
}

export function isBeforeShopSessionSchedule(dateKey: string): boolean {
  return !isDateOnOrAfter(dateKey, SHOP_SESSION_SCHEDULE_START_DATE)
}

export function xiaobaiWarningForDate(dateKey: string): string | null {
  if (isDateOnOrAfter(dateKey, XIAOBAI_SCHEDULE_START_DATE)) return null
  if (isDateOnOrAfter(dateKey, SHOP_SESSION_SCHEDULE_START_DATE)) {
    return '当前日期早于小白上岗日（2026-06-18），若手动添加小白排班请确认是否符合实际。'
  }
  return null
}

export function validateScheduleDraft(
  dateKey: string,
  rows: Array<{
    anchorName: string
    shopName: string
    liveRoomName: string
    startTime: string
    endTime: string
    enabled?: boolean
  }>,
): { ok: boolean; conflicts: ScheduleConflict[]; warnings: string[] } {
  const warnings: string[] = []
  const xb = xiaobaiWarningForDate(dateKey)
  if (xb) warnings.push(xb)

  const enabledRows = rows.filter((r) => r.enabled !== false)
  for (let i = 0; i < enabledRows.length; i++) {
    const r = enabledRows[i]!
    if (!r.startTime?.trim()) throw new Error(`第 ${i + 1} 行开始时间不能为空`)
    if (!r.endTime?.trim()) throw new Error(`第 ${i + 1} 行结束时间不能为空`)
    if (!r.anchorName?.trim()) throw new Error(`第 ${i + 1} 行主播不能为空`)
    if (!r.shopName?.trim() || !r.liveRoomName?.trim()) {
      throw new Error(`第 ${i + 1} 行店铺/直播间不能为空`)
    }
    const startMin = r.startTime.trim()
    const endMin = r.endTime.trim()
    if (startMin === endMin && endMin !== '24:00') {
      throw new Error(`第 ${i + 1} 行开始时间不能等于结束时间`)
    }
  }

  const intervals = enabledRows.map((r) => {
    const { startAt, endAt } = buildScheduleBounds(dateKey, r.startTime, r.endTime)
    return {
      anchorName: r.anchorName.trim(),
      shopName: r.shopName.trim(),
      liveRoomName: r.liveRoomName.trim(),
      startAt,
      endAt,
    }
  })

  const conflicts = detectScheduleConflicts(intervals)
  return { ok: conflicts.length === 0, conflicts, warnings }
}

export const SHOP_SESSION_CUTOFF_MS = SHOP_SESSION_ANCHOR_CUTOFF_MS
export const XIAOBAI_CUTOFF_MS = XIAOBAI_ANCHOR_CUTOFF_MS

export function todayShanghaiDateKey(): string {
  return formatDateKeyShanghai(new Date())
}

export function listTemplateSeedKeysForDate(dateKey: string): string[] {
  return DEFAULT_SCHEDULE_TEMPLATE_SEEDS.filter((seed) => templateAppliesOnDate(seed, dateKey)).map(
    templateSeedKey,
  )
}

export type ScheduleTemplateAdminDto = {
  id: string
  anchorId: string | null
  anchorName: string
  shopName: string
  liveRoomName: string
  startTime: string
  endTime: string
  effectiveFrom: string | null
  effectiveTo: string | null
  enabled: boolean
  sortOrder: number
  note: string | null
}

/** 设置页：列出当前日期仍生效的默认排班模板（生成默认排班的事实源） */
export async function listCurrentDefaultTemplatesForAdmin(
  asOfDate?: string,
): Promise<{ date: string; templates: ScheduleTemplateAdminDto[] }> {
  const dateKey = asOfDate?.trim() || todayShanghaiDateKey()
  const rows = await listActiveTemplatesForDate(dateKey)
  return {
    date: dateKey,
    templates: rows.map((t) => ({
      id: t.id,
      anchorId: t.anchorId ?? null,
      anchorName: t.anchorName,
      shopName: t.shopName,
      liveRoomName: t.liveRoomName,
      startTime: t.startTime,
      endTime: t.endTime,
      effectiveFrom: t.effectiveFrom,
      effectiveTo: t.effectiveTo,
      enabled: t.enabled,
      sortOrder: t.sortOrder,
      note: t.note,
    })),
  }
}

function normalizeHm(value: string, allowEnd2400 = false): string {
  const t = value.trim()
  if (allowEnd2400 && (t === '24:00' || t === '24:00:00')) return '24:00'
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t)
  if (!m) throw new Error(`时间格式无效：${value}`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error(`时间格式无效：${value}`)
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

async function resolveAnchorIdByName(name: string): Promise<string | null> {
  const hit = await prisma.anchor.findFirst({
    where: {
      name: name.trim(),
      deletedAt: null,
      enabled: true,
      attributionMode: 'schedule',
      systemKey: null,
    },
    select: { id: true },
  })
  return hit?.id ?? null
}

/**
 * 保存设置页默认排班：
 * - 有 id：更新对应行
 * - 无 id：新建（effectiveFrom=asOfDate，effectiveTo=null）
 * - 本次未提交的原「当日生效」模板：标记 enabled=false（历史日不再用它生成）
 */
export async function saveCurrentDefaultTemplates(params: {
  asOfDate?: string
  templates: Array<{
    id?: string | null
    anchorId?: string | null
    anchorName: string
    shopName: string
    liveRoomName: string
    startTime: string
    endTime: string
    note?: string | null
    sortOrder?: number
  }>
}): Promise<{ date: string; templates: ScheduleTemplateAdminDto[] }> {
  const dateKey = params.asOfDate?.trim() || todayShanghaiDateKey()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error('日期格式须为 YYYY-MM-DD')
  }

  const draft = params.templates.map((t, i) => ({
    ...t,
    anchorName: t.anchorName.trim(),
    shopName: t.shopName.trim(),
    liveRoomName: (t.liveRoomName || t.shopName).trim(),
    startTime: normalizeHm(t.startTime),
    endTime: normalizeHm(t.endTime, true),
    sortOrder: t.sortOrder ?? (i + 1) * 10,
    note: t.note?.trim() || null,
  }))

  const validation = validateScheduleDraft(dateKey, draft)
  if (!validation.ok) {
    throw new Error(validation.conflicts[0]?.message ?? '默认排班有冲突，不能保存')
  }

  const before = await listActiveTemplatesForDate(dateKey)
  const keepIds = new Set(draft.map((d) => d.id).filter(Boolean) as string[])

  await prisma.$transaction(async (tx) => {
    for (const old of before) {
      if (!keepIds.has(old.id)) {
        await tx.anchorScheduleTemplate.update({
          where: { id: old.id },
          data: { enabled: false, updatedAt: new Date() },
        })
      }
    }

    for (const row of draft) {
      const resolvedAnchorId =
        (row.anchorId?.trim() || null) ?? (await resolveAnchorIdByName(row.anchorName))
      if (row.id) {
        const existing = await tx.anchorScheduleTemplate.findUnique({ where: { id: row.id } })
        if (!existing) throw new Error(`排班模板不存在：${row.id}`)
        await tx.anchorScheduleTemplate.update({
          where: { id: row.id },
          data: {
            anchorId: resolvedAnchorId,
            anchorName: row.anchorName,
            shopName: row.shopName,
            liveRoomName: row.liveRoomName,
            startTime: row.startTime,
            endTime: row.endTime,
            enabled: true,
            sortOrder: row.sortOrder,
            note: row.note,
          },
        })
      } else {
        await tx.anchorScheduleTemplate.create({
          data: {
            anchorId: resolvedAnchorId,
            anchorName: row.anchorName,
            shopName: row.shopName,
            liveRoomName: row.liveRoomName,
            startTime: row.startTime,
            endTime: row.endTime,
            effectiveFrom: dateKey,
            effectiveTo: null,
            enabled: true,
            sortOrder: row.sortOrder,
            note: row.note,
          },
        })
      }
    }
  })

  return listCurrentDefaultTemplatesForAdmin(dateKey)
}
