import type { AnalyzedOrderView } from '../types/analysis'
import type { DateRangeResolved } from '../utils/date-range'
import type { UserRole } from '../types/roles'
import { viewBelongsToAnchor } from './anchor-attribution.util'
import { buildAnchorPerformanceViewsFromScopedViews } from './anchor-performance-views.service'
import {
  getOrBuildBusinessBoardCache,
  getBusinessBoardCache,
} from './business-cache.service'
import { CANONICAL_ATTRIBUTION_VERSION } from './canonical-order-attribution.service'
import { filterViewsForStaffScope } from './staff-anchor-scope.service'

export interface BoardScopedViewsBundle {
  views: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
  blacklistedBuyerIds: string[]
  range: DateRangeResolved
  preset: string
  startDate: string
  endDate: string
  source: 'business-cache'
}

async function resolveBoardCacheWithViews(params: {
  preset: string
  startDate: string
  endDate: string
  forceRefresh?: boolean
}) {
  let boardCache = getBusinessBoardCache(params.preset, params.startDate, params.endDate)
  const needsRebuild =
    params.forceRefresh === true ||
    !boardCache ||
    boardCache.stale ||
    boardCache.fallbackReason === 'disk_snapshot' ||
    boardCache.attributionAlgorithmVersion !== CANONICAL_ATTRIBUTION_VERSION ||
    (boardCache.views.length === 0 && boardCache.orderCount > 0)

  if (needsRebuild) {
    boardCache = await getOrBuildBusinessBoardCache({
      preset: params.preset,
      startDate: params.startDate,
      endDate: params.endDate,
      forceRebuild: params.forceRefresh === true,
    })
  }

  return boardCache
}

/** 经营看板统一数据源：drill / metric-detail 共用内存缓存（不在读路径强制重建） */
export async function getBoardScopedViewsForRange(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
  /** 仅数据维护/验收可显式 true 强制重建 */
  forceRefresh?: boolean
}): Promise<BoardScopedViewsBundle> {
  const preset = params.preset ?? 'custom'
  const boardCache = await resolveBoardCacheWithViews({
    preset,
    startDate: params.startDate,
    endDate: params.endDate,
    forceRefresh: params.forceRefresh,
  })
  const views =
    params.role && params.username
      ? filterViewsForStaffScope(boardCache.views, params.role, params.username)
      : boardCache.views

  return {
    views,
    rawByMatch: boardCache.rawByMatch,
    blacklistedBuyerIds: boardCache.blacklistedBuyerIds,
    range: boardCache.range,
    preset: boardCache.preset,
    startDate: boardCache.startDate,
    endDate: boardCache.endDate,
    source: 'business-cache',
  }
}

export function normalizeAnchorDrillQuery(opts: {
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

export function filterViewsByAnchorSpec(
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

/** 主播业绩汇总 / anchor-drill 使用的 views（含低价过滤 + raw + 排班覆盖层） */
export async function getAnchorPerformanceViews(
  scopedViews: AnalyzedOrderView[],
  rawByMatch: Map<string, Record<string, unknown>>,
  anchorId?: string,
  anchorName?: string,
): Promise<AnalyzedOrderView[]> {
  return buildAnchorPerformanceViewsFromScopedViews(
    scopedViews,
    rawByMatch,
    anchorId,
    anchorName,
  )
}
