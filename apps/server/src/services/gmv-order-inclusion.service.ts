import type { NormalizedOrder } from '../types/analysis'
import type { DateRangeResolved } from '../utils/date-range'
import { computeOrderAmountMetrics } from './order-amount-metrics.service'
import { classifyOrderAfterSale } from './after-sale-classification.service'

export interface GmvOrderInclusionDetail {
  packageId: string
  bizOrderId: string
  matchOrderId: string
  productTitle: string
  skuId: string | null
  includedInGmv: boolean
  includeReason: string | null
  excludeReason: string | null
  gmvTimeField: string | null
  gmvTimeValue: string | null
  rawStatus: string
  rawAfterSaleStatus: string
  gmvCent: number
  receivableAmountCent: number
  actualSellerReceiveAmountCent: number
  sourceUsed: string
  inTargetDateRange: boolean
  passedNormalization: boolean
  inDedupedUnique: boolean
  dedupeNote: string | null
  multiSkuMerged: boolean
  orderStatusText: string
  afterSaleStatusText: string
  isReturned: boolean
  isSigned: boolean
  isQualityReturn: boolean
  paidAtRaw: string | null
  orderedAtRaw: string | null
  warning: string | null
}

function pickProductTitle(raw: Record<string, unknown>): string {
  const skus = raw.skus
  if (!Array.isArray(skus) || skus.length === 0) return '—'
  const first = skus[0] as Record<string, unknown>
  return String(first.skuName ?? first.displayName ?? first.name ?? '—').trim() || '—'
}

function pickSkuId(raw: Record<string, unknown>): string | null {
  const skus = raw.skus
  if (!Array.isArray(skus) || skus.length === 0) return null
  const first = skus[0] as Record<string, unknown>
  const id = first.skuId ?? first.sku_id
  return id != null ? String(id) : null
}

/** GMV 统计时间：支付时间优先 */
export function resolveGmvTimeField(raw: Record<string, unknown>): {
  field: string
  value: string
} | null {
  if (raw.paidAt != null && String(raw.paidAt).trim()) {
    return { field: 'paidAt', value: String(raw.paidAt).trim() }
  }
  if (raw.paid_at != null && String(raw.paid_at).trim()) {
    return { field: 'paid_at', value: String(raw.paid_at).trim() }
  }
  if (raw.payTime != null && String(raw.payTime).trim()) {
    return { field: 'payTime', value: String(raw.payTime).trim() }
  }
  if (raw.pay_time != null && String(raw.pay_time).trim()) {
    return { field: 'pay_time', value: String(raw.pay_time).trim() }
  }
  if (raw.paymentTime != null && String(raw.paymentTime).trim()) {
    return { field: 'paymentTime', value: String(raw.paymentTime).trim() }
  }
  if (raw.orderedAt != null && String(raw.orderedAt).trim()) {
    return { field: 'orderedAt', value: String(raw.orderedAt).trim() }
  }
  if (raw.ordered_at != null && String(raw.ordered_at).trim()) {
    return { field: 'ordered_at', value: String(raw.ordered_at).trim() }
  }
  return null
}

function orderInRange(order: NormalizedOrder, range: DateRangeResolved): boolean {
  if (!order.paymentTime) return false
  const ms = order.paymentTime.getTime()
  return ms >= range.startTimeMs && ms <= range.endTimeMs
}

const GMV_INCLUDE_POLICY =
  '有效 GMV 口径（v2）：实付>应收>卖家实收>商品金额；已取消/未支付不计入；全额退款不计入；部分退款按支付基数减退款金额'

export function explainOrderGmvInclusion(
  order: NormalizedOrder,
  range: DateRangeResolved,
  ctx?: { inDedupedUnique?: boolean; dedupeNote?: string | null; multiSkuMerged?: boolean },
): GmvOrderInclusionDetail {
  const raw = order.raw
  const timeMeta = resolveGmvTimeField(raw)
  const inTargetDateRange = orderInRange(order, range)
  const passedNormalization = order.errors.length === 0
  const inDedupedUnique = ctx?.inDedupedUnique ?? true

  const base = {
    packageId: order.packageId || '—',
    bizOrderId: order.bizOrderId || order.orderId,
    matchOrderId: order.matchOrderId || '—',
    productTitle: pickProductTitle(raw),
    skuId: pickSkuId(raw),
    gmvTimeField: timeMeta?.field ?? null,
    gmvTimeValue: timeMeta?.value ?? (order.orderTimeText || null),
    rawStatus: String(raw.statusDesc ?? raw.status ?? order.orderStatusText ?? '—'),
    rawAfterSaleStatus: String(
      raw.afterSaleStatusDesc ?? raw.afterSaleStatus ?? order.afterSaleStatusText ?? '—',
    ),
    gmvCent: order.gmvCent,
    receivableAmountCent: order.receivableAmountCent,
    actualSellerReceiveAmountCent: order.actualSellerReceiveAmountCent,
    sourceUsed: order.gmvSourceUsed,
    inTargetDateRange,
    passedNormalization,
    inDedupedUnique,
    dedupeNote: ctx?.dedupeNote ?? null,
    multiSkuMerged: ctx?.multiSkuMerged ?? false,
    orderStatusText: order.orderStatusText,
    afterSaleStatusText: order.afterSaleStatusText,
    isReturned: order.isReturned,
    isSigned: order.isSigned,
    isQualityReturn: order.isQualityReturn,
    paidAtRaw: raw.paidAt != null ? String(raw.paidAt) : raw.paid_at != null ? String(raw.paid_at) : null,
    orderedAtRaw:
      raw.orderedAt != null ? String(raw.orderedAt) : raw.ordered_at != null ? String(raw.ordered_at) : null,
    warning: order.amountWarnings.length > 0 ? order.amountWarnings.join('；') : null,
  }

  const reasons: string[] = []
  if (!inTargetDateRange) {
    reasons.push(
      `下单时间 ${order.orderTimeText || '—'} 不在范围 ${range.startDate}~${range.endDate}（按 orderedAt→paidAt 解析后的 orderTime 与 range.startTimeMs/endTimeMs 比较）`,
    )
  }
  if (!passedNormalization) {
    reasons.push(`规范化失败：${order.errors.join('；')}`)
  }
  const refundCent = order.isReturned ? order.receivableAmountCent || order.gmvCent : 0
  const classification = classifyOrderAfterSale(order, refundCent)
  const metrics = computeOrderAmountMetrics(order, classification)

  if (order.gmvCent <= 0 && metrics.paymentBaseCent <= 0) {
    reasons.push('商品 GMV≤0 且无支付基数，无法计入')
  }
  if (metrics.gmvExcludeReason) {
    reasons.push(metrics.gmvExcludeReason)
  }
  if (!inDedupedUnique) {
    reasons.push(ctx?.dedupeNote ?? '去重后未进入 uniqueOrders')
  }

  if (reasons.length > 0 || !metrics.includedInGmv) {
    return {
      ...base,
      includedInGmv: false,
      includeReason: null,
      excludeReason: reasons.join('；') || metrics.gmvExcludeReason,
    }
  }

  const includeParts = [
    GMV_INCLUDE_POLICY,
    `有效 GMV=${metrics.effectiveGmvCent} 分，支付基数=${metrics.paymentBaseCent} 分（${metrics.paymentBaseSource}）`,
  ]
  if (ctx?.multiSkuMerged) {
    includeParts.push('同包裹多 SKU 已累加')
  }

  return {
    ...base,
    includedInGmv: true,
    includeReason: includeParts.join('；'),
    excludeReason: null,
  }
}
