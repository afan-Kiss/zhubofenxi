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
} from '../config/anchor-schedule.constants'
import { XIAOBAI_ANCHOR_CUTOFF_MS, SHOP_SESSION_ANCHOR_CUTOFF_MS } from './anchor-performance-attribution.service'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import { addDaysShanghai } from '../utils/business-timezone'

export const XIAOBAI_SCHEDULE_START_DATE = ANCHOR_XIAOBAI_SCHEDULE_START_DATE
export const SHOP_SESSION_SCHEDULE_START_DATE = ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE

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

export const DEFAULT_SCHEDULE_TEMPLATE_SEEDS: ScheduleTemplateSeed[] = [
  {
    anchorName: '飞云',
    shopName: '拾玉居和田玉',
    liveRoomName: '拾玉居和田玉',
    startTime: '18:00',
    endTime: '24:00',
    effectiveFrom: null,
    effectiveTo: null,
    sortOrder: 50,
    note: '晚场·拾玉居',
  },
  {
    anchorName: '小红',
    shopName: '和田雅玉',
    liveRoomName: '和田雅玉',
    startTime: '00:00',
    endTime: '18:00',
    effectiveFrom: SHOP_SESSION_SCHEDULE_START_DATE,
    effectiveTo: null,
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
    effectiveTo: null,
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
    effectiveTo: null,
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
    effectiveTo: null,
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
    effectiveTo: null,
    sortOrder: 15,
    note: '午场·XY祥钰 14:30-18:00',
  },
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

export async function ensureScheduleTemplatesSeeded(): Promise<void> {
  const existing = await prisma.anchorScheduleTemplate.findMany()
  const existingKeys = new Set(
    existing.map((row) =>
      templateSeedKey({
        anchorName: row.anchorName,
        shopName: row.shopName,
        liveRoomName: row.liveRoomName,
        startTime: row.startTime,
        endTime: row.endTime,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        sortOrder: row.sortOrder,
      }),
    ),
  )

  for (const seed of DEFAULT_SCHEDULE_TEMPLATE_SEEDS) {
    const key = templateSeedKey(seed)
    if (existingKeys.has(key)) continue
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
    existingKeys.add(key)
  }
}

export async function listActiveTemplatesForDate(dateKey: string) {
  await ensureScheduleTemplatesSeeded()
  const rows = await prisma.anchorScheduleTemplate.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { anchorName: 'asc' }],
  })
  return rows.filter((t) =>
    templateAppliesOnDate(
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
    ),
  )
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

  const intervals = rows
    .filter((r) => r.enabled !== false)
    .map((r) => {
      const { startAt, endAt } = buildScheduleBounds(dateKey, r.startTime, r.endTime)
      return {
        anchorName: r.anchorName.trim(),
        shopName: r.shopName.trim(),
        liveRoomName: r.liveRoomName.trim(),
        startAt,
        endAt,
      }
    })

  for (const row of intervals) {
    if (!row.anchorName) throw new Error('主播不能为空')
    if (!row.shopName || !row.liveRoomName) throw new Error('店铺/直播间不能为空')
  }

  const conflicts = detectScheduleConflicts(intervals)
  return { ok: conflicts.length === 0, conflicts, warnings }
}

export const SHOP_SESSION_CUTOFF_MS = SHOP_SESSION_ANCHOR_CUTOFF_MS
export const XIAOBAI_CUTOFF_MS = XIAOBAI_ANCHOR_CUTOFF_MS

export function todayShanghaiDateKey(): string {
  return formatDateKeyShanghai(new Date())
}
