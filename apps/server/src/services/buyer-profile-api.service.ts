import type { BuyerRankingItem } from './buyer-ranking.service'
import type { BuyerRankingProfilePayload } from './buyer-ranking-cache.service'
import { filterBuyerRankingByTab } from './buyer-ranking-tab-filters'
import { centToYuan } from '../utils/money'

function buyerEarnedAmount(item: BuyerRankingItem): number {
  if (item.buyerSummary?.displayEarnedAmountCent != null) {
    return centToYuan(item.buyerSummary.displayEarnedAmountCent)
  }
  return Number(item.earnedAmount ?? item.actualDealAmount ?? 0)
}

function buyerRefundSuccessCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.refundOrderCount ?? item.refundCount ?? 0
}

function buyerRefundAmount(item: BuyerRankingItem): number {
  if (item.buyerSummary) return centToYuan(item.buyerSummary.refundAmountCent)
  return Number(item.productRefundAmount ?? item.refundAmount ?? 0)
}

function buyerQualityCount(item: BuyerRankingItem): number {
  return item.buyerSummary?.qualityRefundOrderCount ?? item.qualityReturnCount ?? 0
}

export function sortBuyerRankingTabItems(
  items: BuyerRankingItem[],
  tab: string,
): BuyerRankingItem[] {
  const list = [...items]
  switch (tab) {
    case 'repurchase':
      list.sort((a, b) => {
        const oc = b.orderCount - a.orderCount
        if (oc !== 0) return oc
        const g = buyerEarnedAmount(b) - buyerEarnedAmount(a)
        if (g !== 0) return g
        return String(b.lastOrderTime ?? '').localeCompare(String(a.lastOrderTime ?? ''))
      })
      break
    case 'refund':
      list.sort((a, b) => {
        const d = buyerRefundSuccessCount(b) - buyerRefundSuccessCount(a)
        if (d !== 0) return d
        const c = buyerRefundAmount(b) - buyerRefundAmount(a)
        if (c !== 0) return c
        return buyerEarnedAmount(b) - buyerEarnedAmount(a)
      })
      break
    case 'quality':
      list.sort((a, b) => {
        const q = buyerQualityCount(b) - buyerQualityCount(a)
        if (q !== 0) return q
        return buyerEarnedAmount(b) - buyerEarnedAmount(a)
      })
      break
    case 'spend':
    default:
      list.sort((a, b) => buyerEarnedAmount(b) - buyerEarnedAmount(a))
      break
  }
  return list
}

export interface BuyerProfilePagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
  rankingTab: string
}

export function buildPaginatedBuyerProfileResponse(
  profile: BuyerRankingProfilePayload,
  opts: { page?: number; pageSize?: number; rankingTab?: string },
): BuyerRankingProfilePayload & { pagination: BuyerProfilePagination } {
  const page = Math.max(1, Math.floor(opts.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20)))
  const rankingTab = String(opts.rankingTab ?? 'spend').trim() || 'spend'

  const filtered = filterBuyerRankingByTab(profile.items, rankingTab)
  const sorted = sortBuyerRankingTabItems(filtered, rankingTab)
  const total = sorted.length
  const items = sorted.slice((page - 1) * pageSize, page * pageSize)

  return {
    ...profile,
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      rankingTab,
    },
  }
}
