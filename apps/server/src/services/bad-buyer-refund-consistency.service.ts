import { logWarn } from '../utils/server-log'

export interface BadBuyerRefundConsistencyInput {
  buyerKey?: string
  refundOrderCount: number
  refundAmountCent: number
}

export interface BadBuyerRefundConsistencyResult extends BadBuyerRefundConsistencyInput {
  inconsistent: boolean
  /** 本期无支付、仅有历史订单售后/退款 */
  historicalRefundOnly: boolean
}

/**
 * 强制退款金额与退款订单数一致：
 * - refundOrderCount === 0 ⇒ refundAmountCent === 0
 * - refundAmountCent > 0 且 refundOrderCount === 0 ⇒ 清零金额并告警
 */
export function enforceBadBuyerRefundConsistency(
  input: BadBuyerRefundConsistencyInput & { paidCount?: number },
): BadBuyerRefundConsistencyResult {
  let refundOrderCount = Math.max(0, input.refundOrderCount)
  let refundAmountCent = Math.max(0, input.refundAmountCent)
  let inconsistent = false

  if (refundOrderCount <= 0 && refundAmountCent > 0) {
    inconsistent = true
    logWarn(
      '买家排行',
      `refund mismatch detected: buyerKey=${input.buyerKey ?? '—'} refundOrderCount=${refundOrderCount} refundAmountCent=${refundAmountCent}`,
    )
    refundAmountCent = 0
  }

  if (refundOrderCount <= 0) {
    refundAmountCent = 0
  }

  const paidCount = input.paidCount ?? 0
  const historicalRefundOnly = paidCount <= 0 && refundOrderCount > 0

  return {
    buyerKey: input.buyerKey,
    refundOrderCount,
    refundAmountCent,
    inconsistent,
    historicalRefundOnly,
  }
}

export function isBadBuyerRefundStatsConsistent(stats: {
  refundOrderCount: number
  refundAmountCent: number
}): boolean {
  const orders = Math.max(0, stats.refundOrderCount)
  const amount = Math.max(0, stats.refundAmountCent)
  if (amount > 0 && orders <= 0) return false
  if (orders <= 0) return amount <= 0
  return true
}

export function assertBadBuyerRefundConsistency(
  stats: BadBuyerRefundConsistencyInput,
  context: string,
): void {
  if (!isBadBuyerRefundStatsConsistent(stats)) {
    throw new Error(
      `数据异常：退款金额无订单来源 (${context}, buyerKey=${stats.buyerKey ?? '—'})`,
    )
  }
}
