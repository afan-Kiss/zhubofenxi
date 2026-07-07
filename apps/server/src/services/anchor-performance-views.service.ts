import type { AnalyzedOrderView } from '../types/analysis'
import { viewBelongsToAnchor } from './anchor-attribution.util'
import { remapViewsWithScheduleOverlay } from './anchor-schedule-attribution.service'
import {
  attachRawByMatchToViews,
  filterViewsForAnchorPerformance,
} from './low-price-brush-order.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import { ensureManualAnchorOverrideCache } from './order-anchor-manual-override.service'

function normalizeAnchorDrillQuery(opts: {
  anchorId?: string
  anchorName?: string
}): { anchorId?: string; anchorName?: string } {
  const name = opts.anchorName?.trim()
  const id = opts.anchorId?.trim()
  if (name === '未归属' || id === '未归属') {
    return { anchorName: '未归属' }
  }
  if (!id && !name) return {}
  return { anchorId: id, anchorName: name }
}

function filterViewsByAnchorSpec(
  views: AnalyzedOrderView[],
  anchorId?: string,
  anchorName?: string,
): AnalyzedOrderView[] {
  const normalized = normalizeAnchorDrillQuery({ anchorId, anchorName })
  const id = normalized.anchorId
  const name = normalized.anchorName
  if (!id && (!name || name === '全部')) return views
  return views.filter((v) => viewBelongsToAnchor(v, { anchorId: id, anchorName: name }))
}

/**
 * 主播业绩口径 views：attachRaw → remap（手动指定/排班/直播场次）→ 核心指标池 → 低价过滤。
 * 供 business-cache / board-live-query / board-scoped-views 共用，避免循环依赖。
 */
export async function buildAnchorPerformanceViewsFromScopedViews(
  scopedViews: AnalyzedOrderView[],
  rawByMatch: Map<string, Record<string, unknown>>,
  anchorId?: string,
  anchorName?: string,
): Promise<AnalyzedOrderView[]> {
  const normalized = normalizeAnchorDrillQuery({ anchorId, anchorName })
  await ensureManualAnchorOverrideCache()
  const withRaw = attachRawByMatchToViews(scopedViews, rawByMatch)
  const remapped = await remapViewsWithScheduleOverlay(withRaw)
  const base =
    normalized.anchorId || normalized.anchorName
      ? filterViewsByAnchorSpec(remapped, normalized.anchorId, normalized.anchorName)
      : remapped
  const coreBase = filterViewsForCoreMetrics(base)
  return filterViewsForAnchorPerformance(coreBase)
}
