import { OPERATIONS_PRODUCT_RANKING } from '../config/operations-product-ranking.config'
import type { OperationsPriceBandRow } from './operations-price-band.service'
import {
  makeRankingQuality,
  type PriceBandRankItem,
  type RankingListPayload,
} from './operations-rankings.types'

const BASIS = 'computed_from_price_band_analysis' as const
const MIN_ORDERS = OPERATIONS_PRODUCT_RANKING.minSoldOrderCountForHighReturn

function toBandItem(
  row: OperationsPriceBandRow,
  rankReason: string,
  sampleTooSmall = false,
): PriceBandRankItem {
  const soldOrderCount = row.orderCount
  const paidOrderCount = row.paidOrderCount
  const productReturnOrderRate =
    paidOrderCount > 0 ? row.returnOrderCount / paidOrderCount : null
  return {
    bandLabel: row.bandLabel,
    validAmountYuan: row.amountYuan,
    soldOrderCount,
    paidOrderCount,
    buyerCount: row.buyerCount,
    amountSharePercent: row.amountSharePercent,
    averageOrderValueYuan: row.avgOrderAmountYuan,
    productReturnOrderCount: row.returnOrderCount,
    productReturnOrderRate,
    rankReason,
    sampleTooSmall,
  }
}

export function buildPriceBandRankingLists(
  rows: OperationsPriceBandRow[],
  limit = 10,
): {
  byAmount: RankingListPayload<PriceBandRankItem>
  byOrders: RankingListPayload<PriceBandRankItem>
  byShare: RankingListPayload<PriceBandRankItem>
  byReturnRate: RankingListPayload<PriceBandRankItem>
} {
  const pool = rows.filter((r) => r.orderCount > 0 || r.returnOrderCount > 0)

  const byAmountSorted = [...pool].sort(
    (a, b) => b.amountYuan - a.amountYuan || b.orderCount - a.orderCount,
  )
  const byAmount: RankingListPayload<PriceBandRankItem> = {
    rankingType: 'price_band_by_amount',
    title: '价格带成交金额榜',
    subtitle: '按有效成交金额、成交订单排序；分 cent 精确分档',
    rankReasonTemplate: '成交金额最高',
    items: byAmountSorted.slice(0, limit).map((r) => toBandItem(r, '价格带成交金额最高')),
    dataQuality: makeRankingQuality(BASIS, byAmountSorted.length > 0, byAmountSorted.length > 0 ? 'high' : 'insufficient'),
  }

  const byOrdersSorted = [...pool].sort(
    (a, b) => b.orderCount - a.orderCount || b.amountYuan - a.amountYuan,
  )
  const byOrders: RankingListPayload<PriceBandRankItem> = {
    rankingType: 'price_band_by_orders',
    title: '价格带订单榜',
    subtitle: '按有效成交订单、成交金额排序',
    rankReasonTemplate: '成交订单最多',
    items: byOrdersSorted.slice(0, limit).map((r) => toBandItem(r, '价格带成交订单最多')),
    dataQuality: makeRankingQuality(BASIS, byOrdersSorted.length > 0, byOrdersSorted.length > 0 ? 'high' : 'insufficient'),
  }

  const byShareSorted = [...pool]
    .filter((r) => r.amountSharePercent != null)
    .sort(
      (a, b) =>
        (b.amountSharePercent ?? 0) - (a.amountSharePercent ?? 0) ||
        b.amountYuan - a.amountYuan,
    )
  const byShare: RankingListPayload<PriceBandRankItem> = {
    rankingType: 'price_band_by_share',
    title: '价格带金额占比榜',
    subtitle: '按成交金额占比排序',
    rankReasonTemplate: '成交金额占比最高',
    items: byShareSorted.slice(0, limit).map((r) =>
      toBandItem(r, `成交占比 ${r.amountSharePercent}%`),
    ),
    dataQuality: makeRankingQuality(
      BASIS,
      byShareSorted.length > 0,
      byShareSorted.length > 0 ? 'high' : 'insufficient',
    ),
  }

  const withReturns = pool.filter((r) => r.returnOrderCount > 0 && r.paidOrderCount > 0)
  const formal = withReturns.filter((r) => r.paidOrderCount >= MIN_ORDERS)
  const sample = withReturns.filter((r) => r.paidOrderCount > 0 && r.paidOrderCount < MIN_ORDERS)
  const sortReturn = (a: OperationsPriceBandRow, b: OperationsPriceBandRow) => {
    const ar = a.returnOrderCount / a.paidOrderCount
    const br = b.returnOrderCount / b.paidOrderCount
    return br - ar || b.returnOrderCount - a.returnOrderCount
  }
  const byReturnRate: RankingListPayload<PriceBandRankItem> = {
    rankingType: 'price_band_by_return_rate',
    title: '价格带退货率榜',
    subtitle: '商品退货订单率 = 退货订单 / 支付订单；正式榜 ≥3 单',
    rankReasonTemplate: '商品退货订单率最高',
    items: [...formal].sort(sortReturn).slice(0, limit).map((r) =>
      toBandItem(r, `价格带商品退货订单率 ${r.returnOrderCount}/${r.paidOrderCount}`),
    ),
    sampleTooSmall: [...sample].sort(sortReturn).slice(0, limit).map((r) =>
      toBandItem(r, `样本不足 ${r.returnOrderCount}/${r.paidOrderCount}`, true),
    ),
    dataQuality: makeRankingQuality(
      BASIS,
      formal.length > 0,
      formal.length > 0 ? 'high' : sample.length > 0 ? 'low' : 'insufficient',
      sample.length > 0 ? [`支付不足 ${MIN_ORDERS} 单的价格带仅参考`] : [],
    ),
  }

  return { byAmount, byOrders, byShare, byReturnRate }
}
