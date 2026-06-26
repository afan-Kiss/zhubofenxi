export type RankingBasis =
  | 'official_order'
  | 'official_after_sales'
  | 'official_live_traffic'
  | 'official_product_exposure'
  | 'manual_product_dimension'
  | 'computed_from_valid_performance_view'
  | 'computed_from_price_band_analysis'
  | 'computed_from_after_sales_reason'
  | 'insufficient_data'

export type RankingConfidence = 'high' | 'medium' | 'low' | 'insufficient'

export interface RankingDataQuality {
  reliable: boolean
  basis: RankingBasis
  confidence: RankingConfidence
  warnings: string[]
  missingFields?: string[]
}

export interface RankingListPayload<T> {
  rankingType: string
  title: string
  subtitle: string
  rankReasonTemplate: string
  items: T[]
  sampleTooSmall?: T[]
  dataQuality: RankingDataQuality
}

export interface AnchorRankItem {
  anchorName: string
  shopName: string
  validAmountYuan: number
  soldOrderCount: number
  returnOrderCount: number
  returnRate: number | null
  liveDurationMinutes: number
  hourlyAmountYuan: number | null
  viewSessionCount: number | null
  joinUserCount: number | null
  dealUserCount: number | null
  dealConversionRate: number | null
  newFollowerCount: number | null
  followerConversionRate: number | null
  averageOrderValueYuan: number | null
  rankReason: string
  sampleTooSmall: boolean
}

export interface ProductRankListItem {
  productKey: string
  productName: string
  skuName: string
  shopName: string
  productCode: string | null
  ringSize: string
  barType: string
  soldCount: number
  soldOrderCount: number
  validAmountYuan: number
  buyerCount: number
  returnOrderCount: number
  returnRate: number | null
  averageOrderValueYuan: number | null
  rankReason: string
  sampleTooSmall: boolean
  productRoleLabel: string
}

export interface PriceBandRankItem {
  bandLabel: string
  validAmountYuan: number
  soldOrderCount: number
  buyerCount: number
  amountSharePercent: number | null
  averageOrderValueYuan: number | null
  productReturnOrderCount: number
  productReturnOrderRate: number | null
  rankReason: string
  sampleTooSmall: boolean
}

export interface AfterSalesRankItem {
  category: string
  categoryLabel: string
  orderCount: number
  refundAmountYuan: number
  sharePercent: number | null
  rankReason: string
}

export interface BossSummaryItem {
  title: string
  primaryText: string
  metrics: Array<{ label: string; value: string }>
  reason: string
  basis: RankingBasis
  confidence: RankingConfidence
  empty?: boolean
}

export type BusinessInsightType =
  | 'promote_product'
  | 'pause_product'
  | 'review_product'
  | 'review_anchor'
  | 'increase_anchor_schedule'
  | 'optimize_anchor_product_match'
  | 'focus_price_band'
  | 'after_sales_check'
  | 'data_quality_warning'

export type BusinessInsightPriority = 'high' | 'medium' | 'low'

export type BusinessInsightConfidence =
  | 'high'
  | 'medium'
  | 'low'
  | 'insufficient'

export interface BusinessInsightEvidence {
  label: string
  value: string | number | null
  unit?: string
  source:
    | 'operations_rankings'
    | 'daily_report'
    | 'weekly_report'
    | 'product_ranking'
    | 'anchor_ranking'
    | 'price_band_ranking'
    | 'after_sales_ranking'
    | 'manual_review_note'
  rankingType?: string
  rank?: number
}

export interface BusinessInsightEntity {
  type: 'anchor' | 'product' | 'price_band' | 'after_sales_reason' | 'system'
  id?: string
  name: string
}

export interface BusinessInsightDataQuality {
  reliable: boolean
  confidence: BusinessInsightConfidence
  warnings: string[]
}

