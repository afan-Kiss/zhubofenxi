export type DataAccuracyStatus = 'pass' | 'warning' | 'danger'

/** 核对项分类：blocking=阻塞结账；info=提示；technical=技术扫描；ignorable=可忽略 */
export type DataAccuracyCheckCategory = 'blocking' | 'info' | 'technical' | 'ignorable'

export interface DuplicateOrderSample {
  keyType: 'orderNo' | 'packageId' | 'dedupeKey' | 'matchOrderId'
  key: string
  count: number
  sampleOrderIds: string[]
}

export interface DailyRevenueDiffRow {
  date: string
  boardCent: number
  dailyCent: number
  diffCent: number
  boardOrders: number
  dailyOrders: number
  diffOrders: number
}

export interface OrderPoolDiffRow {
  orderNo: string
  buyerNickname: string
  payAmountCent: number
  validRevenueCent: number
  orderStatus: string
  afterSaleStatus: string
  reason: string
}

export interface BuyerDrawerDiffField {
  field: string
  listValue: string
  drawerValue: string
  note?: string
}

export interface BuyerDrawerDiffRow {
  buyerDisplayName: string
  buyerKey: string
  sampleOrderIds: string[]
  diffFields: BuyerDrawerDiffField[]
  possibleReasons: string[]
}

export interface DataAccuracyCheck {
  key: string
  title: string
  status: DataAccuracyStatus
  category?: DataAccuracyCheckCategory
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
  dailyDiffs?: DailyRevenueDiffRow[]
  orderPoolDiffs?: {
    onlyInBoard?: OrderPoolDiffRow[]
    onlyInAggregate?: OrderPoolDiffRow[]
    amountMismatch?: OrderPoolDiffRow[]
    roundingNote?: string
  }
  buyerDrawerDiffs?: BuyerDrawerDiffRow[]
  badBuyerDrawerDiffs?: BuyerDrawerDiffRow[]
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
  blockingIssues?: string[]
  infoNotes?: string[]
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
  /** 报告 JSON 结构版本，低于当前版本时 UI 提示重跑 */
  schemaVersion?: number
  appVersion?: string
  gitCommit?: string
  fullScan?: boolean
  conclusion?: {
    canClose: boolean
    reasonSummary: string
  }
  blockingIssues?: string[]
  infoNotes?: string[]
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
