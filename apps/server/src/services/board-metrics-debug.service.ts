import type { AnalyzedOrderView } from '../types/analysis'
import { centToYuan } from '../utils/money'
import { isBoardMetricsDebugEnabled } from '../utils/server-log'
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import {
  aggregateRefundAmountCentByOrderNo,
  resolveViewRefundAmountCent,
  viewCountsAsRefundOrder,
} from './order-refund-metrics.service'
import { viewCountsAsPaidOrder } from './business-metrics.service'
import { buildOrderMetricSets } from './order-metric-sets.service'
import { pickOfficialPaidAmountCent } from './order-amount-metrics.service'
import { isEffectiveSignedView } from './strict-after-sale-metrics.service'
import { isStatusSignedView } from './order-sign-status.service'
import type { NormalizedOrder } from '../types/analysis'

export { isBoardMetricsDebugEnabled } from '../utils/server-log'

export const OFFICIAL_GMV_ACCEPT_20260528 = {
  date: '2026-05-28',
  paidAmountCent: 1_007_990,
  paidOrderCount: 9,
  refundAmountCent: 2_990,
} as const

export interface BoardMetricsDebugContext {
  dateRange?: { startDate: string; endDate: string; preset?: string }
  scope: string
  fetchMeta?: {
    orderPagesRead?: number
    orderRowsRead?: number
    afterSalePagesRead?: number
    afterSaleRowsRead?: number
  }
}

function paidAmountCentFromViews(views: AnalyzedOrderView[]): number {
  const byNo = new Map<string, number>()
  for (const v of views) {
    if (!viewCountsAsPaidOrder(v)) continue
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    const cent = v.officialPaidAmountCent ?? v.paymentBaseCent ?? 0
    if (cent > 0) byNo.set(no, cent)
  }
  let sum = 0
  for (const c of byNo.values()) sum += c
  return sum
}

export function logBoardMetricsDebug(
  views: AnalyzedOrderView[],
  ctx: BoardMetricsDebugContext,
): void {
  if (!isBoardMetricsDebugEnabled()) return
  const sets = buildOrderMetricSets(views, { scope: ctx.scope })
  const { totalCent: refundAmountCent, byOrderNo: refundByNo } =
    aggregateRefundAmountCentByOrderNo(views)

  const paidNos = [...new Set(sets.paidOrderNos)]
  const meta = ctx.fetchMeta

  console.log(
    [
      `[board-metrics-debug] scope=${ctx.scope}`,
      ctx.dateRange
        ? `dateRange=${ctx.dateRange.preset ?? 'custom'} ${ctx.dateRange.startDate}~${ctx.dateRange.endDate}`
        : '',
      `rawOrderCount=${views.length}`,
      `paidOrderCount=${sets.paidOrderCount}`,
      `paidOrderNos.length=${paidNos.length}`,
      `paidAmountCent=${paidAmountCentFromViews(views)}`,
      `refundAmountCent=${refundAmountCent}`,
      `refundOrderCount=${sets.refundOrderCount}`,
      `refundOrderNos.length=${refundByNo.size}`,
      `returnOrderCount=${sets.returnOrderCount}`,
      `qualityRefundOrderCount=${sets.qualityRefundOrderCount}`,
      `signedOrderCount=${sets.signedOrderCount}`,
      `signRate=${sets.signRate == null ? '--' : `${((sets.signRate ?? 0) * 100).toFixed(2)}%`}`,
      `refundRate=${sets.refundRate == null ? '--' : `${((sets.refundRate ?? 0) * 100).toFixed(2)}%`}`,
      `returnRate=${sets.returnRate == null ? '--' : `${((sets.returnRate ?? 0) * 100).toFixed(2)}%`}`,
      `qualityRefundRate=${sets.qualityRefundRate == null ? '--' : `${((sets.qualityRefundRate ?? 0) * 100).toFixed(2)}%`}`,
      meta ? `orderPagesRead=${meta.orderPagesRead ?? 0}` : '',
      meta ? `orderRowsRead=${meta.orderRowsRead ?? 0}` : '',
      meta ? `afterSalePagesRead=${meta.afterSalePagesRead ?? 0}` : '',
      meta ? `afterSaleRowsRead=${meta.afterSaleRowsRead ?? 0}` : '',
      meta ? `afterSaleMatchedOrderCount=${refundByNo.size}` : '',
    ]
      .filter(Boolean)
      .join('\n  '),
  )

  if (meta?.orderRowsRead === 200 && (meta.orderPagesRead ?? 0) <= 5) {
    console.warn('[board-metrics-debug] 订单可能未全量读取，请检查分页停止条件')
  }
  if (sets.refundOrderCount > sets.paidOrderCount) {
    console.warn('[board-metrics-debug] 退款订单数大于支付订单数，请检查售后记录重复或分母错误')
  }
  if (sets.refundOrderCount > 0 && refundAmountCent === 0) {
    console.warn('[board-metrics-debug] 存在退款订单数但退款金额为0，请检查退款订单判断')
  }
  const statusSignedCount = views.filter((v) => isStatusSignedView(v) && viewCountsAsPaidOrder(v)).length
  if (statusSignedCount > sets.signedOrderCount + 5) {
    console.warn(
      '[board-metrics-debug] 签收单数异常偏低，请检查已完成/交易成功状态是否计入签收',
    )
  }

  const dr = ctx.dateRange
  if (
    dr &&
    dr.startDate === OFFICIAL_GMV_ACCEPT_20260528.date &&
    dr.endDate === OFFICIAL_GMV_ACCEPT_20260528.date
  ) {
    const paidCent = paidAmountCentFromViews(views)
    if (paidCent !== OFFICIAL_GMV_ACCEPT_20260528.paidAmountCent) {
      console.warn(
        `[board-metrics-debug] 今日支付金额与官方验收值不一致 actual=${paidCent} expected=${OFFICIAL_GMV_ACCEPT_20260528.paidAmountCent}`,
      )
    }
  }
}

