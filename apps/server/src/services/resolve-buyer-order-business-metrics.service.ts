/**
 * 买家排行：单笔订单真实成交 / 净额（基于订单主表 + returns/v3 售后，不用 status_name 当成交）
 */
import type { AnalyzedOrderView } from '../types/analysis'
import { isStatusSignedView } from './order-sign-status.service'
import { aggregateClassifiedAfterSalesForOrder } from './classify-after-sale-record.service'
import { resolveOfficialPaidAmountCent } from './resolve-official-paid-amount.service'
import { isUnverifiedCompletedAfterSaleOrder } from './order-product-refund.service'

export interface BuyerOrderBusinessMetrics {
  isPaidOrder: boolean
  isRealDealOrder: boolean
  isCancelledOrder: boolean
  isClosedOrder: boolean
  hasSuccessfulProductRefund: boolean
  hasFreightOnlyRefund: boolean
  hasPendingAfterSale: boolean
  hasUnshippedRefundOnly: boolean
  paidAmountCent: number
  paidAmountSource: string
  realDealAmountCent: number
  netDealAmountCent: number
  productRefundAmountCent: number
  freightRefundAmountCent: number
  excludeFromRealDealReason: string | null
}

const CANCELLED_KEYWORDS = ['已取消', '取消', '交易关闭', '交易取消']
const CLOSED_KEYWORDS = ['已关闭', '交易关闭']
const REAL_DEAL_STATUS_KEYWORDS = ['已完成', '已签收', '交易完成', '已收货', '交易成功', '实际签收']

function orderStatusText(v: AnalyzedOrderView): string {
  return (v.orderStatusText ?? '').trim()
}

function isCancelledOrderStatus(text: string): boolean {
  return CANCELLED_KEYWORDS.some((k) => text.includes(k))
}

function isClosedOrderStatus(text: string): boolean {
  return CLOSED_KEYWORDS.some((k) => text.includes(k))
}

function isRealDealOrderStatus(text: string, v: AnalyzedOrderView): boolean {
  if (v.statusSigned === true || isStatusSignedView(v)) return true
  if (v.isEffectiveSigned === true) return true
  return REAL_DEAL_STATUS_KEYWORDS.some((k) => text.includes(k))
}

function pickPaidCent(v: AnalyzedOrderView & { raw?: Record<string, unknown> }): {
  cent: number
  source: string
} {
  const resolved = resolveOfficialPaidAmountCent(v)
  if (resolved.cent > 0 && resolved.confirmed) {
    return { cent: resolved.cent, source: resolved.source }
  }
  const pipelinePaid = v.officialPaidAmountCent ?? v.statPaidAmountCent ?? 0
  if (pipelinePaid > 0 && (v.officialPaidConfirmed ?? true)) {
    return { cent: pipelinePaid, source: 'analysis_pipeline_paid' }
  }
  return { cent: resolved.cent, source: resolved.source }
}

function viewHasUnshippedRefundOnly(v: AnalyzedOrderView, productRefundCent: number): boolean {
  if (productRefundCent <= 0) return false
  const combined = [
    v.afterSaleDisplayType,
    v.afterSalesWorkbenchReason,
    v.finalAfterSaleReason,
    v.afterSaleStatusText,
    v.reasonText,
    v.afterSaleCategory,
  ]
    .filter(Boolean)
    .join(' ')
  if (combined.includes('未发货仅退款')) return true
  if (v.isRefundOnly && !isRealDealOrderStatus(orderStatusText(v), v)) {
    if (!v.isEffectiveSigned && !v.isSigned && !v.statusSigned) return true
  }
  return false
}

/** 订单 + 该单售后 records → 买家排行业务指标 */
export function resolveBuyerOrderBusinessMetrics(
  order: AnalyzedOrderView & { raw?: Record<string, unknown> },
  afterSalesForOrder?: Record<string, unknown>[],
): BuyerOrderBusinessMetrics {
  const status = orderStatusText(order)
  const paid = pickPaidCent(order)
  const paidAmountCent = paid.cent
  const isPaidOrder = paidAmountCent > 0
  const isCancelledOrder = isCancelledOrderStatus(status)
  const isClosedOrder = isClosedOrderStatus(status)
  const orderFreightCent = order.freightCent ?? 0

  const fromAfterSales =
    afterSalesForOrder?.length ?
      aggregateClassifiedAfterSalesForOrder(afterSalesForOrder, { orderFreightCent })
    : null

  let productRefundAmountCent =
    fromAfterSales?.productRefundAmountCent ??
    (order.isFreightRefundOnly ? 0 : order.buyerProductRefundAmountCent ?? 0)
  let freightRefundAmountCent =
    fromAfterSales?.freightRefundAmountCent ??
    (order.isFreightRefundOnly ? order.freightRefundAmountCent ?? 0 : 0)

  if (!fromAfterSales && order.isFreightRefundOnly) {
    productRefundAmountCent = 0
    freightRefundAmountCent = Math.max(freightRefundAmountCent, order.freightRefundAmountCent ?? 0)
  }

  const hasSuccessfulProductRefund = productRefundAmountCent > 0
  const hasFreightOnlyRefund =
    (fromAfterSales?.hasFreightOnlyRefund ?? order.isFreightRefundOnly === true) &&
    freightRefundAmountCent > 0 &&
    productRefundAmountCent === 0
  const hasPendingAfterSale =
    fromAfterSales?.hasPendingAfterSale ??
    order.buyerProductRefundSource === 'after_sales_workbench_pending'
  const hasUnshippedRefundOnly =
    fromAfterSales?.hasUnshippedRefundOnly ??
    viewHasUnshippedRefundOnly(order, productRefundAmountCent)

  let excludeFromRealDealReason: string | null = null

  if (!isPaidOrder) {
    excludeFromRealDealReason = '未支付'
  } else if (isCancelledOrder) {
    excludeFromRealDealReason = '订单已取消'
  } else if (isClosedOrder) {
    excludeFromRealDealReason = '订单已关闭'
  } else if (hasUnshippedRefundOnly) {
    excludeFromRealDealReason = '未发货仅退款'
  } else if (hasPendingAfterSale) {
    excludeFromRealDealReason = '售后金额待同步'
  } else if (
    isUnverifiedCompletedAfterSaleOrder(order, order.buyerProductRefundSource) &&
    productRefundAmountCent <= 0
  ) {
    excludeFromRealDealReason = '售后完成待核实'
  } else if (!isRealDealOrderStatus(status, order)) {
    excludeFromRealDealReason = '订单未完成/未签收'
  } else if (hasSuccessfulProductRefund && productRefundAmountCent >= paidAmountCent) {
    excludeFromRealDealReason = '商品全额退款'
  }

  const isRealDealOrder = excludeFromRealDealReason == null && isPaidOrder
  const netDealAmountCent = isRealDealOrder
    ? Math.max(0, paidAmountCent - productRefundAmountCent)
    : 0
  const realDealAmountCent = isRealDealOrder ? netDealAmountCent : 0

  return {
    isPaidOrder,
    isRealDealOrder,
    isCancelledOrder,
    isClosedOrder,
    hasSuccessfulProductRefund,
    hasFreightOnlyRefund,
    hasPendingAfterSale,
    hasUnshippedRefundOnly,
    paidAmountCent,
    paidAmountSource: paid.source,
    realDealAmountCent,
    netDealAmountCent,
    productRefundAmountCent,
    freightRefundAmountCent,
    excludeFromRealDealReason,
  }
}
