/**
 * Wave4: 经营数据 generation — 热路径用内存整数比对，替代反复 MAX(updatedAt)
 */
import { prisma } from '../lib/prisma'
import { logInfo, logWarn } from '../utils/server-log'

export type BusinessGenerationField =
  | 'ordersGeneration'
  | 'liveSessionsGeneration'
  | 'settlementsGeneration'
  | 'workbenchGeneration'
  | 'timeSearchGeneration'
  | 'scheduleGeneration'
  | 'manualOverrideGeneration'
  | 'offlineDealGeneration'
  | 'anchorMasterGeneration'
  | 'qualityGeneration'

export type BusinessDataGenerationSnapshot = Record<BusinessGenerationField, number> & {
  updatedAt: string
}

const ALL_FIELDS: BusinessGenerationField[] = [
  'ordersGeneration',
  'liveSessionsGeneration',
  'settlementsGeneration',
  'workbenchGeneration',
  'timeSearchGeneration',
  'scheduleGeneration',
  'manualOverrideGeneration',
  'offlineDealGeneration',
  'anchorMasterGeneration',
  'qualityGeneration',
]

const DEFAULTS: Record<BusinessGenerationField, number> = {
  ordersGeneration: 1,
  liveSessionsGeneration: 1,
  settlementsGeneration: 1,
  workbenchGeneration: 1,
  timeSearchGeneration: 1,
  scheduleGeneration: 1,
  manualOverrideGeneration: 1,
  offlineDealGeneration: 1,
  anchorMasterGeneration: 1,
  qualityGeneration: 1,
}

let memory: BusinessDataGenerationSnapshot | null = null
let lastDbHydrateAt = 0
const MEMORY_TTL_MS = Number(process.env.BUSINESS_GENERATION_TTL_MS || 2000)

function emptySnapshot(updatedAt = new Date().toISOString()): BusinessDataGenerationSnapshot {
  return { ...DEFAULTS, updatedAt }
}

function rowToSnapshot(row: {
  ordersGeneration: number
  liveSessionsGeneration: number
  settlementsGeneration: number
  workbenchGeneration: number
  timeSearchGeneration: number
  scheduleGeneration: number
  manualOverrideGeneration: number
  offlineDealGeneration: number
  anchorMasterGeneration: number
  qualityGeneration: number
  updatedAt: Date
}): BusinessDataGenerationSnapshot {
  return {
    ordersGeneration: row.ordersGeneration,
    liveSessionsGeneration: row.liveSessionsGeneration,
    settlementsGeneration: row.settlementsGeneration,
    workbenchGeneration: row.workbenchGeneration,
    timeSearchGeneration: row.timeSearchGeneration,
    scheduleGeneration: row.scheduleGeneration,
    manualOverrideGeneration: row.manualOverrideGeneration,
    offlineDealGeneration: row.offlineDealGeneration,
    anchorMasterGeneration: row.anchorMasterGeneration,
    qualityGeneration: row.qualityGeneration,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function getBusinessDataGenerationSync(): BusinessDataGenerationSnapshot {
  return memory ?? emptySnapshot()
}

export function cloneBusinessDataGeneration(
  src?: BusinessDataGenerationSnapshot | null,
): BusinessDataGenerationSnapshot {
  return { ...(src ?? getBusinessDataGenerationSync()) }
}

export function isBusinessDataGenerationEqual(
  a: BusinessDataGenerationSnapshot | null | undefined,
  b: BusinessDataGenerationSnapshot | null | undefined,
): boolean {
  if (!a || !b) return false
  for (const f of ALL_FIELDS) {
    if (a[f] !== b[f]) return false
  }
  return true
}

/** 启动时加载；表未迁时降级为内存默认值 */
export async function ensureBusinessDataGenerationLoaded(): Promise<BusinessDataGenerationSnapshot> {
  try {
    let row = await prisma.businessDataGeneration.findUnique({ where: { id: 'default' } })
    if (!row) {
      row = await prisma.businessDataGeneration.create({ data: { id: 'default' } })
    }
    memory = rowToSnapshot(row)
    lastDbHydrateAt = Date.now()
    logInfo(
      '经营版本',
      `已加载 generation：orders=${memory.ordersGeneration} workbench=${memory.workbenchGeneration}`,
    )
    return memory
  } catch (err) {
    memory = emptySnapshot()
    logWarn(
      '经营版本',
      `加载失败，使用内存默认值：${err instanceof Error ? err.message : String(err)}`,
    )
    return memory
  }
}

/** 多实例短 TTL：热路径命中前可选刷新（非阻塞可跳过） */
export async function refreshBusinessDataGenerationIfStale(): Promise<BusinessDataGenerationSnapshot> {
  if (memory && Date.now() - lastDbHydrateAt < MEMORY_TTL_MS) {
    return memory
  }
  return ensureBusinessDataGenerationLoaded()
}

export async function bumpBusinessDataGeneration(
  fields: BusinessGenerationField[],
): Promise<BusinessDataGenerationSnapshot> {
  const unique = [...new Set(fields)]
  if (unique.length === 0) return getBusinessDataGenerationSync()

  const data: Record<string, { increment: number }> = {}
  for (const f of unique) data[f] = { increment: 1 }

  try {
    await prisma.businessDataGeneration.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    })
    const updated = await prisma.businessDataGeneration.update({
      where: { id: 'default' },
      data,
    })
    memory = rowToSnapshot(updated)
    lastDbHydrateAt = Date.now()
    return memory
  } catch (err) {
    const next = cloneBusinessDataGeneration(memory)
    for (const f of unique) next[f] += 1
    next.updatedAt = new Date().toISOString()
    memory = next
    logWarn(
      '经营版本',
      `bump 落库失败，仅推进内存：${err instanceof Error ? err.message : String(err)}`,
    )
    return memory
  }
}

/** 经营缓存失效通用 bump（覆盖 fingerprint 相关维度） */
export async function bumpBoardSourceGenerations(): Promise<void> {
  await bumpBusinessDataGeneration([
    'ordersGeneration',
    'liveSessionsGeneration',
    'settlementsGeneration',
    'workbenchGeneration',
    'timeSearchGeneration',
    'scheduleGeneration',
    'manualOverrideGeneration',
    'offlineDealGeneration',
    'qualityGeneration',
  ])
}

/** 验收/诊断：与 MAX(updatedAt) 并排比对（禁止 HTTP 热路径调用） */
export async function diagnoseBusinessGenerationVsMaxUpdatedAt(): Promise<{
  generation: BusinessDataGenerationSnapshot
  rawMaxUpdatedAt: string | null
}> {
  const generation = await ensureBusinessDataGenerationLoaded()
  const [orderAgg] = await Promise.all([
    prisma.xhsRawOrder.aggregate({ _max: { updatedAt: true } }),
  ])
  return {
    generation,
    rawMaxUpdatedAt: orderAgg._max.updatedAt?.toISOString() ?? null,
  }
}
