/** 抽屉底部一行总结文案（与复制按钮配套） */

function formatDrawerDateLabel(startDate: string, endDate: string): string {
  const part = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
    if (!m) return iso
    return `${Number(m[2])}.${Number(m[3])}`
  }
  if (startDate.trim() === endDate.trim()) return `${part(startDate)}日`
  return `${part(startDate)}~${part(endDate)}日`
}

function countZh(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n)
  if (n === 0) return '零'
  if (n === 1) return '一'
  if (n === 2) return '两'
  if (n <= 10) return ['', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'][n]!
  return String(n)
}

export function buildAnchorDrawerSummaryText(params: {
  startDate: string
  endDate: string
  anchorName: string
  orderCount: number
  refundOrderCount: number
  shippedOrderAmountYuan: number
  formatMoney: (n: number) => string
}): string {
  const dateLabel = formatDrawerDateLabel(params.startDate, params.endDate)
  const name = params.anchorName.trim() || '主播'
  const deal = Math.max(0, Math.floor(params.orderCount))
  const refund = Math.max(0, Math.floor(params.refundOrderCount))
  const amount = params.formatMoney(params.shippedOrderAmountYuan)
  let text = `${dateLabel}${name}成交${countZh(deal)}单`
  if (refund > 0) {
    text += `，退货${countZh(refund)}单`
  }
  text += `，发货单金额：${amount}`
  return text
}

export function formatShippedOrderCountLabel(count: number): string {
  const n = Math.max(0, Math.floor(count))
  return `${n}单`
}
