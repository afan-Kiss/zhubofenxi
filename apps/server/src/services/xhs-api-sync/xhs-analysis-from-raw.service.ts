import { prisma } from '../../lib/prisma'
import type { DateRangeResolved } from '../../utils/date-range'
import { formatDateTime } from '../../utils/time'
import { orderPayTimeInRange } from '../../utils/order-stat-time.util'
import type {
  LiveSession,
  NormalizedOrder,
  SettlementRecord,
} from '../../types/analysis'
import type { AnalysisPipelineResult } from '../analysis-pipeline.service'
import type {
  AnalysisTrustStatus,
  DataValidationReport,
} from '../../types/data-validation'
import { TRUST_STATUS_HINTS } from '../../types/data-validation'
import {
  checkApiCollectionCompleteness,
  checkApiFieldRecognition,
  checkGmvReconciliation,
  checkOrderAttributionReconciliation,
  checkSettlementReconciliation,
  extractLiveFileDateRange,
  extractOrderFileDateRange,
  extractPendingFileDateRange,
  extractSettledFileDateRange,
  resolveApiTrustStatus,
  validateApiDataDateRanges,
} from '../data-validation.service'
import {
  prepareAnalysisArtifactsFromRaw,
  runBusinessAnalysisFromRaw,
  type RawAnalyzeBundle,
} from '../business-analysis.service'
import { detectAmountAnomalies } from './amount-anomaly.service'
import {
  loadNormalizedOrdersFromRaw,
  normalizeLiveSessionsFromRaw,
  normalizePendingSettlementsFromRaw,
  normalizeSettledSettlementsFromRaw,
  type NormalizedLiveSession,
} from './xhs-json-normalizer.service'
import {
  loadAfterSalesBundleForOrderNos,
  buildLiveAccountOrderQueries,
} from '../xhs-after-sales-workbench.service'
import {
  loadAfterSalesTimeSearchByOrderNo,
  mergeAfterSaleRecordMaps,
} from '../xhs-after-sales-time-search.service'
import { bootstrapQualityBadCaseCache } from '../quality-badcase-store.service'

function orderInRange(order: NormalizedOrder, range: DateRangeResolved): boolean {
  return orderPayTimeInRange(order, range)
}

function liveInRange(session: NormalizedLiveSession, range: DateRangeResolved): boolean {
  if (!session.startTime) return false
  const ms = session.startTime.getTime()
  return ms >= range.startTimeMs && ms <= range.endTimeMs
}

function settlementInRange(record: SettlementRecord, range: DateRangeResolved): boolean {
  const t = record.settlementTime
  if (!t) return true
  const ms = t.getTime()
  return ms >= range.startTimeMs && ms <= range.endTimeMs
}

function toLiveSession(
  session: NormalizedLiveSession,
  index: number,
): LiveSession | null {
  if (!session.startTime || session.errors.length > 0) return null
  const endTime =
    session.endTime ??
    new Date(session.startTime.getTime() + session.durationMinutes * 60_000)
  return {
    id: session.liveId || session.id,
    sourceRowIndex: index + 1,
    startTime: session.startTime,
    endTime,
    startTimeText: formatDateTime(session.startTime),
    endTimeText: formatDateTime(endTime),
    anchorName: session.anchorName || undefined,
    durationMinutes: session.durationMinutes,
    errors: session.errors,
    raw: session.raw,
  }
}

