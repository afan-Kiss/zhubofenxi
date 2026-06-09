import type { NormalizedOrder } from '../types/analysis'
import { isOrderCancelled, isOrderUnpaid } from './order-amount-metrics.service'
import { matchPlatformReturnReason, normalizePlatformReason, NON_QUALITY_RETURN_REASONS } from '../utils/quality-return'

/** 售后关闭且无实际退款 */
const AFTER_SALE_CLOSED_NO_REFUND_KEYWORDS = [
  '售后关闭',
  '关闭',
  '已取消',
  '未退款',
  '售后取消',
  '售后已关闭',
  '买家取消售后',
]

/** 退货退款成功（状态语义，非品退判断依据） */
const RETURN_REFUND_SUCCESS_KEYWORDS = [
  '退货退款成功',
  '退货退款',
  '退货完成',
  '退货成功',
]

/** 仅退款（状态语义） */
const REFUND_ONLY_KEYWORDS = ['仅退款', '退款成功', '已退款', '退款完成']

/** 仅退运费 — 仅匹配售后状态/原因字段中的明确运费语义 */
const FREIGHT_REFUND_REASON_NORMALIZED = normalizePlatformReason('仅退运费')
const FREIGHT_STATUS_KEYWORDS = ['退运费', '运费退款', '运费补偿', '邮费退款', '退邮费']

export type AfterSaleCategory =
  | 'none'
  | 'freight_only'
  | 'after_sale_closed_no_refund'
  | 'return_refund'
  | 'refund_only'
  | 'real_product_refund'
  | 'unpaid_cancel'
  | 'shipped_unsigned'

/** 前端展示用售后分类 */
export type AfterSaleDisplayType =
  | '—'
  | '品退'
  | '普通退货'
  | '仅退款'
  | '运费补偿'
  | '售后关闭无退款'
  | '尺寸不合适'
  | '其他售后'

export interface AfterSaleClassification {
  category: AfterSaleCategory
  rawRefundAmountCent: number
  freightRefundAmountCent: number
  productRefundAmountCent: number
  realAfterSaleAmountCent: number
  isFreightRefundOnly: boolean
  afterSaleClosedNoRefund: boolean
  isReturnRefund: boolean
  isRefundOnly: boolean
  isRealProductRefund: boolean
  countsAsProductRefund: boolean
  countsAsReturnRefund: boolean
  countsAsRefundOnly: boolean
  countsAsFreightRefund: boolean
  /** 仅白名单原因命中 */
  countsAsQualityReturn: boolean
  countsAsSizeMismatch: boolean
  countsForSigned: boolean
  isCompletedOrSigned: boolean
  isShippedUnsigned: boolean
  /** 平台原始退货原因 */
  reasonRaw: string
  afterSaleStatusLabel: string
  afterSaleDisplayType: AfterSaleDisplayType
}

const SHIPPED_KEYWORDS = ['已发货', '待收货', '运输中', '派送中']
const SIGNED_KEYWORDS = ['已签收', '已完成', '交易完成', '已收货', '交易成功']

function containsAny(text: string, keywords: string[]): boolean {
  if (!text) return false
  return keywords.some((k) => text.includes(k))
}

function isAfterSaleClosedNoRefund(afterSaleText: string, refundCent: number): boolean {
  if (refundCent > 0) return false
  return containsAny(afterSaleText, AFTER_SALE_CLOSED_NO_REFUND_KEYWORDS)
}

function isReturnRefundStatus(orderStatusText: string, afterSaleText: string): boolean {
  const combined = [orderStatusText, afterSaleText].filter(Boolean).join(' ')
  return (
    containsAny(combined, RETURN_REFUND_SUCCESS_KEYWORDS) ||
    (combined.includes('退货') && combined.includes('退款'))
  )
}

function isRefundOnlyStatus(afterSaleText: string, orderStatusText: string): boolean {
  const combined = [afterSaleText, orderStatusText].filter(Boolean).join(' ')
  if (isReturnRefundStatus(orderStatusText, afterSaleText)) return false
  return containsAny(combined, REFUND_ONLY_KEYWORDS) || combined.includes('仅退款')
}

function isSignedOrCompleted(orderStatusText: string, afterSaleText: string): boolean {
  const combined = [orderStatusText, afterSaleText].filter(Boolean).join(' ')
  return containsAny(orderStatusText, SIGNED_KEYWORDS) || containsAny(combined, SIGNED_KEYWORDS)
}

