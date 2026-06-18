import type { NormalizedOrder } from '../types/analysis'
import type { AfterSaleClassification } from './after-sale-classification.service'
import {
  canSkipAfterSalesWorkbenchFetch,
  shouldFetchAfterSalesWorkbench,
  shouldFetchInputFromNormalizedOrder,
} from './after-sales-fetch-decision.service'
import { pickPaymentBaseCent } from './order-amount-metrics.service'
import {
  FREIGHT_REFUND_CENT,
  isFreightOnlyRefund,
} from './business-refund-caliber.service'
import { parseMoneyToCent } from '../utils/money'
import {
  isCompletedAfterSaleStatusText,
  isStaleEmptyWorkbenchForOrder,
} from './completed-after-sale-status.service'
import type { AfterSalesWorkbenchRefund } from './xhs-after-sales-workbench.service'

export type OrderRefundAmountSource =
  | 'none'
  | 'no_after_sale'
  | 'after_sales_workbench'
  | 'after_sales_workbench_expected'
  | 'after_sales_workbench_applied'
  | 'after_sales_workbench_pending'
  | 'after_sales_workbench_no_record'
  | 'after_sales_workbench_zero_refund'
  | 'raw_product_refund'
  | 'raw_refund_amount'
  | 'raw_after_sale_refund'
  | 'settlement'
  | 'capped_to_payment'
  /** 订单列表已取消/已关闭且售后完成，工作台无明细时按实付兜底 */
  | 'order_closed_after_sale_complete'

export interface OrderProductRefundResolved {
  productRefundAmountCent: number
  freightRefundAmountCent: number
  refundAmountSource: OrderRefundAmountSource
  refundAmountWarning: string | null
  refundIncludesFreight: boolean
  afterSalesWorkbenchRefundAmountCent?: number
}

function pickNestedCent(obj: unknown, keys: string[]): number {
  if (obj == null || typeof obj !== 'object') return 0
  const rec = obj as Record<string, unknown>
  for (const k of keys) {
    const v = rec[k]
    if (v == null || v === '') continue
    const parsed = parseMoneyToCent(v)
    if (parsed.ok && parsed.cent > 0) return parsed.cent
  }
  return 0
}

/** 从订单原始 JSON 读取商品退款金额（分），不使用 pay_amount / settlement_amount */
function pickRawOrderProductRefundCent(
  order: NormalizedOrder,
): { cent: number; source: OrderRefundAmountSource } | null {
  const raw = order.raw
  const flat: Array<[string[], OrderRefundAmountSource]> = [
    [
      [
        'actualRefundAmount',
        'actual_refund_amount',
        'afterSaleRefundAmount',
        'after_sale_refund_amount',
        'applyRefundAmount',
        'goodsRefundAmount',
        'returnRefundAmount',
        'refundFee',
        'refund_fee',
        'productRefundFee',
        'refundAmountCent',
      ],
      'raw_after_sale_refund',
    ],
    [['productRefundAmount', 'product_refund_amount', 'productRefundAmt'], 'raw_product_refund'],
    [['refundAmount', 'refund_amount', 'refundAmt'], 'raw_refund_amount'],
  ]
  for (const [keys, source] of flat) {
    const cent = pickNestedCent(raw, keys)
    if (cent > 0) return { cent, source }
  }
  const afterSale = raw.afterSaleInfo ?? raw.after_sale_info ?? raw.afterSale
  if (afterSale && typeof afterSale === 'object') {
    const cent = pickNestedCent(afterSale, [
      'actualRefundAmount',
      'refundAmount',
      'refund_amount',
      'productRefundAmount',
      'afterSaleRefundAmount',
    ])
    if (cent > 0) return { cent, source: 'raw_after_sale_refund' }
  }
  return null
}

function capProductRefundToPayment(
  productCent: number,
  paymentBaseCent: number,
  source: OrderRefundAmountSource,
): { cent: number; source: OrderRefundAmountSource; warning: string | null } {
  if (paymentBaseCent <= 0 || productCent <= paymentBaseCent) {
    return { cent: productCent, source, warning: null }
  }
  return {
    cent: paymentBaseCent,
    source: 'capped_to_payment',
    warning: `订单退款金额超过支付金额，已按支付金额 ${(paymentBaseCent / 100).toFixed(2)} 元展示`,
  }
}

