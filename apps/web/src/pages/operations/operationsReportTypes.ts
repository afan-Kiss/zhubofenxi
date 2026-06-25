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
}
