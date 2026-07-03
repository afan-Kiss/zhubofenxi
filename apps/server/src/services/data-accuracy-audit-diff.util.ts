import type { AnalyzedOrderView } from '../types/analysis'
import { resolveMetricOrderNo, dedupeViewsByMetricOrderNo } from './calc-refund-rate.service'
import {
  isValidRevenueOrder,
  explainValidRevenueOrder,
  sumValidRevenueFromViews,
} from './valid-revenue-order.service'
import { calculateBusinessMetrics } from './business-metrics.service'
import type {
  BuyerDrawerDiffField,
  BuyerDrawerDiffRow,
  DailyRevenueDiffRow,
  OrderPoolDiffRow,
} from './monthly-close-auto.types'

const ORDER_DIFF_LIMIT = 20

function viewOrderNo(v: AnalyzedOrderView): string {
  return resolveMetricOrderNo(v) || v.displayOrderNo || v.orderId
}

function viewToOrderPoolRow(v: AnalyzedOrderView, reason: string): OrderPoolDiffRow {
  return {
    orderNo: viewOrderNo(v),
    buyerNickname: (v.buyerNickname ?? v.buyerDisplayName ?? '—').trim() || '—',
    payAmountCent: v.paymentBaseCent ?? v.effectiveGmvCent ?? 0,
    validRevenueCent: v.effectiveGmvCent ?? 0,
    orderStatus: v.orderStatusText ?? '—',
    afterSaleStatus: v.afterSaleStatusText ?? v.afterSaleStatusLabel ?? '—',
    reason,
  }
}

function countsAsShippedOrderView(v: AnalyzedOrderView): boolean {
  return v.includedInGmv === true && v.effectiveGmvCent > 0
}

export function buildValidRevenueOrderKeySet(views: AnalyzedOrderView[]): Map<string, AnalyzedOrderView> {
  const map = new Map<string, AnalyzedOrderView>()
  for (const v of dedupeViewsByMetricOrderNo(views)) {
    const orderNo = resolveMetricOrderNo(v)
    if (!orderNo) continue
    if (!isValidRevenueOrder(v)) continue
    map.set(orderNo, v)
  }
  return map
}

function buildShippedOrderKeySet(views: AnalyzedOrderView[]): Map<string, AnalyzedOrderView> {
  const map = new Map<string, AnalyzedOrderView>()
  for (const v of dedupeViewsByMetricOrderNo(views)) {
    const orderNo = resolveMetricOrderNo(v)
    if (!orderNo) continue
    if (!countsAsShippedOrderView(v)) continue
    map.set(orderNo, v)
  }
  return map
}

export function compareValidRevenueOrderPools(
  views: AnalyzedOrderView[],
): {
  boardCent: number
  aggregateCent: number
  boardOrders: number
  aggregateOrders: number
  onlyInBoard: OrderPoolDiffRow[]
  onlyInAggregate: OrderPoolDiffRow[]
  amountMismatch: OrderPoolDiffRow[]
  roundingNote?: string
} {
  const direct = sumValidRevenueFromViews(views)
  const metrics = calculateBusinessMetrics(views)
  const aggregateCent = Math.round(metrics.validSalesAmount * 100)

  const boardPool = buildValidRevenueOrderKeySet(views)
  const shippedPool = buildShippedOrderKeySet(views)

  const onlyInBoard: OrderPoolDiffRow[] = []
  const onlyInAggregate: OrderPoolDiffRow[] = []
  const amountMismatch: OrderPoolDiffRow[] = []

  for (const [orderNo, v] of boardPool) {
    if (!shippedPool.has(orderNo)) {
      onlyInBoard.push(viewToOrderPoolRow(v, explainValidRevenueOrder(v).reason))
    }
  }
  for (const [orderNo, v] of shippedPool) {
    if (!boardPool.has(orderNo)) {
      onlyInAggregate.push(
        viewToOrderPoolRow(v, '计入发货单金额但未计入有效成交池'),
      )
    }
  }

  let roundingNote: string | undefined
  if (
    onlyInBoard.length === 0 &&
    onlyInAggregate.length === 0 &&
    direct.validAmountCent !== aggregateCent
  ) {
    roundingNote =
      '订单池一致，金额差异来自 validSalesAmount 经 centToYuan 再乘 100 的四舍五入；核对应统一用 cent 分。'
  }

  return {
    boardCent: direct.validAmountCent,
    aggregateCent,
    boardOrders: direct.soldOrderCount,
    aggregateOrders: metrics.shippedOrderCount,
    onlyInBoard: onlyInBoard.slice(0, ORDER_DIFF_LIMIT),
    onlyInAggregate: onlyInAggregate.slice(0, ORDER_DIFF_LIMIT),
    amountMismatch: amountMismatch.slice(0, ORDER_DIFF_LIMIT),
    roundingNote,
  }
}

