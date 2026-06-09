/**
 * 售后业务退款口径：申请售后金额优先，排除纯 18 元运费退款，不用用户实付作业务退款
 */
import { parseMoneyToCent } from '../utils/money'
import {
  isReturnsV3FreightOnlyRefund,
  isReturnsV3UnshippedRefundOnly,
  pickReturnsV3ReasonNameZh,
  pickReturnsV3ReturnTypeName,
  RETURNS_V3_FREIGHT_REASON_CODE,
} from './returns-v3-record.service'
import { extractAfterSaleReasonText } from './strict-after-sale-metrics.service'

export const FREIGHT_REFUND_CENT = 1800

const FREIGHT_TEXT_KEYWORDS = [
  '运费',
  '邮费',
  '补运费',
  '退运费',
  '运费退还',
  '快递费',
  '配送费',
  '拍两条',
  '退一条',
  '多拍',
  '拍错',
] as const

/** 售后工作台/API 金额字段单位为「元」，转为分 */
export function yuanApiAmountToCent(value: unknown): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0
    return Math.round(value * 100)
  }
  const parsed = parseMoneyToCent(value)
  return parsed.ok ? parsed.cent : 0
}

function pickString(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function textIndicatesFreight(text: string): boolean {
  if (!text) return false
  return FREIGHT_TEXT_KEYWORDS.some((k) => text.includes(k))
}

function pickNestedCent(obj: unknown, keys: string[]): number {
  if (obj == null || typeof obj !== 'object') return 0
  const rec = obj as Record<string, unknown>
  for (const k of keys) {
    const v = rec[k]
    if (v == null || v === '') continue
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      return Math.round(v * 100)
    }
    const parsed = parseMoneyToCent(v)
    if (parsed.ok && parsed.cent > 0) return parsed.cent
  }
  return 0
}

/** 用户实付金额（分）— 仅展示/对照，不作业务退款 */
export function resolveUserPaidAmountCent(raw: Record<string, unknown>): number {
  return yuanApiAmountToCent(
    raw.pay_amount ?? raw.payAmount ?? raw.user_pay_amount ?? raw.userPayAmount,
  )
}

/** 申请售后金额（分） */
export function resolveAppliedAfterSaleAmountCent(raw: Record<string, unknown>): number {
  return yuanApiAmountToCent(raw.applied_amount ?? raw.appliedAmount)
}

/**
 * 业务退款金额（分）：优先申请售后金额，其次官方退款字段；绝不用用户实付
 */
export function resolveBusinessRefundAmountCent(raw: Record<string, unknown>): number {
  const applied = resolveAppliedAfterSaleAmountCent(raw)
  if (applied > 0) return applied

  const refundFee = yuanApiAmountToCent(
    raw.refund_fee ?? raw.refundFee ?? raw.refundAmount ?? raw.refund_amount,
  )
  if (refundFee > 0) return refundFee

  const actual = yuanApiAmountToCent(
    raw.actual_refund_amount ??
      raw.actualRefundAmount ??
      raw.expected_refund_amount ??
      raw.expectedRefundAmount,
  )
  if (actual > 0) return actual

  const nested = pickNestedCent(raw, [
    'afterSaleRefundAmount',
    'after_sale_refund_amount',
    'refundAmountCent',
  ])
  if (nested > 0) return nested

  for (const container of ['afterSaleInfo', 'after_sale_info', 'afterSale']) {
    const inner = raw[container]
    if (inner && typeof inner === 'object') {
      const c = pickNestedCent(inner, [
        'afterSaleRefundAmount',
        'refundAmount',
        'refund_amount',
        'actualRefundAmount',
      ])
      if (c > 0) return c
    }
  }

  const feeCentField = raw.refund_fee_cent ?? raw.refundFeeCent
  if (feeCentField != null && feeCentField !== '') {
    const feeYuan = yuanApiAmountToCent(raw.refund_fee ?? raw.refundFee)
    if (feeYuan > 0) return feeYuan
    const n = Number(feeCentField)
    if (Number.isFinite(n) && n > 0) {
      if (n >= 100) return Math.round(n)
      return yuanApiAmountToCent(n)
    }
  }

  return 0
}

function pickProductAmountCent(raw: Record<string, unknown>): number {
  return yuanApiAmountToCent(
    raw.goods_amount ??
      raw.goodsAmount ??
      raw.product_amount ??
      raw.productAmount ??
      raw.item_amount ??
      raw.itemAmount,
  )
}

function paymentBaseCentFromRaw(raw: Record<string, unknown>): number {
  return yuanApiAmountToCent(
    raw.actual_seller_receive_amount ??
      raw.actualSellerReceiveAmount ??
      raw.sellerReceiveAmount ??
      raw.pay_amount ??
      raw.payAmount ??
      raw.receivable_amount ??
      raw.receivableAmount,
  )
}

