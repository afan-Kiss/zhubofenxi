export interface DailyTrendPointLike {
  date?: string
  dateKey?: string
  validAmountYuan?: number
  amountYuan?: number
  soldOrderCount?: number
  orderCount?: number
}

/** 开发环境：连续多天成交/订单完全相同且非零，疑似误用周期汇总 */
export function warnIfDailyTrendLooksAggregated(
  rows: DailyTrendPointLike[],
  label = 'dailyTrend',
): void {
  if (!import.meta.env.DEV || rows.length < 3) return

  let run = 1
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!
    const cur = rows[i]!
    const prevAmount = prev.validAmountYuan ?? prev.amountYuan ?? 0
    const curAmount = cur.validAmountYuan ?? cur.amountYuan ?? 0
    const prevOrders = prev.soldOrderCount ?? prev.orderCount ?? 0
    const curOrders = cur.soldOrderCount ?? cur.orderCount ?? 0

    if (prevAmount === curAmount && prevOrders === curOrders && prevAmount > 0) {
      run += 1
      if (run >= 3) {
        console.warn(
          `[${label}] 连续多天成交金额/订单数相同，可能误用了周期汇总数据`,
          rows,
        )
        return
      }
    } else {
      run = 1
    }
  }
}
