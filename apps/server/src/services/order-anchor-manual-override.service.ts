import type { AnalyzedOrderView } from '../types/analysis'
import { prisma } from '../lib/prisma'
import { findAnchorByName } from './anchor-rules.service'
import {
  findAnchorForAttributionByName,
  getAnchorConfigSync,
  isOfflineOnlyAnchor,
  refreshAnchorConfigCache,
  type AttributionAnchorLookup,
} from './anchor.service'
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import {
  invalidateAndRebuildBusinessBoardCache,
  invalidateBusinessBoardCache,
} from './business-cache.service'
import { clearScheduleAttributionCache } from './anchor-schedule-attribution.service'
import { ANCHOR_SESSION_DISPLAY_FROM_0613 } from './anchor-performance-attribution.service'
import { logInfo, logWarn } from '../utils/server-log'
import {
  isAnchorEffectiveOnDate,
  isOffboardDateMissing,
  shanghaiTodayDateKey,
} from '../utils/anchor-effective-date.util'

export interface ManualAnchorOverrideEntry {
  anchorId: string
  anchorName: string
  assignedBy?: string | null
  updatedAt?: string | null
}

let cachedOverrideMap: Map<string, ManualAnchorOverrideEntry> | null = null

export function clearManualAnchorOverrideCache(): void {
  cachedOverrideMap = null
}

/** 仅供单元测试注入内存覆盖，勿用于生产路径 */
export function setManualAnchorOverrideCacheForTests(
  map: Map<string, ManualAnchorOverrideEntry> | null,
): void {
  cachedOverrideMap = map
}

export async function ensureManualAnchorOverrideCache(): Promise<
  Map<string, ManualAnchorOverrideEntry>
> {
  if (cachedOverrideMap) return cachedOverrideMap
  const rows = await prisma.orderAnchorManualOverride.findMany({
    select: { orderKey: true, anchorId: true, anchorName: true },
  })
  cachedOverrideMap = new Map(
    rows.map((row) => [
      row.orderKey,
      {
        anchorId: row.anchorId ?? resolveAnchorIdByName(row.anchorName),
        anchorName: row.anchorName,
      },
    ]),
  )
  return cachedOverrideMap
}

export async function loadManualAnchorOverrideMap(
  orderKeys: string[],
): Promise<Map<string, ManualAnchorOverrideEntry>> {
  const cache = await ensureManualAnchorOverrideCache()
  if (orderKeys.length === 0) return cache
  const wanted = new Set(orderKeys.filter(Boolean))
  const out = new Map<string, ManualAnchorOverrideEntry>()
  for (const key of wanted) {
    const hit = cache.get(key)
    if (hit) out.set(key, hit)
  }
  return out
}

/** 读取历史手动指定时解析 id（允许已离职）；禁止回落 extra-* */
function resolveAnchorIdByName(anchorName: string): string {
  const name = anchorName.trim()
  if (!name || name === '未归属') return ''
  const found =
    findAnchorByName(getAnchorConfigSync(), name) ?? findAnchorForAttributionByName(name)
  return found?.id ?? ''
}

/** 今日可手动指派：在职区间内、非线下专属、非「停用却无离职日」 */
export function isManualAssignableAnchorToday(
  anchor: AttributionAnchorLookup | null | undefined,
  today = shanghaiTodayDateKey(),
): boolean {
  if (!anchor?.name?.trim()) return false
  if (isOfflineOnlyAnchor(anchor)) return false
  if (isOffboardDateMissing(anchor)) return false
  return isAnchorEffectiveOnDate(anchor, today)
}

export function resolveManualAssignAnchorIdentity(anchorName: string): {
  anchorId: string
  anchorName: string
} {
  const name = anchorName.trim()
  if (!name || name === '未归属') throw new Error('请选择有效主播')
  const found =
    findAnchorByName(getAnchorConfigSync(), name) ?? findAnchorForAttributionByName(name)
  if (!found) throw new Error(`主播「${name}」不存在`)
  if (!isManualAssignableAnchorToday(found)) {
    throw new Error(`主播「${found.name}」已不在岗，不能再指派订单`)
  }
  return { anchorId: found.id, anchorName: found.name }
}

