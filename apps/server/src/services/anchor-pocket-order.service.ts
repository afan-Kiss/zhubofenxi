import type { AnalyzedOrderView } from '../types/analysis'
import { centToYuan } from '../utils/money'
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import {
  LOW_PRICE_BRUSH_THRESHOLD_CENT,
  resolvePaymentBaseCentForBrushCheck,
} from './low-price-brush-order.service'
import { isStatusSignedView } from './order-sign-status.service'
import type { AfterSalesWorkbenchRefund } from './xhs-after-sales-workbench.service'
import {
  isAfterSalesResultPending,
  shouldFetchAfterSalesWorkbench,
  shouldFetchInputFromView,
} from './after-sales-fetch-decision.service'

const PROCESSING_AFTER_SALE_RE =
  /售后处理中|待商家收货|待买家退货|退款中|退货退款中|待平台介入|售后中|待审核|进行中/

const SUCCESS_AFTER_SALE_RE = /退款成功|售后完成|已退款|退款完成|退货退款成功/

export interface AnchorPocketOrderLine {
  orderNo: string
  shopName: string
  anchorName: string
  sessionName: string
  paidAmountCent: number
  isBrushOrder: boolean
  isClosedOrCanceled: boolean
  isPendingReceive: boolean
  isRefundProcessing: boolean
  refundFinishedAmountCent: number
  performanceAmountCent: number
  refundProcessingAmountCent: number
  pendingReceiveAmountCent: number
  brushAmountCent: number
  actualPocketAmountCent: number
  afterSalesDataPending: boolean
  explain: string
}

export function isBrushOrderPaidCent(paidCent: number): boolean {
  return paidCent > 0 && paidCent < LOW_PRICE_BRUSH_THRESHOLD_CENT
}

export function isClosedOrCanceledOrderView(v: AnalyzedOrderView): boolean {
  const text = (v.orderStatusText ?? '').trim()
  return /已取消|已关闭|交易关闭/.test(text)
}

export function isPendingReceiveOrderView(v: AnalyzedOrderView): boolean {
  if (!v.includedInGmv) return false
  if (isClosedOrCanceledOrderView(v)) return false
  return !isStatusSignedView(v)
}

export function isRefundProcessingOrderView(
  v: AnalyzedOrderView,
  workbench?: AfterSalesWorkbenchRefund | null,
): boolean {
  if (v.buyerProductRefundSource === 'after_sales_workbench_pending') return true
  const afterSale = [v.afterSaleStatusText, v.afterSaleStatusLabel, v.afterSaleDisplayType]
    .filter(Boolean)
    .join(' ')
  if (!afterSale) {
    if (workbench?.fetchStatus === 'pending') return true
    return false
  }
  if (SUCCESS_AFTER_SALE_RE.test(afterSale) && !PROCESSING_AFTER_SALE_RE.test(afterSale)) {
    return false
  }
  return PROCESSING_AFTER_SALE_RE.test(afterSale)
}

/** 已完成退款（分）：工作台累计优先，多来源取大值后封顶到支付金额 */
export function resolveRefundFinishedAmountCent(
  paidCent: number,
  v: AnalyzedOrderView,
  workbench?: AfterSalesWorkbenchRefund | null,
): number {
  if (paidCent <= 0) return 0
  let cent = 0
  if (workbench?.fetchStatus === 'success') {
    cent = Math.max(cent, workbench.officialRefundAmountCent ?? 0)
  }
  cent = Math.max(
    cent,
    v.productRefundAmountCent ?? 0,
    v.realAfterSaleAmountCent ?? 0,
    v.afterSalesWorkbenchRefundAmountCent ?? 0,
    v.successfulRefundAmountCent ?? 0,
    v.statRangeRefundAmountCent ?? 0,
  )
  if (cent <= 0 && SUCCESS_AFTER_SALE_RE.test(v.afterSaleStatusText ?? '')) {
    cent = Math.max(cent, v.productRefundAmountCent ?? 0)
  }
  return Math.min(Math.max(0, cent), paidCent)
}

