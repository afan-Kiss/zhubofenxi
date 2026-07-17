import { prisma } from '../lib/prisma'
import type { AnchorConfig } from '../types/analysis'
import { createDefaultAnchorConfig } from './default-anchor-config'
import { isLegacyAnchorCreatedAt } from './anchor-rules.service'
import { logWarn } from '../utils/server-log'

let configCache: AnchorConfig | null = null

export const YIFAN_SYSTEM_KEY = 'YIFAN_MANUAL'
export const YIFAN_DEFAULT_DISPLAY_NAME = '逸凡'

export type AnchorAttributionMode = 'schedule' | 'manual'

/** 稳定身份：线下成交专属主播（禁止用展示名判断） */
export function isYifanManualSystemAnchor(anchor: {
  systemKey?: string | null
}): boolean {
  return (anchor.systemKey ?? '').trim() === YIFAN_SYSTEM_KEY
}

/** 仅线下展示：不进普通直播主播榜；有线下出单时会出现在日报图片 */
export function isOfflineOnlyAnchor(anchor: {
  systemKey?: string | null
  attributionMode?: string | null
}): boolean {
  return isYifanManualSystemAnchor(anchor)
}

export function findYifanManualSystemAnchor(config: AnchorConfig): {
  id: string
  name: string
  systemKey: string
  attributionMode?: string
} | null {
  const found = config.anchors.find((a) => isYifanManualSystemAnchor(a))
  if (!found) return null
  return {
    id: found.id,
    name: found.name,
    systemKey: YIFAN_SYSTEM_KEY,
    attributionMode: found.attributionMode,
  }
}

export function isManualAttributionMode(
  mode: string | null | undefined,
): boolean {
  return mode === 'manual'
}

/** 仅按 attributionMode 判断；不得再用「无 timeRules」推断手动主播 */
export function isManualOnlyAnchor(anchor: {
  attributionMode?: string | null
  timeRules?: Array<{ enabled?: boolean | null }> | null
}): boolean {
  void anchor.timeRules
  return isManualAttributionMode(anchor.attributionMode)
}

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
        attributionMode: 'schedule',
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

/**
 * 启动时初始化系统主播（幂等、按 systemKey）。
 * 禁止在 refreshAnchorConfigCache / 读接口路径调用。
 */
export async function initializeSystemAnchors(): Promise<void> {
  await ensureAnchorsSeeded()
  await ensureYifanSystemAnchor()
}

/**
 * 按 systemKey 确保逸凡存在。不按展示名识别；不强制重新启用已停用账号。
 */
