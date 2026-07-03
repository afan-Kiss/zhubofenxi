import type { AnalyzedOrderView } from '../types/analysis'
import { viewMatchesBuyerKey } from './buyer-identity.service'
import { resolveBuyerIdentityFromView } from './buyer-identity.service'

export interface BuyerShopAggregate {
  mainShopName: string
  shopNames: string[]
}

function pickShopName(v: AnalyzedOrderView): string {
  const name = (v.liveAccountName ?? '').trim()
  return name || '未知店铺'
}

function dealCentForView(v: AnalyzedOrderView): number {
  if (!v.includedInGmv) return 0
  return v.effectiveGmvCent ?? v.paymentBaseCent ?? v.statPaidAmountCent ?? 0
}

/** 从订单视图聚合每个买家的店铺归属（按真实成交金额最高店为主店） */
export function buildBuyerShopMapFromViews(
  views: AnalyzedOrderView[],
): Map<string, BuyerShopAggregate> {
  const byBuyer = new Map<string, Map<string, number>>()

  for (const v of views) {
    const identity = resolveBuyerIdentityFromView(v)
    const buyerKey = identity?.buyerKey ?? v.buyerKey ?? v.buyerId
    if (!buyerKey) continue
    const cent = dealCentForView(v)
    if (cent <= 0 && !v.includedInGmv) continue
    const shop = pickShopName(v)
    let shops = byBuyer.get(buyerKey)
    if (!shops) {
      shops = new Map()
      byBuyer.set(buyerKey, shops)
    }
    shops.set(shop, (shops.get(shop) ?? 0) + Math.max(cent, 0))
  }

  const result = new Map<string, BuyerShopAggregate>()
  for (const [buyerKey, shops] of byBuyer) {
    const sorted = [...shops.entries()].sort((a, b) => b[1] - a[1])
    const shopNames = sorted.map(([name]) => name)
    result.set(buyerKey, {
      mainShopName: shopNames[0] ?? '未知店铺',
      shopNames,
    })
  }
  return result
}

export function formatShopLabelForWechat(agg: BuyerShopAggregate | undefined): string {
  if (!agg || agg.shopNames.length === 0) return '未知店铺'
  if (agg.shopNames.length === 1) return agg.mainShopName
  return `${agg.mainShopName}等${agg.shopNames.length}店`
}

export function getBuyerShopAggregate(
  map: Map<string, BuyerShopAggregate>,
  buyerKey: string,
): BuyerShopAggregate {
  return map.get(buyerKey) ?? { mainShopName: '未知店铺', shopNames: [] }
}

export function filterViewsForBuyerKey(views: AnalyzedOrderView[], buyerKey: string): AnalyzedOrderView[] {
  return views.filter((v) => viewMatchesBuyerKey(v, buyerKey))
}
