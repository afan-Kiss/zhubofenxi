import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'
import { resolvePriceBandLabelFromCent } from '../config/operations-price-band.config'
import { AFTER_SALES_REASON_LABELS } from './after-sales-reason-normalize.service'
import {
  getBoardScopedViewsForRange,
  getAnchorPerformanceViews,
} from './board-scoped-views.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { isValidRevenueOrder, resolveValidRevenueAmountCent } from './valid-revenue-order.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { resolveRequestCacheIdentity } from './operations-report-cache.service'
import {
  pickItemIdFromRaw,
  pickProductNameFromRaw,
  pickSkuNameFromRaw,
  resolveProductKey,
} from './operations-product-fields.util'
import { isProductReturnOrder } from './operations-product-analysis.service'
import {
  formatAfterSaleStatusDisplay,
  formatAfterSalesCategoryLabel,
  formatAfterSalesReasonDisplay,
  isActualAfterSaleOrder,
} from './operations-after-sale-order.util'
import { normalizeAfterSalesReason } from './after-sales-reason-normalize.service'
import { mapViewToOperationsBiDrillRow } from './operations-bi-drill-row.mapper'
import type {
  OperationsBiDrillPayload,
  OperationsBiDrillRequest,
  OperationsBiDrillSource,
  OperationsBiDrillTarget,
} from './operations-bi-drill.types'
import { computeProductReturnRateByOrder } from './operations-product-analysis.service'
import type { AnalyzedOrderView } from '../types/analysis'

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 31
const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20

const VALID_SOURCES = new Set<OperationsBiDrillSource>([
  'daily_summary',
  'weekly_summary',
  'monthly_summary',
  'rankings',
  'anchor_ranking',
  'product_ranking',
  'price_band_ranking',
  'after_sales_ranking',
  'business_insight',
  'risk_warning',
  'metric_card',
])

const VALID_TARGETS = new Set<OperationsBiDrillTarget>([
  'summary_valid_amount',
  'summary_orders',
  'summary_return_orders',
  'summary_return_rate',
  'summary_buyer_count',
  'summary_deal_conversion',
  'anchor_amount',
  'anchor_orders',
  'anchor_hourly_amount',
  'anchor_return_rate',
  'product_hot',
  'product_amount',
  'product_orders',
  'product_quantity',
  'product_high_return',
  'product_slow',
  'product_high_aov',
  'price_band_amount',
  'price_band_orders',
  'price_band_return_rate',
  'after_sales_reason',
  'after_sales_refund_amount',
  'business_insight_orders',
  'custom',
])

const TRAFFIC_ONLY_TARGETS = new Set<OperationsBiDrillTarget>(['summary_deal_conversion'])

const TARGET_LABELS: Record<OperationsBiDrillTarget, string> = {
  summary_valid_amount: '有效成交金额',
  summary_orders: '成交订单数',
  summary_return_orders: '商品退货订单',
  summary_return_rate: '商品退货率',
  summary_buyer_count: '成交买家数',
  summary_deal_conversion: '成交率',
  anchor_amount: '主播成交金额',
  anchor_orders: '主播成交订单',
  anchor_hourly_amount: '主播每小时成交',
  anchor_return_rate: '主播退货率',
  product_hot: '热卖商品',
  product_amount: '商品成交金额',
  product_orders: '商品成交订单',
  product_quantity: '商品成交件数',
  product_high_return: '高退货商品',
  product_slow: '主推未成交',
  product_high_aov: '高客单商品',
  price_band_amount: '价格带金额',
  price_band_orders: '价格带订单数',
  price_band_return_rate: '价格带退货率',
  after_sales_reason: '售后原因',
  after_sales_refund_amount: '退款金额',
  business_insight_orders: '经营建议相关订单',
  custom: '自定义',
}

export class OperationsBiDrillValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperationsBiDrillValidationError'
  }
}

function assertDateKey(value: string, label: string): void {
  if (!DATE_KEY_RE.test(value)) {
    throw new OperationsBiDrillValidationError(`${label} 格式应为 YYYY-MM-DD`)
  }
}

function resolveProductKeyFromView(
  view: AnalyzedOrderView,
  rawByMatch: Map<string, Record<string, unknown>>,
): string {
  const withRaw = attachRawByMatchToViews([view], rawByMatch)[0]!
  const raw = withRaw.raw
  return resolveProductKey({
    itemId: pickItemIdFromRaw(raw),
    productName: pickProductNameFromRaw(raw),
    skuName: pickSkuNameFromRaw(raw),
  })
}