async function ensureYifanSystemAnchor(): Promise<void> {
  const byKey = await prisma.anchor.findUnique({
    where: { systemKey: YIFAN_SYSTEM_KEY },
  })
  if (byKey) {
    await prisma.$transaction(async (tx) => {
      const patch: {
        deletedAt?: null
        attributionMode?: 'manual'
        defaultLiveRoomName?: null
      } = {}
      if (byKey.deletedAt) patch.deletedAt = null
      if (byKey.attributionMode !== 'manual') patch.attributionMode = 'manual'
      if (byKey.defaultLiveRoomName) patch.defaultLiveRoomName = null
      if (Object.keys(patch).length > 0) {
        await tx.anchor.update({ where: { id: byKey.id }, data: patch })
      }
      await tx.anchorTimeRule.updateMany({
        where: { anchorId: byKey.id, enabled: true },
        data: { enabled: false },
      })
    })
    return
  }

  const activeByName = await prisma.anchor.findFirst({
    where: { name: YIFAN_DEFAULT_DISPLAY_NAME, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  if (activeByName) {
    const dupes = await prisma.anchor.count({
      where: { name: YIFAN_DEFAULT_DISPLAY_NAME, deletedAt: null },
    })
    if (dupes > 1) {
      logWarn(
        '主播初始化',
        `存在 ${dupes} 条名称为「${YIFAN_DEFAULT_DISPLAY_NAME}」的启用记录，仅绑定最早一条为系统主播，请人工清理重复`,
      )
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.anchor.update({
          where: { id: activeByName.id },
          data: {
            systemKey: YIFAN_SYSTEM_KEY,
            attributionMode: 'manual',
            defaultLiveRoomName: null,
          },
        })
        await tx.anchorTimeRule.updateMany({
          where: { anchorId: activeByName.id, enabled: true },
          data: { enabled: false },
        })
      })
    } catch (e) {
      if (isPrismaUniqueError(e)) {
        const raced = await prisma.anchor.findUnique({
          where: { systemKey: YIFAN_SYSTEM_KEY },
        })
        if (raced) return
      }
      throw e
    }
    return
  }

  const softDeletedByName = await prisma.anchor.findFirst({
    where: { name: YIFAN_DEFAULT_DISPLAY_NAME, deletedAt: { not: null } },
    orderBy: { createdAt: 'asc' },
  })
  if (softDeletedByName) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.anchor.update({
          where: { id: softDeletedByName.id },
          data: {
            systemKey: YIFAN_SYSTEM_KEY,
            attributionMode: 'manual',
            defaultLiveRoomName: null,
            deletedAt: null,
            enabled: true,
          },
        })
        await tx.anchorTimeRule.updateMany({
          where: { anchorId: softDeletedByName.id, enabled: true },
          data: { enabled: false },
        })
      })
    } catch (e) {
      if (isPrismaUniqueError(e)) {
        const raced = await prisma.anchor.findUnique({
          where: { systemKey: YIFAN_SYSTEM_KEY },
        })
        if (raced) return
      }
      throw e
    }
    return
  }

  const maxOrder = await prisma.anchor.aggregate({
    where: { deletedAt: null },
    _max: { sortOrder: true },
  })
  try {
    await prisma.anchor.create({
      data: {
        name: YIFAN_DEFAULT_DISPLAY_NAME,
        color: '#6366f1',
        enabled: true,
        defaultLiveRoomName: null,
        systemKey: YIFAN_SYSTEM_KEY,
        attributionMode: 'manual',
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
    })
  } catch (e) {
    if (isPrismaUniqueError(e)) {
      const raced = await prisma.anchor.findUnique({
        where: { systemKey: YIFAN_SYSTEM_KEY },
      })
      if (raced) return
      throw new Error(
        `无法创建系统主播「${YIFAN_DEFAULT_DISPLAY_NAME}」：名称或系统身份冲突`,
      )
    }
    throw e
  }
}

/** @deprecated 请用 initializeSystemAnchors；保留别名避免外部脚本断裂 */
export async function ensureYifanManualAnchor(options?: {
  skipCacheRefresh?: boolean
}): Promise<void> {
  await initializeSystemAnchors()
  if (!options?.skipCacheRefresh) {
    await refreshAnchorConfigCache()
  }
}

/**
 * 仅从数据库读取启用主播并刷新内存缓存。
 * 禁止在此函数内 create / update / delete 主播或规则。
 */
export async function refreshAnchorConfigCache(): Promise<AnchorConfig> {
  // 含已停用主播：历史日归属 / 离职日当天仍须能按 id/姓名解析
  const rows = await prisma.anchor.findMany({
    where: { deletedAt: null },
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
      systemKey: a.systemKey,
      attributionMode: a.attributionMode === 'manual' ? 'manual' : 'schedule',
      effectiveFrom: a.effectiveFrom ?? null,
      effectiveTo: a.effectiveTo ?? null,
    })),
    timeRules: rows.flatMap((a) => {
      if (a.attributionMode === 'manual') return []
      return a.timeRules.map((r) => ({
        id: r.id,
        name: `${a.name} ${r.startTime}-${r.endTime}`,
        startTime: r.startTime,
        endTime: r.endTime,
        anchorId: a.id,
        enabled: r.enabled && a.enabled,
        effectiveFromMs: r.effectiveFrom?.getTime() ?? null,
      }))
    }),
  }
  return configCache
}

export function invalidateAnchorConfigCache(): void {
  configCache = null
}

/** 仅供验收/单元测试注入配置缓存 */
export function setAnchorConfigCacheForTests(config: AnchorConfig | null): void {
  configCache = config
}

export function getAnchorConfigSync(): AnchorConfig {
  return configCache ?? createDefaultAnchorConfig()
}

/** 自动归属路径：manual 模式主播不可被场次/排班/时段命中 */
export function isAutoAttributableAnchorName(anchorName: string): boolean {
  const name = anchorName.trim()
  if (!name || name === '未归属') return false
  const found = findCachedAnchorByName(name)
  if (!found) return true
  return !isManualAttributionMode(found.attributionMode)
}

function findCachedAnchorByName(name: string) {
  const n = name.trim().toLowerCase()
  return getAnchorConfigSync().anchors.find(
    (a) => a.name.trim().toLowerCase() === n,
  )
}

