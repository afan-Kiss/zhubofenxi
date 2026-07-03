export function filterBoardOrders(
  orders: Array<Record<string, unknown>>,
  filters: {
    buyerId?: string
    anchorName?: string
    anchorId?: string
    statusType?: string
    orderId?: string
  },
): Array<Record<string, unknown>> {
  let list = [...orders]
  const buyer = filters.buyerId?.trim()
  if (buyer) {
    list = list.filter(
      (o) =>
        String(o.buyerKey ?? '') === buyer ||
        String(o.buyerId ?? '') === buyer,
    )
  }
  const anchor = filters.anchorName?.trim()
  if (anchor && anchor !== '全部') {
    list = list.filter(
      (o) =>
        String(o.anchorName ?? '') === anchor ||
        String(o.anchorName ?? '').includes(anchor),
    )
  }
  const orderSearch = filters.orderId?.trim()
  if (orderSearch) {
    list = list.filter(
      (o) =>
        String(o.displayOrderNo ?? o.officialOrderNo ?? o.orderNo ?? '').includes(
          orderSearch,
        ) ||
        String(o.packageId ?? '').includes(orderSearch),
    )
  }
  switch (filters.statusType) {
    case 'signed':
      list = list.filter((o) => o.isActualSigned === true || o.isSigned === true)
      break
    case 'returned':
      list = list.filter((o) => o.isReturned === true)
      break
    case 'quality_return':
      list = list.filter((o) => o.isQualityReturn === true)
      break
    case 'freight_refund':
      list = list.filter((o) => o.isFreightRefundOnly === true)
      break
    case 'refund_only':
      list = list.filter(
        (o) =>
          Number(o.refundAmount ?? 0) > 0 &&
          !o.isReturned &&
          !o.isQualityReturn,
      )
      break
    case 'after_sale_closed':
      list = list.filter((o) => o.afterSaleClosedNoRefund === true)
      break
    default:
      break
  }
  return list
}

import { earnedAmountFromRow } from './buyer-earned-amount'

function buyerNickname(row: Record<string, unknown>): string {
  return String(row.buyerNickname ?? row.nickname ?? row.buyerDisplayName ?? '').trim()
}

interface BuyerSummaryCent {
  receivableAmountCent?: number
  payAmountCent?: number
  refundAmountCent?: number
  netDealAmountCent?: number
  realDealAmountCent?: number
  displayEarnedAmountCent?: number
  orderCount?: number
  paidOrderCount?: number
  realDealOrderCount?: number
  refundOrderCount?: number
  qualityRefundOrderCount?: number
  pendingAfterSaleOrderCount?: number
}

function buyerSummaryFromRow(row: Record<string, unknown>): BuyerSummaryCent | null {
  const raw = row.buyerSummary
  if (!raw || typeof raw !== 'object') return null
  return raw as BuyerSummaryCent
}

function buyerRefundAmount(row: Record<string, unknown>): number {
  const summary = buyerSummaryFromRow(row)
  if (summary?.refundAmountCent != null) return summary.refundAmountCent / 100
  return Number(row.productRefundAmount ?? row.refundAmount ?? 0)
}

function buyerRefundSuccessCount(row: Record<string, unknown>): number {
  const summary = buyerSummaryFromRow(row)
  if (summary?.refundOrderCount != null) return summary.refundOrderCount
  const amt = buyerRefundAmount(row)
  if (amt <= 0) return 0
  return Number(row.refundCount ?? row.refundTimes ?? 0)
}

function buyerQualityRefundOrderCount(row: Record<string, unknown>): number {
  const summary = buyerSummaryFromRow(row)
  if (summary?.qualityRefundOrderCount != null) return summary.qualityRefundOrderCount
  return Number(row.qualityReturnCount ?? 0)
}

function buyerEarnedAmount(row: Record<string, unknown>): number {
  return earnedAmountFromRow(row)
}

/** 卡片展示：赚到金额 */
export function buyerCardEarnedAmount(row: Record<string, unknown>): number {
  return buyerEarnedAmount(row)
}

function buyerRealDealOrderCount(row: Record<string, unknown>): number {
  const summary = buyerSummaryFromRow(row)
  if (summary?.realDealOrderCount != null) return summary.realDealOrderCount
  return Number(row.realDealOrderCount ?? row.completedOrderCount ?? 0)
}

function buyerPendingAfterSaleCount(row: Record<string, unknown>): number {
  const summary = buyerSummaryFromRow(row)
  if (summary?.pendingAfterSaleOrderCount != null) return summary.pendingAfterSaleOrderCount
  return Number(row.pendingAfterSaleOrderCount ?? 0)
}

/** 前端兜底：低价刷单行不展示（主过滤在后端缓存重建） */
export function isLowPriceBrushBuyerRow(row: Record<string, unknown>): boolean {
  if (row.isLowPriceBrushOrder === true) return true
  const cent = Number(row.unitPriceCentForBrushCheck ?? 0)
  if (cent > 0 && cent < 2000) return true
  return false
}