export async function buildRawAnalyzeBundle(
  range: DateRangeResolved,
): Promise<RawAnalyzeBundle | null> {
  /** 经营总览读路径：仅读本地 xhsRawOrder / 直播 / 结算 / 售后缓存 / 品退缓存，不请求平台 API */
  const orderCount = await prisma.xhsRawOrder.count()
  if (orderCount === 0) return null

  const orders = await loadNormalizedOrdersFromRaw({ range })

  const liveSessions = (await normalizeLiveSessionsFromRaw({ range }))
    .filter((s) => liveInRange(s, range))
    .map((s, i) => toLiveSession(s, i))
    .filter((s): s is LiveSession => s != null)

  const pendingAll = await normalizePendingSettlementsFromRaw()
  const settledAll = await normalizeSettledSettlementsFromRaw()

  const pendingRecords = pendingAll.filter((r) => r.errors.length === 0)
  const settledRecords = settledAll.filter(
    (r) => r.errors.length === 0 && settlementInRange(r, range),
  )

  const warnings: string[] = []
  if (orders.length === 0) {
    warnings.push('当前时间范围内无有效订单')
  }
  if (liveSessions.length === 0) {
    warnings.push('直播场次接口无数据，将使用时间规则归属主播')
  }

  const orderQueries = buildLiveAccountOrderQueries(orders)
  const paidOrderNos = new Set(orderQueries.map((q) => q.orderNo))
  const [, afterSales] = await Promise.all([
    bootstrapQualityBadCaseCache(),
    loadAfterSalesBundleForOrderNos(orderQueries, paidOrderNos),
  ])
  const timeSearchMap = await loadAfterSalesTimeSearchByOrderNo(range, orderQueries)
  const mergedAfterSales = mergeAfterSaleRecordMaps(
    afterSales.rawAfterSalesByOrderNo,
    timeSearchMap,
  )

  return {
    orders,
    liveSessions,
    pendingRecords,
    settledRecords,
    hasPending: pendingRecords.length > 0,
    hasSettled: settledRecords.length > 0,
    warnings,
    afterSaleByOrderNo: afterSales.afterSaleByOrderNo,
    rawAfterSalesByOrderNo: mergedAfterSales,
  }
}

/** 全量历史订单分析包（买家画像缓存用，不按日期筛选） */
export async function buildRawAnalyzeBundleAll(): Promise<RawAnalyzeBundle | null> {
  const orderCount = await prisma.xhsRawOrder.count()
  if (orderCount === 0) return null

  const orders = await loadNormalizedOrdersFromRaw()
  const liveSessions = (await normalizeLiveSessionsFromRaw())
    .map((s, i) => toLiveSession(s, i))
    .filter((s): s is LiveSession => s != null)

  const pendingAll = await normalizePendingSettlementsFromRaw()
  const settledAll = await normalizeSettledSettlementsFromRaw()
  const pendingRecords = pendingAll.filter((r) => r.errors.length === 0)
  const settledRecords = settledAll.filter((r) => r.errors.length === 0)

  const warnings: string[] = []
  if (orders.length === 0) {
    warnings.push('无有效订单')
  }
  if (liveSessions.length === 0) {
    warnings.push('直播场次无数据，将使用时间规则归属主播')
  }

  const orderQueries = buildLiveAccountOrderQueries(orders)
  const paidOrderNos = new Set(orderQueries.map((q) => q.orderNo))
  const [, afterSales] = await Promise.all([
    bootstrapQualityBadCaseCache(),
    loadAfterSalesBundleForOrderNos(orderQueries, paidOrderNos),
  ])

  return {
    orders,
    liveSessions,
    pendingRecords,
    settledRecords,
    hasPending: pendingRecords.length > 0,
    hasSettled: settledRecords.length > 0,
    warnings,
    afterSaleByOrderNo: afterSales.afterSaleByOrderNo,
    rawAfterSalesByOrderNo: afterSales.rawAfterSalesByOrderNo,
  }
}

function buildApiRawValidation(
  range: DateRangeResolved,
  bundle: RawAnalyzeBundle,
): DataValidationReport {
  const completeness = checkApiCollectionCompleteness({
    order: bundle.orders.length,
    live: bundle.liveSessions.length,
    pending: bundle.pendingRecords.length,
    settled: bundle.settledRecords.length,
  })

  const errors: string[] = [...completeness.errors]
  if (bundle.orders.length === 0) {
    errors.push('当前范围内无订单数据')
  }

  return {
    selectedRange: { startDate: range.startDate, endDate: range.endDate },
    completeness,
    fileDateRanges: [],
    fieldRecognition: checkApiFieldRecognition(bundle.orders),
    orderAttribution: null,
    gmvReconciliation: null,
    settlementReconciliation: null,
    warnings: [...completeness.warnings, ...bundle.warnings],
    errors,
    abnormalReasons: [],
  }
}

