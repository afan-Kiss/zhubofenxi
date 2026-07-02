import type { AnalyzedOrderView } from '../types/analysis'
import { prisma } from '../lib/prisma'
import { findAnchorByName } from './anchor-rules.service'
import { getAnchorConfigSync } from './anchor.service'
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import { invalidateAndRebuildBusinessBoardCache } from './business-cache.service'
import { clearScheduleAttributionCache } from './anchor-schedule-attribution.service'
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
  const config = getAnchorConfigSync()
  const found = findAnchorByName(config, anchorName)
  return found?.id ?? `extra-${anchorName}`
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

  const config = getAnchorConfigSync()
  const found = findAnchorByName(config, anchorName)
  if (!found) throw new Error(`主播「${anchorName}」不存在`)

  const anchorId = found.id
  await prisma.orderAnchorManualOverride.upsert({
    where: { orderKey },
    create: {
      orderKey,
      anchorName,
      anchorId,
      assignedBy: params.assignedBy ?? null,
    },
    update: {
      anchorName,
      anchorId,
      assignedBy: params.assignedBy ?? null,
    },
  })

  clearManualAnchorOverrideCache()
  clearScheduleAttributionCache()
  logInfo('订单归属', `手动指定 ${orderKey} → ${anchorName}`)
  await invalidateAndRebuildBusinessBoardCache(`order-anchor-manual:${orderKey}`)

  return { anchorId, anchorName }
}

export async function removeOrderAnchorManualOverride(orderKey: string): Promise<void> {
  const key = orderKey.trim()
  if (!key) throw new Error('请提供订单号')
  await prisma.orderAnchorManualOverride.deleteMany({ where: { orderKey: key } })
  clearManualAnchorOverrideCache()
  clearScheduleAttributionCache()
  await invalidateAndRebuildBusinessBoardCache(`order-anchor-manual-remove:${key}`)
}
