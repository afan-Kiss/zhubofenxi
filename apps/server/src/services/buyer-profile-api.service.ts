import type { BuyerRankingItem } from './buyer-ranking.service'
import type { BuyerRankingProfilePayload } from './buyer-ranking-cache.service'
import { filterBuyerRankingByTab } from './buyer-ranking-tab-filters'
import { centToYuan } from '../utils/money'
import { buildBuyerValueProfile } from './buyer-value-profile.service'
import type { BuyerShopAggregate } from './buyer-shop-aggregate.service'

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

function signedCount(item: BuyerRankingItem): number {
  return item.signedOrderCount ?? item.buyerSummary?.realDealOrderCount ?? 0
}

function valueScore(item: BuyerRankingItem & { valueProfile?: ReturnType<typeof buildBuyerValueProfile> }): number {
  return item.valueProfile?.customerValueScore ?? buildBuyerValueProfile(item).customerValueScore
}

function averageOrderValue(item: BuyerRankingItem & { valueProfile?: ReturnType<typeof buildBuyerValueProfile> }): number {
  return item.valueProfile?.averageOrderValueYuan ?? buildBuyerValueProfile(item).averageOrderValueYuan
}

export function sortBuyerRankingTabItems(
  items: Array<BuyerRankingItem & { valueProfile?: ReturnType<typeof buildBuyerValueProfile> }>,
  tab: string,
): typeof items {
  const list = [...items]
  switch (tab) {
    case 'highValue':
      list.sort((a, b) => {
        const s = valueScore(b) - valueScore(a)
        if (s !== 0) return s
        const g = buyerEarnedAmount(b) - buyerEarnedAmount(a)
        if (g !== 0) return g
        return signedCount(b) - signedCount(a)
      })
      break
    case 'highAov':
      list.sort((a, b) => {
        const aov = averageOrderValue(b) - averageOrderValue(a)
        if (aov !== 0) return aov
        return buyerEarnedAmount(b) - buyerEarnedAmount(a)
      })
      break
    case 'stableSigned':
      list.sort((a, b) => {
        const sc = signedCount(b) - signedCount(a)
        if (sc !== 0) return sc
        const rr =
          (a.valueProfile?.refundRate ?? 1) - (b.valueProfile?.refundRate ?? 1)
        if (rr !== 0) return rr
        return buyerEarnedAmount(b) - buyerEarnedAmount(a)
      })
      break
    case 'afterSale':
      list.sort((a, b) => {
        const d = buyerRefundSuccessCount(b) - buyerRefundSuccessCount(a)
        if (d !== 0) return d
        return buyerRefundAmount(b) - buyerRefundAmount(a)
      })
      break
    case 'repurchase':
      list.sort((a, b) => {
        const oc =
          (b.buyerSummary?.realDealOrderCount ?? b.orderCount) -
          (a.buyerSummary?.realDealOrderCount ?? a.orderCount)
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
      list.sort((a, b) => buyerEarnedAmount(b) - buyerEarnedAmount(a))
      break
    default:
      list.sort((a, b) => valueScore(b) - valueScore(a))
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

export type EnrichedBuyerRankingItem = BuyerRankingItem & {
  valueProfile: ReturnType<typeof buildBuyerValueProfile>
  mainShopName: string
  shopNames: string[]
  shopLabel: string
}

function enrichItem(item: BuyerRankingItem): EnrichedBuyerRankingItem {
  const shopNames = (item as EnrichedBuyerRankingItem).shopNames ?? []
  const mainShopName =
    (item as EnrichedBuyerRankingItem).mainShopName ??
    shopNames[0] ??
    '未知店铺'
  const shop: BuyerShopAggregate = { mainShopName, shopNames }
  const valueProfile = buildBuyerValueProfile(item, shop)
  return {
    ...item,
    mainShopName,
    shopNames,
    shopLabel: valueProfile.shopLabel,
    valueProfile,
  }
}

export function buildPaginatedBuyerProfileResponse(
  profile: BuyerRankingProfilePayload,
  opts: { page?: number; pageSize?: number; rankingTab?: string },
): BuyerRankingProfilePayload & {
  pagination: BuyerProfilePagination
  items: EnrichedBuyerRankingItem[]
  dataNote: string
} {
  const page = Math.max(1, Math.floor(opts.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20)))
  const rankingTab = String(opts.rankingTab ?? 'highValue').trim() || 'highValue'

  const enrichedAll = profile.items.map((item) => enrichItem(item))
  const filtered = filterBuyerRankingByTab(enrichedAll, rankingTab) as EnrichedBuyerRankingItem[]
  const sorted = sortBuyerRankingTabItems(filtered, rankingTab) as EnrichedBuyerRankingItem[]
  const total = sorted.length
  const items = sorted.slice((page - 1) * pageSize, page * pageSize)

  return {
    ...profile,
    items,
    dataNote:
      '所有主播共用同一份公司公共客户榜；不按主播区分。不展示完整 buyerId、手机号、地址。',
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      rankingTab,
    },
  }
}