function isShippedNotSigned(orderStatusText: string): boolean {
  if (isSignedOrCompleted(orderStatusText, '')) return false
  return containsAny(orderStatusText, SHIPPED_KEYWORDS)
}

/** 仅依据售后状态或平台原因字段「仅退运费」，不用聊天/备注 */
function detectFreightOnlyRefund(
  order: NormalizedOrder,
  refundCent: number,
  afterSaleText: string,
  reasonRaw: string,
): boolean {
  if (refundCent <= 0) return false

  const reasonNorm = normalizePlatformReason(reasonRaw)
  if (reasonNorm === FREIGHT_REFUND_REASON_NORMALIZED) return true
  if (containsAny(afterSaleText, FREIGHT_STATUS_KEYWORDS)) return true

  const freightCent = order.freightCent > 0 ? order.freightCent : 0
  if (freightCent > 0 && refundCent <= freightCent) {
    const paymentBase =
      order.actualPaidCent ||
      order.receivableAmountCent ||
      order.actualSellerReceiveAmountCent ||
      order.gmvCent
    if (paymentBase > 0 && refundCent < paymentBase * 0.15) return true
  }
  return false
}

function resolveDisplayType(
  base: AfterSaleClassification,
  reasonMatch: ReturnType<typeof matchPlatformReturnReason>,
): AfterSaleDisplayType {
  if (base.afterSaleClosedNoRefund) return '售后关闭无退款'
  if (base.isFreightRefundOnly) return '运费补偿'
  if (reasonMatch.isSizeMismatch) return '尺寸不合适'
  if (base.countsAsQualityReturn) return '品退'
  if (base.isReturnRefund) return '普通退货'
  if (base.isRefundOnly) return '仅退款'
  if (reasonMatch.isNonQualityReason && reasonMatch.rawReason) {
    const norm = normalizePlatformReason(reasonMatch.rawReason)
    if (NON_QUALITY_RETURN_REASONS.map(normalizePlatformReason).includes(norm)) {
      return '其他售后'
    }
  }
  if (base.countsAsProductRefund || base.isReturnRefund || base.isRefundOnly) {
    return '其他售后'
  }
  return '—'
}

