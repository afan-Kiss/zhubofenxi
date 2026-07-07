import type { AnalyzedOrderView } from '../types/analysis'
import { prisma } from '../lib/prisma'
import { findAnchorByName } from './anchor-rules.service'
import { getAnchorConfigSync, refreshAnchorConfigCache } from './anchor.service'
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import { invalidateAndRebuildBusinessBoardCache } from './business-cache.service'
import { clearScheduleAttributionCache } from './anchor-schedule-attribution.service'
import { ANCHOR_SESSION_DISPLAY_FROM_0613 } from './anchor-performance-attribution.service'
import { logInfo } from '../utils/server-log'

export interface ManualAnchorOverrideEntry {
  anchorId: string
  anchorName: string
}

let cachedOverrideMap: Map<string, ManualAnchorOverrideEntry> | null = null

export function clearManualAnchorOverrideCache(): void {
  cachedOverrideMap = null
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

function resolveAnchorIdByName(anchorName: string): string {
  return resolveManualAssignAnchorIdentity(anchorName).anchorId
}

export function resolveManualAssignAnchorIdentity(anchorName: string): {
  anchorId: string
  anchorName: string
} {
  const name = anchorName.trim()
  if (!name || name === '未归属') throw new Error('请选择有效主播')
  const config = getAnchorConfigSync()
  const found = findAnchorByName(config, name)
  if (found) return { anchorId: found.id, anchorName: found.name }
  if (Object.prototype.hasOwnProperty.call(ANCHOR_SESSION_DISPLAY_FROM_0613, name)) {
    return { anchorId: `extra-${name}`, anchorName: name }
  }
  throw new Error(`主播「${name}」不存在`)
}

/** 抽屉手动指定：固定场次主播 + 后台启用主播（与业绩页一致） */
export async function listOrderAnchorAssignOptions(): Promise<
  Array<{ id: string; name: string }>
> {
  await refreshAnchorConfigCache()
  const config = getAnchorConfigSync()
  const fixedNames = Object.keys(ANCHOR_SESSION_DISPLAY_FROM_0613)
  const byName = new Map<string, { id: string; name: string }>()

  for (const name of fixedNames) {
    const found = findAnchorByName(config, name)
    byName.set(name, { id: found?.id ?? `extra-${name}`, name })
  }
  for (const anchor of config.anchors) {
    if (!anchor.enabled || !anchor.name.trim()) continue
    byName.set(anchor.name, { id: anchor.id, name: anchor.name })
  }

  const result: Array<{ id: string; name: string }> = []
  const seen = new Set<string>()
  for (const name of fixedNames) {
    const hit = byName.get(name)
    if (!hit || seen.has(name)) continue
    seen.add(name)
    result.push(hit)
  }
  for (const anchor of config.anchors) {
    if (!anchor.enabled || seen.has(anchor.name)) continue
    seen.add(anchor.name)
    result.push({ id: anchor.id, name: anchor.name })
  }
  return result
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
  await prisma.orderAnchorManualOverride.upsert({
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
  await invalidateAndRebuildBusinessBoardCache(`order-anchor-manual:${orderKey}`)

  return { anchorId, anchorName: resolvedName }
}

export async function removeOrderAnchorManualOverride(orderKey: string): Promise<void> {
  const key = orderKey.trim()
  if (!key) throw new Error('请提供订单号')
  await prisma.orderAnchorManualOverride.deleteMany({ where: { orderKey: key } })
  clearManualAnchorOverrideCache()
  clearScheduleAttributionCache()
  await invalidateAndRebuildBusinessBoardCache(`order-anchor-manual-remove:${key}`)
}
