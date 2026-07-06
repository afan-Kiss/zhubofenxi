/**
 * 月度结账核对（只读）
 *
 * 说明：运营月报 summary.validAmountYuan 是「有效成交金额」，不是利润。
 * 盈亏判断需要成本、支出、完整结算；缺数据时必须明确不能下结论。
 */
import { prisma } from '../lib/prisma'
import type { AnalyzedOrderView } from '../types/analysis'
import { resolveDateRange } from '../utils/date-range'
import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'
import { parseLiveSessionTimeMs } from '../utils/business-timezone'
import { resolveMonthlyCloseMonth, type MonthlyCloseMonthResolved } from '../utils/monthly-close-month.util'
import { getBoardScopedViewsForRange } from './board-scoped-views.service'
import {
  buildDailyOperationsReport,
  type DailyOperationsReportPayload,
} from './daily-operations-report.service'
import {
  getMonthlyOperationsReport,
} from './monthly-operations-report.service'
import { aggregateWeeklySummaryForAcceptance } from './weekly-operations-report.service'
import { LOCAL_VIEWER_USER } from '../constants/local-viewer'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { viewCountsAsPaidOrder } from './business-metrics.service'
import { isDailyReportInvalidOrder } from './daily-report-order.util'
import {
  computeOperationsRefundMetricsFromViews,
  isActualAfterSaleOrder,
} from './operations-after-sale-order.util'
import { normalizeAfterSalesReason } from './after-sales-reason-normalize.service'
import {
  sumValidRevenueFromViews,
} from './valid-revenue-order.service'
import {
  loadNormalizedOrdersFromRaw,
  normalizePendingSettlementsFromRaw,
  normalizeSettledSettlementsFromRaw,
} from './xhs-api-sync/xhs-json-normalizer.service'
import { orderPayTimeInRange } from '../utils/order-stat-time.util'
import {
  runPayTimePrefilterDiagnostic,
  type PayTimePrefilterDiagnosticResult,
} from './order-pay-time-prefilter-diagnostic.service'

function isUnassignedMonthlyCloseView(v: AnalyzedOrderView): boolean {
  const name = String(v.anchorName ?? '').trim()
  return name === '未归属' || v.attributionType === 'unassigned'
}

export type MonthlyCloseProfitConclusion =
  | 'can_judge_profit_loss'
  | 'sales_only_no_profit'
  | 'incomplete'

export type MonthlyCloseDataQualityLevel = 'safe' | 'warning' | 'danger'

export interface MonthlyCloseDataQuality {
  reliable: boolean
  level: MonthlyCloseDataQualityLevel
  score: number
  warnings: string[]
  blockers: string[]
}

export interface MonthlyCloseReconciliationReport {
  generatedAt: string
  databasePathHint: string
  scope: MonthlyCloseMonthResolved
  sectionA: Record<string, unknown>
  sectionB: Record<string, unknown>
  sectionC: Record<string, unknown>
  sectionD: Record<string, unknown>
  sectionE: Record<string, unknown>
  sectionF: Record<string, unknown>
  dataQuality: MonthlyCloseDataQuality
  crossCheck: Record<string, unknown>
  payTimePrefilterDiagnostic: PayTimePrefilterDiagnosticResult
  fieldSourceNote: string
}

function countDuplicateKeys(views: AnalyzedOrderView[]): {
  duplicateOrderCount: number
  duplicatePackageCount: number
} {
  const orderIds = new Map<string, number>()
  const packageIds = new Map<string, number>()
  for (const v of views) {
    const orderNo = resolveMetricOrderNo(v)
    if (orderNo) orderIds.set(orderNo, (orderIds.get(orderNo) ?? 0) + 1)
    const pkg = v.packageId?.trim() || v.orderId?.trim()
    if (pkg) packageIds.set(pkg, (packageIds.get(pkg) ?? 0) + 1)
  }
  let duplicateOrderCount = 0
  for (const c of orderIds.values()) {
    if (c > 1) duplicateOrderCount += c - 1
  }
  let duplicatePackageCount = 0
  for (const c of packageIds.values()) {
    if (c > 1) duplicatePackageCount += c - 1
  }
  return { duplicateOrderCount, duplicatePackageCount }
}

