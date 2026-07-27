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

/**
 * 2026-07-01 起正式长期排班（不含橙橙：橙橙仅为 7.17 一日试播，不走默认模板）。
 * 小白 7.1 起改挂和田雅玉早场；XY 午场长期模板已结束。
 */
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
    anchorName: '小白',
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
    /** 与 Anchor.effectiveFrom=2026-07-16 对齐；此前 XY 早场无固定主播 */
    anchorName: '小小',
    shopName: 'XY祥钰珠宝',
    liveRoomName: 'XY祥钰珠宝',
    startTime: '09:30',
    endTime: '14:00',
    effectiveFrom: '2026-07-16',
    effectiveTo: null,
    sortOrder: 25,
    note: '早场·XY祥钰珠宝',
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

/** 已废弃、须截断保留历史的旧 7 月模板（禁止再 open-ended 复活） */
export const OBSOLETE_JULY_SCHEDULE_TEMPLATE_CUTOFFS: Array<{
  anchorName: string
  shopName: string
  startTime: string
  effectiveFrom: string
  /** 截断后不再对 >= 次日生效；用 CUTOFF 表示 7.1 前结束 */
  effectiveTo: string
  noteSuffix: string
}> = [
  {
    anchorName: '小白',
    shopName: 'XY祥钰珠宝',
    startTime: '14:00',
    effectiveFrom: NEW_SCHEDULE_START_DATE,
    effectiveTo: NEW_SCHEDULE_CUTOFF_DATE,
    noteSuffix: '（已截断：小白 7.1 起改挂和田雅玉早场）',
  },
  {
    anchorName: '小红',
    shopName: '和田雅玉',
    startTime: '09:30',
    effectiveFrom: NEW_SCHEDULE_START_DATE,
    effectiveTo: NEW_SCHEDULE_CUTOFF_DATE,
    noteSuffix: '（已截断：7.1 起和田早场归小白）',
  },
  {
    anchorName: '小艺',
    shopName: '和田雅玉',
    startTime: '14:00',
    effectiveFrom: NEW_SCHEDULE_START_DATE,
    effectiveTo: NEW_SCHEDULE_CUTOFF_DATE,
    noteSuffix: '（已截断：7.1 起和田午场无固定长期主播）',
  },
  {
    anchorName: '橙橙',
    shopName: '和田雅玉',
    startTime: '09:30',
    effectiveFrom: '2026-07-17',
    effectiveTo: '2026-07-17',
    noteSuffix: '（已截断：橙橙仅为 7.17 试播日，禁止长期模板）',
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

export async function upsertScheduleTemplateSeed(
  seed: ScheduleTemplateSeed,
  options?: { force?: boolean },
): Promise<'created' | 'updated' | 'unchanged'> {
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

  // 已有行：repair 强制对齐种子字段；日常 ensure 不覆盖手改
  if (options?.force) {
    const same =
      existing.liveRoomName === seed.liveRoomName &&
      existing.endTime === seed.endTime &&
      existing.effectiveTo === seed.effectiveTo &&
      existing.enabled === true &&
      existing.sortOrder === seed.sortOrder &&
      (existing.note ?? null) === (seed.note ?? null)
    if (same) return 'unchanged'
    await prisma.anchorScheduleTemplate.update({
      where: { id: existing.id },
      data: {
        liveRoomName: seed.liveRoomName,
        endTime: seed.endTime,
        effectiveTo: seed.effectiveTo,
        enabled: true,
        sortOrder: seed.sortOrder,
        note: seed.note ?? null,
        updatedAt: new Date(),
      },
    })
    return 'updated'
  }
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
  if (!dryRun) {
    await truncateObsoleteJulyScheduleTemplates()
    for (const seed of DEFAULT_SCHEDULE_TEMPLATE_SEEDS) {
      const result = await upsertScheduleTemplateSeed(seed, { force: true })
      upserted[result] += 1
    }
    await ensureXiaobaiHetianMorningTemplateAlive()
    await disableDuplicateOpenEndedXiaoxiaoTemplates()
  } else {
    for (const _seed of DEFAULT_SCHEDULE_TEMPLATE_SEEDS) {
      void _seed
      upserted.unchanged += 1
    }
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
  // 截断错误长期模板（XY 午场 / 橙橙 open-ended / 小红小艺 7 月行）
  await truncateObsoleteJulyScheduleTemplates()
  // 保证小白·和田雅玉早场默认模板可用
  await ensureXiaobaiHetianMorningTemplateAlive()
  await disableDuplicateOpenEndedXiaoxiaoTemplates()
}

/** 截断已废弃的 7 月错误模板，保留历史可追溯（不物理删除） */
async function truncateObsoleteJulyScheduleTemplates(): Promise<void> {
  for (const cut of OBSOLETE_JULY_SCHEDULE_TEMPLATE_CUTOFFS) {
    const rows = await prisma.anchorScheduleTemplate.findMany({
      where: {
        anchorName: cut.anchorName,
        shopName: cut.shopName,
        startTime: cut.startTime,
        effectiveFrom: cut.effectiveFrom,
      },
    })
    for (const row of rows) {
      const needsTruncate =
        row.effectiveTo == null || row.effectiveTo > cut.effectiveTo || row.enabled
      if (!needsTruncate && row.effectiveTo === cut.effectiveTo) continue
      // 橙橙：截断到试播当日后禁用，避免虚排长期出场
      const disable =
        cut.anchorName === '橙橙' ||
        (cut.anchorName === '小白' && cut.shopName === 'XY祥钰珠宝') ||
        cut.anchorName === '小红' ||
        cut.anchorName === '小艺'
      await prisma.anchorScheduleTemplate.update({
        where: { id: row.id },
        data: {
          effectiveTo: cut.effectiveTo,
          enabled: disable ? false : row.enabled,
          note: `${row.note ?? ''}${cut.noteSuffix}`.trim(),
          updatedAt: new Date(),
        },
      })
    }
  }
}

/**
 * 小白在职时，保证「和田雅玉 09:30-14:00」默认模板可用（7.1 起正式长期）。
 */
async function ensureXiaobaiHetianMorningTemplateAlive(): Promise<void> {
  const seed = NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.find(
    (s) => s.anchorName === '小白' && s.shopName === '和田雅玉' && s.startTime === '09:30',
  )
  if (!seed) return

  const dateKey = todayShanghaiDateKey()
  if (!templateAppliesOnDate(seed, dateKey)) return

  const xiaobai = await prisma.anchor.findFirst({
    where: {
      name: '小白',
      deletedAt: null,
      enabled: true,
      attributionMode: 'schedule',
      systemKey: null,
    },
    select: { id: true, enabled: true, effectiveFrom: true, effectiveTo: true },
  })
  if (!xiaobai) return
  const { isAnchorEffectiveOnDate } = await import('../utils/anchor-effective-date.util')
  if (!isAnchorEffectiveOnDate(xiaobai, dateKey)) return

  const candidates = await prisma.anchorScheduleTemplate.findMany({
    where: {
      anchorName: '小白',
      shopName: '和田雅玉',
      startTime: '09:30',
      effectiveFrom: seed.effectiveFrom,
    },
    orderBy: [{ updatedAt: 'desc' }],
  })
  const existing =
    candidates.find((r) => r.enabled && (!r.effectiveTo || r.effectiveTo >= dateKey)) ??
    candidates.find((r) => !r.effectiveTo || r.effectiveTo >= dateKey) ??
    candidates[0]
  if (existing) {
    if (existing.effectiveTo && existing.effectiveTo < dateKey) return
    await prisma.anchorScheduleTemplate.update({
      where: { id: existing.id },
      data: {
        enabled: true,
        anchorId: xiaobai.id,
        anchorName: '小白',
        liveRoomName: seed.liveRoomName,
        endTime: seed.endTime,
        effectiveTo: null,
        sortOrder: seed.sortOrder,
        note: seed.note ?? existing.note,
        updatedAt: new Date(),
      },
    })
    // 关闭同键重复行，避免设置页/虚排重复出卡
    await prisma.anchorScheduleTemplate.updateMany({
      where: {
        id: { not: existing.id },
        anchorName: '小白',
        shopName: '和田雅玉',
        startTime: '09:30',
        effectiveFrom: seed.effectiveFrom,
        OR: [{ enabled: true }, { effectiveTo: null }, { effectiveTo: { gt: NEW_SCHEDULE_CUTOFF_DATE } }],
      },
      data: {
        enabled: false,
        effectiveTo: NEW_SCHEDULE_CUTOFF_DATE,
        updatedAt: new Date(),
      },
    })
    return
  }

  await prisma.anchorScheduleTemplate.create({
    data: {
      anchorId: xiaobai.id,
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
}

/** 关闭非种子的小小开放模板（错误店名 / 错误 effectiveFrom） */
async function disableDuplicateOpenEndedXiaoxiaoTemplates(): Promise<void> {
  const seed = NEW_SCHEDULE_TEMPLATE_SEEDS_20260701.find((s) => s.anchorName === '小小')
  if (!seed) return
  const rows = await prisma.anchorScheduleTemplate.findMany({
    where: {
      anchorName: '小小',
      enabled: true,
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: seed.effectiveFrom! } }],
    },
  })
  for (const row of rows) {
    const isCanonical =
      row.shopName === seed.shopName &&
      row.startTime === seed.startTime &&
      row.endTime === seed.endTime &&
      row.effectiveFrom === seed.effectiveFrom
    if (isCanonical) continue
    await prisma.anchorScheduleTemplate.update({
      where: { id: row.id },
      data: {
        enabled: false,
        effectiveTo: row.effectiveTo ?? NEW_SCHEDULE_CUTOFF_DATE,
        updatedAt: new Date(),
      },
    })
  }
}

export async function listActiveTemplatesForDate(dateKey: string) {
  await ensureScheduleTemplatesSeeded()
  const rows = await prisma.anchorScheduleTemplate.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { anchorName: 'asc' }],
  })
  // 含软删除：否则已删主播查不到，旧逻辑会误把模板当成「无主播约束」继续虚排
  const anchors = await prisma.anchor.findMany({
    where: { attributionMode: 'schedule', systemKey: null },
  })
  const byId = new Map(anchors.map((a) => [a.id, a]))
  const byName = new Map(anchors.map((a) => [a.name.trim().toLowerCase(), a]))
  const { isAnchorEffectiveOnDate, isOffboardDateMissing } = await import(
    '../utils/anchor-effective-date.util'
  )
  const { formatDateKeyShanghai } = await import('../utils/business-timezone')

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
    // 库里无此主播：不虚排（避免幽灵模板）
    if (!anchor) return false
    // 软删除日及之后不再虚排；删除前的历史日仍可按区间生效
    if (anchor.deletedAt) {
      const deletedDay = formatDateKeyShanghai(new Date(anchor.deletedAt))
      if (dateKey >= deletedDay) return false
      return isAnchorEffectiveOnDate(
        {
          enabled: true,
          effectiveFrom: anchor.effectiveFrom,
          effectiveTo: anchor.effectiveTo,
        },
        dateKey,
      )
    }
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

  const draftRaw = params.templates.map((t, i) => ({
    ...t,
    anchorName: t.anchorName.trim(),
    shopName: t.shopName.trim(),
    liveRoomName: (t.liveRoomName || t.shopName).trim(),
    startTime: normalizeHm(t.startTime),
    endTime: normalizeHm(t.endTime, true),
    sortOrder: t.sortOrder ?? (i + 1) * 10,
    note: t.note?.trim() || null,
  }))

  // 去掉完全相同的行（双击保存 / 误点新增容易产生）
  const seenSlot = new Set<string>()
  const draft: typeof draftRaw = []
  for (const row of draftRaw) {
    const key = `${row.anchorName}|${row.shopName}|${row.liveRoomName}|${row.startTime}|${row.endTime}`
    if (seenSlot.has(key)) continue
    seenSlot.add(key)
    draft.push(row)
  }
  if (draft.length === 0) {
    throw new Error('默认排班不能为空')
  }

  const validation = validateScheduleDraft(dateKey, draft)
  if (!validation.ok) {
    throw new Error(validation.conflicts[0]?.message ?? '默认排班有冲突，不能保存')
  }

  const before = await listActiveTemplatesForDate(dateKey)
  const keepIds = new Set(draft.map((d) => d.id).filter(Boolean) as string[])

  await prisma.$transaction(async (tx) => {
    for (const old of before) {
      if (!keepIds.has(old.id)) {
        // 截断生效区间，避免仅 enabled=false 时被种子/兜底逻辑误复活
        const closedTo =
          old.effectiveTo && old.effectiveTo < dateKey
            ? old.effectiveTo
            : addDaysShanghai(dateKey, -1)
        await tx.anchorScheduleTemplate.update({
          where: { id: old.id },
          data: { enabled: false, effectiveTo: closedTo, updatedAt: new Date() },
        })
      }
    }

    for (const row of draft) {
      let resolvedAnchorId = row.anchorId?.trim() || null
      let resolvedAnchorName = row.anchorName
      if (resolvedAnchorId) {
        const byId = await tx.anchor.findFirst({
          where: {
            id: resolvedAnchorId,
            deletedAt: null,
            enabled: true,
            attributionMode: 'schedule',
            systemKey: null,
          },
          select: { id: true, name: true },
        })
        if (!byId) {
          throw new Error(`找不到可用主播「${row.anchorName}」，请重新选择后再保存`)
        }
        resolvedAnchorId = byId.id
        resolvedAnchorName = byId.name
      } else {
        resolvedAnchorId = await resolveAnchorIdByName(row.anchorName)
        if (!resolvedAnchorId) {
          throw new Error(`找不到可用主播「${row.anchorName}」，请重新选择后再保存`)
        }
      }
      if (row.id) {
        const existing = await tx.anchorScheduleTemplate.findUnique({ where: { id: row.id } })
        if (!existing) throw new Error(`排班模板不存在：${row.id}`)
        await tx.anchorScheduleTemplate.update({
          where: { id: row.id },
          data: {
            anchorId: resolvedAnchorId,
            anchorName: resolvedAnchorName,
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
            anchorName: resolvedAnchorName,
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