/** 纯 18 元运费退款（不含商品退款的 18 元低价单） */
export function isFreightOnlyRefund(
  raw: Record<string, unknown>,
  refundAmountCent?: number,
): boolean {
  const applied = resolveAppliedAfterSaleAmountCent(raw)
  const amount = refundAmountCent ?? resolveBusinessRefundAmountCent(raw)
  const checkCent = applied === FREIGHT_REFUND_CENT ? applied : amount
  if (checkCent !== FREIGHT_REFUND_CENT) return false

  if (isReturnsV3FreightOnlyRefund(raw)) return true

  const reason = extractAfterSaleReasonText(raw) || pickReturnsV3ReasonNameZh(raw)
  const typeName = pickReturnsV3ReturnTypeName(raw)
  const productName = pickString(raw, ['goods_name', 'goodsName', 'product_name', 'productName'])
  const remark = pickString(raw, ['remark', 'note', 'desc', 'description'])

  if (
    textIndicatesFreight(reason) ||
    textIndicatesFreight(typeName) ||
    textIndicatesFreight(productName) ||
    textIndicatesFreight(remark)
  ) {
    return true
  }

  const code = Number(raw.reason ?? raw.reasonCode ?? raw.reason_code)
  if (code === RETURNS_V3_FREIGHT_REASON_CODE) return true

  const productAmt = pickProductAmountCent(raw)
  if (applied === FREIGHT_REFUND_CENT && productAmt === 0) return true

  const pay = resolveUserPaidAmountCent(raw)
  if (checkCent === FREIGHT_REFUND_CENT && pay > 0 && pay <= FREIGHT_REFUND_CENT * 2) {
    if (productAmt === 0 && !reason && !typeName.includes('退款')) return true
  }

  // 高客单恰好退 18 元：常见为拍两条退一条运费
  if (checkCent === FREIGHT_REFUND_CENT && pay > FREIGHT_REFUND_CENT * 5) {
    if (textIndicatesFreight(reason) || textIndicatesFreight(typeName) || textIndicatesFreight(remark)) {
      return true
    }
    if (paymentBaseCentFromRaw(raw) > FREIGHT_REFUND_CENT * 5) return true
  }

  const paymentBase = paymentBaseCentFromRaw(raw)
  if (
    paymentBase > 50000 &&
    checkCent > 0 &&
    checkCent < paymentBase * 0.55 &&
    isReturnsV3UnshippedRefundOnly(raw)
  ) {
    const reasonText = [reason, typeName, remark].filter(Boolean).join(' ')
    if (/多拍|拍错|不想要|退运费|运费|邮费/.test(reasonText)) return true
  }

  const deliveryOnly = raw.refund_only_delivery_status ?? raw.refundOnlyDeliveryStatus
  if (deliveryOnly != null && deliveryOnly !== '' && Number(deliveryOnly) > 0) return true

  return false
}

/** 商品业务退款（分）：排除纯运费，混合售后扣除运费部分 */
export function resolveBusinessProductRefundAmountCent(raw: Record<string, unknown>): number {
  let cent = resolveBusinessRefundAmountCent(raw)
  if (cent <= 0) return 0
  if (isFreightOnlyRefund(raw, cent)) return 0

  const shipFee = yuanApiAmountToCent(
    raw.applied_ship_fee_amount ?? raw.appliedShipFeeAmount,
  )
  if (shipFee > 0) {
    if (shipFee >= cent) return 0
    cent = Math.max(0, cent - shipFee)
  } else {
    const pay = resolveUserPaidAmountCent(raw)
    const applied = resolveAppliedAfterSaleAmountCent(raw)
    if (
      pay > 0 &&
      applied > 0 &&
      pay - applied === FREIGHT_REFUND_CENT &&
      cent > applied
    ) {
      cent = applied
    }
    if (cent === FREIGHT_REFUND_CENT && paymentBaseCentFromRaw(raw) > FREIGHT_REFUND_CENT * 5) {
      return 0
    }
  }

  return cent
}

export interface BusinessAfterSaleResolution {
  userPaidAmountCent: number
  appliedAmountCent: number
  businessRefundAmountCent: number
  isFreightOnly: boolean
  isBusinessRefund: boolean
}

export function resolveBusinessAfterSale(
  raw: Record<string, unknown>,
  opts: { isSuccessful: boolean },
): BusinessAfterSaleResolution {
  const userPaidAmountCent = resolveUserPaidAmountCent(raw)
  const appliedAmountCent = resolveAppliedAfterSaleAmountCent(raw)
  const businessRefundAmountCent = resolveBusinessProductRefundAmountCent(raw)
  const isFreightOnly = isFreightOnlyRefund(raw)

  return {
    userPaidAmountCent,
    appliedAmountCent,
    businessRefundAmountCent,
    isFreightOnly,
    isBusinessRefund: opts.isSuccessful && businessRefundAmountCent > 0,
  }
}
