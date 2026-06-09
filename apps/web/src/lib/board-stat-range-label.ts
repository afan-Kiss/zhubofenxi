function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface BoardStatRangeLabel {
  windowText: string
  includesTodayRealtime: boolean
  payAmountNote: string
  masterOrderNote: string
  afterSaleNote: string
}

/** 经营看板页面展示的统计日期窗口文案 */
export function formatBoardStatRangeLabel(
  startDate: string,
  endDate: string,
): BoardStatRangeLabel {
  const includesTodayRealtime = endDate === todayKey()
  const windowText = includesTodayRealtime
    ? `${startDate} 00:00:00 ~ ${endDate}（含今日实时订单）`
    : `${startDate} 00:00:00 ~ ${endDate} 23:59:59`

  return {
    windowText,
    includesTodayRealtime,
    payAmountNote: '支付金额等指标按支付时间归属',
    masterOrderNote: '主表订单范围与接口查询一致（优先支付时间，无则下单时间）',
    afterSaleNote: '售后按申请/退款时间拉取，仅补充已匹配主表订单',
  }
}
