import type { AnalyzedOrderView } from '../types/analysis'
import { centToYuan } from '../utils/money'
import {
  OPERATIONS_PRICE_BANDS,
  resolvePriceBandLabelFromCent,
  type OperationsPriceBandLabel,
} from '../config/operations-price-band.config'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { viewCountsAsPaidOrder } from './business-metrics.service'
import { viewCountsAsRefundOrder } from './order-refund-metrics.service'
import { isValidRevenueOrder, resolveValidRevenueAmountCent } from './valid-revenue-order.service'
import { safeDivide, safeRatioPercent } from './daily-report-order.util'
import { computeReturnOrderRateRatio } from './operations-after-sale-order.util'

export interface OperationsPriceBandRow {
  bandLabel: OperationsPriceBandLabel
  orderCount: number
  paidOrderCount: number
  amountYuan: number
  buyerCount: number
  amountSharePercent: number | null
  avgOrderAmountYuan: number | null
  returnOrderCount: number
  returnRate: number | null
}

function isProductReturnOrder(v: AnalyzedOrderView): boolean {
  return viewCountsAsRefundOrder(v)
}

export function buildOperationsPriceBandAnalysis(views: AnalyzedOrderView[]): OperationsPriceBandRow[] {
  const deduped = dedupeViewsByMetricOrderNo(views)
  type Bucket = {
    validRevenueOrderKeys: Set<string>
    paidOrderKeys: Set<string>
    amountCent: number
    buyers: Set<string>
    returnOrderKeys: Set<string>
  }
  const buckets = new Map<OperationsPriceBandLabel, Bucket>()
  for (const band of OPERATIONS_PRICE_BANDS) {
    buckets.set(band.label, {
      validRevenueOrderKeys: new Set<string>(),
      paidOrderKeys: new Set<string>(),
      amountCent: 0,
      buyers: new Set<string>(),
      returnOrderKeys: new Set<string>(),
    })
  }

  let totalAmountCent = 0
  for (const view of deduped) {
    const orderKey = resolveMetricOrderNo(view) || view.orderId
    if (!orderKey) continue
    const label = resolvePriceBandLabelFromCent(view.paymentBaseCent || view.effectiveGmvCent)
    const bucket = buckets.get(label)!
    if (viewCountsAsPaidOrder(view)) {
      bucket.paidOrderKeys.add(orderKey)
    }
    if (isValidRevenueOrder(view)) {
      bucket.validRevenueOrderKeys.add(orderKey)
      const amountCent = resolveValidRevenueAmountCent(view)
      bucket.amountCent += amountCent
      totalAmountCent += amountCent
      const buyerKey = view.buyerKey || view.buyerId
      if (buyerKey) bucket.buyers.add(buyerKey)
    }
    if (isProductReturnOrder(view)) {
      bucket.returnOrderKeys.add(orderKey)
    }
  }

  return OPERATIONS_PRICE_BANDS.map((band) => {
    const bucket = buckets.get(band.label)!
    const orderCount = bucket.validRevenueOrderKeys.size
    const paidOrderCount = bucket.paidOrderKeys.size
    const amountYuan = Math.round(centToYuan(bucket.amountCent))
    const returnOrderCount = [...bucket.returnOrderKeys].filter((key) =>
      bucket.paidOrderKeys.has(key),
    ).length
    return {
      bandLabel: band.label,
      orderCount,
      paidOrderCount,
      amountYuan,
      buyerCount: bucket.buyers.size,
      amountSharePercent: safeRatioPercent(bucket.amountCent, totalAmountCent),
      avgOrderAmountYuan: Math.round(safeDivide(amountYuan, orderCount) ?? 0) || null,
      returnOrderCount,
      returnRate: computeReturnOrderRateRatio(paidOrderCount, returnOrderCount),
    }
  }).filter((row) => row.orderCount > 0 || row.returnOrderCount > 0)
}
