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
  paidOrderCount: number
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
  paidOrderCount: number
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
  paidOrderCount: number
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

export interface OperationsRankingsRange {
  startDate: string
  endDate: string
  prevStartDate?: string
  prevEndDate?: string
}

export interface OperationsRankingsDailyTrendRow {
  date: string
  validAmountYuan: number
  soldOrderCount: number
  productReturnOrderCount: number
  productReturnRate: number | null
}

export interface OperationsRankingsPayload {
  range: OperationsRankingsRange
  dataQuality: {
    reliable: boolean
    warnings: string[]
  }
  dailyTrend: OperationsRankingsDailyTrendRow[]
  bossSummary: BossSummaryItem[]
  businessInsights?: import('./operations-business-insights.types').BusinessInsightsPayload
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

export function makeRankingQuality(
  basis: RankingBasis,
  reliable: boolean,
  confidence: RankingConfidence,
  warnings: string[] = [],
  missingFields?: string[],
): RankingDataQuality {
  return { reliable, basis, confidence, warnings, missingFields }
}

export function emptyRankingList<T>(
  rankingType: string,
  title: string,
  subtitle: string,
  rankReasonTemplate: string,
  basis: RankingBasis,
  warnings: string[] = [],
): RankingListPayload<T> {
  return {
    rankingType,
    title,
    subtitle,
    rankReasonTemplate,
    items: [],
    dataQuality: makeRankingQuality(basis, false, 'insufficient', warnings),
  }
}