/** 纯函数：供验收；生产路径经 listOrderAnchorAssignOptions 刷新缓存后调用 */
export function buildOrderAnchorAssignOptions(
  today = shanghaiTodayDateKey(),
): Array<{ id: string; name: string; attributionMode?: string; systemKey?: string | null }> {
  const config = getAnchorConfigSync()
  const fixedNames = Object.keys(ANCHOR_SESSION_DISPLAY_FROM_0613)
  const byName = new Map<
    string,
    { id: string; name: string; attributionMode?: string; systemKey?: string | null }
  >()

  const offer = (anchor: AttributionAnchorLookup) => {
    if (!isManualAssignableAnchorToday(anchor, today)) return
    byName.set(anchor.name, {
      id: anchor.id,
      name: anchor.name,
      attributionMode: anchor.attributionMode ?? 'schedule',
      systemKey: anchor.systemKey ?? null,
    })
  }

  for (const name of fixedNames) {
    const found =
      findAnchorByName(config, name) ?? findAnchorForAttributionByName(name)
    if (found) offer(found)
  }
  for (const anchor of config.anchors) {
    offer({ ...anchor, deletedAt: null })
  }

  const result: Array<{
    id: string
    name: string
    attributionMode?: string
    systemKey?: string | null
  }> = []
  const seen = new Set<string>()
  for (const name of fixedNames) {
    const hit = byName.get(name)
    if (!hit || seen.has(name)) continue
    seen.add(name)
    result.push(hit)
  }
  for (const hit of byName.values()) {
    if (seen.has(hit.name)) continue
    seen.add(hit.name)
    result.push(hit)
  }
  return result
}

/** 抽屉手动指定：今日仍在岗的场次主播 + 配置主播（禁止 extra-* / 已离职幽灵名） */
export async function listOrderAnchorAssignOptions(): Promise<
  Array<{ id: string; name: string; attributionMode?: string; systemKey?: string | null }>
> {
  await refreshAnchorConfigCache()
  return buildOrderAnchorAssignOptions()
}

export function resolveManualAnchorOverrideForView(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  overrideMap?: Map<string, ManualAnchorOverrideEntry> | null,
): ManualAnchorOverrideEntry | null {
  const map = overrideMap ?? cachedOverrideMap
  if (!map) return null
  const orderKey = resolveMetricOrderNo(view)
  if (!orderKey) return null
  return map.get(orderKey) ?? null
}

export function applyManualAnchorOverrideToView<T extends AnalyzedOrderView>(
  view: T & { raw?: Record<string, unknown> },
  overrideMap?: Map<string, ManualAnchorOverrideEntry> | null,
): T {
  const hit = resolveManualAnchorOverrideForView(view, overrideMap)
  if (!hit) return view
  if (hit.anchorId === view.anchorId && hit.anchorName === view.anchorName) return view
  return {
    ...view,
    anchorId: hit.anchorId,
    anchorName: hit.anchorName,
  }
}

export async function assignOrderAnchorManualOverride(params: {
  orderKey: string
  anchorName: string
  assignedBy?: string
}): Promise<ManualAnchorOverrideEntry> {
  const orderKey = params.orderKey.trim()
  const anchorName = params.anchorName.trim()
  if (!orderKey) throw new Error('请提供订单号')
  if (!anchorName || anchorName === '未归属') throw new Error('请选择有效主播')

  const { anchorId, anchorName: resolvedName } = resolveManualAssignAnchorIdentity(anchorName)
  const row = await prisma.orderAnchorManualOverride.upsert({
    where: { orderKey },
    create: {
      orderKey,
      anchorName: resolvedName,
      anchorId,
      assignedBy: params.assignedBy ?? null,
    },
    update: {
      anchorName: resolvedName,
      anchorId,
      assignedBy: params.assignedBy ?? null,
    },
  })

  clearManualAnchorOverrideCache()
  clearScheduleAttributionCache()
  logInfo('订单归属', `手动指定 ${orderKey} → ${resolvedName}`)
  // 先立刻清内存缓存，HTTP 不再阻塞 5 档经营缓存全量重建（与线下录入一致后台重建）
  invalidateBusinessBoardCache()
  void invalidateAndRebuildBusinessBoardCache(`order-anchor-manual:${orderKey}`).catch((e) => {
    logWarn(
      '订单归属',
      `后台重建失败：${e instanceof Error ? e.message : String(e)}`,
    )
  })

  return {
    anchorId,
    anchorName: resolvedName,
    assignedBy: row.assignedBy,
    updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt),
  }
}

export async function removeOrderAnchorManualOverride(orderKey: string): Promise<void> {
  const key = orderKey.trim()
  if (!key) throw new Error('请提供订单号')
  await prisma.orderAnchorManualOverride.deleteMany({ where: { orderKey: key } })
  clearManualAnchorOverrideCache()
  clearScheduleAttributionCache()
  invalidateBusinessBoardCache()
  void invalidateAndRebuildBusinessBoardCache(`order-anchor-manual-remove:${key}`).catch((e) => {
    logWarn(
      '订单归属',
      `清除归属后后台重建失败：${e instanceof Error ? e.message : String(e)}`,
    )
  })
}
