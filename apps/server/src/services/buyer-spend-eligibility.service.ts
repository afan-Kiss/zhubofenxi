/**
 * 买家排行：消费/高价值客户 eligibility（基于 returns/v3 HAR 口径）
 */
import type { AnalyzedOrderView } from '../types/analysis'
import type { BuyerOrderStandardRow } from './buyer-order-standard.service'
import { resolveBuyerOrderBusinessMetrics } from './resolve-buyer-order-business-metrics.service'

export function viewCountsTowardBuyerSpend(v: AnalyzedOrderView): boolean {
  return resolveBuyerOrderBusinessMetrics(v).isRealDealOrder
}

export function buyerOrderRowCountsTowardSpend(row: BuyerOrderStandardRow): boolean {
  return row.isRealDealOrder && row.realDealAmountCent > 0
}

export function buyerOrderRowCountsTowardRefundRanking(row: BuyerOrderStandardRow): boolean {
  return row.refundAmountCent > 0 && row.afterSaleType !== 'shipping_compensation'
}

export function buyerOrderRowCountsAsReturnCustomer(row: BuyerOrderStandardRow): boolean {
  if (row.afterSaleType === 'shipping_compensation') return false
  if (row.afterSaleType === 'return_refund' && row.refundAmountCent > 0) return true
  return row.refundAmountCent > 0 && row.afterSaleType !== 'refund_only'
}
