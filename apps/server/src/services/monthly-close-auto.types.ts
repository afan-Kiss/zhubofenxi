export type DataAccuracyStatus = 'pass' | 'warning' | 'danger'

export interface DuplicateOrderSample {
  keyType: 'orderNo' | 'packageId' | 'dedupeKey' | 'matchOrderId'
  key: string
  count: number
  sampleOrderIds: string[]
}

export interface DataAccuracyCheck {
  key: string
  title: string
  status: DataAccuracyStatus
  expectedCent?: number
  actualCent?: number
  diffCent?: number
  expectedCount?: number
  actualCount?: number
  diffCount?: number
  note: string
  sampleOrderIds?: string[]
  sampleBuyerKeys?: string[]
  duplicateSamples?: DuplicateOrderSample[]
  /** info 类核对项不计入 moneyDiff/orderDiff 汇总 */
  excludeFromTotals?: boolean
}

export interface DataAccuracyAuditReport {
  range: { startDate: string; endDate: string }
  generatedAt: string
  score: number
  status: DataAccuracyStatus
  checks: DataAccuracyCheck[]
  moneyDiffCentTotal: number
  orderDiffTotal: number
  blockers: string[]
  warnings: string[]
  suggestions: string[]
}

export interface MonthlyCloseAutoReport {
  month: string
  range: {
    startDate: string
    endDate: string
  }
  generatedAt: string
  status: DataAccuracyStatus
  canClose: boolean
  score: number
  summary: {
    validRevenueCent: number
    paidOrderCount: number
    validOrderCount: number
    refundOrderCount: number
    qualityRefundOrderCount: number
    unassignedOrderCount: number
    duplicateOrderCount: number
    moneyDiffCentTotal: number
    orderDiffTotal: number
  }
  blockers: string[]
  warnings: string[]
  checks: DataAccuracyCheck[]
  syncRisk: {
    status: DataAccuracyStatus
    requestCount24h: number
    throttledCount24h: number
    failedCount24h: number
    circuitOpenCount24h: number
    highRiskApis: string[]
    directRequestFindings?: Array<{
      file: string
      line: number
      risk: 'low' | 'medium' | 'high'
      reason: string
      suggestion: string
    }>
    note: string
  }
  schedulerRegistered?: boolean
}
