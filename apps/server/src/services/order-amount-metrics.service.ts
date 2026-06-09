import type { NormalizedOrder } from '../types/analysis'
import type { AfterSaleClassification } from './after-sale-classification.service'
import { parseMoneyToCent } from '../utils/money'

/** 全站统一金额公式版本（看板 / 买家排行 / 导出 / 调试接口共用） */
export const AMOUNT_FORMULA_VERSION = 'v4-gmv-seller-receive-2026-05'

/** 支付金额优先使用商家应收金额 */
export const GMV_PAYMENT_FIELD_NOTE =
  '支付金额 = 统计时间内已支付订单的支付金额合计（不扣退款）；已支付后退款/取消仍计入；支付基数优先取商家应收金额，其次实付、用户应付、商品金额'

const CANCEL_STATUS_CODES = new Set([998, '998'])
const CANCEL_KEYWORDS = ['已取消', '取消', '交易关闭', 'closed', '已关闭']
const UNPAID_KEYWORDS = ['待付款', '未支付', '待支付']

export interface OrderAmountMetrics {
  paymentBaseCent: number
  paymentBaseSource: string
  effectiveGmvCent: number
  actualSignedAmountCent: number
  includedInGmv: boolean
  countsForSigned: boolean
  countsForGrossProfit: boolean
  gmvExcludeReason: string | null
  refundType: 'none' | 'full_refund' | 'partial_refund' | 'return_unpriced'
}

export function isOrderCancelled(order: NormalizedOrder): boolean {
  const raw = order.raw
  const statusCode = raw.status ?? raw.orderStatus
  if (statusCode != null && CANCEL_STATUS_CODES.has(statusCode as number | string)) {
    return true
  }
  const text = [order.orderStatusText, String(raw.statusDesc ?? '')].filter(Boolean).join(' ')
  return CANCEL_KEYWORDS.some((k) => text.includes(k))
}

/** 有支付时间字段（官方支付订单数口径） */
export function hasOrderPaymentTime(order: NormalizedOrder): boolean {
  return (
    order.paymentTime != null && !Number.isNaN(order.paymentTime.getTime())
  )
}

export function isOrderUnpaid(order: NormalizedOrder): boolean {
  const text = [order.orderStatusText, String(order.raw.statusDesc ?? '')].filter(Boolean).join(' ')
  if (UNPAID_KEYWORDS.some((k) => text.includes(k))) return true
  const paid =
    order.actualPaidCent > 0 ||
    order.receivableAmountCent > 0 ||
    order.actualSellerReceiveAmountCent > 0
  return !paid && order.gmvCent <= 0
}

/** 买家 Drawer：应收 = 商品金额 + 运费（理论应收，非真实支付） */
export function pickBuyerReceivableAmountCent(order: NormalizedOrder): number {
  const product = order.productAmountCent || order.gmvCent || 0
  const freight = order.freightCent || 0
  if (product > 0 || freight > 0) return product + freight
  return order.receivableAmountCent || 0
}

const OFFICIAL_PAID_RAW_KEYS = [
  'actualPaid',
  'actualPaidWithoutDeposit',
  'actual_paid',
  'paidAmount',
  'payAmount',
  'paymentAmount',
  'orderPaidAmount',
  'buyerPayAmount',
  'realPayAmount',
  'statisticsPaidAmount',
]

function pickCentFromRaw(raw: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = raw[k]
    if (v == null || v === '') continue
    const parsed = parseMoneyToCent(v)
    if (parsed.ok && parsed.cent > 0) return parsed.cent
  }
  return 0
}

/**
 * 官方真实已支付金额（买家侧专用）
 * 禁止用商家应收 / 商品+运费 兜底为支付金额
 */
export function pickOfficialPaidAmountCent(order: NormalizedOrder): {
  cent: number
  source: string
  confirmed: boolean
} {
  if (order.actualPaidCent > 0) {
    return { cent: order.actualPaidCent, source: 'actualPaid', confirmed: true }
  }
  const raw = order.raw
  if (raw && typeof raw === 'object') {
    const fromRaw = pickCentFromRaw(raw as Record<string, unknown>, OFFICIAL_PAID_RAW_KEYS)
    if (fromRaw > 0) {
      return { cent: fromRaw, source: 'rawPaid', confirmed: true }
    }
    const skus = raw.skus
    if (Array.isArray(skus) && skus.length > 0) {
      for (const row of skus) {
        if (!row || typeof row !== 'object') continue
        const skuPaid = pickCentFromRaw(row as Record<string, unknown>, [
          'paidAmount',
          'payAmount',
          'skuPayAmount',
        ])
        if (skuPaid > 0) {
          return { cent: skuPaid, source: 'skuPaidAmount', confirmed: true }
        }
      }
    }
  }
  return { cent: 0, source: 'none', confirmed: false }
}