function viewMatchesAnchor(view: AnalyzedOrderView, anchorName?: string): boolean {
  if (!anchorName?.trim()) return true
  return (view.anchorName ?? '').trim() === anchorName.trim()
}

function viewMatchesProduct(
  view: AnalyzedOrderView,
  rawByMatch: Map<string, Record<string, unknown>>,
  productKey?: string,
): boolean {
  if (!productKey?.trim()) return true
  return resolveProductKeyFromView(view, rawByMatch) === productKey.trim()
}

function viewMatchesPriceBand(view: AnalyzedOrderView, priceBandLabel?: string): boolean {
  if (!priceBandLabel?.trim()) return true
  const cent = view.paymentBaseCent || view.effectiveGmvCent || 0
  return resolvePriceBandLabelFromCent(cent) === priceBandLabel.trim()
}

function viewMatchesAfterSales(
  view: AnalyzedOrderView,
  category?: string,
  reason?: string,
): boolean {
  const reasonRaw =
    view.afterSaleReasonText ??
    view.reasonText ??
    view.afterSalesWorkbenchReason ??
    ''
  const normalized = normalizeAfterSalesReason(String(reasonRaw))
  if (category?.trim() && normalized.category !== category.trim()) return false
  if (reason?.trim()) {
    const q = reason.trim()
    if (!String(reasonRaw).includes(q) && normalized.categoryLabel !== q) return false
  }
  return true
}

type FilterMode = 'sold' | 'return' | 'after_sale' | 'any_included'

function filterViewsForTarget(
  views: AnalyzedOrderView[],
  rawByMatch: Map<string, Record<string, unknown>>,
  input: OperationsBiDrillRequest,
  mode: FilterMode,
): AnalyzedOrderView[] {
  const deduped = dedupeViewsByMetricOrderNo(views)
  return deduped.filter((view) => {
    if (!viewMatchesAnchor(view, input.anchorName)) return false
    if (!viewMatchesProduct(view, rawByMatch, input.productKey)) return false
    if (!viewMatchesPriceBand(view, input.priceBandLabel ?? input.priceBandKey)) return false
    if (
      input.afterSalesCategory ||
      input.afterSalesReason ||
      input.target.startsWith('after_sales')
    ) {
      if (!viewMatchesAfterSales(view, input.afterSalesCategory, input.afterSalesReason)) {
        return false
      }
    }

    if (mode === 'sold') return isValidRevenueOrder(view)
    if (mode === 'return') return isProductReturnOrder(view)
    if (mode === 'after_sale') return isActualAfterSaleOrder(view)
    return Boolean(resolveMetricOrderNo(view) || view.paymentBaseCent > 0)
  })
}

function resolveFilterMode(target: OperationsBiDrillTarget): FilterMode {
  if (
    target === 'summary_return_orders' ||
    target === 'summary_return_rate' ||
    target === 'anchor_return_rate' ||
    target === 'product_high_return' ||
    target === 'after_sales_reason' ||
    target === 'after_sales_refund_amount' ||
    target === 'price_band_return_rate'
  ) {
    return 'after_sale'
  }
  if (target === 'product_slow') return 'sold'
  return 'sold'
}

function resolveInsightTarget(input: OperationsBiDrillRequest): OperationsBiDrillTarget {
  const type = input.insightType?.trim()
  if (type === 'review_product' || type === 'pause_product') return 'product_high_return'
  if (type === 'promote_product') return 'product_hot'
  if (type === 'review_anchor' || type === 'optimize_anchor_product_match') {
    return 'anchor_orders'
  }
  if (type === 'increase_anchor_schedule') return 'anchor_amount'
  if (type === 'focus_price_band') return 'price_band_amount'
  if (type === 'after_sales_check') return 'after_sales_reason'
  if (type === 'data_quality_warning') return input.target
  return input.target
}

function validateRequiredDimensions(input: OperationsBiDrillRequest): void {
  const target = input.target
  if (
    (target.startsWith('anchor_') || input.source === 'anchor_ranking') &&
    !input.anchorName?.trim()
  ) {
    throw new OperationsBiDrillValidationError('请提供主播名称，才能查看这个主播由哪些订单组成')
  }
  if (
    (target.startsWith('product_') || input.source === 'product_ranking') &&
    target !== 'product_slow' &&
    !input.productKey?.trim()
  ) {
    throw new OperationsBiDrillValidationError('请提供商品标识，才能查看这个商品由哪些订单组成')
  }
  if (
    (target.startsWith('price_band_') || input.source === 'price_band_ranking') &&
    !(input.priceBandLabel?.trim() || input.priceBandKey?.trim())
  ) {
    throw new OperationsBiDrillValidationError('请提供价格带，才能查看这个价格带由哪些订单组成')
  }
  if (
    (target.startsWith('after_sales_') || input.source === 'after_sales_ranking') &&
    !(input.afterSalesCategory?.trim() || input.afterSalesReason?.trim())
  ) {
    throw new OperationsBiDrillValidationError('请提供售后原因，才能查看对应订单')
  }
}

