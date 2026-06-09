import type { BusinessAnalysisResult } from '../types/analysis'
import type {
  AnalysisTrustStatus,
  DataValidationReport,
} from '../types/data-validation'
import { TRUST_STATUS_LABELS, TRUST_STATUS_HINTS } from '../types/data-validation'
import { buildShortRiskHints } from './data-validation.service'
import type { AnalysisPipelineResult } from './analysis-pipeline.service'
import { centToYuan } from '../utils/money'

export interface DashboardTrustSummary {
  status: AnalysisTrustStatus
  statusLabel: string
  statusHint: string
  canReport: boolean
  isPreviewOnly: boolean
  isBlocked: boolean
  riskHints: string[]
  selectedRange: { startDate: string; endDate: string } | null
}

export interface DashboardTrustChecks {
  apiCollectionStatuses: Array<{ label: string; status: '通过' | '缺失' | '失败' }>
  dateRangeOk: boolean
  dateRangeStatus: '通过' | '警告' | '失败'
  orderReconciliationOk: boolean
  gmvReconciliationOk: boolean
  settlementOk: boolean
  settlementStatus: '通过' | '警告' | '失败'
  amountUnitOk: boolean
  amountUnitStatus: '通过' | '警告' | '失败'
  settlementSummary: string | null
  selectedRange: { startDate: string; endDate: string } | null
  actualDataRange: string | null
}

function mapApiCollectionStatus(
  downloadStatus: string,
  required: boolean,
): '通过' | '缺失' | '失败' {
  if (downloadStatus === 'success') return '通过'
  if (required) return '失败'
  return '缺失'
}

function buildTrustChecks(validation: DataValidationReport): DashboardTrustChecks {
  const dateBlocked = validation.fileDateRanges.some((f) => f.status === 'blocked')
  const dateWarning = validation.fileDateRanges.some((f) => f.status === 'warning')
  const dateRangeStatus: DashboardTrustChecks['dateRangeStatus'] = dateBlocked
    ? '失败'
    : dateWarning
      ? '警告'
      : '通过'

  const settlementWarnings = validation.settlementReconciliation?.warnings.length ?? 0
  const settlementStatus: DashboardTrustChecks['settlementStatus'] =
    settlementWarnings > 0 ? '警告' : '通过'

  const amountWarnings = validation.warnings.filter(
    (w) => w.includes('单位异常') || w.includes('100 倍') || w.includes('金额'),
  )
  const amountBlocked = validation.errors.some(
    (e) => e.includes('单位异常') || e.includes('100 倍'),
  )
  const amountUnitStatus: DashboardTrustChecks['amountUnitStatus'] = amountBlocked
    ? '失败'
    : amountWarnings.length > 0
      ? '警告'
      : '通过'

  const orderRange = validation.fileDateRanges.find((f) => f.type === 'order')
  const actualDataRange = orderRange?.actualRange?.displayText ?? null

  return {
    apiCollectionStatuses: validation.completeness.tables.map((t) => ({
      label: t.typeLabel,
      status: mapApiCollectionStatus(t.downloadStatus, t.required),
    })),
    dateRangeOk: !dateBlocked && !dateWarning,
    dateRangeStatus,
    orderReconciliationOk: validation.orderAttribution?.ok ?? false,
    gmvReconciliationOk: validation.gmvReconciliation?.ok ?? false,
    settlementOk: settlementWarnings === 0,
    settlementStatus,
    amountUnitOk: amountUnitStatus === '通过',
    amountUnitStatus,
    settlementSummary: validation.settlementReconciliation
      ? `已结算匹配 ${validation.settlementReconciliation.settledMatchedCount} · 待结算匹配 ${validation.settlementReconciliation.pendingMatchedCount} · 非本次结算 ${validation.settlementReconciliation.nonCurrentOrderSettlementCount}`
      : null,
    selectedRange: validation.selectedRange,
    actualDataRange,
  }
}