function sumRefundCent(views: AnalyzedOrderView[]): number {
  let cent = 0
  for (const v of dedupeViewsByMetricOrderNo(views)) {
    if (!isActualAfterSaleOrder(v)) continue
    cent +=
      (v.productRefundAmountCent ?? 0) ||
      (v.returnAmountCent ?? 0) ||
      (v.realAfterSaleAmountCent ?? 0) ||
      0
  }
  return cent
}

function buildAfterSalesTop(views: AnalyzedOrderView[], limit = 5): Array<{ reason: string; count: number }> {
  const map = new Map<string, number>()
  for (const v of dedupeViewsByMetricOrderNo(views)) {
    if (!isActualAfterSaleOrder(v)) continue
    const rawText =
      String(v.afterSaleReasonText ?? v.reasonText ?? '').trim() ||
      String(v.afterSaleStatusText ?? v.afterSaleStatusLabel ?? '').trim()
    const normalized = normalizeAfterSalesReason(rawText)
    const label = normalized.categoryLabel || rawText || '未填写原因'
    map.set(label, (map.get(label) ?? 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count }))
}

function settlementTimeMs(rec: { settlementTime?: Date; settlementTimeText?: string }): number | null {
  if (rec.settlementTime instanceof Date && !Number.isNaN(rec.settlementTime.getTime())) {
    return rec.settlementTime.getTime()
  }
  return null
}

function buildDataQuality(input: {
  orderScore: number
  paymentScore: number
  afterSaleScore: number
  settlementScore: number
  costScore: number
  warnings: string[]
  blockers: string[]
}): MonthlyCloseDataQuality {
  const score =
    input.orderScore +
    input.paymentScore +
    input.afterSaleScore +
    input.settlementScore +
    input.costScore
  let level: MonthlyCloseDataQualityLevel = 'safe'
  if (score < 60) level = 'danger'
  else if (score < 80) level = 'warning'
  return {
    reliable: score >= 80 && input.blockers.length === 0,
    level,
    score,
    warnings: input.warnings,
    blockers: input.blockers,
  }
}

function resolveProfitConclusion(input: {
  dataQuality: MonthlyCloseDataQuality
  hasCostData: boolean
  hasSettlementData: boolean
  paymentGapRate: number
  duplicateCount: number
}): { tier: MonthlyCloseProfitConclusion; message: string } {
  if (
    input.dataQuality.score >= 80 &&
    input.hasCostData &&
    input.hasSettlementData &&
    input.paymentGapRate < 0.02 &&
    input.duplicateCount === 0
  ) {
    return {
      tier: 'can_judge_profit_loss',
      message: '成交、退款、结算、成本数据齐全，可尝试判断盈亏（仍需人工复核）',
    }
  }
  if (input.dataQuality.score >= 40 && input.paymentGapRate < 0.1) {
    return {
      tier: 'sales_only_no_profit',
      message:
        '只能判断经营销售结果，不能判断最终盈利亏损。系统缺少商品成本或支出数据，或结算不完整。',
    }
  }
  return {
    tier: 'incomplete',
    message: '数据不完整，不能下盈利/亏损结论。请先补齐同步与核对。',
  }
}

