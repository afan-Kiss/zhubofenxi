export type SettlementType = 'pending' | 'settled'
export type SettlementDirection = 'income' | 'refund' | 'fee' | 'unknown'

export interface SettlementRecord {
  sourceRowIndex: number
  settlementType: SettlementType
  orderId: string
  amountCent: number
  settlementTime?: Date
  settlementTimeText?: string
  statusText: string
  direction: SettlementDirection
  errors: string[]
  raw: Record<string, unknown>
}

export interface SettlementSummary {
  pendingRawRows: number
  pendingValidCount: number
  pendingAbnormalCount: number
  pendingIncomeCent: number
  pendingRefundCent: number
  pendingFeeCent: number
  pendingMissingOrderIdCount: number
  pendingMoneyParseFailCount: number
  settledRawRows: number
  settledValidCount: number
  settledAbnormalCount: number
  settledIncomeCent: number
  settledRefundCent: number
  settledFeeCent: number
  settledMissingOrderIdCount: number
  settledMoneyParseFailCount: number
  settledMissingTimeCount: number
}

export interface SettlementPreprocessResult {
  pendingRecords: SettlementRecord[]
  settledRecords: SettlementRecord[]
  abnormalPendingRecords: SettlementRecord[]
  abnormalSettledRecords: SettlementRecord[]
  summary: SettlementSummary
}
