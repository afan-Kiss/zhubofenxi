import { OPERATIONS_PRODUCT_RANKING } from '../config/operations-product-ranking.config'
import type { OperationsProductRow } from './operations-product-analysis.service'
import { computeProductReturnRateByOrder } from './operations-product-analysis.service'
import {
  buildHotProductRankings,
  buildHighReturnProductRankings,
  buildSlowProductRankings,
  sortHotProducts,
  sortHighReturnProducts,
  type ProductRankItem,
} from './operations-product-ranking.service'
import type { OpsReviewNotePayload } from './ops-review-note.service'
import type { ProductDimensionRow } from './operations-product-ranking.service'
import {
  emptyRankingList,
  makeRankingQuality,
  type ProductRankListItem,
  type RankingListPayload,
} from './operations-rankings.types'

const BASIS = 'computed_from_valid_performance_view' as const
const MIN_AOV_ORDERS = 2

function toListItem(p: ProductRankItem | OperationsProductRow, rankReason: string, sampleTooSmall = false): ProductRankListItem {
  const validAmountYuan = 'validAmountYuan' in p ? p.validAmountYuan : p.soldAmountYuan
  const soldOrderCount = p.soldOrderCount
  const paidOrderCount =
    'paidOrderCount' in p ? p.paidOrderCount : (p as OperationsProductRow).paidOrderCount ?? soldOrderCount
  return {
    productKey: p.productKey,
    productName: p.productName,
    skuName: p.skuName,
    shopName: p.shopName || '—',
    productCode: p.productCode ?? null,
    ringSize: p.ringSize,
    barType: p.barType,
    soldCount: p.soldCount,
    soldOrderCount,
    paidOrderCount,
    validAmountYuan,
    buyerCount: p.buyerCount,
    returnOrderCount: p.returnOrderCount,
    returnRate: p.returnRate,
    averageOrderValueYuan:
      soldOrderCount > 0 ? Math.round(validAmountYuan / soldOrderCount) : null,
    rankReason,
    sampleTooSmall,
    productRoleLabel: p.productRoleLabel,
  }
}

function fromProductRankItems(
  items: ProductRankItem[],
  rankingType: string,
  title: string,
  subtitle: string,
  rankReasonTemplate: string,
): RankingListPayload<ProductRankListItem> {
  return {
    rankingType,
    title,
    subtitle,
    rankReasonTemplate,
    items: items.map((p) => toListItem(p, p.rankReason, p.sampleTooSmall)),
    dataQuality: makeRankingQuality(
      BASIS,
      items.length > 0,
      items.length > 0 ? 'high' : 'insufficient',
      items.length === 0 ? ['暂无有效成交商品'] : [],
    ),
  }
}