export interface DashboardOverviewResponse {
  hasData: boolean
  officialDataAvailable: boolean
  trust: DashboardTrustSummary
  trustChecks?: DashboardTrustChecks
  periodLabel: string
  gmv: number
  orderCount: number
  actualSignedCount: number
  actualSignedAmount: number
  returnCount: number
  returnAmount: number
  returnRate: number
  qualityReturnCount: number
  qualityReturnAmount: number
  qualityReturnRate: number
  settledAmount: number
  pendingAmount: number
  grossProfit: number
  grossProfitNote: string
  grossProfitBreakdown?: Record<string, unknown> | null
  abnormalOrderCount: number
  unassignedOrderCount: number
  billUnmatchedCount: number
  anchorGmvShare: Array<{ name: string; value: number; color: string }>
  anchorActualSignedShare: Array<{ name: string; value: number; color: string }>
  lastUpdatedAt: string | null
  anchorSummaries: Array<{
    anchorName: string
    color: string
    gmv: number
    gmvShare: number
    orderCount: number
    actualSignedCount: number
    actualSignedAmount: number
    actualSignedShare: number
    returnCount: number
    returnRate: number
    qualityReturnCount: number
    qualityReturnAmount: number
    settledAmount: number
    pendingAmount: number
    grossProfit: number
  }>
  buyerReturnRanking: Array<{
    buyerId: string
    returnCount: number
    returnAmount: number
    latestReturnTime: string
    orderCount?: number
    anchors?: string
  }>
  buyerReturnCountRanking: Array<{
    buyerId: string
    returnCount: number
    returnAmount: number
    latestReturnTime: string
    orderCount?: number
    anchors?: string
  }>
  buyerPaymentRanking: Array<{
    buyerId: string
    paymentAmount: number
    orderCount: number
    latestOrderTime: string
    anchors: string
  }>
  buyerQualityReturnRanking: Array<{
    buyerId: string
    qualityReturnCount: number
    qualityReturnAmount: number
    reasonSummary: string
  }>
  returnDetails: Array<{
    orderId: string
    buyerId: string
    anchorName: string
    gmv: number
    reasonText: string
    isQualityReturn: boolean
  }>
  unassignedOrders: Array<{
    orderId: string
    orderTimeText: string
    gmv: number
    reason: string
  }>
  abnormalOrders: Array<{
    sourceRowIndex: number
    orderId: string
    errors: string[]
  }>
  warnings: string[]
  errors: string[]
  /** 按订单月份归属退款（元） */
  returnByOrderMonth?: number
  /** 按退款发生月份归属退款（元） */
  returnByRefundMonth?: number
  dataStatusMeta?: {
    monthlyStatus: string
    lastSyncedAt: string | null
    hasHistoricalAdjustment: boolean
    adjustmentAmount: number
    grossProfitStability: string
    returnByOrderMonth?: number
    returnByRefundMonth?: number
  }
}

export interface DashboardDiagnosticsResponse {
  trust: DashboardTrustSummary
  validation: DataValidationReport
}

function buildTrustSummary(
  trustStatus: AnalysisTrustStatus,
  validation: DataValidationReport,
): DashboardTrustSummary {
  return {
    status: trustStatus,
    statusLabel: TRUST_STATUS_LABELS[trustStatus],
    statusHint: TRUST_STATUS_HINTS[trustStatus],
    canReport: trustStatus === 'official_ready',
    isPreviewOnly: trustStatus === 'preview_only',
    isBlocked: trustStatus === 'blocked' || trustStatus === 'error',
    riskHints: buildShortRiskHints(trustStatus, validation),
    selectedRange: validation.selectedRange,
  }
}

function emptyTrust(
  status: AnalysisTrustStatus = 'blocked',
  range?: { startDate: string; endDate: string },
): DashboardTrustSummary {
  return {
    status,
    statusLabel: TRUST_STATUS_LABELS[status],
    statusHint: TRUST_STATUS_HINTS[status],
    canReport: false,
    isPreviewOnly: status === 'preview_only',
    isBlocked: status !== 'official_ready',
    riskHints: [],
    selectedRange: range ?? null,
  }
}

