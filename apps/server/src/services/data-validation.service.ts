import { prisma } from '../lib/prisma'
import { DOWNLOAD_TYPES, DOWNLOAD_TYPE_LABELS, type DownloadType } from '../types/download'
import type {
  AnalyzedOrderView,
  FieldMappingResult,
  LiveSession,
  NormalizedOrder,
  OrderDedupeResult,
  SettlementPreprocessResult,
  SettlementRecord,
} from '../types/analysis'
import type {
  AnalysisContext,
  AnalysisTrustStatus,
  DataValidationReport,
  DateRangeSpan,
  DownloadCompletenessCheck,
  DownloadTableStatus,
  FieldRecognitionCheck,
  FileDateRangeCheck,
  GmvReconciliation,
  OrderAttributionReconciliation,
  SettlementReconciliation,
} from '../types/data-validation'
import { API_COLLECTION_TYPE_LABELS } from '../types/data-validation'
import type { DateRangeResolved } from '../utils/date-range'
import { formatDateKey } from '../utils/date-range'
import { formatDateTime } from '../utils/time'
import { sumCent } from '../utils/money'
import { sumSettlementDirection } from './reconcile.service'
import {
  buildOrderSettlementKeyIndex,
  resolveSettlementRecordCanonicalOrderId,
} from './settlement-order-key-match.util'

const OPTIONAL_TABLE_HINTS: Record<DownloadType, string> = {
  order: '订单列表接口无数据，无法生成经营看板',
  live: '直播场次接口无数据，将使用默认时间规则归属主播，归属可能不准',
  pendingSettlement: '待结算接口无数据，待结算金额可能不完整',
  settledSettlement: '已结算接口无数据，已结算金额和毛利润可能不完整',
}

function isOrderRequired(type: DownloadType): boolean {
  return type === 'order'
}

export async function checkDownloadCompleteness(): Promise<DownloadCompletenessCheck> {
  const tables: DownloadTableStatus[] = []
  const warnings: string[] = []
  const errors: string[] = []

  for (const type of DOWNLOAD_TYPES) {
    const latest = await prisma.downloadTask.findFirst({
      where: { type },
      orderBy: { createdAt: 'desc' },
    })

    const required = isOrderRequired(type)
    let downloadStatus: DownloadTableStatus['downloadStatus'] = 'missing'
    let impact: DownloadTableStatus['impact'] = required ? 'blocked' : 'preview'
    let hint: string | null = OPTIONAL_TABLE_HINTS[type] || null

    if (!latest) {
      if (required) {
        errors.push('订单表尚未下载，无法进行分析')
      } else if (hint) {
        warnings.push(hint)
      }
    } else if (latest.status === 'success' && latest.filePath) {
      downloadStatus = 'success'
      impact = 'none'
      hint = null
    } else if (latest.status === 'failed') {
      downloadStatus = 'failed'
      if (required) {
        errors.push(`订单表下载失败：${latest.errorMessage ?? '未知错误'}`)
      } else if (hint) {
        warnings.push(`${DOWNLOAD_TYPE_LABELS[type]}下载失败。${hint}`)
      }
    } else {
      downloadStatus = 'not_attempted'
      if (!required && hint) warnings.push(hint)
    }

    tables.push({
      type,
      typeLabel: DOWNLOAD_TYPE_LABELS[type],
      required,
      downloadStatus,
      fileName: latest?.fileName ?? null,
      taskId: latest?.id ?? null,
      finishedAt: latest?.finishedAt?.toISOString() ?? null,
      errorMessage: latest?.errorMessage ?? null,
      impact,
      hint,
    })
  }

  const orderOk = tables.find((t) => t.type === 'order')?.downloadStatus === 'success'

  return { tables, orderOk, warnings, errors }
}

export interface ApiCollectionCounts {
  order: number
  live: number
  pending: number
  settled: number
}