export async function listAnchorsForAdmin(includeDeleted = false) {
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
      systemKey: a.systemKey ?? null,
      attributionMode: a.attributionMode ?? 'schedule',
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

function isPrismaUniqueError(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002')
}

function assertManualModeAllowsRoomAndRules(params: {
  attributionMode: AnchorAttributionMode
  defaultLiveRoomName?: string | null
  timeRules?: Array<{ startTime: string; endTime: string; enabled?: boolean }>
  hasTimeRulesInput: boolean
}): void {
  if (params.attributionMode !== 'manual') return
  const room = params.defaultLiveRoomName?.trim()
  if (room) {
    throw new Error('仅手动归属主播不可配置默认直播间')
  }
  if (!params.hasTimeRulesInput) return
  const enabledRules = (params.timeRules ?? []).filter((r) => r.enabled !== false)
  if (enabledRules.length > 0 || (params.timeRules ?? []).length > 0) {
    throw new Error('仅手动归属主播不可配置归属时间段')
  }
}

export async function createAnchor(input: {
  name: string
  externalId?: string
  defaultLiveRoomName?: string
  color?: string
  sortOrder?: number
  timeRules?: Array<{ startTime: string; endTime: string; enabled?: boolean }>
  manualOnly?: boolean
  attributionMode?: AnchorAttributionMode
  effectiveFrom?: string | null
  effectiveTo?: string | null
}) {
  const name = input.name.trim()
  if (!name) throw new Error('主播名称不能为空')
  const maxOrder = await prisma.anchor.aggregate({
    where: { deletedAt: null },
    _max: { sortOrder: true },
  })
  // 正式规则：仅 explicit manual；不得因无 timeRules 推断手动，也不得默认全日时段
  const attributionMode: AnchorAttributionMode =
    input.attributionMode === 'manual' || Boolean(input.manualOnly) ? 'manual' : 'schedule'

  const effectiveFrom = input.effectiveFrom?.trim() || null
  if (attributionMode === 'schedule' && !effectiveFrom) {
    throw new Error('排班主播必须填写上岗日期（YYYY-MM-DD）')
  }
  if (effectiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    throw new Error('上岗日期格式无效，请使用 YYYY-MM-DD')
  }
  const effectiveTo = input.effectiveTo?.trim() || null
  if (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) {
    throw new Error('离岗日期格式无效，请使用 YYYY-MM-DD')
  }

  assertManualModeAllowsRoomAndRules({
    attributionMode,
    defaultLiveRoomName: input.defaultLiveRoomName,
    timeRules: input.timeRules,
    hasTimeRulesInput: input.timeRules !== undefined,
  })

  const timeRules =
    attributionMode === 'manual'
      ? []
      : input.timeRules && input.timeRules.length > 0
        ? normalizeTimeRulesInput(input.timeRules)
        : []
  const ruleEffectiveFrom = new Date()
  let anchor
  try {
    anchor = await prisma.anchor.create({
      data: {
        name,
        externalId: input.externalId?.trim() || null,
        defaultLiveRoomName:
          attributionMode === 'manual' ? null : input.defaultLiveRoomName?.trim() || null,
        color: input.color ?? '#94a3b8',
        enabled: true,
        attributionMode,
        effectiveFrom,
        effectiveTo,
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
    if (isPrismaUniqueError(e)) {
      throw new Error('主播名称已存在，请换一个名称')
    }
    throw e
  }
  await refreshAnchorConfigCache()
  return anchor
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
    attributionMode?: AnchorAttributionMode
    effectiveFrom?: string | null
    effectiveTo?: string | null
    timeRules?: Array<{
      id?: string
      startTime: string
      endTime: string
      enabled?: boolean
      sortOrder?: number
    }>
  },
) {
  const existing = await prisma.anchor.findFirst({
    where: { id, deletedAt: null },
    include: { timeRules: true },
  })
  if (!existing) throw new Error('主播不存在')

  const isSystem = Boolean(existing.systemKey)
  let nextMode: AnchorAttributionMode =
    existing.attributionMode === 'manual' ? 'manual' : 'schedule'
  if (input.attributionMode !== undefined) {
    if (isSystem && input.attributionMode !== 'manual') {
      throw new Error('系统主播归属模式不可改为自动归属')
    }
    nextMode = input.attributionMode
  }

  if (input.enabled === false && input.effectiveTo === undefined) {
    throw new Error('停用主播须通过「办理离职」并填写离职日期，不能仅提交 enabled=false')
  }
  if (input.enabled === false && input.effectiveTo !== undefined) {
    if (!input.effectiveTo || !String(input.effectiveTo).trim()) {
      throw new Error('离职日期不能为空')
    }
  }

  if (input.effectiveFrom !== undefined && input.effectiveFrom) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) {
      throw new Error('上岗日期格式须为 YYYY-MM-DD')
    }
  }
  if (input.effectiveTo !== undefined && input.effectiveTo) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveTo)) {
      throw new Error('下岗日期格式须为 YYYY-MM-DD')
    }
  }
  if (
    input.effectiveTo &&
    (input.effectiveFrom || existing.effectiveFrom) &&
    String(input.effectiveTo).trim() <
      String(input.effectiveFrom ?? existing.effectiveFrom).trim()
  ) {
    throw new Error('离职日期不得早于上岗日期')
  }
  if (
    nextMode === 'schedule' &&
    input.effectiveFrom !== undefined &&
    !input.effectiveFrom &&
    !existing.effectiveFrom
  ) {
    throw new Error('排班主播须设置上岗日期')
  }

  // 仅校验请求体显式提交的直播间/时段；切到 manual 时服务端会清空直播间并停用时段
  assertManualModeAllowsRoomAndRules({
    attributionMode: nextMode,
    defaultLiveRoomName:
      input.defaultLiveRoomName === undefined ? null : input.defaultLiveRoomName,
    timeRules: input.timeRules,
    hasTimeRulesInput: input.timeRules !== undefined,
  })

  try {
    await prisma.$transaction(async (tx) => {
      await tx.anchor.update({
        where: { id },
        data: {
          name: input.name?.trim() ?? undefined,
          externalId:
            input.externalId === undefined
              ? undefined
              : input.externalId?.trim() || null,
          defaultLiveRoomName:
            nextMode === 'manual'
              ? null
              : input.defaultLiveRoomName === undefined
                ? undefined
                : input.defaultLiveRoomName?.trim() || null,
          color: input.color,
          enabled: input.enabled,
          sortOrder: input.sortOrder,
          attributionMode: nextMode,
          effectiveFrom:
            input.effectiveFrom === undefined
              ? undefined
              : nextMode === 'manual'
                ? null
                : input.effectiveFrom?.trim() || null,
          effectiveTo:
            input.effectiveTo === undefined
              ? undefined
              : nextMode === 'manual'
                ? null
                : input.effectiveTo?.trim() || null,
        },
      })

      if (nextMode === 'manual') {
        // 切到手动：停用历史时段，不物理删除
        await tx.anchorTimeRule.updateMany({
          where: { anchorId: id, enabled: true },
          data: { enabled: false },
        })
      } else if (input.timeRules) {
        const normalized = normalizeTimeRulesInput(input.timeRules)
        const legacyAnchor = isLegacyAnchorCreatedAt(existing.createdAt)
        const ruleEffectiveFrom = legacyAnchor ? null : new Date()
        await tx.anchorTimeRule.deleteMany({ where: { anchorId: id } })
        for (let i = 0; i < normalized.length; i++) {
          const r = normalized[i]
          await tx.anchorTimeRule.create({
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
    })
  } catch (e) {
    if (isPrismaUniqueError(e)) {
      throw new Error('主播名称已存在，请换一个名称')
    }
    throw e
  }

  await refreshAnchorConfigCache()
  return prisma.anchor.findUnique({
    where: { id },
    include: { timeRules: { orderBy: [{ sortOrder: 'asc' }] } },
  })
}

/** @deprecated 请使用 offboardAnchor；保留别名以免旧调用崩溃 */
export async function disableAnchor(
  id: string,
  opts?: { effectiveTo?: string; reason?: string },
) {
  if (!opts?.effectiveTo?.trim()) {
    throw new Error('停用主播须提供离职日期 effectiveTo（YYYY-MM-DD）')
  }
  const { offboardAnchor } = await import('./anchor-offboard.service')
  await offboardAnchor({
    id,
    effectiveTo: opts.effectiveTo,
    reason: opts.reason,
  })
  return prisma.anchor.findUnique({
    where: { id },
    include: { timeRules: { orderBy: [{ sortOrder: 'asc' }] } },
  })
}

/** 逻辑删除（系统主播禁止删除） */
export async function softDeleteAnchor(id: string) {
  const existing = await prisma.anchor.findFirst({ where: { id, deletedAt: null } })
  if (!existing) throw new Error('主播不存在')
  if (existing.systemKey) {
    throw new Error('系统主播不可删除，如需停用请使用停用')
  }
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