function pickFromWorkbench(
  workbench: AfterSalesWorkbenchRefund,
  order?: Pick<NormalizedOrder, 'afterSaleStatusText' | 'isReturned' | 'orderStatusText'>,
): { cent: number; source: OrderRefundAmountSource } | null {
  if (order && isStaleEmptyWorkbenchForOrder(order, workbench)) {
    return null
  }
  if (workbench.fetchStatus === 'success' && workbench.officialRefundAmountCent > 0) {
    return { cent: workbench.officialRefundAmountCent, source: 'after_sales_workbench' }
  }
  if (workbench.fetchStatus === 'success' && workbench.expectedRefundAmountCent > 0) {
    return { cent: workbench.expectedRefundAmountCent, source: 'after_sales_workbench_expected' }
  }
  if (workbench.fetchStatus === 'success' && workbench.appliedAmountCent > 0) {
    return { cent: workbench.appliedAmountCent, source: 'after_sales_workbench_applied' }
  }
  if (workbench.fetchStatus === 'empty') {
    return { cent: 0, source: 'after_sales_workbench_no_record' }
  }
  if (workbench.fetchStatus === 'success') {
    return { cent: 0, source: 'after_sales_workbench_zero_refund' }
  }
  return null
}

export function isClosedOrderWithCompletedAfterSale(order: NormalizedOrder): boolean {
  const orderText = (order.orderStatusText ?? '').trim()
  const afterText = (order.afterSaleStatusText ?? '').trim()
  if (!orderText || !afterText) return false
  if (!/已取消|已关闭|交易关闭/.test(orderText)) return false
  return isCompletedAfterSaleStatusText(afterText)
}

/** 主表显示售后完成，但尚无 API 已核实的退款结果 */
export function isUnverifiedCompletedAfterSaleOrder(
  order: Pick<NormalizedOrder, 'afterSaleStatusText'> & { isReturned?: boolean },
  resolvedRefundSource?: string | null,
): boolean {
  if (!isCompletedAfterSaleStatusText(order.afterSaleStatusText)) {
    if (!order.isReturned) return false
  }
  const src = (resolvedRefundSource ?? '').trim()
  if (
    src === 'after_sales_workbench' ||
    src === 'after_sales_workbench_expected' ||
    src === 'after_sales_workbench_applied' ||
    src === 'after_sales_workbench_zero_refund' ||
    src === 'order_closed_after_sale_complete' ||
    src === 'settlement' ||
    src === 'raw_product_refund' ||
    src === 'raw_refund_amount' ||
    src === 'raw_after_sale_refund' ||
    src === 'capped_to_payment'
  ) {
    return false
  }
  return true
}

export {
  isCompletedAfterSaleStatusText,
  isStaleEmptyWorkbenchForOrder,
  orderSignalsCompletedAfterSale,
} from './completed-after-sale-status.service'

function hasAfterSaleRefundSignal(
  order: NormalizedOrder,
  classification: AfterSaleClassification,
): boolean {
  const text = [order.orderStatusText, order.afterSaleStatusText].filter(Boolean).join(' ')
  return (
    classification.isReturnRefund ||
    classification.isRefundOnly ||
    classification.afterSaleClosedNoRefund ||
    order.isReturned ||
    /退款|退货|售后/.test(text)
  )
}

/**
 * 买家侧订单商品退款：优先售后工作台 refund_fee，禁止 payAmount / receivable 兜底
 */
