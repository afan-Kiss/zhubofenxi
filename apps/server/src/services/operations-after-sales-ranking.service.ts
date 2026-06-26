import type { AfterSalesReasonRow } from './after-sales-reason-normalize.service'
import {
  makeRankingQuality,
  type AfterSalesRankItem,
  type RankingListPayload,
} from './operations-rankings.types'

const BASIS = 'computed_from_after_sales_reason' as const

function toItem(row: AfterSalesReasonRow, rankReason: string): AfterSalesRankItem {
  return {
    category: row.category,
    categoryLabel: row.categoryLabel,
    orderCount: row.orderCount,
    refundAmountYuan: row.refundAmountYuan,
    sharePercent: row.sharePercent,
    rankReason,
  }
}

export function buildAfterSalesRankingLists(
  rows: AfterSalesReasonRow[],
  limit = 10,
): {
  byReason: RankingListPayload<AfterSalesRankItem>
  byRefundAmount: RankingListPayload<AfterSalesRankItem>
} {
  const pool = rows.filter((r) => r.orderCount > 0 || r.refundAmountYuan > 0)

  const byOrderSorted = [...pool].sort(
    (a, b) => b.orderCount - a.orderCount || b.refundAmountYuan - a.refundAmountYuan,
  )
  const byReason: RankingListPayload<AfterSalesRankItem> = {
    rankingType: 'after_sales_by_orders',
    title: '售后原因订单数榜',
    subtitle: '按归一化售后原因分类统计；不含客户隐私',
    rankReasonTemplate: '售后订单数最多',
    items: byOrderSorted.slice(0, limit).map((r) => toItem(r, `${r.categoryLabel} 订单数最多`)),
    dataQuality: makeRankingQuality(
      BASIS,
      byOrderSorted.length > 0,
      byOrderSorted.length > 0 ? 'high' : 'insufficient',
      byOrderSorted.length === 0 ? ['暂无售后原因数据'] : [],
    ),
  }

  const byAmountSorted = [...pool].sort(
    (a, b) => b.refundAmountYuan - a.refundAmountYuan || b.orderCount - a.orderCount,
  )
  const byRefundAmount: RankingListPayload<AfterSalesRankItem> = {
    rankingType: 'after_sales_by_refund_amount',
    title: '售后原因退款金额榜',
    subtitle: '按商品退款金额排序；不含运费-only',
    rankReasonTemplate: '退款金额最高',
    items: byAmountSorted.slice(0, limit).map((r) => toItem(r, `${r.categoryLabel} 退款金额最高`)),
    dataQuality: makeRankingQuality(
      BASIS,
      byAmountSorted.length > 0,
      byAmountSorted.length > 0 ? 'high' : 'insufficient',
    ),
  }

  return { byReason, byRefundAmount }
}