export function logAnchorMetricsDebug(
  anchorName: string,
  views: AnalyzedOrderView[],
  ctx: BoardMetricsDebugContext,
): void {
  if (!isBoardMetricsDebugEnabled()) return
  const sets = buildOrderMetricSets(views, { scope: 'anchor', anchorName })
  const { totalCent: refundAmountCent } = aggregateRefundAmountCentByOrderNo(views)

  console.log(
    [
      `[board-metrics-debug] anchor=${anchorName}`,
      `rawOrderCount=${views.length}`,
      `paidOrderCount=${sets.paidOrderCount}`,
      `paidAmountCent=${paidAmountCentFromViews(views)}`,
      `refundAmountCent=${refundAmountCent}`,
      `refundOrderCount=${sets.refundOrderCount}`,
      `returnOrderCount=${sets.returnOrderCount}`,
      `qualityRefundOrderCount=${sets.qualityRefundOrderCount}`,
      `signedOrderCount=${sets.signedOrderCount}`,
      `signRate=${sets.signRate == null ? '--' : `${((sets.signRate ?? 0) * 100).toFixed(2)}%`}`,
      `refundRate=${sets.refundRate == null ? '--' : `${((sets.refundRate ?? 0) * 100).toFixed(2)}%`}`,
      `returnRate=${sets.returnRate == null ? '--' : `${((sets.returnRate ?? 0) * 100).toFixed(2)}%`}`,
      `qualityRefundRate=${sets.qualityRefundRate == null ? '--' : `${((sets.qualityRefundRate ?? 0) * 100).toFixed(2)}%`}`,
    ].join('\n  '),
  )
}

export function warnAnchorTotalsMismatch(
  summary: Record<string, unknown>,
  anchors: Array<Record<string, unknown>>,
): void {
  if (!isBoardMetricsDebugEnabled()) return
  const sum = (key: string) =>
    anchors.reduce((s, a) => s + Number(a[key] ?? 0), 0)
  const checks: Array<[string, string]> = [
    ['totalGmv', 'gmv'],
    ['returnAmount', 'returnAmount'],
    ['orderCount', 'orderCount'],
    ['returnCount', 'returnCount'],
  ]
  for (const [summaryKey, anchorKey] of checks) {
    const top = Number(summary[summaryKey] ?? summary.gmv ?? 0)
    const sub = sum(anchorKey)
    if (Math.abs(top - sub) > 0.02 && anchors.length > 0) {
      console.warn(
        `[board-metrics-debug] 主播合计与经营总览不一致 field=${anchorKey} summary=${top} anchors=${sub}`,
      )
    }
  }
}

export function explainOrderPaidCent(order: NormalizedOrder): number {
  return pickOfficialPaidAmountCent(order).cent
}