export function buildDailyBoardRevenueByDate(
  views: AnalyzedOrderView[],
  dateKeys: string[],
): Map<string, { cent: number; orders: number }> {
  const byDate = new Map<string, { cent: number; orders: number }>()
  for (const key of dateKeys) byDate.set(key, { cent: 0, orders: 0 })

  for (const v of dedupeViewsByMetricOrderNo(views)) {
    if (!isValidRevenueOrder(v)) continue
    const payTime = v.orderTimeText?.trim().slice(0, 10)
    if (!payTime) continue
    const dateKey = payTime
    const bucket = byDate.get(dateKey)
    if (!bucket) continue
    bucket.cent += v.effectiveGmvCent
    bucket.orders += 1
  }
  return byDate
}

export function buildDailyRevenueDiffRows(params: {
  dateKeys: string[]
  boardByDate: Map<string, { cent: number; orders: number }>
  dailyByDate: Map<string, { cent: number; orders: number }>
}): DailyRevenueDiffRow[] {
  const rows: DailyRevenueDiffRow[] = []
  for (const date of params.dateKeys) {
    const board = params.boardByDate.get(date) ?? { cent: 0, orders: 0 }
    const daily = params.dailyByDate.get(date) ?? { cent: 0, orders: 0 }
    const diffCent = board.cent - daily.cent
    const diffOrders = board.orders - daily.orders
    if (diffCent !== 0 || diffOrders !== 0) {
      rows.push({
        date,
        boardCent: board.cent,
        dailyCent: daily.cent,
        diffCent,
        boardOrders: board.orders,
        dailyOrders: daily.orders,
        diffOrders,
      })
    }
  }
  return rows
}

export function formatCentYuan(cent: number): string {
  return `¥${(cent / 100).toFixed(2)}`
}

export function inferBuyerDrawerPossibleReasons(fields: BuyerDrawerDiffField[]): string[] {
  const reasons: string[] = []
  const names = fields.map((f) => f.field).join(' ')
  if (names.includes('售后')) {
    reasons.push('售后申请次数和售后订单数可能混用')
    reasons.push('一个订单多个售后单')
  }
  if (names.includes('退货退款')) reasons.push('纯运费补偿口径不一致')
  if (names.includes('品退')) reasons.push('品退判定与官方品退表同步时差')
  if (names.includes('退款')) reasons.push('售后中/售后关闭口径不一致')
  return [...new Set(reasons)]
}

export function buildBadBuyerDrawerDiffRow(params: {
  buyerDisplayName: string
  buyerKey: string
  listQuality: number
  drawerQuality: number
  listReturnRefund: number
  drawerReturnRefund: number
  listAftersaleOrders: number
  drawerAftersaleOrders: number
  listAftersaleApplies: number
  drawerAftersaleApplies: number
  listRefundCent: number
  drawerRefundCent: number
  listRefundOrders: number
  drawerRefundOrders: number
  listRefundRate: number
  drawerRefundRate: number
  sampleOrderIds: string[]
}): BuyerDrawerDiffRow | null {
  const diffFields: BuyerDrawerDiffField[] = []
  const pct = (r: number) => `${Math.round(r * 100)}%`

  if (params.listQuality !== params.drawerQuality) {
    diffFields.push({
      field: '品退',
      listValue: `${params.listQuality} 单`,
      drawerValue: `${params.drawerQuality} 单`,
    })
  }
  if (params.listReturnRefund !== params.drawerReturnRefund) {
    diffFields.push({
      field: '退货退款',
      listValue: `${params.listReturnRefund} 单`,
      drawerValue: `${params.drawerReturnRefund} 单`,
    })
  }
  if (params.listAftersaleOrders !== params.drawerAftersaleOrders) {
    diffFields.push({
      field: '售后订单数',
      listValue: `${params.listAftersaleOrders} 单`,
      drawerValue: `${params.drawerAftersaleOrders} 单`,
    })
  }
  if (params.listAftersaleApplies !== params.drawerAftersaleApplies) {
    diffFields.push({
      field: '售后申请次数',
      listValue: `${params.listAftersaleApplies} 次`,
      drawerValue: `${params.drawerAftersaleApplies} 次`,
    })
  }
  if (params.listRefundCent !== params.drawerRefundCent) {
    diffFields.push({
      field: '退款金额',
      listValue: formatCentYuan(params.listRefundCent),
      drawerValue: formatCentYuan(params.drawerRefundCent),
    })
  }
  if (params.listRefundOrders !== params.drawerRefundOrders) {
    diffFields.push({
      field: '退款单数',
      listValue: `${params.listRefundOrders} 单`,
      drawerValue: `${params.drawerRefundOrders} 单`,
    })
  }
  if (Math.abs(params.listRefundRate - params.drawerRefundRate) > 0.0001) {
    diffFields.push({
      field: '退款率',
      listValue: pct(params.listRefundRate),
      drawerValue: pct(params.drawerRefundRate),
    })
  }

  if (diffFields.length === 0) return null

  return {
    buyerDisplayName: params.buyerDisplayName,
    buyerKey: params.buyerKey,
    sampleOrderIds: params.sampleOrderIds.slice(0, 5),
    diffFields,
    possibleReasons: inferBuyerDrawerPossibleReasons(diffFields),
  }
}

