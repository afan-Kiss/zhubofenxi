import type { AnalyzedOrderView } from '../types/analysis'
import type { DateRangeResolved } from '../utils/date-range'
import type { UserRole } from '../types/roles'
import { viewBelongsToAnchor } from './anchor-attribution.util'
import { buildAnchorPerformanceViewsFromScopedViews } from './anchor-performance-views.service'
import { getOrBuildBusinessBoardCache } from './business-cache.service'
import { filterViewsForStaffScope } from './staff-anchor-scope.service'
import { isRealtimeBoardPreset } from '../utils/board-realtime-refresh.util'
import { clearScheduleAttributionCache } from './anchor-schedule-attribution.service'

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

/** 经营看板统一数据源：local-data / anchor-drill / metric-detail 共用 */
export async function getBoardScopedViewsForRange(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
  /** 今日/昨日每次打开强制重读订单；也可显式传入 */
  forceRefresh?: boolean
}): Promise<BoardScopedViewsBundle> {
  const preset = params.preset ?? 'custom'
  const forceRefresh = params.forceRefresh ?? isRealtimeBoardPreset(preset)
  if (forceRefresh) {
    clearScheduleAttributionCache()
  }
  const boardCache = await getOrBuildBusinessBoardCache({
    preset,
    startDate: params.startDate,
    endDate: params.endDate,
    forceRebuild: forceRefresh,
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
