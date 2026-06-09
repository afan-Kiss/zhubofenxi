/** 买家侧展示：赚到金额（非利润，客户最终留下的真实成交金额） */
export function resolveDisplayEarnedAmountCent(input: {
  netDealAmountCent?: number | null
  realDealAmountCent?: number | null
}): number {
  const net = input.netDealAmountCent ?? 0
  if (net > 0) return net
  const real = input.realDealAmountCent ?? 0
  return real > 0 ? real : 0
}

export const EARNED_AMOUNT_TOOLTIP =
  '赚到金额 = 客户最终留下的真实成交金额。只统计已完成/已签收且未成功商品退款的订单。已取消、已关闭、未支付、未发货仅退款、商品全退订单不计入。纯运费退款不影响赚到金额。该金额不是利润，不扣成本。'
