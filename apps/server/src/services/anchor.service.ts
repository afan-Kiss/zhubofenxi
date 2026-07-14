import { prisma } from '../lib/prisma'
import type { AnchorConfig } from '../types/analysis'
import { createDefaultAnchorConfig } from './default-anchor-config'
import { isLegacyAnchorCreatedAt } from './anchor-rules.service'

let configCache: AnchorConfig | null = null

export async function ensureAnchorsSeeded(): Promise<void> {
  const count = await prisma.anchor.count({ where: { deletedAt: null } })
  if (count > 0) return

  const anyCount = await prisma.anchor.count()
  if (anyCount > 0) return

  const defaults = [
    {
      name: '子杰',
      color: '#FF2442',
      sortOrder: 0,
      rules: [{ startTime: '00:00', endTime: '17:59', sortOrder: 0 }],
    },
    {
      name: '飞云',
      color: '#FF8A3D',
      sortOrder: 1,
      rules: [{ startTime: '18:00', endTime: '23:59', sortOrder: 0 }],
    },
  ]

  for (const d of defaults) {
    const anchor = await prisma.anchor.create({
      data: {
        name: d.name,
        color: d.color,
        enabled: true,
        sortOrder: d.sortOrder,
      },
    })
    for (const r of d.rules) {
      await prisma.anchorTimeRule.create({
        data: {
          anchorId: anchor.id,
          startTime: r.startTime,
          endTime: r.endTime,
          enabled: true,
          sortOrder: r.sortOrder,
        },
      })
    }
  }
}

export async function refreshAnchorConfigCache(): Promise<AnchorConfig> {
  await ensureAnchorsSeeded()
  await ensureYifanManualAnchor({ skipCacheRefresh: true })
  const rows = await prisma.anchor.findMany({
    where: { deletedAt: null, enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { timeRules: { orderBy: [{ sortOrder: 'asc' }] } },
  })

  configCache = {
    anchors: rows.map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color ?? '#94a3b8',
      enabled: a.enabled,
      externalId: a.externalId,
    })),
    timeRules: rows.flatMap((a) =>
      a.timeRules.map((r) => ({
        id: r.id,
        name: `${a.name} ${r.startTime}-${r.endTime}`,
        startTime: r.startTime,
        endTime: r.endTime,
        anchorId: a.id,
        enabled: r.enabled && a.enabled,
        effectiveFromMs: r.effectiveFrom?.getTime() ?? null,
      })),
    ),
  }
  return configCache
}

export function getAnchorConfigSync(): AnchorConfig {
  return configCache ?? createDefaultAnchorConfig()
}

export async function listAnchorsForAdmin(includeDeleted = false) {
  await ensureAnchorsSeeded()
  return prisma.anchor.findMany({
    where: includeDeleted ? undefined : { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { timeRules: { orderBy: [{ sortOrder: 'asc' }] } },
  })
}

export async function listAnchorFilterOptions() {
  await refreshAnchorConfigCache()
  const cfg = getAnchorConfigSync()
  return {
    anchors: cfg.anchors.map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
    })),
    filterNames: ['全部', ...cfg.anchors.map((a) => a.name), '其他'],
  }
}

/** HH:MM 或 HH:MM:SS → HH:MM */
export function normalizeAnchorTimeValue(value: string): string {
  const t = value.trim()
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t)
  if (!m) throw new Error(`时间段格式无效：${value}`)
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`时间段超出范围：${value}`)
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function normalizeTimeRulesInput(
  rules: Array<{ startTime: string; endTime: string; enabled?: boolean; sortOrder?: number }>,
) {
  return rules.map((r, i) => ({
    startTime: normalizeAnchorTimeValue(r.startTime),
    endTime: normalizeAnchorTimeValue(r.endTime),
    enabled: r.enabled ?? true,
    sortOrder: r.sortOrder ?? i,
  }))
}

export async function createAnchor(input: {
  name: string
  externalId?: string
  defaultLiveRoomName?: string
  color?: string
  sortOrder?: number
  /** 传空数组 = 仅手动归属（不匹配时段）；省略则默认 00:00–23:59 */
  timeRules?: Array<{ startTime: string; endTime: string; enabled?: boolean }>
  /** true = 不创建时间段，仅通过订单抽屉手动指定计入业绩 */
  manualOnly?: boolean
}) {
  const name = input.name.trim()
  if (!name) throw new Error('主播名称不能为空')
  const maxOrder = await prisma.anchor.aggregate({
    where: { deletedAt: null },
    _max: { sortOrder: true },
  })
  const manualOnly = Boolean(input.manualOnly) || (Array.isArray(input.timeRules) && input.timeRules.length === 0)
  const timeRules = manualOnly
    ? []
    : input.timeRules && input.timeRules.length > 0
      ? normalizeTimeRulesInput(input.timeRules)
      : [{ startTime: '00:00', endTime: '23:59', enabled: true, sortOrder: 0 }]
  const ruleEffectiveFrom = new Date()
  let anchor
  try {
    anchor = await prisma.anchor.create({
    data: {
      name,
      externalId: input.externalId?.trim() || null,
      defaultLiveRoomName: input.defaultLiveRoomName?.trim() || null,
      color: input.color ?? '#94a3b8',
      enabled: true,
      sortOrder: input.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1,
      timeRules:
        timeRules.length > 0
          ? {
              create: timeRules.map((r, i) => ({
                startTime: r.startTime,
                endTime: r.endTime,
                enabled: r.enabled ?? true,
                sortOrder: r.sortOrder ?? i,
                effectiveFrom: ruleEffectiveFrom,
              })),
            }
          : undefined,
    },
    include: { timeRules: true },
    })
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      throw new Error('主播名称已存在，请换一个名称')
    }
    throw e
  }
  await refreshAnchorConfigCache()
  return anchor
}

