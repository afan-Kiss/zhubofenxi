/** 买家侧展示：赚到金额（非利润，客户最终留下的真实成交金额） */

export const EARNED_AMOUNT_TOOLTIP =
  '赚到金额 = 客户最终留下的真实成交金额。只统计已完成/已签收且未成功商品退款的订单。已取消、已关闭、未支付、未发货仅退款、商品全退订单不计入。纯运费退款不影响赚到金额。该金额不是利润，不扣成本。'

export function resolveDisplayEarnedAmountCent(input: {
  netDealAmountCent?: number | null
  realDealAmountCent?: number | null
  displayEarnedAmountCent?: number | null
}): number {
  if (input.displayEarnedAmountCent != null && Number.isFinite(input.displayEarnedAmountCent)) {
    return Math.max(0, input.displayEarnedAmountCent)
  }
  const net = input.netDealAmountCent ?? 0
  if (net > 0) return net
  const real = input.realDealAmountCent ?? 0
  return real > 0 ? real : 0
}

export function earnedAmountFromRow(row: Record<string, unknown>): number {
  const summary = row.buyerSummary as Record<string, unknown> | undefined
  if (summary) {
    const cent = resolveDisplayEarnedAmountCent({
      displayEarnedAmountCent: Number(summary.displayEarnedAmountCent),
      netDealAmountCent: Number(summary.netDealAmountCent),
      realDealAmountCent: Number(summary.realDealAmountCent),
    })
    if (cent > 0 || summary.displayEarnedAmountCent != null) return cent / 100
  }
  if (row.displayEarnedAmountCent != null) {
    return resolveDisplayEarnedAmountCent({
      displayEarnedAmountCent: Number(row.displayEarnedAmountCent),
    }) / 100
  }
  if (row.earnedAmount != null && Number.isFinite(Number(row.earnedAmount))) {
    return Math.max(0, Number(row.earnedAmount))
  }
  return Math.max(0, Number(row.actualDealAmount ?? 0))
}
