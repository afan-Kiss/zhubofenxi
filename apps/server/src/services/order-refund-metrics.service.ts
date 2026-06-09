import type { AnalyzedOrderView } from '../types/analysis'
import { resolveMetricOrderNo } from './calc-refund-rate.service'

function viewIsPaid(v: AnalyzedOrderView): boolean {
  return v.includedInGmv === true
}

/**
 * 订单级真实商品退款金额（分）— 经营看板 / 主播排行统一
 * 未签收、仅售后信号、0 元售后均返回 0
 */
/**
 * 经营看板退款金额（分）：以 productRefundAmountCent（board 解析）为主，
 * 买家侧 buyerProductRefundAmountCent 仅作补充，不用有效销售额差额推算。
 */
export function resolveViewRefundAmountCent(v: AnalyzedOrderView): number {
  const board = v.productRefundAmountCent ?? 0
  const buyer = v.buyerProductRefundAmountCent ?? 0
  const workbench = v.afterSalesWorkbenchRefundAmountCent ?? 0
  const realAfterSale = v.realAfterSaleAmountCent ?? 0
  const base = Math.max(board, buyer, workbench, realAfterSale)
  const inRange = v.statRangeRefundAmountCent ?? 0
  return Math.max(base, inRange)
}

/** 退款订单：本期已支付且真实退款金额 > 0（按 P 订单号去重） */
export function viewCountsAsRefundOrder(v: AnalyzedOrderView): boolean {
  if (!viewIsPaid(v)) return false
  return resolveViewRefundAmountCent(v) > 0
}

export function aggregateRefundAmountCentByOrderNo(
  views: AnalyzedOrderView[],
): { totalCent: number; byOrderNo: Map<string, number> } {
  const byOrderNo = new Map<string, number>()
  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    const cent = resolveViewRefundAmountCent(v)
    if (cent <= 0) continue
    const prev = byOrderNo.get(no) ?? 0
    byOrderNo.set(no, Math.max(prev, cent))
  }
  let totalCent = 0
  for (const cent of byOrderNo.values()) totalCent += cent
  return { totalCent, byOrderNo }
}