/** 支付基数：商家应收 > 实付 > 用户应付 > 商品金额 */
export function pickPaymentBaseCent(order: NormalizedOrder): { cent: number; source: string } {
  if (order.actualSellerReceiveAmountCent > 0) {
    return { cent: order.actualSellerReceiveAmountCent, source: 'sellerReceive' }
  }
  if (order.actualPaidCent > 0) {
    return { cent: order.actualPaidCent, source: 'actualPaid' }
  }
  if (order.receivableAmountCent > 0) {
    return { cent: order.receivableAmountCent, source: 'receivable' }
  }
  if (order.gmvCent > 0) {
    return { cent: order.gmvCent, source: 'productGmv' }
  }
  return { cent: 0, source: 'none' }
}

export function computeOrderAmountMetrics(
  order: NormalizedOrder,
  classification: AfterSaleClassification,
): OrderAmountMetrics {
  const { cent: paymentBaseCent, source: paymentBaseSource } = pickPaymentBaseCent(order)
  const productRefundCent = classification.productRefundAmountCent
  const freightRefundCent = classification.freightRefundAmountCent
  const totalDeductCent = productRefundCent + freightRefundCent

  if (isOrderUnpaid(order)) {
    return {
      paymentBaseCent,
      paymentBaseSource,
      effectiveGmvCent: 0,
      actualSignedAmountCent: 0,
      includedInGmv: false,
      countsForSigned: false,
      countsForGrossProfit: false,
      gmvExcludeReason: '未支付订单不计入支付金额',
      refundType: 'none',
    }
  }

  let effectiveGmvCent = paymentBaseCent
  let refundType: OrderAmountMetrics['refundType'] = 'none'
  let gmvExcludeReason: string | null = null

  if (classification.isReturnRefund || classification.countsAsProductRefund) {
    if (productRefundCent <= 0 && classification.isReturnRefund) {
      effectiveGmvCent = 0
      refundType = 'return_unpriced'
      gmvExcludeReason = '退货退款且无退款金额字段，不计入有效销售额'
    } else if (productRefundCent >= paymentBaseCent && paymentBaseCent > 0) {
      effectiveGmvCent = 0
      refundType = 'full_refund'
      gmvExcludeReason = '全额商品退款，不计入有效销售额'
    } else if (productRefundCent > 0) {
      effectiveGmvCent = Math.max(0, paymentBaseCent - productRefundCent)
      refundType = productRefundCent >= paymentBaseCent ? 'full_refund' : 'partial_refund'
    }
  } else if (classification.isFreightRefundOnly && freightRefundCent > 0) {
    effectiveGmvCent = Math.max(0, paymentBaseCent - freightRefundCent)
    refundType = 'partial_refund'
  }

  const cancelled = isOrderCancelled(order)
  let countsForSigned = classification.countsForSigned
  let actualSignedAmountCent = 0
  if (countsForSigned && !cancelled) {
    actualSignedAmountCent = Math.max(0, paymentBaseCent - totalDeductCent)
  }
  if (cancelled) {
    effectiveGmvCent = 0
    countsForSigned = false
    actualSignedAmountCent = 0
  }

  const includedInGmv = paymentBaseCent > 0 && hasOrderPaymentTime(order)
  let excludeReason: string | null = null
  if (!includedInGmv) {
    if (!hasOrderPaymentTime(order)) excludeReason = '无支付时间'
    else if (paymentBaseCent <= 0) excludeReason = '无支付基数'
    else excludeReason = gmvExcludeReason ?? '不计入支付金额'
  }

  return {
    paymentBaseCent,
    paymentBaseSource,
    effectiveGmvCent,
    actualSignedAmountCent,
    includedInGmv,
    countsForSigned,
    countsForGrossProfit: includedInGmv,
    gmvExcludeReason: includedInGmv ? null : excludeReason,
    refundType,
  }
}

export function sumEffectiveGmvCent(items: Array<{ effectiveGmvCent: number }>): number {
  return items.reduce((s, o) => s + o.effectiveGmvCent, 0)
}
