/**
 * 签收额计算：仅减去成功商品退款，不减纯运费退款
 */
import { FREIGHT_REFUND_CENT, isFreightOnlyRefund } from './business-refund-caliber.service'
import { aggregateStrictAfterSaleForOrder } from './strict-after-sale-metrics.service'

const FREIGHT_TEXT_KEYWORDS = [
  '运费',
  '邮费',
  '补运费',
  '退运费',
  '快递费',
  '配送费',
  '拍两条',
  '退一条',
  '多拍',
  '拍错',
] as const

function textIndicatesFreight(text: string): boolean {
  if (!text) return false
  return FREIGHT_TEXT_KEYWORDS.some((k) => text.includes(k))
}

/** 订单主表 / 工作台 fallback 退款是否应视为纯运费（不减签收额） */
export function isFreightOnlyBoardRefundCent(
  refundCent: number,
  paymentBaseCent: number,
  orderRaw?: Record<string, unknown>,
): boolean {
  if (refundCent <= 0) return false
  if (orderRaw && isFreightOnlyRefund(orderRaw, refundCent)) return true
  if (refundCent !== FREIGHT_REFUND_CENT) return false
  if (paymentBaseCent <= FREIGHT_REFUND_CENT * 2) return false
  if (orderRaw) {
    const reason = [
      orderRaw.reason_name_zh,
      orderRaw.reasonNameZh,
      orderRaw.remark,
      orderRaw.note,
      orderRaw.return_type_name,
      orderRaw.returnTypeName,
    ]
      .filter(Boolean)
      .join(' ')
    if (textIndicatesFreight(String(reason))) return true
  }
  // 高客单 + 恰好 18 元退款：默认视为退运费（拍两条退一条运费）
  return paymentBaseCent >= 20000
}

export function resolveSuccessfulProductRefundCentForSign(params: {
  afterSaleRecords: Record<string, unknown>[]
  boardRefundAmountCent: number
  paymentBaseCent: number
  orderRaw?: Record<string, unknown>
  isFreightRefundOnly?: boolean
  freightRefundAmountCent?: number
}): number {
  if (params.isFreightRefundOnly) return 0
  if (params.afterSaleRecords.length > 0) {
    const cent = aggregateStrictAfterSaleForOrder(params.afterSaleRecords).successfulRefundAmountCent
    if (params.isFreightRefundOnly) return 0
    const freight = params.freightRefundAmountCent ?? 0
    if (freight > 0 && cent > 0 && cent <= freight) return 0
    if (
      cent > 0 &&
      cent < params.paymentBaseCent * 0.08 &&
      params.orderRaw &&
      isFreightOnlyRefund(params.orderRaw, cent)
    ) {
      return 0
    }
    return cent
  }
  const board = params.boardRefundAmountCent
  if (board <= 0) return 0
  const freightCent = params.freightRefundAmountCent ?? 0
  if (freightCent > 0 && board === freightCent) return 0
  if (isFreightOnlyBoardRefundCent(board, params.paymentBaseCent, params.orderRaw)) {
    return 0
  }
  if (params.orderRaw && isFreightOnlyRefund(params.orderRaw, board)) {
    return 0
  }
  if (board === FREIGHT_REFUND_CENT && params.paymentBaseCent >= 20000) {
    return 0
  }
  return board
}
