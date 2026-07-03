import { apiRequest } from './api'

export type AnchorWeeklyRankingTab = 'spend' | 'repurchase' | 'refund' | 'quality'

export type AnchorWeeklyRankingPreset = 'thisWeek' | 'lastWeek' | 'custom'

export interface AnchorWeeklyBuyerRankingItem {
  rank: number
  buyerKey: string
  buyerDisplayName: string
  buyerShortCode: string
  buyerDisplayLabel: string
  tags: string[]
  suggestion: string
  weeklyDealAmountYuan: number
  weeklyRealDealOrderCount: number
  weeklyRefundOrderCount: number
  weeklyQualityRefundOrderCount: number
  weeklyRefundAmountYuan: number
  weeklyRefundRate: number | null
  lastOrderTime: string | null
  canOpenOrders: boolean
}

export interface AnchorWeeklyRankingData {
  range: {
    preset: string
    presetLabel: string
    startDate: string
    endDate: string
  }
  anchorScope: {
    mode: 'all' | 'anchor' | 'unbound'
    anchorName?: string | null
    anchorId?: string
    message?: string
  }
  rankingTab: AnchorWeeklyRankingTab
  items: AnchorWeeklyBuyerRankingItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  summary: {
    buyerCount: number
    orderCountInRange: number
  }
  dataNote: string
  generatedAt: string
  emptyText: string
  message?: string
  source: string
}

export interface AnchorWeeklyOrderScope {
  startDate: string
  endDate: string
  anchorName?: string
  source: 'anchor_weekly_ranking'
}

export interface BadBuyerOrderScope {
  startDate: string
  endDate: string
  source: 'bad_buyer_ranking'
}

export type BuyerOrderDateScope = AnchorWeeklyOrderScope | BadBuyerOrderScope

export async function fetchAnchorWeeklyRanking(params: {
  preset?: AnchorWeeklyRankingPreset
  startDate?: string
  endDate?: string
  rankingTab?: AnchorWeeklyRankingTab
  anchorName?: string
  page?: number
  pageSize?: number
}): Promise<AnchorWeeklyRankingData> {
  const qs = new URLSearchParams()
  qs.set('preset', params.preset ?? 'thisWeek')
  if (params.startDate) qs.set('startDate', params.startDate)
  if (params.endDate) qs.set('endDate', params.endDate)
  qs.set('rankingTab', params.rankingTab ?? 'spend')
  if (params.anchorName) qs.set('anchorName', params.anchorName)
  qs.set('page', String(params.page ?? 1))
  qs.set('pageSize', String(params.pageSize ?? 20))
  return apiRequest<AnchorWeeklyRankingData>(`/api/board/anchor-buyer-weekly-ranking?${qs}`)
}

export function weeklyItemToDrawerBuyer(
  item: AnchorWeeklyBuyerRankingItem,
): import('../components/board/BuyerOrderDrawer').BuyerOrderDrawerBuyer {
  return {
    buyerKey: item.buyerKey,
    buyerId: item.buyerKey,
    nickname: item.buyerDisplayName,
    buyerDisplayName: item.buyerDisplayName,
    buyerDisplayLabel: item.buyerDisplayLabel,
    buyerShortCode: item.buyerShortCode,
    buyerIdentityCode: item.buyerShortCode,
    gmv: item.weeklyDealAmountYuan,
    orderCount: item.weeklyRealDealOrderCount,
    productRefundAmount: item.weeklyRefundAmountYuan,
    refundCount: item.weeklyRefundOrderCount,
    refundTimes: item.weeklyRefundOrderCount,
    qualityReturnCount: item.weeklyQualityRefundOrderCount,
    listBuyerSummary: {
      receivableAmountCent: Math.round(item.weeklyDealAmountYuan * 100),
      payAmountCent: Math.round(item.weeklyDealAmountYuan * 100),
      refundAmountCent: Math.round(item.weeklyRefundAmountYuan * 100),
      netDealAmountCent: Math.round(item.weeklyDealAmountYuan * 100),
      realDealAmountCent: Math.round(item.weeklyDealAmountYuan * 100),
      displayEarnedAmountCent: Math.round(item.weeklyDealAmountYuan * 100),
      orderCount: item.weeklyRealDealOrderCount,
      paidOrderCount: item.weeklyRealDealOrderCount,
      realDealOrderCount: item.weeklyRealDealOrderCount,
      refundOrderCount: item.weeklyRefundOrderCount,
      qualityRefundOrderCount: item.weeklyQualityRefundOrderCount,
      pendingAfterSaleOrderCount: 0,
    },
  }
}