export interface BusinessInsightItem {
  id: string
  type: BusinessInsightType
  priority: BusinessInsightPriority
  title: string
  reason: string
  suggestedAction: string
  evidence: BusinessInsightEvidence[]
  relatedEntity: BusinessInsightEntity
  dataQuality: BusinessInsightDataQuality
}

export interface BusinessInsightsPayload {
  items: BusinessInsightItem[]
  dataQuality: {
    reliable: boolean
    warnings: string[]
  }
}

export interface OperationsRankingsPayload {
  range: {
    startDate: string
    endDate: string
    prevStartDate?: string
    prevEndDate?: string
  }
  dataQuality: { reliable: boolean; warnings: string[] }
  bossSummary: BossSummaryItem[]
  businessInsights?: BusinessInsightsPayload
  anchors: {
    byAmount: RankingListPayload<AnchorRankItem>
    byOrders: RankingListPayload<AnchorRankItem>
    byHourlyAmount: RankingListPayload<AnchorRankItem>
    byDealConversion: RankingListPayload<AnchorRankItem>
    byNewFollowers: RankingListPayload<AnchorRankItem>
    byFollowerConversion: RankingListPayload<AnchorRankItem>
    byReturnRate: RankingListPayload<AnchorRankItem>
  }
  products: {
    hot: RankingListPayload<ProductRankListItem>
    byAmount: RankingListPayload<ProductRankListItem>
    byOrders: RankingListPayload<ProductRankListItem>
    byQuantity: RankingListPayload<ProductRankListItem>
    highAverageOrderValue: RankingListPayload<ProductRankListItem>
    highReturn: RankingListPayload<ProductRankListItem>
    slow: RankingListPayload<ProductRankListItem>
  }
  priceBands: {
    byAmount: RankingListPayload<PriceBandRankItem>
    byOrders: RankingListPayload<PriceBandRankItem>
    byShare: RankingListPayload<PriceBandRankItem>
    byReturnRate: RankingListPayload<PriceBandRankItem>
  }
  afterSales: {
    byReason: RankingListPayload<AfterSalesRankItem>
    byRefundAmount: RankingListPayload<AfterSalesRankItem>
  }
}

export interface DailyReportRankingsSlice {
  products: {
    hot: RankingListPayload<ProductRankListItem>
    highReturn: RankingListPayload<ProductRankListItem>
  }
  anchors: {
    byAmount: RankingListPayload<AnchorRankItem>
    byOrders: RankingListPayload<AnchorRankItem>
    byHourlyAmount: RankingListPayload<AnchorRankItem>
    byDealConversion: RankingListPayload<AnchorRankItem>
    byNewFollowers: RankingListPayload<AnchorRankItem>
    byReturnRate: RankingListPayload<AnchorRankItem>
  }
}

export interface LiveRoomNewFollowerRow {
  liveAccountName: string
  newFollowerCount: number
}

export interface DailyOperationsAnchorRow {
  anchorName: string
  sessionLabel: string
  shopName: string
  livePeriodText: string
  liveDurationText: string
  liveDurationMinutes: number
  validAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  returnOrderCount: number
  returnOrderRate: number | null
  avgOrderAmountYuan: number | null
  hourlyAmountYuan: number | null
  amountRatio: number | null
  viewSessionCount: number | null
  joinUserCount: number | null
  avgOnlineUserCount: number | null
  avgViewDurationSeconds: number | null
  newFollowerCount: number | null
  dealUserCount: number | null
  dealConversionRate: number | null
  newFollowerRate: number | null
}

export interface OperationsProductRow {
  productKey: string
  itemId: string
  productName: string
  skuName: string
  shopName: string
  productCode: string | null
  ringSize: string
  barType: string
  soldCount: number
  soldOrderCount: number
  soldAmountYuan: number
  buyerCount: number
  returnOrderCount: number
  returnRate: number | null
  productRole: string
  productRoleLabel: string
}

export interface OperationsPriceBandRow {
  bandLabel: string
  orderCount: number
  amountYuan: number
  buyerCount: number
  amountSharePercent: number | null
  avgOrderAmountYuan: number | null
  returnOrderCount: number
  returnRate: number | null
}