/** 仅手动归属主播：无启用时间段，不进场次/排班自动匹配 */
export function isManualOnlyAnchor(anchor: {
  timeRules?: Array<{ enabled?: boolean | null }> | null
}): boolean {
  const rules = anchor.timeRules ?? []
  return rules.filter((r) => r.enabled !== false).length === 0
}

/**
 * 确保「逸凡」存在：无直播间/时段，仅靠订单抽屉手动指定计入业绩。
 * skipCacheRefresh：由 refreshAnchorConfigCache 内部调用时避免递归。
 */
export async function ensureYifanManualAnchor(options?: {
  skipCacheRefresh?: boolean
}): Promise<void> {
  await ensureAnchorsSeeded()
  const existing = await prisma.anchor.findFirst({
    where: { name: '逸凡', deletedAt: null },
    include: { timeRules: true },
  })
  if (!existing) {
    const maxOrder = await prisma.anchor.aggregate({
      where: { deletedAt: null },
      _max: { sortOrder: true },
    })
    await prisma.anchor.create({
      data: {
        name: '逸凡',
        color: '#6366f1',
        enabled: true,
        defaultLiveRoomName: null,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
    })
  } else {
    const patch: { enabled?: boolean; defaultLiveRoomName?: string | null } = {}
    if (!existing.enabled) patch.enabled = true
    if (existing.defaultLiveRoomName) patch.defaultLiveRoomName = null
    if (Object.keys(patch).length > 0) {
      await prisma.anchor.update({ where: { id: existing.id }, data: patch })
    }
    if (existing.timeRules.some((r) => r.enabled)) {
      await prisma.anchorTimeRule.deleteMany({ where: { anchorId: existing.id } })
    }
  }
  if (!options?.skipCacheRefresh) {
    await refreshAnchorConfigCache()
  }
}

export async function updateAnchor(
  id: string,
  input: {
    name?: string
    externalId?: string | null
    defaultLiveRoomName?: string | null
    color?: string
    enabled?: boolean
    sortOrder?: number
    timeRules?: Array<{
      id?: string
      startTime: string
      endTime: string
      enabled?: boolean
      sortOrder?: number
    }>
  },
) {
  const existing = await prisma.anchor.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw new Error('主播不存在')

  try {
    await prisma.anchor.update({
      where: { id },
      data: {
        name: input.name?.trim() ?? undefined,
        externalId:
          input.externalId === undefined
            ? undefined
            : input.externalId?.trim() || null,
        defaultLiveRoomName:
          input.defaultLiveRoomName === undefined
            ? undefined
            : input.defaultLiveRoomName?.trim() || null,
        color: input.color,
        enabled: input.enabled,
        sortOrder: input.sortOrder,
      },
    })
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
      throw new Error('主播名称已存在，请换一个名称')
    }
    throw e
  }

  if (input.timeRules) {
    const normalized = normalizeTimeRulesInput(input.timeRules)
    const legacyAnchor = isLegacyAnchorCreatedAt(existing.createdAt)
    const ruleEffectiveFrom = legacyAnchor ? null : new Date()
    await prisma.anchorTimeRule.deleteMany({ where: { anchorId: id } })
    for (let i = 0; i < normalized.length; i++) {
      const r = normalized[i]
      await prisma.anchorTimeRule.create({
        data: {
          anchorId: id,
          startTime: r.startTime,
          endTime: r.endTime,
          enabled: r.enabled ?? true,
          sortOrder: r.sortOrder ?? i,
          effectiveFrom: ruleEffectiveFrom,
        },
      })
    }
  }

  await refreshAnchorConfigCache()
  return prisma.anchor.findUnique({
    where: { id },
    include: { timeRules: { orderBy: [{ sortOrder: 'asc' }] } },
  })
}

/** 停用主播（enabled=false，历史数据保留） */
export async function disableAnchor(id: string) {
  return updateAnchor(id, { enabled: false })
}

/** 逻辑删除（不删历史订单/统计中的主播名称） */
export async function softDeleteAnchor(id: string) {
  const existing = await prisma.anchor.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw new Error('主播不存在')
  await prisma.anchor.update({
    where: { id },
    data: { deletedAt: new Date(), enabled: false },
  })
  await refreshAnchorConfigCache()
  return { id, deleted: true }
}

export async function reorderAnchors(orderedIds: string[]) {
  const ids = orderedIds.filter(Boolean)
  for (let i = 0; i < ids.length; i++) {
    await prisma.anchor.updateMany({
      where: { id: ids[i], deletedAt: null },
      data: { sortOrder: i },
    })
  }
  await refreshAnchorConfigCache()
  return listAnchorsForAdmin(false)
}

export async function getEnabledAnchorNames(): Promise<string[]> {
  await refreshAnchorConfigCache()
  return getAnchorConfigSync()
    .anchors.filter((a) => a.enabled)
    .map((a) => a.name)
}
