import type { AttributionType, AttributionValidation, OrderAttribution, UnmatchedBillSummary } from './anchor'
import type { StandardOrder } from './order'

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'done_with_warnings' | 'error'

export interface BusinessOverview {
  gmvCent: number
  orderCount: number
  actualSignedCount: number
  actualSignedAmountCent: number
  returnCount: number
  returnAmountCent: number
  returnRate: number
  qualityReturnCount: number
  qualityReturnAmountCent: number
  qualityReturnRate: number
  settledAmountCent: number
  pendingAmountCent: number
  grossProfitCent: number
  grossProfitNote: string
  abnormalOrderCount: number
  unassignedOrderCount: number
  unmatchedBillOrderCount: number
  unmatchedBillAmountCent: number
  qualityReasonMissing: boolean
}

export interface AnchorSummary {
  anchorId: string
  anchorName: string
  color: string
  gmvCent: number
  gmvShare: number
  orderCount: number
  actualSignedCount: number
  actualSignedAmountCent: number
  returnCount: number
  returnRate: number
  qualityReturnCount: number
  qualityReturnAmountCent: number
  settledAmountCent: number
  pendingAmountCent: number
  grossProfitCent: number
  grossProfitNote?: string
}

export interface BuyerReturnRankItem {
  buyerId: string
  returnCount: number
  returnAmountCent: number
  latestReturnTime: string
}

export interface BuyerQualityReturnRankItem {
  buyerId: string
  qualityReturnCount: number
  qualityReturnAmountCent: number
  reasonSummary: string
}

export interface QualityReturnInsight {
  qualityReturnCount: number
  qualityReturnAmountCent: number
  qualityReturnRate: number
  buyerCount: number
  topBuyerId: string
  topBuyerAmountCent: number
  reasonMissing: boolean
}

export interface BusinessAnalysisResult {
  month: string
  overview: BusinessOverview
  anchorSummaries: AnchorSummary[]
  qualityReturn: QualityReturnInsight
  buyerReturnRanking: BuyerReturnRankItem[]
  buyerQualityReturnRanking: BuyerQualityReturnRankItem[]
  analyzedOrders: AnalyzedOrderView[]
  abnormalOrders: AnalyzedOrderView[]
  attributionValidation: AttributionValidation
  unmatchedBills: UnmatchedBillSummary
  warnings: string[]
  errors: string[]
}

export interface AnalyzedOrderView {
  sourceRowIndex: number
  orderId: string
  orderTimeText: string
  buyerId: string
  anchorId: string
  anchorName: string
  attributionType: AttributionType
  matchedRuleId?: string
  matchedRuleName?: string
  matchedLiveSessionId?: string
  matchedLiveStartTime?: string
  matchedLiveEndTime?: string
  attributionWarning?: string
  gmvCent: number
  isSigned: boolean
  isRefunded: boolean
  isActualSigned: boolean
  isQualityReturn: boolean
  returnAmountCent: number
  returnAmountSource: 'bill' | 'order_estimate' | 'none'
  reasonText: string
  errors: string[]
  raw: Record<string, unknown>
}

export type { StandardOrder, OrderAttribution, AttributionValidation, UnmatchedBillSummary }