/** 接口采集版完整性：检查当前范围内原始 JSON 数据表是否有数据 */
export function checkApiCollectionCompleteness(
  counts: ApiCollectionCounts,
): DownloadCompletenessCheck {
  const tables: DownloadTableStatus[] = []
  const warnings: string[] = []
  const errors: string[] = []

  const countMap: Record<DownloadType, number> = {
    order: counts.order,
    live: counts.live,
    pendingSettlement: counts.pending,
    settledSettlement: counts.settled,
  }

  for (const type of DOWNLOAD_TYPES) {
    const required = isOrderRequired(type)
    const count = countMap[type]
    const hasData = count > 0

    let downloadStatus: DownloadTableStatus['downloadStatus'] = hasData ? 'success' : 'missing'
    let impact: DownloadTableStatus['impact'] = required ? 'blocked' : 'preview'
    let hint: string | null = !hasData ? OPTIONAL_TABLE_HINTS[type] || null : null

    if (!hasData) {
      if (required) {
        errors.push(OPTIONAL_TABLE_HINTS.order)
      } else if (hint) {
        warnings.push(hint)
      }
    } else {
      impact = 'none'
      hint = null
    }

    tables.push({
      type,
      typeLabel: API_COLLECTION_TYPE_LABELS[type],
      required,
      downloadStatus,
      fileName: hasData ? `${count} 条` : null,
      taskId: null,
      finishedAt: null,
      errorMessage: required && !hasData ? OPTIONAL_TABLE_HINTS.order : null,
      impact,
      hint,
    })
  }

  const orderOk = counts.order > 0

  return { tables, orderOk, warnings, errors }
}

export function checkApiFieldRecognition(orders: NormalizedOrder[]): FieldRecognitionCheck[] {
  const failed = orders.filter((o) => o.errors.length > 0).length
  const orderOk = orders.length > 0 && failed === 0

  return DOWNLOAD_TYPES.map((type) => {
    if (type !== 'order') {
      return {
        type,
        typeLabel: API_COLLECTION_TYPE_LABELS[type],
        missingRequired: [],
        warnings: [],
        ok: true,
      }
    }
    return {
      type,
      typeLabel: API_COLLECTION_TYPE_LABELS.order,
      missingRequired: orderOk ? [] : ['订单字段识别或标准化异常'],
      warnings: failed > 0 ? [`${failed} 条订单标准化失败`] : [],
      ok: orderOk,
    }
  })
}

export function validateApiDataDateRanges(params: {
  selectedRange: DateRangeResolved
  orderRange: DateRangeSpan
  liveRange: DateRangeSpan | null
  pendingRange: DateRangeSpan | null
  settledRange: DateRangeSpan | null
  orders: NormalizedOrder[]
}): FileDateRangeCheck[] {
  const checks = validateDownloadedFileDateRanges(params)
  return checks.map((c) => ({
    ...c,
    typeLabel: API_COLLECTION_TYPE_LABELS[c.type],
  }))
}

export function buildDateRangeSpan(
  dates: Date[],
  labelWhenEmpty: string,
): DateRangeSpan | null {
  const valid = dates.filter((d) => !Number.isNaN(d.getTime()))
  if (valid.length === 0) {
    return { start: null, end: null, displayText: labelWhenEmpty, validCount: 0 }
  }
  const min = new Date(Math.min(...valid.map((d) => d.getTime())))
  const max = new Date(Math.max(...valid.map((d) => d.getTime())))
  return {
    start: formatDateKey(min),
    end: formatDateKey(max),
    displayText: `${formatDateTime(min)} ~ ${formatDateTime(max)}`,
    validCount: valid.length,
  }
}

export function extractOrderFileDateRange(orders: NormalizedOrder[]): DateRangeSpan {
  const dates = orders
    .filter((o) => o.orderTime && o.errors.length === 0)
    .map((o) => o.orderTime as Date)
  return (
    buildDateRangeSpan(dates, '无有效下单时间') ?? {
      start: null,
      end: null,
      displayText: '无有效下单时间',
      validCount: 0,
    }
  )
}

export function extractLiveFileDateRange(sessions: LiveSession[]): DateRangeSpan | null {
  const dates = sessions.flatMap((s) => [s.startTime, s.endTime].filter(Boolean) as Date[])
  return buildDateRangeSpan(dates, '无有效直播时间')
}

export function extractSettledFileDateRange(records: SettlementRecord[]): DateRangeSpan | null {
  const dates = records
    .filter((r) => r.settlementTime && r.errors.length === 0)
    .map((r) => r.settlementTime as Date)
  return buildDateRangeSpan(dates, '无有效结算时间')
}