export function toDashboardResponse(
  pipeline: AnalysisPipelineResult | null,
  emptyMessage?: string,
  includeTrustChecks = false,
): DashboardOverviewResponse {
  if (!pipeline) {
    return {
      hasData: false,
      officialDataAvailable: false,
      trust: emptyTrust('blocked'),
      periodLabel: emptyMessage ?? '暂无分析数据',
      gmv: 0,
      orderCount: 0,
      actualSignedCount: 0,
      actualSignedAmount: 0,
      returnCount: 0,
      returnAmount: 0,
      returnRate: 0,
      qualityReturnCount: 0,
      qualityReturnAmount: 0,
      qualityReturnRate: 0,
      settledAmount: 0,
      pendingAmount: 0,
      grossProfit: 0,
      grossProfitNote: emptyMessage ?? '暂无分析数据，请先同步接口数据',
      abnormalOrderCount: 0,
      unassignedOrderCount: 0,
      billUnmatchedCount: 0,
      anchorGmvShare: [],
      anchorActualSignedShare: [],
      lastUpdatedAt: null,
      anchorSummaries: [],
      buyerReturnRanking: [],
      buyerReturnCountRanking: [],
      buyerPaymentRanking: [],
      buyerQualityReturnRanking: [],
      returnDetails: [],
      unassignedOrders: [],
      abnormalOrders: [],
      warnings: [],
      errors: [],
    }
  }

  const { result, validation, trustStatus } = pipeline
  const trust = buildTrustSummary(trustStatus, validation)
  const trustChecks = includeTrustChecks ? buildTrustChecks(validation) : undefined
  const official = trustStatus === 'official_ready' || trustStatus === 'preview_only'

  if (!result || !official) {
    const rangeText = validation.selectedRange
      ? `${validation.selectedRange.startDate} ~ ${validation.selectedRange.endDate}`
      : '—'
    return {
      hasData: false,
      officialDataAvailable: false,
      trust,
      trustChecks,
      periodLabel: `分析范围：${rangeText}`,
      gmv: 0,
      orderCount: 0,
      actualSignedCount: 0,
      actualSignedAmount: 0,
      returnCount: 0,
      returnAmount: 0,
      returnRate: 0,
      qualityReturnCount: 0,
      qualityReturnAmount: 0,
      qualityReturnRate: 0,
      settledAmount: 0,
      pendingAmount: 0,
      grossProfit: 0,
      grossProfitNote: trust.statusHint,
      abnormalOrderCount: validation.orderAttribution?.abnormalOrderCount ?? 0,
      unassignedOrderCount: validation.orderAttribution?.unassignedOrderCount ?? 0,
      billUnmatchedCount: 0,
      anchorGmvShare: [],
      anchorActualSignedShare: [],
      lastUpdatedAt: null,
      anchorSummaries: [],
      buyerReturnRanking: [],
      buyerReturnCountRanking: [],
      buyerPaymentRanking: [],
      buyerQualityReturnRanking: [],
      returnDetails: [],
      unassignedOrders: [],
      abnormalOrders: [],
      warnings: validation.warnings,
      errors: [...validation.errors, ...validation.abnormalReasons],
    }
  }

  const o = result.overview
  const selected = validation.selectedRange
  const actualRange = o.analysisRangeText
  const rangeNote =
    actualRange &&
    selected &&
    !actualRange.includes(selected.startDate.slice(0, 7))
      ? `当前展示的是选择范围内已采集到的数据，实际数据截至 ${actualRange.split('~').pop()?.trim() ?? actualRange}`
      : null
  const periodLabel = selected
    ? `当前选择范围：${selected.startDate} ~ ${selected.endDate} · 实际数据范围：${actualRange}${rangeNote ? `（${rangeNote}）` : ''}`
    : `实际数据范围：${actualRange}`

  return {
    hasData: true,
    officialDataAvailable: trustStatus === 'official_ready',
    trust,
    trustChecks,
    periodLabel,
    gmv: centToYuan(o.gmvCent),
    orderCount: o.orderCount,
    actualSignedCount: o.actualSignedCount,
    actualSignedAmount: centToYuan(o.actualSignedAmountCent),
    returnCount: o.returnCount,
    returnAmount: centToYuan(o.returnAmountCent),
    returnByOrderMonth: centToYuan(o.returnByOrderMonthCent ?? o.returnAmountCent),
    returnByRefundMonth: centToYuan(o.returnByRefundMonthCent ?? o.returnAmountCent),
    returnRate: o.returnRate,
    qualityReturnCount: o.qualityReturnCount,
    qualityReturnAmount: centToYuan(o.qualityReturnAmountCent),
    qualityReturnRate: o.qualityReturnRate,
    settledAmount: centToYuan(o.settledAmountCent),
    pendingAmount: centToYuan(o.pendingAmountCent),
    grossProfit: centToYuan(o.grossProfitCent),
    grossProfitNote: o.grossProfitNote,
    grossProfitBreakdown: o.grossProfitBreakdown ?? null,
    abnormalOrderCount: o.abnormalOrderCount,
    unassignedOrderCount: o.unassignedOrderCount,
    billUnmatchedCount: o.billUnmatchedCount,
    anchorGmvShare: result.anchorSummaries.map((a) => ({
      name: a.anchorName,
      value: centToYuan(a.gmvCent),
      color: a.color,
    })),
    anchorActualSignedShare: result.anchorSummaries.map((a) => ({
      name: a.anchorName,
      value: centToYuan(a.actualSignedAmountCent),
      color: a.color,
    })),
    lastUpdatedAt: o.lastUpdatedAt ?? null,
    anchorSummaries: result.anchorSummaries.map((a) => ({
      anchorName: a.anchorName,
      color: a.color,
      gmv: centToYuan(a.gmvCent),
      gmvShare: a.gmvShare,
      orderCount: a.orderCount,
      actualSignedCount: a.actualSignedCount,
      actualSignedAmount: centToYuan(a.actualSignedAmountCent),
      actualSignedShare: a.actualSignedShare,
      returnCount: a.returnCount,
      returnRate: a.returnRate,
      qualityReturnCount: a.qualityReturnCount,
      qualityReturnAmount: centToYuan(a.qualityReturnAmountCent),
      settledAmount: centToYuan(a.settledAmountCent),
      pendingAmount: centToYuan(a.pendingAmountCent),
      grossProfit: centToYuan(a.grossProfitCent),
    })),
    buyerReturnRanking: result.buyerReturnRanking.map((b) => ({
      buyerId: b.buyerId,
      returnCount: b.returnCount,
      returnAmount: centToYuan(b.returnAmountCent),
      latestReturnTime: b.latestReturnTime,
      orderCount: b.orderCount ?? b.returnCount,
      anchors: b.anchors ?? '—',
    })),
    buyerReturnCountRanking: result.buyerReturnCountRanking.map((b) => ({
      buyerId: b.buyerId,
      returnCount: b.returnCount,
      returnAmount: centToYuan(b.returnAmountCent),
      latestReturnTime: b.latestReturnTime,
      orderCount: b.orderCount ?? b.returnCount,
      anchors: b.anchors ?? '—',
    })),
    buyerPaymentRanking: result.buyerPaymentRanking.map((b) => ({
      buyerId: b.buyerId,
      paymentAmount: centToYuan(b.paymentAmountCent),
      orderCount: b.orderCount,
      latestOrderTime: b.latestOrderTime,
      anchors: b.anchors,
    })),
    buyerQualityReturnRanking: result.buyerQualityReturnRanking.map((b) => ({
      buyerId: b.buyerId,
      qualityReturnCount: b.qualityReturnCount,
      qualityReturnAmount: centToYuan(b.qualityReturnAmountCent),
      reasonSummary: b.reasonSummary,
    })),
    returnDetails: result.returnDetails.map((r) => ({
      orderId: r.orderId,
      buyerId: r.buyerId,
      anchorName: r.anchorName,
      gmv: centToYuan(r.gmvCent),
      reasonText: r.reasonText,
      isQualityReturn: r.isQualityReturn,
    })),
    unassignedOrders: result.unassignedOrders.map((u) => ({
      orderId: u.orderId,
      orderTimeText: u.orderTimeText,
      gmv: centToYuan(u.gmvCent),
      reason: u.reason,
    })),
    abnormalOrders: result.abnormalOrders,
    warnings: o.warnings,
    errors: [...result.errors, ...validation.errors],
  }
}

export function toDiagnosticsResponse(
  pipeline: AnalysisPipelineResult,
): DashboardDiagnosticsResponse {
  return {
    trust: buildTrustSummary(pipeline.trustStatus, pipeline.validation),
    validation: pipeline.validation,
  }
}
