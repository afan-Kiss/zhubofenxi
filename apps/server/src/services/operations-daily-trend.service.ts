import type { DailyOperationsReportPayload } from './daily-operations-report.service'
import { computeProductReturnRateByOrder } from './operations-product-analysis.service'

export interface OperationsDailyTrendRow {
  date: string
  validAmountYuan: number
  soldOrderCount: number
  productReturnOrderCount: number
  productReturnRate: number | null
}

export function buildOperationsDailyTrendFromSnapshots(
  snapshots: DailyOperationsReportPayload[],
): OperationsDailyTrendRow[] {
  return snapshots.map((snap) => {
    const productReturnOrderCount = snap.products.reduce(
      (sum, p) => sum + p.returnOrderCount,
      0,
    )
    const productSoldOrderCount = snap.products.reduce((sum, p) => sum + p.soldOrderCount, 0)
    return {
      date: snap.startDate,
      validAmountYuan: snap.summary.validAmountYuan,
      soldOrderCount: snap.summary.soldOrderCount,
      productReturnOrderCount,
      productReturnRate: computeProductReturnRateByOrder(
        productSoldOrderCount,
        productReturnOrderCount,
      ),
    }
  })
}