export function extractPendingFileDateRange(
  records: SettlementRecord[],
  ordersById: Map<string, NormalizedOrder>,
): DateRangeSpan | null {
  const dates: Date[] = []
  for (const r of records) {
    if (r.errors.length) continue
    const order = ordersById.get(r.orderId)
    if (order?.orderTime) dates.push(order.orderTime)
  }
  return buildDateRangeSpan(dates, '待结算无关联订单时间')
}

function dateInSelectedRange(date: Date, range: DateRangeResolved): boolean {
  const t = date.getTime()
  return t >= range.startTimeMs && t <= range.endTimeMs
}

function compareRangeCoverage(
  outer: DateRangeSpan | null,
  inner: DateRangeSpan,
): 'covers' | 'partial' | 'none' {
  if (!outer?.start || !outer.end || !inner.start || !inner.end) return 'partial'
  if (outer.start <= inner.start && outer.end >= inner.end) return 'covers'
  if (outer.end < inner.start || outer.start > inner.end) return 'none'
  return 'partial'
}

export function validateDownloadedFileDateRanges(params: {
  selectedRange: DateRangeResolved
  orderRange: DateRangeSpan
  liveRange: DateRangeSpan | null
  pendingRange: DateRangeSpan | null
  settledRange: DateRangeSpan | null
  orders: NormalizedOrder[]
}): FileDateRangeCheck[] {
  const { selectedRange, orderRange, liveRange, pendingRange, settledRange, orders } =
    params
  const selected = {
    startDate: selectedRange.startDate,
    endDate: selectedRange.endDate,
  }
  const checks: FileDateRangeCheck[] = []

  const validOrders = orders.filter((o) => o.orderTime && o.errors.length === 0)
  const inRange = validOrders.filter((o) =>
    dateInSelectedRange(o.orderTime as Date, selectedRange),
  )
  const outRange = validOrders.length - inRange.length

  let orderStatus: FileDateRangeCheck['status'] = 'ok'
  let orderMessage: string | null = null

  if (validOrders.length === 0) {
    orderStatus = 'blocked'
    orderMessage = '订单表没有有效下单时间，无法校验日期范围'
  } else if (inRange.length === 0) {
    orderStatus = 'blocked'
    orderMessage = '订单表实际时间完全不在所选范围内，请检查下载时间设置'
  } else if (outRange > 0) {
    orderStatus = 'warning'
    orderMessage = `订单表包含选择范围外的数据（${outRange} 单），请确认下载时间`
  }

  checks.push({
    type: 'order',
    typeLabel: DOWNLOAD_TYPE_LABELS.order,
    actualRange: orderRange,
    selectedRange: selected,
    status: orderStatus,
    message: orderMessage,
  })

  if (liveRange && liveRange.validCount > 0) {
    const cov = compareRangeCoverage(liveRange, orderRange)
    checks.push({
      type: 'live',
      typeLabel: DOWNLOAD_TYPE_LABELS.live,
      actualRange: liveRange,
      selectedRange: selected,
      status: cov === 'covers' ? 'ok' : 'warning',
      message:
        cov === 'covers'
          ? null
          : '直播场次范围与订单范围不完全一致，将影响主播归属',
    })
  } else {
    checks.push({
      type: 'live',
      typeLabel: DOWNLOAD_TYPE_LABELS.live,
      actualRange: null,
      selectedRange: selected,
      status: 'skipped',
      message: null,
    })
  }

  for (const [type, range, label] of [
    ['pendingSettlement', pendingRange, '待结算'] as const,
    ['settledSettlement', settledRange, '已结算'] as const,
  ]) {
    if (!range || range.validCount === 0) {
      checks.push({
        type,
        typeLabel: DOWNLOAD_TYPE_LABELS[type],
        actualRange: range,
        selectedRange: selected,
        status: 'skipped',
        message: null,
      })
      continue
    }
    const cov = compareRangeCoverage(range, orderRange)
    checks.push({
      type,
      typeLabel: DOWNLOAD_TYPE_LABELS[type],
      actualRange: range,
      selectedRange: selected,
      status: cov === 'covers' ? 'ok' : 'warning',
      message:
        cov === 'covers'
          ? null
          : `${label}明细范围与本次订单范围不一致，请检查`,
    })
  }

  return checks
}