export function resolveOrderProductRefund(
  order: NormalizedOrder,
  classification: AfterSaleClassification,
  settlementRefundCent: number,
  workbench?: AfterSalesWorkbenchRefund | null,
  opts?: { buyerStrict?: boolean },
): OrderProductRefundResolved {
  const { cent: paymentBaseCent } = pickPaymentBaseCent(order)
  let warning: string | null = null
  let refundIncludesFreight = false
  const fetchInput = {
    ...shouldFetchInputFromNormalizedOrder(order),
    isReturnRefund: classification.isReturnRefund,
    isRefundOnly: classification.isRefundOnly,
    isFreightRefundOnly: classification.isFreightRefundOnly,
    afterSaleClosedNoRefund: classification.afterSaleClosedNoRefund,
    isReturned: classification.isReturnRefund || classification.countsAsProductRefund,
  }

  if (opts?.buyerStrict && canSkipAfterSalesWorkbenchFetch(fetchInput)) {
    if (!isClosedOrderWithCompletedAfterSale(order)) {
      return {
        productRefundAmountCent: 0,
        freightRefundAmountCent: 0,
        refundAmountSource: 'no_after_sale',
        refundAmountWarning: null,
        refundIncludesFreight: false,
      }
    }
  }

  if (opts?.buyerStrict && !shouldFetchAfterSalesWorkbench(fetchInput)) {
    if (!isClosedOrderWithCompletedAfterSale(order)) {
      return {
        productRefundAmountCent: 0,
        freightRefundAmountCent: 0,
        refundAmountSource: 'no_after_sale',
        refundAmountWarning: null,
        refundIncludesFreight: false,
      }
    }
  }

  if (classification.isFreightRefundOnly) {
    const freight = Math.min(
      classification.freightRefundAmountCent,
      paymentBaseCent || classification.freightRefundAmountCent,
    )
    return {
      productRefundAmountCent: 0,
      freightRefundAmountCent: freight,
      refundAmountSource: 'none',
      refundAmountWarning: null,
      refundIncludesFreight: false,
    }
  }

  let productCent = 0
  let source: OrderRefundAmountSource = 'none'
  let workbenchCent = 0

  const mustFetchWorkbench = shouldFetchAfterSalesWorkbench(fetchInput)
  const completedAfterSaleUnverified = isUnverifiedCompletedAfterSaleOrder(
    order,
    undefined,
  )
  const staleEmptyWorkbench = workbench ? isStaleEmptyWorkbenchForOrder(order, workbench) : false

  if (workbench) {
    const wbPick = pickFromWorkbench(workbench, order)
    if (wbPick) {
      productCent = wbPick.cent
      source = wbPick.source
      workbenchCent = wbPick.cent
      refundIncludesFreight = workbench.refundIncludesFreight
    } else if (
      workbench.fetchStatus === 'pending' ||
      workbench.fetchStatus === 'failed' ||
      staleEmptyWorkbench
    ) {
      warning = '售后金额待同步'
      source = 'after_sales_workbench_pending'
    }
  } else if (
    mustFetchWorkbench &&
    (hasAfterSaleRefundSignal(order, classification) || completedAfterSaleUnverified)
  ) {
    warning = '售后金额待同步'
    source = 'after_sales_workbench_pending'
  }

  const allowRawFallback =
    !opts?.buyerStrict &&
    !mustFetchWorkbench &&
    !completedAfterSaleUnverified
  if (productCent <= 0 && allowRawFallback) {
    const rawPick = pickRawOrderProductRefundCent(order)
    if (rawPick) {
      productCent = rawPick.cent
      source = rawPick.source
    } else if (settlementRefundCent > 0) {
      productCent = settlementRefundCent
      source = 'settlement'
    }
  }

  if (
    productCent <= 0 &&
    source !== 'after_sales_workbench_no_record' &&
    source !== 'after_sales_workbench_zero_refund' &&
    source !== 'no_after_sale' &&
    (hasAfterSaleRefundSignal(order, classification) || completedAfterSaleUnverified) &&
    (!workbench ||
      workbench.fetchStatus === 'failed' ||
      workbench.fetchStatus === 'pending' ||
      staleEmptyWorkbench)
  ) {
    warning = warning ?? '售后金额待同步'
    source = 'after_sales_workbench_pending'
  }

  if (
    productCent <= 0 &&
    !classification.isFreightRefundOnly &&
    isClosedOrderWithCompletedAfterSale(order) &&
    paymentBaseCent > 0
  ) {
    productCent = paymentBaseCent
    source = 'order_closed_after_sale_complete'
    warning = null
  }

  const capped = capProductRefundToPayment(productCent, paymentBaseCent, source)
  if (capped.warning) warning = capped.warning

  let finalProductCent = capped.cent
  const orderRaw = order.raw as Record<string, unknown>
  if (
    finalProductCent > 0 &&
    isFreightOnlyRefund(orderRaw, finalProductCent)
  ) {
    finalProductCent = 0
  } else if (
    finalProductCent === FREIGHT_REFUND_CENT &&
    paymentBaseCent > FREIGHT_REFUND_CENT * 5 &&
    isFreightOnlyRefund(orderRaw, finalProductCent)
  ) {
    finalProductCent = 0
  }

  return {
    productRefundAmountCent: finalProductCent,
    freightRefundAmountCent:
      refundIncludesFreight && workbench && workbench.appliedShipFeeAmountCent > 0
        ? workbench.appliedShipFeeAmountCent
        : 0,
    refundAmountSource: capped.source,
    refundAmountWarning: warning,
    refundIncludesFreight,
    afterSalesWorkbenchRefundAmountCent: workbenchCent > 0 ? workbenchCent : undefined,
  }
}