export interface AfterSalesReasonRow {
  category: string
  categoryLabel: string
  orderCount: number
  refundAmountYuan: number
  sharePercent: number | null
}

export interface OpsReviewNotePayload {
  reportDate: string
  reportType: 'daily' | 'weekly'
  problemText: string
  reasonText: string
  trafficProducts: string[]
  mainProducts: string[]
  profitProducts: string[]
  scriptText: string
  ownerName: string
  createdBy?: string | null
  updatedAt?: string
}

export interface DailyOperationsSummary {
  validAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  returnOrderCount: number
  returnOrderRate: number | null
  dealUserCount: number | null
  dealConversionRate: number | null
  joinUserCount: number | null
  viewSessionCount: number | null
  avgOnlineUserCount: number | null
  avgViewDurationSeconds: number | null
  avgOrderAmountYuan: number | null
  totalLiveDurationMinutes: number
  hourlyAmountYuan: number | null
  liveRoomNewFollowers: LiveRoomNewFollowerRow[]
  totalNewFollowerCount: number
  newFollowerRate: number | null
}

export interface DailyOperationsReportPayload {
  dateLabel: string
  title: string
  startDate: string
  endDate: string
  summary: DailyOperationsSummary
  anchors: DailyOperationsAnchorRow[]
  products: OperationsProductRow[]
  priceBands: OperationsPriceBandRow[]
  afterSalesReasons: AfterSalesReasonRow[]
  reviewNote: OpsReviewNotePayload | null
  rankings: DailyReportRankingsSlice
  reportDataQuality: { reliable: boolean; warnings: string[] }
  businessInsights?: BusinessInsightsPayload
}

export interface WeeklyDailyTrendRow {
  dateKey: string
  dateLabel: string
  validAmountYuan: number
  soldOrderCount: number
  returnOrderCount: number
}

export interface WeeklyAnchorRow {
  anchorName: string
  validAmountYuan: number
  soldOrderCount: number
  returnOrderCount: number
  returnOrderRate: number | null
  liveDurationMinutes: number
  dealUserCount: number | null
}

export interface ProductRankDataQuality {
  basis: 'official_exposure' | 'manual_product_dimension' | 'insufficient_data' | 'valid_performance_view'
  reliable: boolean
  warning?: string
}

export interface WeeklyProductHighlight {
  productKey: string
  productName: string
  skuName: string
  shopName: string
  productCode: string | null
  ringSize: string
  barType: string
  soldCount: number
  soldOrderCount: number
  soldAmountYuan: number
  validAmountYuan: number
  buyerCount: number
  returnOrderCount: number
  returnRate: number | null
  rankReason: string
  rankingType: 'hot' | 'slow' | 'high_return' | 'sample_too_small'
  dataQuality: ProductRankDataQuality
  sampleTooSmall: boolean
  productRoleLabel: string
}

export interface ProductRankingQuality {
  hotReliable: boolean
  slowReliable: boolean
  highReturnReliable: boolean
  warnings: string[]
}

export interface WeeklyOperationsReportPayload {
  weekStart: string
  weekEnd: string
  title: string
  summary: DailyOperationsSummary & {
    prevValidAmountYuan: number | null
    validAmountChangePercent: number | null
    prevSoldOrderCount: number | null
    soldOrderChangePercent: number | null
  }
  dailyTrend: WeeklyDailyTrendRow[]
  anchors: WeeklyAnchorRow[]
  hotProducts: WeeklyProductHighlight[]
  slowProducts: WeeklyProductHighlight[]
  highReturnProducts: WeeklyProductHighlight[]
  highReturnSampleTooSmall: WeeklyProductHighlight[]
  productRankingQuality: ProductRankingQuality
  priceBands: OperationsPriceBandRow[]
  afterSalesReasons: AfterSalesReasonRow[]
  reviewNote: OpsReviewNotePayload | null
  businessInsights?: BusinessInsightsPayload
}
