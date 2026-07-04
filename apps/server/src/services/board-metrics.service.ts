import type { AnalyzedOrderView, AnchorConfig, LiveSession } from '../types/analysis'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import {
  bootstrapWorkbenchCache,
  buildLiveAccountOrderQueries,
  getWorkbenchRefundMapForOrders,
  loadWorkbenchRefundMapFromDb,
  mergeWorkbenchRefundMaps,
} from './xhs-after-sales-workbench.service'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { anchorGroupKey } from './anchor-attribution.util'
import { getAnchorConfigSync } from './anchor.service'
import {
  calculateBusinessMetrics,
  type BusinessMetrics,
} from './business-metrics.service'
import { logAnchorMetricsDebug } from './board-metrics-debug.service'
import {
  aggregateQualityRefundByAnchor,
  getLiveSessionsForQualityRefundAttribution,
  setLiveSessionsForQualityRefundAttribution,
} from './quality-refund-anchor-attribution.service'

export type { BusinessMetrics }

export interface BoardViewsMetrics extends BusinessMetrics {
  /** @deprecated 使用 totalGmv */
  productGmv: number
  effectiveGmv: number
  productRefundAmount: number
  returnAmount: number
  signedCount: number
  returnCount: number
  qualityReturnCount: number
  /** API 兼容字段，等同 refundRate */
  returnRate: number | null
  /** API 兼容字段，等同 qualityRefundRate */
  qualityReturnRate: number | null
  returnRefundCount: number
  /** API 兼容：退货率 */
  returnRefundRate: number | null
  freightRefundCount: number
  afterSaleClosedNoRefundCount: number
}

export interface BoardAnchorMetrics extends BoardViewsMetrics {
  anchorName: string
  anchorId: string
  color: string
  actualSignedCount: number
  gmv: number
}

function toLegacyMetrics(m: BusinessMetrics, views: AnalyzedOrderView[]): BoardViewsMetrics {
  const freightRefundCount = views.filter((v) => v.isFreightRefundOnly).length
  const afterSaleClosedNoRefundCount = views.filter((v) => v.afterSaleClosedNoRefund).length
  return {
    ...m,
    productGmv: m.totalGmv,
    effectiveGmv: m.validSalesAmount,
    productRefundAmount: m.refundAmount,
    returnAmount: m.refundAmount,
    signedCount: m.signedOrderCount,
    returnCount: m.refundOrderCount,
    qualityReturnCount: m.qualityRefundOrderCount,
    qualityReturnRate: m.qualityRefundRate,
    returnRate: m.refundRate,
    returnRefundCount: m.returnOrderCount,
    returnRefundRate: m.returnRate,
    freightRefundCount,
    afterSaleClosedNoRefundCount,
  }
}

export function aggregateViewsMetrics(
  views: AnalyzedOrderView[],
  warnCtx?: import('./calc-refund-rate.service').RefundRateWarnContext,
): BoardViewsMetrics {
  return toLegacyMetrics(calculateBusinessMetrics(views, warnCtx), views)
}

function applyQualityRefundAnchorCountsToLeaderboard(
  rows: BoardAnchorMetrics[],
  views: AnalyzedOrderView[],
  liveSessions: LiveSession[],
  config?: AnchorConfig,
): void {
  const resolvedConfig = config ?? getAnchorConfigSync()
  const agg = aggregateQualityRefundByAnchor({
    views,
    liveSessions,
    config: resolvedConfig,
  })

  /** 品退归属按展示名汇总，避免 anchorId 与支付归属 id 不一致时对不上行 */
  const countByAnchorName = new Map<string, { count: number; anchorId: string }>()
  for (const bucket of agg.byAnchorKey.values()) {
    const prev = countByAnchorName.get(bucket.anchorName)
    countByAnchorName.set(bucket.anchorName, {
      count: (prev?.count ?? 0) + bucket.count,
      anchorId: prev?.anchorId || bucket.anchorId,
    })
  }

  const rowByName = new Map<string, BoardAnchorMetrics>()
  for (const row of rows) {
    rowByName.set(row.anchorName, row)
  }

  for (const [anchorName, { count, anchorId }] of countByAnchorName) {
    if (count <= 0 || rowByName.has(anchorName)) continue
    const cfg =
      resolvedConfig.anchors.find((a) => a.name === anchorName) ??
      resolvedConfig.anchors.find((a) => a.id === anchorId)
    const resolvedId =
      anchorName === '未归属' ? '' : cfg?.id ?? anchorId ?? `extra-${anchorName}`
    const empty = aggregateViewsMetrics([], {
      scope: 'anchor-leaderboard',
      anchorId: resolvedId,
      anchorName,
    })
    const row: BoardAnchorMetrics = {
      anchorName,
      anchorId: resolvedId,
      color: cfg?.color ?? '#94a3b8',
      ...empty,
      gmv: empty.totalGmv,
      actualSignedCount: empty.signedOrderCount,
      afterSaleRecordCount: empty.afterSaleRecordCount,
    }
    rows.push(row)
    rowByName.set(anchorName, row)
  }

  for (const row of rows) {
    row.qualityReturnCount = countByAnchorName.get(row.anchorName)?.count ?? 0
    row.qualityReturnRate =
      row.orderCount > 0 ? row.qualityReturnCount / row.orderCount : null
  }
}