function buildDrillTitle(target: OperationsBiDrillTarget): string {
  switch (target) {
    case 'summary_return_rate':
    case 'summary_return_orders':
    case 'anchor_return_rate':
    case 'product_high_return':
    case 'price_band_return_rate':
      return '退货/退款订单明细'
    case 'after_sales_refund_amount':
      return '退款订单明细'
    case 'after_sales_reason':
      return '售后原因订单明细'
    case 'summary_valid_amount':
    case 'anchor_amount':
    case 'product_hot':
    case 'product_amount':
    case 'price_band_amount':
      return '成交订单明细'
    case 'summary_orders':
    case 'anchor_orders':
    case 'product_orders':
    case 'price_band_orders':
      return '成交订单明细'
    default:
      return `订单明细：${TARGET_LABELS[target]}`
  }
}

function buildExplanation(input: OperationsBiDrillRequest, mode: FilterMode, total: number): string {
  if (TRAFFIC_ONLY_TARGETS.has(input.target)) {
    return '这个指标来自官方流量数据，不是由订单直接组成。'
  }
  if (input.insightType === 'data_quality_warning') {
    return '这个建议是因为数据不够完整，不是由订单直接组成。'
  }
  if (input.target === 'product_slow' && total === 0) {
    return '这个主推商品在当前范围内没有有效成交订单。'
  }
  if (input.target === 'anchor_hourly_amount') {
    return '这里展示该主播的有效成交订单；直播时长在报表里单独汇总。'
  }
  if (mode === 'after_sale') {
    return '这里只显示发生实际退款或退货的订单。'
  }
  return '这里展示与报表同一口径的有效成交订单。'
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)
  const safePage = Math.min(Math.max(page, 1), Math.max(totalPages, 1))
  const start = (safePage - 1) * pageSize
  return {
    page: safePage,
    pageSize,
    total,
    totalPages,
    slice: items.slice(start, start + pageSize),
  }
}

