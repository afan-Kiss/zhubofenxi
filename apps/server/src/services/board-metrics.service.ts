import type { AnalyzedOrderView } from '../types/analysis'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import {
  bootstrapWorkbenchCache,
  buildLiveAccountOrderQueries,
  getWorkbenchRefundMapForOrders,
  loadWorkbenchRefundMapFromDb,
} from './xhs-after-sales-workbench.service'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { anchorGroupKey } from './anchor-attribution.util'
import { getAnchorConfigSync } from './anchor.service'
import {
  calculateBusinessMetrics,
  type BusinessMetrics,
} from './business-metrics.service'
import { logAnchorMetricsDebug } from './board-metrics-debug.service'

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

export function aggregateAnchorLeaderboard(
  views: AnalyzedOrderView[],
  debugCtx?: import('./board-metrics-debug.service').BoardMetricsDebugContext,
): BoardAnchorMetrics[] {
  const config = getAnchorConfigSync()
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
  let artifacts: Awaited<ReturnType<typeof prepareAnalysisArtifactsFromRaw>> | null = null
  if (bundle) {
    const orderQueries = buildLiveAccountOrderQueries(bundle.orders)
    await bootstrapWorkbenchCache()
    const fromDb = await loadWorkbenchRefundMapFromDb(orderQueries)
    const fromMem = getWorkbenchRefundMapForOrders(orderQueries)
    const workbenchByOrderNo = new Map(fromDb)
    for (const [k, v] of fromMem) workbenchByOrderNo.set(k, v)
    artifacts = prepareAnalysisArtifactsFromRaw(bundle, { statRange: range, workbenchByOrderNo })
  }
  const views = artifacts?.views ?? []
  const rawByMatch = new Map(
    (artifacts?.dedupe.uniqueOrders ?? []).map((o) => [o.matchOrderId, o.raw]),
  )
  return { range, views, rawByMatch, artifacts }
}

/** 将前端 preset 统一为 DateRangePreset（保留 thisWeek，不再转为 custom） */
export function normalizeBoardPreset(preset: string): DateRangePreset {
  return preset as DateRangePreset
}
