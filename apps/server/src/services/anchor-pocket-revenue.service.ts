import type { UserRole } from '../types/roles'
import { centToYuan } from '../utils/money'
import { LOW_PRICE_BRUSH_THRESHOLD_CENT } from './low-price-brush-order.service'
import {
  ANCHOR_SESSION_DISPLAY_FROM_0613,
  isReportDateOnOrAfterShopSessionCutoff,
  isReportDateOnOrAfterXiaoBaiCutoff,
  remapViewsForAnchorPerformance,
} from './anchor-performance-attribution.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { getBoardScopedViewsForRange } from './board-scoped-views.service'
import {
  classifyAnchorPocketOrder,
  type AnchorPocketOrderLine,
} from './anchor-pocket-order.service'
import {
  bootstrapWorkbenchCache,
  buildLiveAccountOrderQueries,
  getWorkbenchRefundMapForOrders,
  loadWorkbenchRefundMapFromDb,
  mergeWorkbenchRefundMaps,
} from './xhs-after-sales-workbench.service'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'

export const ANCHOR_POCKET_CALIBER_NOTE =
  '29元以下按刷单剔除；已退款单独扣除；售后处理中和未签收不算实际到账；资金流水只做校验。'

export interface AnchorPocketDataQualityWarning {
  type: string
  message: string
  count: number
}

export interface AnchorPocketAnchorRow {
  anchorName: string
  shopName: string
  sessionName: string
  performanceAmount: number
  refundFinishedAmount: number
  refundProcessingAmount: number
  pendingReceiveAmount: number
  actualPocketAmount: number
  brushAmount: number
  refundRate: number | null
  explainText: string
  detail?: {
    rawOrderCount: number
    performanceOrderCount: number
    brushOrderCount: number
    refundFinishedOrderCount: number
    refundProcessingOrderCount: number
    pendingReceiveOrderCount: number
  }
}

export interface AnchorPocketSummaryPayload {
  ok: true
  range: { startDate: string; endDate: string; preset?: string }
  caliber: {
    brushThreshold: number
    note: string
    settlementNote: string
  }
  anchors: AnchorPocketAnchorRow[]
  dataQualityWarnings: AnchorPocketDataQualityWarning[]
}

function resolveAnchorDisplayMeta(
  anchorName: string,
  liveAccountName?: string,
): { shopName: string; sessionName: string } {
  const meta = ANCHOR_SESSION_DISPLAY_FROM_0613[anchorName]
  if (meta) {
    return { shopName: meta.shopName, sessionName: meta.sessionLabel }
  }
  const shop = (liveAccountName ?? '').trim() || '—'
  return { shopName: shop, sessionName: '—' }
}

function buildExplainText(row: {
  performanceAmount: number
  refundFinishedAmount: number
  refundProcessingAmount: number
  pendingReceiveAmount: number
  actualPocketAmount: number
  brushAmount: number
  refundRate: number | null
}): string {
  const parts: string[] = []
  if (row.brushAmount > 0) parts.push('刷单金额已剔除，不影响业绩。')
  if (row.refundRate != null && row.refundRate >= 0.35) {
    parts.push('卖得不少，但退款偏高，实际留下来的钱偏少。')
  } else if (row.refundFinishedAmount > 0 && row.actualPocketAmount < row.performanceAmount * 0.5) {
    parts.push('退款较多，实际到账明显低于业绩内金额。')
  }
  if (row.refundProcessingAmount > 0) {
    parts.push('售后处理中金额较高，建议优先跟进这批订单。')
  }
  if (row.pendingReceiveAmount > 0) {
    parts.push('未签收金额较多，最终到账还没完全稳定。')
  }
  if (parts.length === 0) {
    if (row.actualPocketAmount > 0) parts.push('当前周期内实际到账较稳定。')
    else if (row.performanceAmount > 0) parts.push('有业绩内订单，但暂无已确认到账金额。')
    else parts.push('本周期暂无业绩内订单。')
  }
  return parts.join('')
}