export async function buildOperationsBiDrill(
  input: OperationsBiDrillRequest,
): Promise<OperationsBiDrillPayload> {
  if (!VALID_SOURCES.has(input.source)) {
    throw new OperationsBiDrillValidationError('数据来源类型无效')
  }
  if (!VALID_TARGETS.has(input.target)) {
    throw new OperationsBiDrillValidationError('这个指标暂时不能下钻')
  }

  assertDateKey(input.startDate, 'startDate')
  assertDateKey(input.endDate, 'endDate')
  if (input.startDate > input.endDate) {
    throw new OperationsBiDrillValidationError('开始日期不能晚于结束日期')
  }
  const days = eachDayInShanghaiRange(input.startDate, input.endDate)
  if (days.length === 0) {
    throw new OperationsBiDrillValidationError('日期范围无效')
  }
  if (days.length > MAX_RANGE_DAYS) {
    throw new OperationsBiDrillValidationError(
      '这个范围订单较多，请缩小日期或分批查看明细。',
    )
  }

  validateRequiredDimensions(input)

  const pageSize = Math.min(
    Math.max(input.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  )
  const page = Math.max(input.page ?? 1, 1)
  const viewer = resolveRequestCacheIdentity(
    input.role && input.username ? { role: input.role as import('../types/roles').UserRole, username: input.username } : null,
  )

  if (TRAFFIC_ONLY_TARGETS.has(input.target)) {
    return {
      title: `数据来源：${TARGET_LABELS[input.target]}`,
      subtitle: `${input.startDate} ~ ${input.endDate}`,
      explanation: buildExplanation(input, 'sold', 0),
      sourceLabel: input.source,
      targetLabel: TARGET_LABELS[input.target],
      range: { startDate: input.startDate, endDate: input.endDate },
      summary: {
        orderCount: 0,
        validAmountYuan: 0,
        productReturnOrderCount: 0,
        productReturnRate: null,
        buyerCount: null,
      },
      filters: [],
      rows: [],
      pagination: { page: 1, pageSize, total: 0, totalPages: 0 },
      dataQuality: {
        reliable: true,
        warnings: ['这个指标来自官方流量，不是由订单直接组成。'],
      },
    }
  }

  if (input.insightType === 'data_quality_warning') {
    return {
      title: '数据来源：数据维护建议',
      subtitle: `${input.startDate} ~ ${input.endDate}`,
      explanation: buildExplanation(input, 'sold', 0),
      sourceLabel: input.source,
      targetLabel: TARGET_LABELS.business_insight_orders,
      range: { startDate: input.startDate, endDate: input.endDate },
      summary: {
        orderCount: 0,
        validAmountYuan: 0,
        productReturnOrderCount: 0,
        productReturnRate: null,
      },
      filters: [],
      rows: [],
      pagination: { page: 1, pageSize, total: 0, totalPages: 0 },
      dataQuality: {
        reliable: true,
        warnings: ['这个建议不是由订单组成的，是因为数据不够。'],
      },
    }
  }

  const effectiveTarget =
    input.target === 'business_insight_orders' ? resolveInsightTarget(input) : input.target
  const mode = resolveFilterMode(effectiveTarget)

  const scoped = await getBoardScopedViewsForRange({
    preset: input.preset ?? 'custom',
    startDate: input.startDate,
    endDate: input.endDate,
    role: viewer.role,
    username: viewer.username,
  })
  const performanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const filtered = filterViewsForTarget(performanceViews, scoped.rawByMatch, input, mode)

  const inclusionReason = TARGET_LABELS[effectiveTarget]
  const rowsAll = filtered.map((view) =>
    mapViewToOperationsBiDrillRow(view, scoped.rawByMatch, inclusionReason),
  )

  if (input.sort === 'amount_desc') {
    rowsAll.sort((a, b) => (b.validAmountYuan ?? 0) - (a.validAmountYuan ?? 0))
  } else {
    rowsAll.sort((a, b) => String(b.payTime ?? '').localeCompare(String(a.payTime ?? '')))
  }

  const soldCount = filtered.filter((v) => isValidRevenueOrder(v)).length
  const returnCount = filtered.filter((v) => isActualAfterSaleOrder(v)).length
  const validAmountYuan = filtered.reduce(
    (sum, v) => sum + Math.round(resolveValidRevenueAmountCent(v) / 100),
    0,
  )
  const buyers = new Set<string>()
  for (const v of filtered) {
    if (!isValidRevenueOrder(v)) continue
    const key = v.buyerKey || v.buyerId
    if (key) buyers.add(key)
  }

  const paged = paginate(rowsAll, page, pageSize)
  const filters: Array<{ label: string; value: string }> = [
    { label: '日期', value: `${input.startDate} ~ ${input.endDate}` },
  ]
  if (input.anchorName?.trim()) filters.push({ label: '主播', value: input.anchorName.trim() })
  if (input.productName?.trim()) filters.push({ label: '商品', value: input.productName.trim() })
  else if (input.productKey?.trim()) filters.push({ label: '商品', value: input.productKey.trim() })
  if (input.priceBandLabel?.trim()) {
    filters.push({ label: '价格带', value: input.priceBandLabel.trim() })
  }
  if (input.afterSalesReason?.trim()) {
    filters.push({ label: '售后原因', value: input.afterSalesReason.trim() })
  } else if (input.afterSalesCategory?.trim()) {
    const label =
      AFTER_SALES_REASON_LABELS[
        input.afterSalesCategory.trim() as keyof typeof AFTER_SALES_REASON_LABELS
      ] ?? input.afterSalesCategory.trim()
    filters.push({ label: '售后原因', value: label })
  }

  const warnings: string[] = []
  if (paged.total === 0) {
    warnings.push('没有找到组成订单。')
  }

  return {
    title: buildDrillTitle(effectiveTarget),
    subtitle: `${input.startDate} ~ ${input.endDate}`,
    explanation: buildExplanation(input, mode, paged.total),
    sourceLabel: input.source,
    targetLabel: TARGET_LABELS[effectiveTarget],
    range: { startDate: input.startDate, endDate: input.endDate },
    summary: {
      orderCount: soldCount,
      validAmountYuan,
      productReturnOrderCount: returnCount,
      productReturnRate: computeProductReturnRateByOrder(soldCount, returnCount),
      buyerCount: buyers.size,
    },
    filters,
    rows: paged.slice,
    pagination: {
      page: paged.page,
      pageSize: paged.pageSize,
      total: paged.total,
      totalPages: paged.totalPages,
    },
    dataQuality: {
      reliable: true,
      warnings,
    },
  }
}
