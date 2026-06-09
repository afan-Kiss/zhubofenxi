/**
 * returns/v3 售后工作台字段语义（来源：debug/buyer-ranking-har/1.har，仅本地分析/回归）
 *
 * 已观测字段：
 * - user_id: 买家唯一 ID（聚合主键，非 nick_name）
 * - nick_name: 脱敏昵称，仅展示；keywords 搜昵称可能 0 条
 * - status_name: 售后单流程状态（已完成/待收货/已取消），≠ 订单真实成交/签收
 * - refund_status_name: 退款状态（退款成功 等）
 * - reason_name_zh: 原因中文（退运费 / 多拍/拍错/不想要）
 * - reason: 原因码（700004=退运费, 700001=多拍拍错不想要）
 * - refund_only_delivery_status: 纯运费退款标记（1 或 2）
 * - refund_fee: 实际退款金额（元）
 * - pay_amount: 订单支付金额（元），不能用于排行排序
 * - return_type / return_type_name: 5=未发货仅退款, 4=已发货仅退款, 1=退货
 */
import {
  isFreightOnlyRefund,
  resolveBusinessProductRefundAmountCent,
  resolveBusinessRefundAmountCent,
  yuanApiAmountToCent,
  FREIGHT_REFUND_CENT,
} from './business-refund-caliber.service'

export const RETURNS_V3_FREIGHT_REASON_CODE = 700004

export function pickReturnsV3BuyerUserId(rec: Record<string, unknown>): string {
  for (const k of ['user_id', 'userId', 'buyer_id', 'buyerId']) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export function pickReturnsV3Nickname(rec: Record<string, unknown>): string {
  for (const k of ['nick_name', 'nickName', 'nickname', 'buyer_nickname']) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export function pickReturnsV3ReasonCode(rec: Record<string, unknown>): number | null {
  const raw = rec.reason ?? rec.reasonCode ?? rec.reason_code
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function pickReturnsV3ReasonNameZh(rec: Record<string, unknown>): string {
  for (const k of ['reason_name_zh', 'reasonNameZh']) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export function pickReturnsV3ReturnTypeName(rec: Record<string, unknown>): string {
  for (const k of ['return_type_name', 'returnTypeName']) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export function pickReturnsV3StatusName(rec: Record<string, unknown>): string {
  for (const k of ['status_name', 'statusName']) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

/** HAR：reason_name_zh=退运费 / reason=700004 / refund_only_delivery_status 存在 → 纯运费退款 */
export function isReturnsV3FreightOnlyRefund(rec: Record<string, unknown>): boolean {
  const reasonZh = pickReturnsV3ReasonNameZh(rec)
  if (reasonZh === '退运费' || reasonZh.includes('退运费')) return true
  const code = pickReturnsV3ReasonCode(rec)
  if (code === RETURNS_V3_FREIGHT_REASON_CODE) return true
  const deliveryOnly = rec.refund_only_delivery_status ?? rec.refundOnlyDeliveryStatus
  if (deliveryOnly != null && deliveryOnly !== '' && Number(deliveryOnly) > 0) return true
  return false
}

/** HAR：return_type=5 / return_type_name=未发货仅退款 */
export function isReturnsV3UnshippedRefundOnly(rec: Record<string, unknown>): boolean {
  const typeName = pickReturnsV3ReturnTypeName(rec)
  if (typeName.includes('未发货仅退款')) return true
  const rt = rec.return_type ?? rec.returnType
  if (rt === 5 || rt === '5') return true
  return false
}

/** 售后单已取消/关闭且无有效退款 */
export function isReturnsV3CanceledOrClosed(rec: Record<string, unknown>): boolean {
  const status = pickReturnsV3StatusName(rec)
  if (!status) return false
  if (status.includes('已取消') || status.includes('已关闭') || status.includes('已撤销')) {
    const fee = resolveBusinessRefundAmountCent(rec)
    return fee <= 0
  }
  return false
}

/** status_name=已完成 仅表示售后流程结束，需配合 refund_status_name + refund_fee 判断有效退款 */
export function isReturnsV3AfterSaleWorkflowCompleted(rec: Record<string, unknown>): boolean {
  return pickReturnsV3StatusName(rec).includes('已完成')
}

export function splitReturnsV3RefundCent(rec: Record<string, unknown>): {
  productRefundCent: number
  freightRefundCent: number
  isFreightOnly: boolean
} {
  if (isReturnsV3CanceledOrClosed(rec)) {
    return { productRefundCent: 0, freightRefundCent: 0, isFreightOnly: false }
  }
  const feeCent = resolveBusinessRefundAmountCent(rec)
  if (feeCent <= 0) {
    return { productRefundCent: 0, freightRefundCent: 0, isFreightOnly: false }
  }
  if (isFreightOnlyRefund(rec, feeCent)) {
    return { productRefundCent: 0, freightRefundCent: feeCent, isFreightOnly: true }
  }
  const productCent = resolveBusinessProductRefundAmountCent(rec)
  if (productCent === FREIGHT_REFUND_CENT) {
    const payCent = yuanApiAmountToCent(rec.pay_amount ?? rec.payAmount ?? rec.payment_amount)
    if (payCent >= 20000) {
      return { productRefundCent: 0, freightRefundCent: productCent, isFreightOnly: true }
    }
  }
  const freightCent = Math.max(0, feeCent - productCent)
  return { productRefundCent: productCent, freightRefundCent: freightCent, isFreightOnly: false }
}
