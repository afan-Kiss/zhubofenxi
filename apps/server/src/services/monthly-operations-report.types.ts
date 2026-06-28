import type { BusinessInsightEvidence, BusinessInsightsPayload } from './operations-business-insights.types'
import type {
  BusinessInsightActionStatsDailyTrend,
  BusinessInsightActionStatsPayload,
} from './operations-business-insight-action.service'
import type { RankingListPayload, AnchorRankItem, ProductRankListItem, PriceBandRankItem, AfterSalesRankItem } from './operations-rankings.types'

export interface MonthlyOperationsReportRange {
  month: string
  startDate: string
  endDate: string
  prevStartDate?: string
  prevEndDate?: string
}

export interface MonthlyOperationsReportSummary {
  validAmountYuan: number
  soldOrderCount: number
  soldCount: number
  buyerCount: number
  averageOrderValue: number | null
  productReturnOrderCount: number
  productReturnRate: number | null
  productReturnRateAbnormal?: boolean
  liveDurationHours: number | null
  hourlyAmountYuan: number | null
  viewSessionCount: number | null
  joinUserCount: number | null
  dealUserCount: number | null
  dealConversionRate: number | null
  dealConversionNumerator?: number | null
  dealConversionDenominator?: number | null
  dealConversionDenominatorLabel?: string
  newFollowerCount: number | null
  followerConversionRate: number | null
}

export interface MonthlyCompareWithPreviousMonth {
  validAmountYuanChangePercent: number | null
  soldOrderCountChangePercent: number | null
  productReturnRateChangePercent: number | null
  dealConversionRateChangePercent: number | null
  newFollowerCountChangePercent: number | null
  warnings: string[]
}

export interface MonthlyDailyTrendRow {
  date: string
  validAmountYuan: number
  soldOrderCount: number
  productReturnOrderCount: number
  productReturnRate: number | null
}

export interface MonthlyOperationsReportRankings {
  anchors: {
    byAmount: RankingListPayload<AnchorRankItem>
    byOrders: RankingListPayload<AnchorRankItem>
    byHourlyAmount: RankingListPayload<AnchorRankItem>
    byDealConversion: RankingListPayload<AnchorRankItem>
    byReturnRate: RankingListPayload<AnchorRankItem>
  }
  products: {
    hot: RankingListPayload<ProductRankListItem>
    highReturn: RankingListPayload<ProductRankListItem>
    slow: RankingListPayload<ProductRankListItem>
    highAverageOrderValue: RankingListPayload<ProductRankListItem>
  }
  priceBands: {
    byAmount: RankingListPayload<PriceBandRankItem>
    byShare: RankingListPayload<PriceBandRankItem>
    byReturnRate: RankingListPayload<PriceBandRankItem>
  }
  afterSales: {
    byReason: RankingListPayload<AfterSalesRankItem>
    byRefundAmount: RankingListPayload<AfterSalesRankItem>
  }
}

export interface MonthlyPlainLanguageItem {
  label: string
  text: string
  level: 'good' | 'warning' | 'bad' | 'info'
}

export interface MonthlyPlainLanguageSummary {
  title: string
  items: MonthlyPlainLanguageItem[]
}

export interface MonthlyRiskReminder {
  text: string
  level: 'warning' | 'info'
}

export interface MonthlyNextMonthAction {
  text: string
  evidence: BusinessInsightEvidence[]
}

export interface MonthlyOperationsReportDataQuality {
  reliable: boolean
  warnings: string[]
  missingFields?: string[]
}

export interface MonthlyOperationsReportPayload {
  range: MonthlyOperationsReportRange
  title: string
  summary: MonthlyOperationsReportSummary
  compareWithPreviousMonth: MonthlyCompareWithPreviousMonth
  dailyTrend: MonthlyDailyTrendRow[]
  rankings: MonthlyOperationsReportRankings
  businessInsights: BusinessInsightsPayload
  insightActionStats: BusinessInsightActionStatsPayload
  plainLanguageSummary: MonthlyPlainLanguageSummary
  riskReminders: MonthlyRiskReminder[]
  nextMonthActions: MonthlyNextMonthAction[]
  dataQuality: MonthlyOperationsReportDataQuality
}