export function buildBuyerDrawerDiffRow(params: {
  buyerDisplayName: string
  buyerKey: string
  listEarnedCent: number
  drawerEarnedCent: number
  listSigned: number
  drawerSigned: number
  listCompleted: number
  drawerCompleted: number
  listAftersale: number
  drawerAftersale: number
  listRefund: number
  drawerRefund: number
  listQuality: number
  drawerQuality: number
  sampleOrderIds: string[]
}): BuyerDrawerDiffRow | null {
  const diffFields: BuyerDrawerDiffField[] = []
  if (params.listEarnedCent !== params.drawerEarnedCent) {
    diffFields.push({
      field: '成交金额',
      listValue: formatCentYuan(params.listEarnedCent),
      drawerValue: formatCentYuan(params.drawerEarnedCent),
    })
  }
  if (params.listSigned !== params.drawerSigned) {
    diffFields.push({
      field: '签收单',
      listValue: `${params.listSigned} 单`,
      drawerValue: `${params.drawerSigned} 单`,
    })
  }
  if (params.listCompleted !== params.drawerCompleted) {
    diffFields.push({
      field: '完成单',
      listValue: `${params.listCompleted} 单`,
      drawerValue: `${params.drawerCompleted} 单`,
    })
  }
  if (params.listAftersale !== params.drawerAftersale) {
    diffFields.push({
      field: '售后',
      listValue: `${params.listAftersale} 单`,
      drawerValue: `${params.drawerAftersale} 单`,
    })
  }
  if (params.listRefund !== params.drawerRefund) {
    diffFields.push({
      field: '退款单',
      listValue: `${params.listRefund} 单`,
      drawerValue: `${params.drawerRefund} 单`,
    })
  }
  if (params.listQuality !== params.drawerQuality) {
    diffFields.push({
      field: '品退',
      listValue: `${params.listQuality} 单`,
      drawerValue: `${params.drawerQuality} 单`,
    })
  }
  if (diffFields.length === 0) return null

  return {
    buyerDisplayName: params.buyerDisplayName,
    buyerKey: params.buyerKey,
    sampleOrderIds: params.sampleOrderIds.slice(0, 5),
    diffFields,
    possibleReasons: inferBuyerDrawerPossibleReasons(diffFields),
  }
}

export function buildBlockingIssueSummary(checks: import('./monthly-close-auto.types').DataAccuracyCheck[]): string[] {
  const issues: string[] = []
  for (const c of checks) {
    if (c.category !== 'blocking' || c.status !== 'danger') continue
    if (c.key === 'board_vs_daily_sum' && c.diffCent) {
      issues.push(
        `经营总览和运营日报差 ${formatCentYuan(Math.abs(c.diffCent))}，需要统一金额四舍五入口径`,
      )
    } else if (c.key === 'ranking_vs_standard_orders') {
      issues.push('榜单中心和标准订单池不一致，需要查看差异订单')
    } else if (c.key === 'bad_buyer_vs_drawer' && c.diffCount) {
      issues.push(`高风险售后客户榜有 ${c.diffCount} 个买家的售后数量和订单明细不一致`)
    } else if (c.key === 'buyer_ranking_vs_drawer' && c.diffCount) {
      issues.push(`买家榜有 ${c.diffCount} 个买家与订单明细不一致`)
    } else if (c.key === 'duplicate_orders') {
      issues.push('存在重复订单，需要排查去重键')
    } else if (c.key === 'pay_time_gap') {
      issues.push('支付时间预筛可能漏单，需要排查')
    } else {
      issues.push(`${c.title}：${c.note}`)
    }
  }
  return issues
}
