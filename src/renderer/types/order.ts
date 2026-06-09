export interface StandardOrder {
  sourceRowIndex: number
  orderId: string
  orderTime: Date | null
  orderTimeText: string
  monthKey: string
  gmvCent: number
  orderStatusText: string
  afterSaleStatusText: string
  reasonText: string
  buyerId: string
  isSigned: boolean
  isRefunded: boolean
  effectiveSignedCent: number
  errors: string[]
  raw: Record<string, unknown>
}

export interface DuplicateOrderGroup {
  orderId: string
  count: number
  amountConsistent: boolean
  finalGmvCent: number
  originalGmvCents: number[]
  sourceRowIndexes: number[]
}

export interface DedupeSummary {
  rawRowCount: number
  normalizedCount: number
  successCount: number
  abnormalCount: number
  uniqueOrderCount: number
  duplicateOrderIdCount: number
  missingOrderIdCount: number
  moneyParseFailCount: number
  timeParseFailCount: number
  totalGmvCent: number
  totalEffectiveSignedCent: number
}

export interface OrderDedupeResult {
  uniqueOrders: StandardOrder[]
  duplicateOrders: DuplicateOrderGroup[]
  abnormalOrders: StandardOrder[]
  summary: DedupeSummary
}