interface AnchorAgg {
  anchorName: string
  shopName: string
  sessionName: string
  performanceAmountCent: number
  refundFinishedAmountCent: number
  refundProcessingAmountCent: number
  pendingReceiveAmountCent: number
  actualPocketAmountCent: number
  brushAmountCent: number
  performanceOrderNos: Set<string>
  refundFinishedOrderNos: Set<string>
  refundProcessingOrderNos: Set<string>
  pendingReceiveOrderNos: Set<string>
  brushOrderNos: Set<string>
  rawOrderNos: Set<string>
}

function upsertAgg(map: Map<string, AnchorAgg>, line: AnchorPocketOrderLine): void {
  const key = line.anchorName
  let agg = map.get(key)
  if (!agg) {
    agg = {
      anchorName: line.anchorName,
      shopName: line.shopName,
      sessionName: line.sessionName,
      performanceAmountCent: 0,
      refundFinishedAmountCent: 0,
      refundProcessingAmountCent: 0,
      pendingReceiveAmountCent: 0,
      actualPocketAmountCent: 0,
      brushAmountCent: 0,
      performanceOrderNos: new Set(),
      refundFinishedOrderNos: new Set(),
      refundProcessingOrderNos: new Set(),
      pendingReceiveOrderNos: new Set(),
      brushOrderNos: new Set(),
      rawOrderNos: new Set(),
    }
    map.set(key, agg)
  }
  if (line.shopName && line.shopName !== '—') agg.shopName = line.shopName
  if (line.sessionName && line.sessionName !== '—') agg.sessionName = line.sessionName
  agg.rawOrderNos.add(line.orderNo)
  if (line.isBrushOrder) {
    agg.brushAmountCent += line.brushAmountCent
    agg.brushOrderNos.add(line.orderNo)
    return
  }
  agg.performanceAmountCent += line.performanceAmountCent
  agg.performanceOrderNos.add(line.orderNo)
  agg.refundFinishedAmountCent += line.refundFinishedAmountCent
  if (line.refundFinishedAmountCent > 0) agg.refundFinishedOrderNos.add(line.orderNo)
  agg.refundProcessingAmountCent += line.refundProcessingAmountCent
  if (line.isRefundProcessing) agg.refundProcessingOrderNos.add(line.orderNo)
  agg.pendingReceiveAmountCent += line.pendingReceiveAmountCent
  if (line.isPendingReceive) agg.pendingReceiveOrderNos.add(line.orderNo)
  agg.actualPocketAmountCent += line.actualPocketAmountCent
}

function aggToRow(agg: AnchorAgg): AnchorPocketAnchorRow {
  const performanceAmount = centToYuan(agg.performanceAmountCent)
  const refundFinishedAmount = centToYuan(agg.refundFinishedAmountCent)
  const refundProcessingAmount = centToYuan(agg.refundProcessingAmountCent)
  const pendingReceiveAmount = centToYuan(agg.pendingReceiveAmountCent)
  const actualPocketAmount = centToYuan(agg.actualPocketAmountCent)
  const brushAmount = centToYuan(agg.brushAmountCent)
  const perfCount = agg.performanceOrderNos.size
  const refundCount = agg.refundFinishedOrderNos.size
  const refundRate = perfCount > 0 ? refundCount / perfCount : null
  return {
    anchorName: agg.anchorName,
    shopName: agg.shopName,
    sessionName: agg.sessionName,
    performanceAmount,
    refundFinishedAmount,
    refundProcessingAmount,
    pendingReceiveAmount,
    actualPocketAmount,
    brushAmount,
    refundRate,
    explainText: buildExplainText({
      performanceAmount,
      refundFinishedAmount,
      refundProcessingAmount,
      pendingReceiveAmount,
      actualPocketAmount,
      brushAmount,
      refundRate,
    }),
    detail: {
      rawOrderCount: agg.rawOrderNos.size,
      performanceOrderCount: perfCount,
      brushOrderCount: agg.brushOrderNos.size,
      refundFinishedOrderCount: refundCount,
      refundProcessingOrderCount: agg.refundProcessingOrderNos.size,
      pendingReceiveOrderCount: agg.pendingReceiveOrderNos.size,
    },
  }
}

