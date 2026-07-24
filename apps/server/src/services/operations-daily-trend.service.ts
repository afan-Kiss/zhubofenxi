import type { DailyOperationsReportPayload } from './daily-operations-report.service'
import { computeProductReturnRateByOrder } from './operations-product-analysis.service'
import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'

export interface OperationsDailyTrendRow {
  date: string
  validAmountYuan: number
  soldOrderCount: number
  productReturnOrderCount: number
  productReturnRate: number | null
}

function rowFromSnapshot(snap: DailyOperationsReportPayload): OperationsDailyTrendRow {
  const productReturnOrderCount = snap.products.reduce(
    (sum, p) => sum + p.returnOrderCount,
    0,
  )
  // 退货率分母必须用支付 P 单，禁止用有效成交订单数
  const productPaidOrderCount = snap.products.reduce((sum, p) => sum + p.paidOrderCount, 0)
  return {
    date: snap.startDate,
    validAmountYuan: snap.summary.validAmountYuan,
    soldOrderCount: snap.summary.soldOrderCount,
    productReturnOrderCount,
    productReturnRate: computeProductReturnRateByOrder(
      productPaidOrderCount,
      productReturnOrderCount,
    ),
  }
}

function emptyTrendRow(date: string): OperationsDailyTrendRow {
  return {
    date,
    validAmountYuan: 0,
    soldOrderCount: 0,
    productReturnOrderCount: 0,
    productReturnRate: null,
  }
}

export function buildOperationsDailyTrendFromSnapshots(
  snapshots: DailyOperationsReportPayload[],
  options?: { startDate?: string; endDate?: string },
): OperationsDailyTrendRow[] {
  const dailyMap = new Map<string, OperationsDailyTrendRow>()
  for (const snap of snapshots) {
    dailyMap.set(snap.startDate, rowFromSnapshot(snap))
  }

  const start = options?.startDate
  const end = options?.endDate
  if (start && end) {
    return eachDayInShanghaiRange(start, end).map(
      (date) => dailyMap.get(date) ?? emptyTrendRow(date),
    )
  }

  return snapshots.map(rowFromSnapshot)
}

/** 开发/验收：连续多天 amount+orderCount 完全相同且非零，疑似用了周期汇总 */
export function detectSuspiciousDailyTrendRepeat(
  rows: OperationsDailyTrendRow[],
  minRun = 3,
): boolean {
  if (rows.length < minRun) return false
  let run = 1
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!
    const cur = rows[i]!
    if (
      prev.validAmountYuan === cur.validAmountYuan &&
      prev.soldOrderCount === cur.soldOrderCount &&
      prev.validAmountYuan > 0
    ) {
      run += 1
      if (run >= minRun) return true
    } else {
      run = 1
    }
  }
  return false
}
