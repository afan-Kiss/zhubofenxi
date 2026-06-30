/** 抽屉底部一行总结文案（与复制按钮配套） */

function formatDrawerDateLabel(startDate: string, endDate: string): string {
  const part = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
    if (!m) return iso
    return `${Number(m[2])}.${Number(m[3])}`
  }
  if (startDate.trim() === endDate.trim()) return `${part(startDate)}`
  return `${part(startDate)}~${part(endDate)}`
}

export function buildAnchorDrawerSummaryText(params: {
  startDate: string
  endDate: string
  anchorName: string
  orderCount: number
  payAmountYuan: number
  signedOrderCount: number
  signedAmountYuan: number
  refundOrderCount?: number
  formatMoney: (n: number) => string
}): string {
  const dateLabel = formatDrawerDateLabel(params.startDate, params.endDate)
  const name = params.anchorName.trim() || '主播'
  const paidCount = Math.max(0, Math.floor(params.orderCount))
  const signedCount = Math.max(0, Math.floor(params.signedOrderCount))
  const payAmount = params.formatMoney(params.payAmountYuan)
  const signedAmount = params.formatMoney(params.signedAmountYuan)

  if (paidCount <= 0) {
    return `${dateLabel} ${name}当前范围内暂无支付订单。`
  }

  if (signedCount <= 0 && params.signedAmountYuan <= 0) {
    return `${dateLabel} ${name}支付成交 ${paidCount} 单，支付金额 ${payAmount}；当前未签收，实际签收金额 ${signedAmount}。`
  }

  let text = `${dateLabel} ${name}支付成交 ${paidCount} 单，支付金额 ${payAmount}；实际签收 ${signedCount} 单，实际签收金额 ${signedAmount}。`
  const refund = Math.max(0, Math.floor(params.refundOrderCount ?? 0))
  if (refund > 0) {
    text += ` 另有退款 ${refund} 单。`
  }
  return text
}

export function formatShippedOrderCountLabel(count: number): string {
  const n = Math.max(0, Math.floor(count))
  return `${n}单`
}
