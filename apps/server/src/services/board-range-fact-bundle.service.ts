/**
 * Wave4 P1: 一次加载、一次标准化、一次 canonical 归属，再派生各订单池
 */
import type { AnalyzedOrderView, LiveSession } from '../types/analysis'
import type { DateRangePreset } from '../utils/date-range'
import { loadBoardArtifactsForRange } from './board-metrics.service'
import { loadOfflineDealViewsForRange } from './offline-deal.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { filterViewsForAnchorPerformance } from './low-price-brush-order.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import { remapViewsWithCanonicalAttribution } from './canonical-order-attribution.service'
import { logInfo } from '../utils/server-log'

export interface RangeFactBundle {
  views: AnalyzedOrderView[]
  offlineViews: AnalyzedOrderView[]
  mergedViews: AnalyzedOrderView[]
  /** 未归属前、核心指标过滤后的订单（用于总览金额口径，与历史一致） */
  coreMetricViewsUnmapped: AnalyzedOrderView[]
  /** 一次 attach+remap 后的全量视图 */
  remappedViews: AnalyzedOrderView[]
  coreMetricViews: AnalyzedOrderView[]
  anchorPerformanceViews: AnalyzedOrderView[]
  qualityRefundViews: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
  liveSessions: LiveSession[]
  artifacts: Awaited<ReturnType<typeof loadBoardArtifactsForRange>>['artifacts']
  timings: {
    loadMs: number
    attachMs: number
    attributionMs: number
    deriveMs: number
    totalMs: number
  }
}

export async function loadRangeFactBundle(params: {
  preset: DateRangePreset
  startDate: string
  endDate: string
}): Promise<RangeFactBundle> {
  const t0 = Date.now()
  const { views, rawByMatch, artifacts, liveSessions } = await loadBoardArtifactsForRange(
    params.preset,
    params.startDate,
    params.endDate,
  )
  const offlineViews = await loadOfflineDealViewsForRange(params.startDate, params.endDate)
  const mergedViews = [...views, ...offlineViews]
  const loadMs = Date.now() - t0

  const tAttach = Date.now()
  const withRaw = attachRawByMatchToViews(mergedViews, rawByMatch)
  const attachMs = Date.now() - tAttach

  const tAttr = Date.now()
  const remappedViews = await remapViewsWithCanonicalAttribution(withRaw, {
    startDate: params.startDate,
    endDate: params.endDate,
    preload: true,
  })
  const attributionMs = Date.now() - tAttr

  const tDerive = Date.now()
  const coreMetricViewsUnmapped = filterViewsForCoreMetrics(mergedViews)
  const coreMetricViews = filterViewsForCoreMetrics(remappedViews)
  const anchorPerformanceViews = filterViewsForAnchorPerformance(coreMetricViews)
  const qualityRefundViews = coreMetricViews
  const deriveMs = Date.now() - tDerive

  const totalMs = Date.now() - t0
  logInfo(
    '经营事实池',
    `一次归属完成：merged=${mergedViews.length} remapped=${remappedViews.length} core=${coreMetricViews.length} perf=${anchorPerformanceViews.length} load=${loadMs}ms attach=${attachMs}ms attr=${attributionMs}ms`,
  )

  return {
    views,
    offlineViews,
    mergedViews,
    coreMetricViewsUnmapped,
    remappedViews,
    coreMetricViews,
    anchorPerformanceViews,
    qualityRefundViews,
    rawByMatch,
    liveSessions,
    artifacts,
    timings: { loadMs, attachMs, attributionMs, deriveMs, totalMs },
  }
}