function emptyRow(anchorName: string): AnchorPocketAnchorRow {
  const meta = ANCHOR_SESSION_DISPLAY_FROM_0613[anchorName]
  return {
    anchorName,
    shopName: meta?.shopName ?? '—',
    sessionName: meta?.sessionLabel ?? '—',
    performanceAmount: 0,
    refundFinishedAmount: 0,
    refundProcessingAmount: 0,
    pendingReceiveAmount: 0,
    actualPocketAmount: 0,
    brushAmount: 0,
    refundRate: null,
    explainText: '本周期暂无业绩内订单。',
    detail: {
      rawOrderCount: 0,
      performanceOrderCount: 0,
      brushOrderCount: 0,
      refundFinishedOrderCount: 0,
      refundProcessingOrderCount: 0,
      pendingReceiveOrderCount: 0,
    },
  }
}

function resolveFixedAnchorNames(endDate: string): string[] {
  if (!isReportDateOnOrAfterShopSessionCutoff(endDate)) return []
  const names = Object.keys(ANCHOR_SESSION_DISPLAY_FROM_0613).filter((n) => n !== '小白')
  if (isReportDateOnOrAfterXiaoBaiCutoff(endDate)) names.push('小白')
  return names
}

export async function buildAnchorPocketSummary(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<AnchorPocketSummaryPayload> {
  const scoped = await getBoardScopedViewsForRange(params)
  const withRaw = attachRawByMatchToViews(scoped.views, scoped.rawByMatch)
  const remapped = remapViewsForAnchorPerformance(withRaw)
  const deduped = dedupeViewsByMetricOrderNo(remapped)

  await bootstrapWorkbenchCache()
  const queries = buildLiveAccountOrderQueries(deduped)
  const bundle = await buildRawAnalyzeBundle(scoped.range)
  const fromDb = await loadWorkbenchRefundMapFromDb(queries)
  const fromMem = bundle ? getWorkbenchRefundMapForOrders(queries) : new Map()
  const workbenchByOrderNo = mergeWorkbenchRefundMaps(fromDb, fromMem)

  const aggMap = new Map<string, AnchorAgg>()
  let afterSalesPendingCount = 0

  for (const view of deduped) {
    const orderNo = resolveMetricOrderNo(view)
    const workbench = orderNo ? workbenchByOrderNo.get(orderNo) : undefined
    const meta = resolveAnchorDisplayMeta(view.anchorName, view.liveAccountName)
    const line = classifyAnchorPocketOrder({
      view,
      shopName: meta.shopName,
      sessionName: meta.sessionName,
      workbench,
    })
    if (!line) continue
    if (line.afterSalesDataPending) afterSalesPendingCount += 1
    upsertAgg(aggMap, line)
  }

  const warnings: AnchorPocketDataQualityWarning[] = []
  if (afterSalesPendingCount > 0) {
    warnings.push({
      type: 'after_sales_pending',
      message: `有 ${afterSalesPendingCount} 笔订单售后数据未确认，实际到账可能偏高`,
      count: afterSalesPendingCount,
    })
  }

  const rows = [...aggMap.values()].map(aggToRow)
  const byName = new Map(rows.map((r) => [r.anchorName, r]))
  const fixedNames = resolveFixedAnchorNames(scoped.endDate)
  const mergedAnchors: AnchorPocketAnchorRow[] =
    fixedNames.length > 0
      ? fixedNames.map((name) => byName.get(name) ?? emptyRow(name))
      : rows.sort((a, b) => a.anchorName.localeCompare(b.anchorName, 'zh-CN'))

  return {
    ok: true,
    range: {
      startDate: scoped.startDate,
      endDate: scoped.endDate,
      preset: scoped.preset,
    },
    caliber: {
      brushThreshold: centToYuan(LOW_PRICE_BRUSH_THRESHOLD_CENT),
      note: ANCHOR_POCKET_CALIBER_NOTE,
      settlementNote: '资金数据仅作校验，主播实际到账按订单签收和售后状态计算。',
    },
    anchors: mergedAnchors,
    dataQualityWarnings: warnings,
  }
}