export function buildProductRankingLists(params: {
  products: OperationsProductRow[]
  dimensions: ProductDimensionRow[]
  reviewNote: OpsReviewNotePayload | null
  limit?: number
}): {
  hot: RankingListPayload<ProductRankListItem>
  byAmount: RankingListPayload<ProductRankListItem>
  byOrders: RankingListPayload<ProductRankListItem>
  byQuantity: RankingListPayload<ProductRankListItem>
  highAverageOrderValue: RankingListPayload<ProductRankListItem>
  highReturn: RankingListPayload<ProductRankListItem>
  slow: RankingListPayload<ProductRankListItem>
} {
  const limit = params.limit ?? OPERATIONS_PRODUCT_RANKING.hotRankLimit
  const hotItems = buildHotProductRankings(params.products, limit)
  const hot = fromProductRankItems(
    hotItems,
    'product_hot',
    '商品热卖榜',
    '按有效成交金额、成交订单、成交件数排序',
    '有效成交金额最高',
  )

  const byAmount = fromProductRankItems(
    hotItems,
    'product_by_amount',
    '商品成交金额榜',
    '按有效成交金额排序',
    '有效成交金额最高',
  )

  const orderPool = params.products
    .filter((p) => p.soldOrderCount > 0)
    .sort((a, b) => b.soldOrderCount - a.soldOrderCount || b.soldAmountYuan - a.soldAmountYuan)
    .slice(0, limit)
    .map((p) =>
      toListItem(p, '有效成交订单数最高'),
    )
  const byOrders: RankingListPayload<ProductRankListItem> = {
    rankingType: 'product_by_orders',
    title: '商品成交订单榜',
    subtitle: '按有效成交订单、成交金额排序',
    rankReasonTemplate: '有效成交订单数最高',
    items: orderPool,
    dataQuality: makeRankingQuality(BASIS, orderPool.length > 0, orderPool.length > 0 ? 'high' : 'insufficient'),
  }

  const qtyPool = params.products
    .filter((p) => p.soldCount > 0)
    .sort((a, b) => b.soldCount - a.soldCount || b.soldAmountYuan - a.soldAmountYuan)
    .slice(0, limit)
    .map((p) => toListItem(p, '成交件数最高'))
  const byQuantity: RankingListPayload<ProductRankListItem> = {
    rankingType: 'product_by_quantity',
    title: '商品成交件数榜',
    subtitle: '按成交件数、成交金额排序',
    rankReasonTemplate: '成交件数最高',
    items: qtyPool,
    dataQuality: makeRankingQuality(BASIS, qtyPool.length > 0, qtyPool.length > 0 ? 'high' : 'insufficient'),
  }

  const aovFormal = params.products.filter((p) => p.soldOrderCount >= MIN_AOV_ORDERS)
  const aovSample = params.products.filter(
    (p) => p.soldOrderCount === 1 && p.soldAmountYuan > 0,
  )
  const aovSorted = [...aovFormal].sort(
    (a, b) =>
      b.soldAmountYuan / b.soldOrderCount - a.soldAmountYuan / a.soldOrderCount ||
      b.soldAmountYuan - a.soldAmountYuan,
  )
  const highAverageOrderValue: RankingListPayload<ProductRankListItem> = {
    rankingType: 'product_high_aov',
    title: '商品高客单榜',
    subtitle: `客单价 = 有效成交金额 / 成交订单；正式榜要求成交订单 ≥${MIN_AOV_ORDERS}`,
    rankReasonTemplate: '客单价最高',
    items: aovSorted.slice(0, limit).map((p) =>
      toListItem(p, `客单价 ¥${Math.round(p.soldAmountYuan / p.soldOrderCount)}`),
    ),
    sampleTooSmall: [...aovSample]
      .sort((a, b) => b.soldAmountYuan - a.soldAmountYuan)
      .slice(0, limit)
      .map((p) => toListItem(p, '仅 1 单成交，样本不足', true)),
    dataQuality: makeRankingQuality(
      BASIS,
      aovSorted.length > 0,
      aovSorted.length > 0 ? 'high' : aovSample.length > 0 ? 'low' : 'insufficient',
      aovSample.length > 0 ? ['成交仅 1 单的商品仅进入参考区'] : [],
    ),
  }

  const { formal, sampleTooSmall } = buildHighReturnProductRankings(params.products, limit)
  const highReturn: RankingListPayload<ProductRankListItem> = {
    rankingType: 'product_high_return',
    title: '商品高退货榜',
    subtitle: `商品退货订单率 = 退款/退货订单数 ÷ 支付订单数；正式榜要求支付订单 ≥${OPERATIONS_PRODUCT_RANKING.minSoldOrderCountForHighReturn}`,
    rankReasonTemplate: '商品退货订单率最高',
    items: formal.map((p) => toListItem(p, p.rankReason)),
    sampleTooSmall: sampleTooSmall.map((p) => toListItem(p, p.rankReason, true)),
    dataQuality: makeRankingQuality(
      BASIS,
      formal.length > 0,
      formal.length > 0 ? 'high' : sampleTooSmall.length > 0 ? 'low' : 'insufficient',
      formal.length === 0 && sampleTooSmall.length > 0
        ? [`均未达 ${OPERATIONS_PRODUCT_RANKING.minSoldOrderCountForHighReturn} 单支付门槛，正式榜为空`]
        : [],
    ),
  }

  const slowBuilt = buildSlowProductRankings({
    products: params.products,
    dimensions: params.dimensions,
    reviewNote: params.reviewNote,
  })
  const slow: RankingListPayload<ProductRankListItem> = {
    rankingType: 'product_slow',
    title: '主推未成交/低成交商品',
    subtitle: '仅基于人工主推候选池；无曝光/主推依据时不生成自然滞销榜',
    rankReasonTemplate: '主推未成交',
    items: slowBuilt.items.slice(0, limit).map((p) => toListItem(p, p.rankReason)),
    dataQuality: makeRankingQuality(
      slowBuilt.dataQuality.basis === 'insufficient_data'
        ? 'insufficient_data'
        : 'manual_product_dimension',
      slowBuilt.dataQuality.reliable,
      slowBuilt.dataQuality.reliable ? 'medium' : 'insufficient',
      slowBuilt.dataQuality.warning ? [slowBuilt.dataQuality.warning] : [],
    ),
  }

  return { hot, byAmount, byOrders, byQuantity, highAverageOrderValue, highReturn, slow }
}

export function buildDailyProductRankings(params: {
  products: OperationsProductRow[]
  limit?: number
}): {
  hot: RankingListPayload<ProductRankListItem>
  highReturn: RankingListPayload<ProductRankListItem>
} {
  const limit = params.limit ?? OPERATIONS_PRODUCT_RANKING.hotRankLimit
  const hot = fromProductRankItems(
    buildHotProductRankings(params.products, limit),
    'product_hot',
    '热卖前10',
    '按有效成交金额、成交订单、成交件数排序',
    '有效成交金额最高',
  )
  const { formal, sampleTooSmall } = buildHighReturnProductRankings(params.products, limit)
  const highReturn: RankingListPayload<ProductRankListItem> = {
    rankingType: 'product_high_return',
    title: '高退货前10',
    subtitle: '按商品退货订单率排序',
    rankReasonTemplate: '商品退货订单率最高',
    items: formal.map((p) => toListItem(p, p.rankReason)),
    sampleTooSmall: sampleTooSmall.map((p) => toListItem(p, p.rankReason, true)),
    dataQuality: makeRankingQuality(
      BASIS,
      formal.length > 0,
      formal.length > 0 ? 'high' : sampleTooSmall.length > 0 ? 'low' : 'insufficient',
    ),
  }
  return { hot, highReturn }
}