export function checkOrderAttributionReconciliation(
  views: AnalyzedOrderView[],
  abnormalOrderCount: number,
): OrderAttributionReconciliation {
  const anchorOrderCount = views.filter(
    (o) =>
      o.anchorId &&
      o.attributionType !== 'unassigned' &&
      o.attributionType !== 'abnormal',
  ).length
  const unassignedOrderCount = views.filter((o) => o.attributionType === 'unassigned').length
  const uniqueOrderCount = views.length
  const dedupedTotal = uniqueOrderCount + abnormalOrderCount
  const leftSum = anchorOrderCount + unassignedOrderCount + abnormalOrderCount
  const ok = leftSum === dedupedTotal

  return {
    ok,
    anchorOrderCount,
    unassignedOrderCount,
    abnormalOrderCount,
    uniqueOrderCount: dedupedTotal,
    leftSum,
    message: ok ? null : '订单归属对账失败，存在漏单风险',
  }
}

export function checkGmvReconciliation(
  views: AnalyzedOrderView[],
  dedupe: OrderDedupeResult,
): GmvReconciliation {
  const anchorGmvCent = sumCent(
    views
      .filter(
        (o) =>
          o.anchorId &&
          o.attributionType !== 'unassigned' &&
          o.attributionType !== 'abnormal',
      )
      .map((o) => o.gmvCent),
  )
  const unassignedGmvCent = sumCent(
    views.filter((o) => o.attributionType === 'unassigned').map((o) => o.gmvCent),
  )
  const abnormalGmvCent = sumCent(dedupe.abnormalOrders.map((o) => o.gmvCent))
  const totalGmvCent = dedupe.summary.totalGmvCent + abnormalGmvCent
  const leftSumCent = anchorGmvCent + unassignedGmvCent + abnormalGmvCent
  const ok = leftSumCent === totalGmvCent

  return {
    ok,
    anchorGmvCent,
    unassignedGmvCent,
    abnormalGmvCent,
    totalGmvCent,
    leftSumCent,
    message: ok ? null : 'GMV 对账失败，存在金额遗漏风险',
  }
}

export function checkSettlementReconciliation(params: {
  orders: NormalizedOrder[]
  anchorByMatchOrderId?: Map<string, string>
  settlement?: SettlementPreprocessResult
  views: AnalyzedOrderView[]
}): SettlementReconciliation {
  const { settlement, views } = params
  const warnings: string[] = []
  const orderCount = views.length
  const orderKeyIndex = buildOrderSettlementKeyIndex(
    params.orders,
    params.anchorByMatchOrderId ?? new Map(),
  )

  if (!settlement) {
    return {
      orderCount,
      settledMatchedCount: 0,
      pendingMatchedCount: 0,
      ordersWithoutSettlementCount: orderKeyIndex.canonicalOrderIds.size,
      settlementWithoutOrderCount: 0,
      nonCurrentOrderSettlementCount: 0,
      settledAmountCent: 0,
      pendingAmountCent: 0,
      refundAmountCent: 0,
      feeAmountCent: 0,
      warnings: ['未导入结算明细，结算匹配按空处理'],
    }
  }

  const allBills = [...settlement.pendingRecords, ...settlement.settledRecords]

  const settledMatched = new Set<string>()
  const pendingMatched = new Set<string>()
  const matchedCanonicalOrders = new Set<string>()

  for (const r of settlement.settledRecords) {
    const canonical = resolveSettlementRecordCanonicalOrderId(r, orderKeyIndex)
    if (canonical) {
      settledMatched.add(canonical)
      matchedCanonicalOrders.add(canonical)
    }
  }
  for (const r of settlement.pendingRecords) {
    const canonical = resolveSettlementRecordCanonicalOrderId(r, orderKeyIndex)
    if (canonical) {
      pendingMatched.add(canonical)
      matchedCanonicalOrders.add(canonical)
    }
  }

  const ordersWithoutSettlement = [...orderKeyIndex.canonicalOrderIds].filter(
    (id) => !matchedCanonicalOrders.has(id),
  ).length
  const settlementWithoutOrder = allBills.filter(
    (r) => !resolveSettlementRecordCanonicalOrderId(r, orderKeyIndex),
  ).length

  if (settlementWithoutOrder > 0) {
    warnings.push(
      `${settlementWithoutOrder} 条结算记录不在本次订单表中，已计入「非本次订单结算记录」，不计入主播经营数据`,
    )
  }

  return {
    orderCount,
    settledMatchedCount: settledMatched.size,
    pendingMatchedCount: pendingMatched.size,
    ordersWithoutSettlementCount: ordersWithoutSettlement,
    settlementWithoutOrderCount: settlementWithoutOrder,
    nonCurrentOrderSettlementCount: settlementWithoutOrder,
    settledAmountCent: sumSettlementDirection(settlement, 'settled', 'income'),
    pendingAmountCent: sumSettlementDirection(settlement, 'pending', 'income'),
    refundAmountCent: sumCent([
      sumSettlementDirection(settlement, 'settled', 'refund'),
      sumSettlementDirection(settlement, 'pending', 'refund'),
    ]),
    feeAmountCent: sumCent([
      sumSettlementDirection(settlement, 'settled', 'fee'),
      sumSettlementDirection(settlement, 'pending', 'fee'),
    ]),
    warnings,
  }
}

