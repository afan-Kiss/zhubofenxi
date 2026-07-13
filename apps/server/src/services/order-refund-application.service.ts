import type { AnalyzedOrderView } from '../types/analysis'
import { isFreightCompensationByAmountCent } from './business-refund-caliber.service'
import {
  isOperationalAfterSaleText,
  resolveAfterSaleStatusCombinedText,
} from './after-sale-status-signal.service'

/** 买家撤销售后 / 售后关闭无退款（最终结果无退货退款） */
const AFTER_SALE_CANCELLED_RE =
  /售后取消|买家取消售后|客户取消售后|售后已取消|用户取消|用户撤销|撤销售后|关闭售后|售后关闭|关闭无退款|退款关闭|已撤销|已关闭售后|取消申请/

/** 申请中或处理中的售后（含仅退款、退货退款；物流在途也算） */
const PENDING_AFTER_SALE_RE =
  /待审核|处理中|待退货|待退款|待商家|待买家|待平台|待寄回|待收货|待用户|退款中|退货退款中|申请退货|需要寄回|买家已退货|商家待收货|待买家退货/

function viewIsPaid(v: AnalyzedOrderView): boolean {
  return v.includedInGmv === true
}

function combinedStatusTextFromParts(
  ...parts: Array<string | null | undefined>
): string {
  return parts.filter(Boolean).join(' ')
}

/** 申请售后后又取消 / 关闭且无退款（最终结果无退货退款） */
export function isAfterSaleCancelledSignal(input: {
  afterSaleCancelled?: boolean
  afterSaleClosedNoRefund?: boolean
  orderStatusText?: string | null
  afterSaleStatusText?: string | null
  afterSaleStatusLabel?: string | null
  afterSaleDisplayType?: string | null
}): boolean {
  if (input.afterSaleCancelled === true) return true
  if (input.afterSaleClosedNoRefund === true) return true
  const text = combinedStatusTextFromParts(
    input.orderStatusText,
    input.afterSaleStatusText,
    input.afterSaleStatusLabel,
    input.afterSaleDisplayType,
  )
  if (!text) return false
  return AFTER_SALE_CANCELLED_RE.test(text)
}

/** 申请售后后又取消 / 关闭且无退款 */
export function viewAfterSaleCancelled(v: AnalyzedOrderView): boolean {
  return isAfterSaleCancelledSignal({
    afterSaleCancelled: v.afterSaleCancelled,
    afterSaleClosedNoRefund: v.afterSaleClosedNoRefund,
    orderStatusText: v.orderStatusText,
    afterSaleStatusText: v.afterSaleStatusText,
    afterSaleStatusLabel: v.afterSaleStatusLabel,
    afterSaleDisplayType: v.afterSaleDisplayType,
  })
}

/** 申请中或处理中的退货退款（不含仅退款） */
const RETURN_REFUND_APPLICATION_RE =
  /退货退款|待买家退货|待商家收货|退货退款中|申请退货|需要寄回|待寄回|买家已退货|商家待收货/

function viewPendingAfterSaleAmountCent(v: AnalyzedOrderView): number {
  return Math.max(
    v.afterSalesWorkbenchRefundAmountCent ?? 0,
    v.returnAmountCent ?? 0,
    v.realAfterSaleAmountCent ?? 0,
    v.productRefundAmountCent ?? 0,
  )
}

function viewIsFreightCompensationPending(v: AnalyzedOrderView): boolean {
  if (v.isFreightRefundOnly) return true
  const pendingCent = viewPendingAfterSaleAmountCent(v)
  return pendingCent > 0 && isFreightCompensationByAmountCent(pendingCent)
}

function combinedOperationalStatusText(v: AnalyzedOrderView): string {
  return [v.orderStatusText, resolveAfterSaleStatusCombinedText(v)].filter(Boolean).join(' ')
}

/** 已申请退货退款且未取消（含处理中、待寄回；不要求已发生退款金额） */
export function viewHasActiveReturnRefundApplication(v: AnalyzedOrderView): boolean {
  if (!viewIsPaid(v)) return false
  if (v.isFreightRefundOnly) return false
  if (viewAfterSaleCancelled(v)) return false
  if (v.isReturnRefundOrder || v.isReturnRefund) return true
  if (v.hasReturnRefundApplication) return true
  const text = combinedOperationalStatusText(v)
  if (!text) return false
  if (/仅退款|未发货仅退款|已发货仅退款/.test(text) && !/退货/.test(text)) return false
  if (RETURN_REFUND_APPLICATION_RE.test(text)) return true
  if (/售后中|售后处理中|售后申请/.test(text) && /退货/.test(text)) return true
  return false
}

/**
 * 已申请售后且未取消（含仅退款/退货退款/售后中；物流在途也算，不要求已退款成功）
 * ≤ ¥20 已知金额视为运费补偿，不计入
 */
export function viewHasActiveAfterSaleApplication(v: AnalyzedOrderView): boolean {
  if (!viewIsPaid(v)) return false
  if (viewAfterSaleCancelled(v)) return false
  if (v.afterSaleClosedNoRefund) return false
  if (viewIsFreightCompensationPending(v)) return false

  if (v.hasReturnRefundApplication || v.hasRefundOnlyApplication) return true
  if (v.isReturnRefundOrder || v.isReturnRefund) return true
  if (v.isRefundOnlyOrder || v.isRefundOnly) return true

  const text = combinedOperationalStatusText(v)
  if (!text) return false
  if (/仅退运费|运费补偿|退运费|邮费退款/.test(text)) return false

  if (RETURN_REFUND_APPLICATION_RE.test(text)) return true

  if (/仅退款|未发货仅退款|已发货仅退款/.test(text)) {
    if (
      PENDING_AFTER_SALE_RE.test(text) ||
      /售后中|售后处理中|售后申请|退款中/.test(text)
    ) {
      return true
    }
  }

  if (PENDING_AFTER_SALE_RE.test(text)) return true

  const afterSaleText = resolveAfterSaleStatusCombinedText(v)
  const statusProbe = afterSaleText || (v.orderStatusText ?? '').trim()
  if (!statusProbe || /售后关闭无退款|关闭无退款/.test(text)) return false
  if (/售后中|售后处理中|售后申请/.test(text)) return true
  return isOperationalAfterSaleText(statusProbe) && PENDING_AFTER_SALE_RE.test(text)
}
