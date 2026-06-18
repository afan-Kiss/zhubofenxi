import type { NormalizedOrder } from '../types/analysis'
import type { AfterSalesWorkbenchRefund } from './xhs-after-sales-workbench.service'

/** 订单主表售后状态：已完成售后（需 returns/v3 核实退款金额） */
export function isCompletedAfterSaleStatusText(text: string | undefined | null): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (/售后完成|退款成功|退货退款成功|已退款|退款完成|平台已退款/.test(t)) return true
  /** 订单列表 afterSaleStatus 枚举：3 = 售后完成（无 Desc 时仅存数字） */
  if (t === '3') return true
  return false
}

/** 主表/订单侧：存在已完成售后信号，需查 returns/v3 */
export function orderSignalsCompletedAfterSale(
  order: Pick<NormalizedOrder, 'afterSaleStatusText' | 'isReturned' | 'orderStatusText'>,
): boolean {
  if (isCompletedAfterSaleStatusText(order.afterSaleStatusText)) return true
  if (order.isReturned) return true
  const combined = [order.orderStatusText, order.afterSaleStatusText].filter(Boolean).join(' ')
  return /售后完成|退款成功|已退款/.test(combined)
}

/** 工作台缓存 empty，但主表显示已有售后完成 → 不可信，需重查 */
export function isStaleEmptyWorkbenchForOrder(
  order: Pick<NormalizedOrder, 'afterSaleStatusText' | 'isReturned' | 'orderStatusText'>,
  workbench?: AfterSalesWorkbenchRefund | null,
): boolean {
  if (!workbench || workbench.fetchStatus !== 'empty') return false
  if (workbench.officialRefundAmountCent > 0 || workbench.successReturnCount > 0) return false
  return orderSignalsCompletedAfterSale(order)
}