export function checkFieldRecognition(
  checks: Array<{ type: DownloadType; mapping: FieldMappingResult | null; loaded: boolean }>,
): FieldRecognitionCheck[] {
  return checks.map(({ type, mapping, loaded }) => {
    if (!loaded || !mapping) {
      return {
        type,
        typeLabel: DOWNLOAD_TYPE_LABELS[type],
        missingRequired: type === 'order' ? ['订单表未加载'] : [],
        warnings: [],
        ok: type !== 'order',
      }
    }
    return {
      type,
      typeLabel: DOWNLOAD_TYPE_LABELS[type],
      missingRequired: mapping.missingRequiredFields,
      warnings: mapping.warnings,
      ok: mapping.missingRequiredFields.length === 0,
    }
  })
}

export function resolveTrustStatus(report: DataValidationReport): AnalysisTrustStatus {
  if (report.errors.some((e) => e.includes('解析') || e.includes('程序'))) {
    return 'error'
  }
  if (!report.completeness.orderOk) return 'blocked'
  if (report.fieldRecognition.some((f) => f.type === 'order' && !f.ok)) return 'blocked'
  if (report.fileDateRanges.some((f) => f.type === 'order' && f.status === 'blocked')) {
    return 'blocked'
  }
  if (report.orderAttribution && !report.orderAttribution.ok) return 'blocked'
  if (report.gmvReconciliation && !report.gmvReconciliation.ok) return 'blocked'

  const hasPreview =
    report.completeness.warnings.length > 0 ||
    report.fileDateRanges.some((f) => f.status === 'warning') ||
    report.warnings.length > 0

  if (hasPreview) return 'preview_only'
  return 'official_ready'
}

/** 接口采集版：仅严重错误 blocked，其余 warning → preview_only */
export function resolveApiTrustStatus(
  report: DataValidationReport,
  ctx: { apiOrderCount: number; normalizedOrderCount: number },
): AnalysisTrustStatus {
  if (report.errors.some((e) => e.includes('解析') || e.includes('程序'))) {
    return 'error'
  }

  if (ctx.apiOrderCount > 0 && ctx.normalizedOrderCount === 0) {
    return 'blocked'
  }

  if (!report.completeness.orderOk || ctx.normalizedOrderCount === 0) {
    return 'blocked'
  }

  const severeErrors = report.errors.filter(
    (e) =>
      e.includes('放大 100 倍') ||
      e.includes('毛利润大于 GMV') ||
      e.includes('已结算 + 待结算大于 GMV') ||
      e.includes('无法解析'),
  )
  if (severeErrors.length > 0) return 'blocked'

  const orderField = report.fieldRecognition.find((f) => f.type === 'order')
  if (orderField && !orderField.ok && ctx.normalizedOrderCount === 0) {
    return 'blocked'
  }

  const hasPreview =
    report.completeness.warnings.length > 0 ||
    report.fileDateRanges.some((f) => f.status === 'warning') ||
    report.warnings.length > 0 ||
    (report.orderAttribution && !report.orderAttribution.ok) ||
    (report.gmvReconciliation && !report.gmvReconciliation.ok) ||
    (orderField && !orderField.ok) ||
    (report.settlementReconciliation?.warnings.length ?? 0) > 0

  if (hasPreview) return 'preview_only'
  return 'official_ready'
}