function enrichValidationWithAnalysis(
  validation: DataValidationReport,
  range: DateRangeResolved,
  bundle: RawAnalyzeBundle,
): void {
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const { dedupe, views, settlement } = artifacts

  const ordersById = new Map(dedupe.uniqueOrders.map((o) => [o.orderId, o]))
  const orderFileRange = extractOrderFileDateRange(dedupe.uniqueOrders)
  const liveRange = extractLiveFileDateRange(bundle.liveSessions)
  const pendingRange = extractPendingFileDateRange(bundle.pendingRecords, ordersById)
  const settledRange = extractSettledFileDateRange(bundle.settledRecords)

  validation.fileDateRanges = validateApiDataDateRanges({
    selectedRange: range,
    orderRange: orderFileRange,
    liveRange,
    pendingRange,
    settledRange,
    orders: dedupe.uniqueOrders,
  })

  for (const check of validation.fileDateRanges) {
    if (check.status === 'warning' && check.message) {
      validation.warnings.push(check.message)
    }
    if (check.status === 'blocked' && check.message) {
      validation.errors.push(check.message)
    }
  }

  validation.orderAttribution = checkOrderAttributionReconciliation(
    views,
    dedupe.abnormalOrders.length,
  )
  validation.gmvReconciliation = checkGmvReconciliation(views, dedupe)

  const orderIds = new Set(dedupe.uniqueOrders.map((o) => o.orderId))
  validation.settlementReconciliation = checkSettlementReconciliation({
    orderIds,
    settlement,
    views,
  })
  validation.warnings.push(...validation.settlementReconciliation.warnings)

  if (dedupe.abnormalOrders.length > 0) {
    validation.abnormalReasons.push(`异常订单 ${dedupe.abnormalOrders.length} 条`)
  }
}

function applyAmountAnomalyTrust(
  trustStatus: AnalysisTrustStatus,
  anomaly: ReturnType<typeof detectAmountAnomalies>,
  validation: DataValidationReport,
): AnalysisTrustStatus {
  if (!anomaly.hasUnitRisk) return trustStatus

  const newWarnings = anomaly.warnings.filter(
    (w) => !validation.warnings.includes(w),
  )
  validation.warnings.push(...newWarnings)

  const severe =
    anomaly.suspected100xInflated &&
    anomaly.warnings.some(
      (w) =>
        w.includes('毛利润大于 GMV') ||
        w.includes('已结算 + 待结算大于 GMV') ||
        w.includes('放大 100 倍'),
    )

  if (severe) return 'blocked'
  if (trustStatus === 'official_ready') return 'preview_only'
  return trustStatus
}

export async function runAnalysisPipelineFromXhsRaw(
  range: DateRangeResolved,
  audit?: { userId?: string; requestId?: string; ip?: string; userAgent?: string },
): Promise<AnalysisPipelineResult | null> {
  const bundle = await buildRawAnalyzeBundle(range)
  if (!bundle) return null

  const validation = buildApiRawValidation(range, bundle)
  let trustStatus: AnalysisTrustStatus = resolveApiTrustStatus(validation, {
    apiOrderCount: bundle.orders.length,
    normalizedOrderCount: bundle.orders.filter((o) => o.errors.length === 0).length,
  })
  let result = null

  if (trustStatus !== 'blocked' && trustStatus !== 'error') {
    try {
      enrichValidationWithAnalysis(validation, range, bundle)
      trustStatus = resolveApiTrustStatus(validation, {
        apiOrderCount: bundle.orders.length,
        normalizedOrderCount: bundle.orders.filter((o) => o.errors.length === 0).length,
      })

      result = runBusinessAnalysisFromRaw(bundle)
      result.overview.lastUpdatedAt = new Date().toISOString()

      const anomaly = detectAmountAnomalies(bundle.orders, result)
      trustStatus = applyAmountAnomalyTrust(trustStatus, anomaly, validation)

      if (anomaly.hasUnitRisk) {
        result.overview.warnings.unshift(...anomaly.warnings)
      }

      if (trustStatus === 'preview_only') {
        const previewHint = validation.warnings.find((w) =>
          w.includes('接口无数据'),
        )
        if (previewHint && !result.overview.warnings.includes(previewHint)) {
          result.overview.warnings.unshift(previewHint)
        }
        if (!result.overview.warnings.some((w) => w.includes('预览'))) {
          result.overview.warnings.unshift(TRUST_STATUS_HINTS.preview_only)
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '分析失败'
      validation.errors.push(message)
      trustStatus = 'error'
    }
  }

  void audit

  return {
    result,
    validation,
    trustStatus,
    selectedRange: range,
  }
}