export async function buildMonthlyCloseReconciliation(params: {
  month?: string
  autoPrevMonth?: boolean
  now?: Date
  skipMonthlyReportCrossCheck?: boolean
}): Promise<MonthlyCloseReconciliationReport> {
  const scope = resolveMonthlyCloseMonth(params)
  const range = resolveDateRange('custom', scope.startDate, scope.endDate)

  const [
    rawOrderTotal,
    goodReviewCount,
    afterSalesCacheCount,
    pendingSettlementCount,
    settledSettlementCount,
    liveSessionTotal,
    anchorScheduleCount,
    scoped,
    rawOrdersInRange,
  ] = await Promise.all([
    prisma.xhsRawOrder.count(),
    prisma.goodReview.count(),
    prisma.xhsAfterSalesWorkbenchCache.count(),
    prisma.xhsRawPendingSettlement.count(),
    prisma.xhsRawSettledSettlement.count(),
    prisma.xhsRawLiveSession.count(),
    prisma.anchorDailySchedule.count(),
    getBoardScopedViewsForRange({
      preset: 'custom',
      startDate: scope.startDate,
      endDate: scope.endDate,
      role: LOCAL_VIEWER_USER.role,
      username: LOCAL_VIEWER_USER.username,
    }),
    loadNormalizedOrdersFromRaw({ range }),
  ])

  const views = scoped.views
  const deduped = dedupeViewsByMetricOrderNo(views)
  const validRevenue = sumValidRevenueFromViews(views)
  const refundMetrics = computeOperationsRefundMetricsFromViews(views)
  const dup = countDuplicateKeys(views)

  const paidViews = deduped.filter((v) => viewCountsAsPaidOrder(v))
  const invalidViews = deduped.filter((v) => isDailyReportInvalidOrder(v))
  const afterSaleViews = deduped.filter((v) => isActualAfterSaleOrder(v))
  const unassignedViews = deduped.filter(isUnassignedMonthlyCloseView)

  const rawPaidInRange = rawOrdersInRange.filter(
    (o) => o.errors.length === 0 && orderPayTimeInRange(o, range),
  )
  const rawMissingPayment = rawPaidInRange.filter((o) => !o.paymentTime)
  const missingPaymentCount = rawMissingPayment.length

  const abnormalAmountViews = deduped.filter(
    (v) => (v.effectiveGmvCent ?? 0) <= 0 && viewCountsAsPaidOrder(v),
  )

  const liveRows = await prisma.xhsRawLiveSession.findMany({
    select: { rawJson: true, liveAccountName: true },
  })
  let liveSessionsInMonth = 0
  for (const row of liveRows) {
    const raw = row.rawJson as Record<string, unknown>
    const startText =
      String(raw.start_time ?? raw.startTime ?? raw.live_start_time ?? '').trim() ||
      String(raw.actual_start_time ?? '').trim()
    const ms = parseLiveSessionTimeMs(startText)
    if (ms != null && ms >= range.startTimeMs && ms <= range.endTimeMs) liveSessionsInMonth++
  }

  const [pendingAll, settledAll] = await Promise.all([
    normalizePendingSettlementsFromRaw(),
    normalizeSettledSettlementsFromRaw(),
  ])
  const pendingInRange = pendingAll.filter((r) => {
    const ms = settlementTimeMs(r)
    return ms != null && ms >= range.startTimeMs && ms <= range.endTimeMs
  })
  const settledInRange = settledAll.filter((r) => {
    const ms = settlementTimeMs(r)
    return ms != null && ms >= range.startTimeMs && ms <= range.endTimeMs
  })
  const settlementAmountCent =
    pendingInRange.reduce((s, r) => s + Math.abs(r.amountCent), 0) +
    settledInRange.reduce((s, r) => s + Math.abs(r.amountCent), 0)

  const afterSalesPendingFetch = await prisma.xhsAfterSalesWorkbenchCache.count({
    where: { fetchStatus: { in: ['pending', 'failed'] } },
  })

  const hasCostTables = false
  const hasSettlementData =
    pendingSettlementCount + settledSettlementCount > 0 && settlementAmountCent > 0
  const paymentGapRate =
    rawPaidInRange.length > 0
      ? rawMissingPayment.length / rawPaidInRange.length
      : deduped.length > 0
        ? 0
        : 0

  const payTimePrefilterDiagnostic = await runPayTimePrefilterDiagnostic({
    paymentRange: range,
    scanAll: rawOrderTotal <= 5000,
    scanDays: 180,
  })

  const warnings: string[] = []
  const blockers: string[] = []

  if (!scope.suitableForCloseCheck) blockers.push(scope.closeCheckNote)
  if (unassignedViews.length > 0) {
    warnings.push(`有 ${unassignedViews.length} 单未归属主播，日报/月报可能不完整`)
  }
  if (dup.duplicateOrderCount > 0 || dup.duplicatePackageCount > 0) {
    warnings.push(
      `发现重复订单 ${dup.duplicateOrderCount} 条、重复 package ${dup.duplicatePackageCount} 条`,
    )
  }
  if (missingPaymentCount > 0) {
    warnings.push(`有 ${missingPaymentCount} 单缺支付时间`)
  }
  if (!hasSettlementData) {
    blockers.push('结算/到账数据不足，不能判断实际到账利润')
  }
  if (!hasCostTables) {
    blockers.push('系统无商品成本/支出表，不能判断最终盈利亏损')
  }
  if (afterSalesPendingFetch > 0) {
    warnings.push(`售后缓存有 ${afterSalesPendingFetch} 条待拉取或失败，退款可能不全`)
  }
  if (payTimePrefilterDiagnostic.wouldMissWithCurrentPrefilterCount > 0) {
    warnings.push(
      `支付时间预筛可能漏单 ${payTimePrefilterDiagnostic.wouldMissWithCurrentPrefilterCount} 单（${payTimePrefilterDiagnostic.diagnoseMode}，扫描 ${payTimePrefilterDiagnostic.rawRowsScanned} 条 raw）`,
    )
  }

  let orderScore = 20
  if (dup.duplicateOrderCount > 0 || abnormalAmountViews.length > 0) orderScore = Math.min(orderScore, 12)
  if (deduped.length === 0) orderScore = 0

  let paymentScore = 20
  if (paymentGapRate > 0.05) paymentScore = 10
  if (paymentGapRate > 0.15) paymentScore = 0
  if (payTimePrefilterDiagnostic.wouldMissWithCurrentPrefilterCount > 0) {
    paymentScore = Math.min(paymentScore, 10)
  }

  let afterSaleScore = 20
  if (afterSalesPendingFetch > 0) afterSaleScore = 10
  if (afterSalesCacheCount === 0 && afterSaleViews.length > 0) afterSaleScore = 10

  let settlementScore = 0
  if (hasSettlementData) settlementScore = 20
  else settlementScore = Math.min(settlementScore, 14)

  const costScore = 0

  const dataQuality = buildDataQuality({
    orderScore,
    paymentScore,
    afterSaleScore,
    settlementScore,
    costScore,
    warnings,
    blockers,
  })

  const profit = resolveProfitConclusion({
    dataQuality,
    hasCostData: hasCostTables,
    hasSettlementData,
    paymentGapRate,
    duplicateCount: dup.duplicateOrderCount + dup.duplicatePackageCount,
  })

  const crossCheck: Record<string, unknown> = {
    skipped: params.skipMonthlyReportCrossCheck === true,
  }

  if (!params.skipMonthlyReportCrossCheck) {
    try {
      const monthlyReport = await getMonthlyOperationsReport({
        month: scope.month,
        preset: 'custom',
        role: LOCAL_VIEWER_USER.role,
        username: LOCAL_VIEWER_USER.username,
      })
      const mr = monthlyReport.summary
      const amountDiff = Math.abs(validRevenue.validAmountYuan - mr.validAmountYuan)
      const orderDiff = Math.abs(validRevenue.soldOrderCount - mr.soldOrderCount)
      crossCheck.monthlyReport = {
        validAmountYuan: mr.validAmountYuan,
        soldOrderCount: mr.soldOrderCount,
        returnOrderCount: mr.productReturnOrderCount,
      }
      crossCheck.reconciliation = {
        validAmountYuan: validRevenue.validAmountYuan,
        soldOrderCount: validRevenue.soldOrderCount,
        returnOrderCount: refundMetrics.refundOrderCount,
      }
      crossCheck.amountDiffYuan = amountDiff
      crossCheck.orderDiff = orderDiff
      crossCheck.amountMatch = amountDiff <= 1
      crossCheck.orderMatch = orderDiff <= 1
      if (amountDiff > 1) {
        warnings.push(
          `与运营月报有效成交金额相差 ¥${amountDiff.toFixed(2)}，需人工核对`,
        )
      }
      if (orderDiff > 1) {
        warnings.push(`与运营月报成交单数相差 ${orderDiff} 单，需人工核对`)
      }

      const days = eachDayInShanghaiRange(scope.startDate, scope.endDate)
      const dailySnapshots: DailyOperationsReportPayload[] = []
      for (const dateKey of days) {
        dailySnapshots.push(
          await buildDailyOperationsReport({
            preset: 'custom',
            startDate: dateKey,
            endDate: dateKey,
            role: LOCAL_VIEWER_USER.role,
            username: LOCAL_VIEWER_USER.username,
          }),
        )
      }
      const dailySum = aggregateWeeklySummaryForAcceptance(dailySnapshots)
      crossCheck.dailySum = {
        validAmountYuan: dailySum.validAmountYuan,
        soldOrderCount: dailySum.soldOrderCount,
      }
      crossCheck.dailyVsMonthlyAmountDiff = Math.abs(
        dailySum.validAmountYuan - mr.validAmountYuan,
      )
      crossCheck.dailyVsMonthlyOrderDiff = Math.abs(
        dailySum.soldOrderCount - mr.soldOrderCount,
      )
    } catch (err) {
      crossCheck.error = err instanceof Error ? err.message : String(err)
      warnings.push('运营月报交叉核对失败，请检查数据库与日期范围')
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    databasePathHint: process.env.DATABASE_URL ?? 'file:../data/app.db',
    scope,
    sectionA: {
      month: scope.month,
      startDate: scope.startDate,
      endDate: scope.endDate,
      isCompleteNaturalMonth: scope.isCompleteNaturalMonth,
      executionDate: scope.executionDateKey,
      suitableForCloseCheck: scope.suitableForCloseCheck,
      note: scope.closeCheckNote,
    },
    sectionB: {
      rawOrderTotalInDb: rawOrderTotal,
      rawOrdersLoadedForMonth: rawOrdersInRange.length,
      rawPaidOrdersInMonth: rawPaidInRange.length,
      analyzedViewCount: views.length,
      dedupedViewCount: deduped.length,
      paidOrderCount: refundMetrics.paidOrderCount,
      validSoldOrderCount: validRevenue.soldOrderCount,
      invalidOrderCount: invalidViews.length,
      afterSaleOrderCount: afterSaleViews.length,
      unassignedOrderCount: unassignedViews.length,
      missingPaymentTimeCount: missingPaymentCount,
      duplicateOrderCount: dup.duplicateOrderCount,
      duplicatePackageCount: dup.duplicatePackageCount,
      abnormalAmountOrderCount: abnormalAmountViews.length,
      totalPaymentAmountYuan: Math.round(
        paidViews.reduce((s, v) => s + (v.paymentBaseCent ?? 0), 0) / 100,
      ),
      validAmountCent: validRevenue.validAmountCent,
      validAmountYuan: validRevenue.validAmountYuan,
      avgOrderAmountYuan:
        validRevenue.soldOrderCount > 0
          ? Math.round(validRevenue.validAmountYuan / validRevenue.soldOrderCount)
          : null,
      liveSessionsInMonth,
    },
    sectionC: {
      afterSaleOrderCount: afterSaleViews.length,
      refundOrderCount: refundMetrics.refundOrderCount,
      refundAmountYuan: Math.round(sumRefundCent(views) / 100),
      afterSalesTopReasons: buildAfterSalesTop(views),
      afterSalesCacheTotal: afterSalesCacheCount,
      afterSalesPendingOrFailedFetch: afterSalesPendingFetch,
      afterSalesSyncMayBeIncomplete: afterSalesPendingFetch > 0,
    },
    sectionD: {
      hasSettlementTables: true,
      pendingSettlementTotal: pendingSettlementCount,
      settledSettlementTotal: settledSettlementCount,
      pendingInMonth: pendingInRange.length,
      settledInMonth: settledInRange.length,
      settlementAmountYuanInMonth: Math.round(settlementAmountCent / 100),
      validAmountYuanForCompare: validRevenue.validAmountYuan,
      settlementVsValidAmountDiffYuan: Math.round(
        validRevenue.validAmountYuan - settlementAmountCent / 100,
      ),
      canJudgeActualReceivedProfit: hasSettlementData && dataQuality.score >= 80,
      note: hasSettlementData
        ? '有结算原始数据，但与有效成交金额差异需人工核对；不等于最终利润'
        : '结算数据不足，不能判断实际到账利润',
    },
    sectionE: {
      hasProductCostData: false,
      hasLaborCostData: false,
      hasExpenseData: false,
      productCostYuan: null,
      laborCostYuan: null,
      freightExpenseYuan: null,
      otherExpenseYuan: null,
      grossProfitYuan: null,
      netProfitYuan: null,
      note: '数据库无成本/支出表。只能输出经营销售结果，不能输出利润。',
    },
    sectionF: {
      conclusionTier: profit.tier,
      conclusionMessage: profit.message,
      validAmountYuan: validRevenue.validAmountYuan,
      refundAmountYuan: Math.round(sumRefundCent(views) / 100),
      settlementAmountYuan: hasSettlementData ? Math.round(settlementAmountCent / 100) : null,
      costExpenseAvailable: false,
      canOutputProfitNumber: profit.tier === 'can_judge_profit_loss',
    },
    dataQuality,
    crossCheck,
    payTimePrefilterDiagnostic,
    fieldSourceNote:
      '运营月报 validAmountYuan = 有效成交金额（支付口径+售后剔除），非利润。详见 docs/MONTHLY_CLOSE_RECONCILIATION.md',
  }
}

/** 只读：全局 + 指定月基线统计 */
export async function buildMonthlyCloseDataSafetyBaseline(params?: {
  month?: string
  autoPrevMonth?: boolean
}): Promise<Record<string, unknown>> {
  const scope = params?.month || params?.autoPrevMonth
    ? resolveMonthlyCloseMonth({
        month: params.month,
        autoPrevMonth: params.autoPrevMonth,
      })
    : null

  const monthRange = scope
    ? resolveDateRange('custom', scope.startDate, scope.endDate)
    : null

  const [
    rawOrderCount,
    liveSessionCount,
    goodReviewCount,
    afterSalesCacheCount,
    pendingSettlementCount,
    settledSettlementCount,
    anchorScheduleCount,
  ] = await Promise.all([
    prisma.xhsRawOrder.count(),
    prisma.xhsRawLiveSession.count(),
    prisma.goodReview.count(),
    prisma.xhsAfterSalesWorkbenchCache.count(),
    prisma.xhsRawPendingSettlement.count(),
    prisma.xhsRawSettledSettlement.count(),
    prisma.anchorDailySchedule.count(),
  ])

  let monthStats: Record<string, unknown> | null = null
  if (monthRange && scope) {
    const [orders, scoped] = await Promise.all([
      loadNormalizedOrdersFromRaw({ range: monthRange }),
      getBoardScopedViewsForRange({
        preset: 'custom',
        startDate: scope.startDate,
        endDate: scope.endDate,
        role: LOCAL_VIEWER_USER.role,
        username: LOCAL_VIEWER_USER.username,
      }),
    ])
    const paid = orders.filter((o) => orderPayTimeInRange(o, monthRange) && o.errors.length === 0)
    const valid = sumValidRevenueFromViews(scoped.views)
    const refund = computeOperationsRefundMetricsFromViews(scoped.views)
    const dup = countDuplicateKeys(scoped.views)
    const unassigned = dedupeViewsByMetricOrderNo(scoped.views).filter(isUnassignedMonthlyCloseView)
      .length
    const missingPay = paid.filter((o) => !o.paymentTime).length

    monthStats = {
      month: scope.month,
      startDate: scope.startDate,
      endDate: scope.endDate,
      orderCount: orders.length,
      paidOrderCount: paid.length,
      validAmountYuan: valid.validAmountYuan,
      soldOrderCount: valid.soldOrderCount,
      refundOrderCount: refund.refundOrderCount,
      unassignedOrderCount: unassigned,
      missingPaymentTimeCount: missingPay,
      duplicateOrderCount: dup.duplicateOrderCount,
      duplicatePackageCount: dup.duplicatePackageCount,
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    databasePath: process.env.DATABASE_URL ?? 'file:../data/app.db',
    rawOrderCount,
    liveSessionCount,
    goodReviewCount,
    afterSalesCacheCount,
    settlementRecordCount: pendingSettlementCount + settledSettlementCount,
    anchorScheduleCount,
    lastMonthScope: scope,
    lastMonthStats: monthStats,
  }
}