export function classifyAnchorPocketOrder(params: {
  view: AnalyzedOrderView & { raw?: Record<string, unknown> }
  shopName: string
  sessionName: string
  workbench?: AfterSalesWorkbenchRefund | null
}): AnchorPocketOrderLine | null {
  const { view, shopName, sessionName, workbench } = params
  if (!view.includedInGmv) return null

  const orderNo = resolveMetricOrderNo(view) || view.displayOrderNo || view.orderId
  const paidCent = resolvePaymentBaseCentForBrushCheck(view)
  if (paidCent <= 0) return null

  const anchorName = view.anchorName?.trim() || '未归属'
  const base = {
    orderNo,
    shopName,
    anchorName,
    sessionName,
    paidAmountCent: paidCent,
    isBrushOrder: false,
    isClosedOrCanceled: false,
    isPendingReceive: false,
    isRefundProcessing: false,
    refundFinishedAmountCent: 0,
    performanceAmountCent: 0,
    refundProcessingAmountCent: 0,
    pendingReceiveAmountCent: 0,
    brushAmountCent: 0,
    actualPocketAmountCent: 0,
    afterSalesDataPending: false,
    explain: '',
  }

  const fetchInput = shouldFetchInputFromView(view)
  const needsWorkbench = shouldFetchAfterSalesWorkbench(fetchInput)
  const afterSalesPending =
    needsWorkbench &&
    isAfterSalesResultPending(fetchInput, workbench, view.buyerProductRefundSource)

  if (isBrushOrderPaidCent(paidCent)) {
    return {
      ...base,
      isBrushOrder: true,
      brushAmountCent: paidCent,
      explain: `支付金额 ${centToYuan(paidCent)} 元低于 ¥29，按刷单剔除，不计入业绩与实际到账`,
    }
  }

  const performanceAmountCent = paidCent
  const refundFinishedAmountCent = resolveRefundFinishedAmountCent(paidCent, view, workbench)

  if (isClosedOrCanceledOrderView(view)) {
    return {
      ...base,
      performanceAmountCent,
      refundFinishedAmountCent,
      isClosedOrCanceled: true,
      afterSalesDataPending: afterSalesPending,
      explain: '订单已关闭或取消，不计入实际到账',
    }
  }

  if (isPendingReceiveOrderView(view)) {
    return {
      ...base,
      performanceAmountCent,
      refundFinishedAmountCent,
      isPendingReceive: true,
      pendingReceiveAmountCent: paidCent,
      afterSalesDataPending: afterSalesPending,
      explain: '订单未签收或待确认收货，暂不计入实际到账',
    }
  }

  if (isRefundProcessingOrderView(view, workbench)) {
    return {
      ...base,
      performanceAmountCent,
      refundFinishedAmountCent,
      isRefundProcessing: true,
      refundProcessingAmountCent: paidCent,
      afterSalesDataPending: afterSalesPending,
      explain: '售后处理中，暂不计入实际到账',
    }
  }

  if (isStatusSignedView(view)) {
    const actualPocketAmountCent = Math.min(
      paidCent,
      Math.max(0, paidCent - refundFinishedAmountCent),
    )
    return {
      ...base,
      performanceAmountCent,
      refundFinishedAmountCent,
      actualPocketAmountCent,
      afterSalesDataPending: afterSalesPending,
      explain:
        refundFinishedAmountCent > 0
          ? `已签收，扣除已完成退款 ${centToYuan(refundFinishedAmountCent)} 元后实际到账 ${centToYuan(actualPocketAmountCent)} 元`
          : `已签收且无已完成退款，实际到账 ${centToYuan(actualPocketAmountCent)} 元`,
    }
  }

  return {
    ...base,
    performanceAmountCent,
    refundFinishedAmountCent,
    isPendingReceive: true,
    pendingReceiveAmountCent: paidCent,
    afterSalesDataPending: afterSalesPending,
    explain: '订单状态未确认签收，暂不计入实际到账',
  }
}