export function buildShortRiskHints(
  status: AnalysisTrustStatus,
  report: DataValidationReport,
): string[] {
  if (status === 'official_ready') return []
  const hints: string[] = []
  if (status === 'blocked') {
    hints.push(...report.errors.slice(0, 3))
    if (report.orderAttribution && !report.orderAttribution.ok) {
      hints.push('订单归属对账未通过')
    }
    if (report.gmvReconciliation && !report.gmvReconciliation.ok) {
      hints.push('GMV 对账未通过')
    }
    return hints.length > 0 ? hints : ['数据异常，禁止汇报']
  }
  if (status === 'preview_only') {
    hints.push(...report.completeness.warnings.slice(0, 2))
    hints.push(...report.warnings.slice(0, 2))
    return hints.length > 0 ? hints : ['部分数据缺失，仅供预览']
  }
  return report.errors.slice(0, 3)
}

export function runDataValidation(ctx: AnalysisContext): DataValidationReport {
  const abnormalReasons: string[] = []
  if (ctx.orderDedupe.abnormalOrders.length > 0) {
    abnormalReasons.push(`异常订单 ${ctx.orderDedupe.abnormalOrders.length} 条`)
  }
  if (ctx.parseErrors.length > 0) abnormalReasons.push(...ctx.parseErrors)

  const fileDateRanges = validateDownloadedFileDateRanges({
    selectedRange: ctx.selectedRange,
    orderRange: ctx.orderFileRange,
    liveRange: ctx.liveRange,
    pendingRange: ctx.pendingFileRange,
    settledRange: ctx.settledFileRange,
    orders: ctx.orderDedupe.uniqueOrders,
  })

  const warnings = [...ctx.parseWarnings]
  const errors = [...ctx.parseErrors]

  for (const check of fileDateRanges) {
    if (check.status === 'warning' && check.message) warnings.push(check.message)
    if (check.status === 'blocked' && check.message) errors.push(check.message)
  }

  const orderAttribution = checkOrderAttributionReconciliation(
    ctx.views,
    ctx.orderDedupe.abnormalOrders.length,
  )
  const gmvReconciliation = checkGmvReconciliation(ctx.views, ctx.orderDedupe)

  const orderAnchorByOrderId = new Map<string, string>()
  for (const v of ctx.views) {
    if (v.anchorId && v.matchOrderId) orderAnchorByOrderId.set(v.matchOrderId, v.anchorId)
  }
  const settlementReconciliation = checkSettlementReconciliation({
    orders: ctx.orderDedupe.uniqueOrders,
    anchorByMatchOrderId: orderAnchorByOrderId,
    settlement: ctx.settlement,
    views: ctx.views,
  })
  warnings.push(...settlementReconciliation.warnings)

  return {
    selectedRange: {
      startDate: ctx.selectedRange.startDate,
      endDate: ctx.selectedRange.endDate,
    },
    completeness: { tables: [], orderOk: true, warnings: [], errors: [] },
    fileDateRanges,
    fieldRecognition: [],
    orderAttribution,
    gmvReconciliation,
    settlementReconciliation,
    warnings,
    errors,
    abnormalReasons,
  }
}

export async function runFullDataValidation(
  ctx: AnalysisContext,
  fieldChecks: FieldRecognitionCheck[],
): Promise<DataValidationReport> {
  const completeness = await checkDownloadCompleteness()
  const base = runDataValidation(ctx)
  return {
    ...base,
    completeness,
    fieldRecognition: fieldChecks,
    warnings: [...completeness.warnings, ...base.warnings],
    errors: [...completeness.errors, ...base.errors],
  }
}