/** 与后端 buyer-ranking-tab-filters 一致 */
function isRefundRankingRow(row: Record<string, unknown>): boolean {
  return buyerRefundAmount(row) > 0 || buyerRefundSuccessCount(row) > 0
}

function isQualityRankingRow(row: Record<string, unknown>): boolean {
  return buyerQualityRefundOrderCount(row) > 0
}

function isSpendRankingRow(row: Record<string, unknown>): boolean {
  return buyerEarnedAmount(row) > 0
}

/** 高价值客户（与后端 isHighValueBuyer 一致） */
export function isHighValueSummaryRow(row: Record<string, unknown>): boolean {
  const signed = Number(row.signedAmount ?? 0)
  const oc = Number(row.orderCount ?? 0)
  const qr = buyerQualityRefundOrderCount(row)
  const refundOrders = buyerRefundSuccessCount(row)
  const productRefundRate = oc > 0 ? refundOrders / oc : 0
  const isQualityHeavy = qr >= 2 || (oc > 0 && qr / oc >= 0.3)
  return (
    signed >= 1000 &&
    Number(row.signedOrderCount ?? 0) >= 1 &&
    productRefundRate < 0.2 &&
    !isQualityHeavy
  )
}

function isRepurchaseRow(row: Record<string, unknown>): boolean {
  return Number(row.orderCount ?? 0) >= 2
}

export function filterBuyerRankingTab(
  items: Array<Record<string, unknown>>,
  tab: string,
): Array<Record<string, unknown>> {
  switch (tab) {
    case 'repurchase':
      return items.filter((i) => isRepurchaseRow(i))
    case 'refund':
      return items.filter((i) => isRefundRankingRow(i))
    case 'quality':
      return items.filter((i) => isQualityRankingRow(i))
    case 'spend':
    default:
      return items.filter((i) => isSpendRankingRow(i))
  }
}

export function sortBuyerRankingTab(
  items: Array<Record<string, unknown>>,
  tab: string,
): Array<Record<string, unknown>> {
  const list = [...items]
  switch (tab) {
    case 'repurchase':
      list.sort((a, b) => {
        const oc = Number(b.orderCount ?? 0) - Number(a.orderCount ?? 0)
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
        const q = buyerQualityRefundOrderCount(b) - buyerQualityRefundOrderCount(a)
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

export function buyerDisplayNickname(row: Record<string, unknown>): string {
  const nick = buyerNickname(row)
  if (nick) return nick
  return '—'
}

export function buyerDisplayLabel(row: Record<string, unknown>): string {
  return buyerDisplayNickname(row)
}

/** 卡片展示：退款次数 = 成功退款且 refund_fee > 0 */
export function buyerCardRefundTimes(row: Record<string, unknown>): number {
  return buyerRefundSuccessCount(row)
}

/** 卡片展示：售后次数（调试字段，主统计勿用） */
export function buyerCardAfterSaleTimes(row: Record<string, unknown>): number {
  return Number(row.afterSaleCount ?? row.refundRelatedOrderCount ?? 0)
}

export function buyerCardPendingAfterSaleCount(row: Record<string, unknown>): number {
  return buyerPendingAfterSaleCount(row)
}

export function buyerCardRefundAmount(row: Record<string, unknown>): number {
  return buyerRefundAmount(row)
}

export function buyerCardQualityReturnCount(row: Record<string, unknown>): number {
  return buyerQualityRefundOrderCount(row)
}

export function buyerCardRealDealOrderCount(row: Record<string, unknown>): number {
  return buyerRealDealOrderCount(row)
}

export function buyerRankingTabEmptyMessage(tab: string): { title: string; subtitle?: string } {
  if (tab === 'quality') {
    return {
      title: '本期暂无商品问题类退货订单',
      subtitle:
        '品退榜优先统计官方品质负反馈明细，并与售后商品问题逻辑交叉印证；尺码不合适、多拍拍错、不想要等普通原因不计入品退。',
    }
  }
  if (tab === 'highValue') {
    return { title: '当前暂无综合高价值客户', subtitle: '有真实成交的客户会按价值分排序展示。' }
  }
  if (tab === 'highAov') {
    return { title: '当前暂无高客单客户' }
  }
  if (tab === 'stableSigned') {
    return { title: '当前暂无稳定签收客户' }
  }
  if (tab === 'afterSale') {
    return { title: '当前暂无需要售后关注的客户' }
  }
  if (tab === 'repurchase') {
    return { title: '当前范围暂无复购客户' }
  }
  if (tab === 'badBuyer') {
    return {
      title: '当前范围暂无需要重点确认的客户',
      subtitle: '品退、退货、售后纠纷或高退款率的买家会出现在此榜，用于发货前提醒。',
    }
  }
  if (tab === 'refund') {
    return { title: '当前范围暂无退款客户' }
  }
  return { title: '当前 Tab 暂无客户' }
}