export function aggregateAnchorLeaderboard(
  views: AnalyzedOrderView[],
  debugCtx?: import('./board-metrics-debug.service').BoardMetricsDebugContext,
  options?: { liveSessions?: LiveSession[]; config?: AnchorConfig },
): BoardAnchorMetrics[] {
  const config = options?.config ?? getAnchorConfigSync()
  const liveSessions = options?.liveSessions ?? getLiveSessionsForQualityRefundAttribution()
  const byKey = new Map<string, AnalyzedOrderView[]>()

  for (const v of views) {
    const key = anchorGroupKey(v)
    const list = byKey.get(key) ?? []
    list.push(v)
    byKey.set(key, list)
  }

  const rows = [...byKey.entries()].map(([, list]) => {
      const anchorName = list[0]?.anchorName?.trim() || '未归属'
      const cfg =
        config.anchors.find((a) => a.name === anchorName) ??
        config.anchors.find((a) => a.id === list[0]?.anchorId)
      const anchorId =
        anchorName === '未归属' ? '' : (cfg?.id ?? list[0]?.anchorId?.trim() ?? `extra-${anchorName}`)
      const m = aggregateViewsMetrics(list, {
        scope: 'anchor-leaderboard',
        anchorId,
        anchorName,
      })
      if (debugCtx) {
        logAnchorMetricsDebug(anchorName, list, {
          ...debugCtx,
          scope: `anchor:${anchorName}`,
        })
      }

      return {
        anchorName,
        anchorId,
        color: cfg?.color ?? '#94a3b8',
        ...m,
        gmv: m.totalGmv,
        actualSignedCount: m.signedOrderCount,
        paidOrderCount: m.orderCount,
        afterSaleRecordCount: m.afterSaleRecordCount,
      }
    })

  applyQualityRefundAnchorCountsToLeaderboard(rows, views, liveSessions, config)

  return rows.sort((a, b) => {
    const orderA = config.anchors.findIndex((x) => x.name === a.anchorName)
    const orderB = config.anchors.findIndex((x) => x.name === b.anchorName)
    const ia = orderA >= 0 ? orderA : 999
    const ib = orderB >= 0 ? orderB : 999
    if (ia !== ib) return ia - ib
    return a.anchorName.localeCompare(b.anchorName, 'zh-CN')
  })
}

export async function loadBoardViewsForRange(
  preset: DateRangePreset,
  startDate?: string,
  endDate?: string,
): Promise<{ range: ReturnType<typeof resolveDateRange>; views: AnalyzedOrderView[] }> {
  const { range, views } = await loadBoardArtifactsForRange(preset, startDate, endDate)
  return { range, views }
}

import { bootstrapQualityBadCaseCache } from './quality-badcase-store.service'

export async function loadBoardArtifactsForRange(
  preset: DateRangePreset,
  startDate?: string,
  endDate?: string,
) {
  await bootstrapQualityBadCaseCache()
  const range = resolveDateRange(preset, startDate, endDate)
  const bundle = await buildRawAnalyzeBundle(range)
  const liveSessions = bundle?.liveSessions ?? []
  setLiveSessionsForQualityRefundAttribution(liveSessions)
  let artifacts: Awaited<ReturnType<typeof prepareAnalysisArtifactsFromRaw>> | null = null
  if (bundle) {
    const orderQueries = buildLiveAccountOrderQueries(bundle.orders)
    await bootstrapWorkbenchCache()
    const fromDb = await loadWorkbenchRefundMapFromDb(orderQueries)
    const fromMem = getWorkbenchRefundMapForOrders(orderQueries)
    const workbenchByOrderNo = mergeWorkbenchRefundMaps(fromDb, fromMem)
    artifacts = prepareAnalysisArtifactsFromRaw(bundle, { statRange: range, workbenchByOrderNo })
  }
  const views = artifacts?.views ?? []
  const rawByMatch = new Map(
    (artifacts?.dedupe.uniqueOrders ?? []).map((o) => [o.matchOrderId, o.raw]),
  )
  return { range, views, rawByMatch, artifacts, liveSessions }
}

/** 将前端 preset 统一为 DateRangePreset（保留 thisWeek，不再转为 custom） */
export function normalizeBoardPreset(preset: string): DateRangePreset {
  return preset as DateRangePreset
}