export function classifyOrderAfterSale(
  order: NormalizedOrder,
  settlementRefundCent: number,
  opts?: {
    afterSaleReasonText?: string | null
    workbenchFreightRefundCent?: number
    workbenchHasFreightOnly?: boolean
  },
): AfterSaleClassification {
  const orderStatusText = order.orderStatusText ?? ''
  const afterSaleText = order.afterSaleStatusText ?? ''
  const reasonRaw = (opts?.afterSaleReasonText ?? order.reasonText ?? '').trim()
  const reasonMatch = matchPlatformReturnReason(reasonRaw)

  const base: AfterSaleClassification = {
    category: 'none',
    rawRefundAmountCent: 0,
    freightRefundAmountCent: 0,
    productRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isRealProductRefund: false,
    countsAsProductRefund: false,
    countsAsReturnRefund: false,
    countsAsRefundOnly: false,
    countsAsFreightRefund: false,
    countsAsQualityReturn: false,
    countsAsSizeMismatch: false,
    countsForSigned: false,
    isCompletedOrSigned: false,
    isShippedUnsigned: false,
    reasonRaw: reasonMatch.rawReason || reasonRaw,
    afterSaleStatusLabel: '—',
    afterSaleDisplayType: '—',
  }

  if (isOrderUnpaid(order)) {
    base.category = 'unpaid_cancel'
    base.afterSaleStatusLabel = '未支付'
    base.afterSaleDisplayType = '—'
    return base
  }

  const isCompleted = isSignedOrCompleted(orderStatusText, afterSaleText)
  base.isCompletedOrSigned = isCompleted
  base.isShippedUnsigned = isShippedNotSigned(orderStatusText)

  let refundCent = settlementRefundCent > 0 ? settlementRefundCent : 0

  const workbenchFreightCent = opts?.workbenchFreightRefundCent ?? 0
  if (opts?.workbenchHasFreightOnly && workbenchFreightCent > 0 && refundCent <= 0) {
    refundCent = workbenchFreightCent
  }

  // 1. 售后关闭 / 已取消 且退款为 0
  if (isAfterSaleClosedNoRefund(afterSaleText, refundCent)) {
    base.category = 'after_sale_closed_no_refund'
    base.afterSaleClosedNoRefund = true
    base.afterSaleStatusLabel = '售后关闭无退款'
    base.afterSaleDisplayType = '售后关闭无退款'
    base.countsForSigned = isCompleted
    return base
  }

  const returnRefund = isReturnRefundStatus(orderStatusText, afterSaleText)
  const refundOnly = !returnRefund && isRefundOnlyStatus(afterSaleText, orderStatusText)
  const hasRefundSignal =
    refundCent > 0 ||
    returnRefund ||
    refundOnly ||
    containsAny(afterSaleText, ['退款', '退货', '售后'])

  if (!hasRefundSignal) {
    base.countsForSigned = isCompleted
    base.afterSaleStatusLabel = isCompleted ? '正常完成' : base.isShippedUnsigned ? '已发货待签收' : '—'
    base.afterSaleDisplayType = '—'
    if (base.isShippedUnsigned) base.category = 'shipped_unsigned'
    return base
  }

  base.rawRefundAmountCent = refundCent

  // 2. 纯退运费（returns/v3: reason=700004 / reason_name_zh=退运费 / refund_only_delivery_status）
  if (
    opts?.workbenchHasFreightOnly &&
    workbenchFreightCent > 0 &&
    (refundCent <= 0 || refundCent === workbenchFreightCent)
  ) {
    base.category = 'freight_only'
    base.isFreightRefundOnly = true
    base.freightRefundAmountCent = workbenchFreightCent
    base.countsAsFreightRefund = true
    base.afterSaleStatusLabel = '仅退运费'
    base.afterSaleDisplayType = '运费补偿'
    base.countsForSigned = isCompleted
    return base
  }

  // 3. 仅退运费（订单侧语义兜底）
  if (detectFreightOnlyRefund(order, refundCent, afterSaleText, reasonRaw)) {
    base.category = 'freight_only'
    base.isFreightRefundOnly = true
    base.freightRefundAmountCent = refundCent
    base.countsAsFreightRefund = refundCent > 0
    base.afterSaleStatusLabel = '仅退运费'
    base.afterSaleDisplayType = '运费补偿'
    base.countsForSigned = isCompleted
    return base
  }

  // 4. 真实商品退款
  const hasProductRefund = refundCent > 0

  if (returnRefund) {
    base.category = 'return_refund'
    base.isReturnRefund = true
    base.isRealProductRefund = hasProductRefund
    base.productRefundAmountCent = refundCent
    base.realAfterSaleAmountCent = refundCent
    base.countsAsReturnRefund = true
    base.countsAsProductRefund = hasProductRefund
  } else if (refundOnly || hasProductRefund) {
    base.category = refundOnly ? 'refund_only' : 'real_product_refund'
    base.isRefundOnly = refundOnly
    base.isRealProductRefund = hasProductRefund
    base.productRefundAmountCent = refundCent
    base.realAfterSaleAmountCent = refundCent
    base.countsAsRefundOnly = refundOnly && hasProductRefund
    base.countsAsProductRefund = hasProductRefund
  }

  // 5. 品退：白名单或关键词命中（不要求已发生退款，有品退原因即计）
  if (reasonMatch.isQualityReturn && !base.isFreightRefundOnly) {
    base.countsAsQualityReturn = true
  }

  // 6. 尺寸不合适（非品退）
  if (reasonMatch.isSizeMismatch) {
    base.countsAsSizeMismatch = true
  }

  base.afterSaleDisplayType = resolveDisplayType(base, reasonMatch)

  if (base.countsAsQualityReturn) {
    base.afterSaleStatusLabel = base.isReturnRefund ? '品退（退货退款）' : '品退（仅退款）'
  } else if (base.countsAsSizeMismatch) {
    base.afterSaleStatusLabel = '尺码/尺寸不合适'
  } else if (base.isReturnRefund) {
    base.afterSaleStatusLabel = reasonMatch.rawReason || '退货退款'
  } else if (base.isRefundOnly) {
    base.afterSaleStatusLabel = reasonMatch.rawReason || '仅退款'
  } else if (reasonMatch.rawReason) {
    base.afterSaleStatusLabel = reasonMatch.rawReason
  } else {
    base.afterSaleStatusLabel = afterSaleText || '售后中'
  }

  return base
}
