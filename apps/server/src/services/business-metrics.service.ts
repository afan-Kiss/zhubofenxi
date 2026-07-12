import type { AnalyzedOrderView } from '../types/analysis'

import { centToYuan } from '../utils/money'

import { resolveBuyerIdentityFromView } from './buyer-identity.service'

import { hasOrderPaymentTime, isOrderUnpaid } from './order-amount-metrics.service'
import { buildOrderMetricSets } from './order-metric-sets.service'
import { viewCountsAsQualityRefund } from './quality-refund-resolution.service'
import { getOfficialQualityPackageIdSet, getQualityBadCasesSync } from './quality-badcase-store.service'
import { aggregateRefundAmountCentByOrderNo } from './order-refund-metrics.service'
import { dedupeOrderCountByOrderNo } from './order-master-match.service'
import { dedupeViewsByMetricOrderNo, dedupeCoreMetricViewsByOrderNoBestValue, resolveMetricOrderNo } from './calc-refund-rate.service'
import { sumValidRevenueFromViews } from './valid-revenue-order.service'
import { isEffectiveSignedView } from './strict-after-sale-metrics.service'
import {
  isNoAfterSaleText,
  viewHasAfterSaleStatusSignal,
} from './after-sale-status-signal.service'
/** 全站经营指标统一计算（看板 / 排行 / 钻取 / 导出共用） */

export const BUSINESS_METRICS_VERSION = 'v11-valid-revenue-pool-2026-06'



export interface BusinessMetrics {

  version: string

  totalGmv: number

  validSalesAmount: number

  actualSignedAmount: number

  refundAmount: number

  freightRefundAmount: number

  /** 支付订单数：统计时间内有支付时间的订单 */

  orderCount: number

  /** 本期范围内全部订单（含未支付，用于 Drawer「本期」） */

  periodOrderCount: number

  signedOrderCount: number

  /** 退款订单数：本期已支付且真实退款金额>0（按 P 订单号去重） */
  refundOrderCount: number

  /** 售后记录条数（视图行级，可含同一订单多条售后信号） */
  afterSaleRecordCount: number

  /** 售后相关订单数（viewInvolvesRefundAfterSale，按 P 订单号去重） */
  afterSaleRelatedOrderCount: number

  /** 实际产生商品退款金额的订单数 */
  refundWithAmountOrderCount: number

  qualityRefundOrderCount: number

  /** 退货退款订单数（P 订单号去重） */
  returnOrderCount: number

  /** 仅退款订单数（P 订单号去重） */
  refundOnlyOrderCount: number

  /** 有退款金额但类型未识别 */
  unknownRefundTypeOrderCount: number

  /** 退款类型数据不完整（有退款但退货退款/仅退款均为0且存在未识别） */
  returnRefundTypeIncomplete: boolean

  /** 退款率 = 退款订单数 ÷ 支付订单数；分母为 0 时为 null */
  refundRate: number | null

  returnRate: number | null

  qualityRefundRate: number | null

  signRate: number | null

  /** 有效成交订单数（与 validSalesAmount 同一口径，按 P 单号去重） */
  shippedOrderCount: number

}



export function isQualityRefundOrder(view: AnalyzedOrderView): boolean {
  const officialPackageIds = getOfficialPackageIdSetFromCache()
  return viewCountsAsQualityRefund(view, officialPackageIds)
}

function getOfficialPackageIdSetFromCache(): Set<string> | undefined {
  const cases = getQualityBadCasesSync()
  if (!cases.length) return undefined
  return getOfficialQualityPackageIdSet(cases)
}



function viewIsUnpaid(v: AnalyzedOrderView): boolean {

  if (v.includedInGmv) return false

  const reason = v.gmvExcludeReason ?? ''

  return reason.includes('未支付')

}



/** 计入支付金额/支付订单数（官方：有支付时间且已支付，含已取消/已退款） */

export function viewCountsAsPaidOrder(v: AnalyzedOrderView): boolean {
  return v.includedInGmv === true
}

function viewIsCancelled(v: AnalyzedOrderView): boolean {
  const text = v.orderStatusText ?? ''
  return ['已取消', '取消', '交易关闭', '已关闭'].some((k) => text.includes(k))
}

export { isNoAfterSaleText } from './after-sale-status-signal.service'

export function viewHasRefundAfterSaleSignal(v: AnalyzedOrderView): boolean {
  return viewHasAfterSaleStatusSignal(v)
}

/** Drawer / 退款单数卡片：涉及退款、退货退款、售后关闭、已支付后取消等 */
export function viewInvolvesRefundAfterSale(v: AnalyzedOrderView): boolean {
  if (v.isFreightRefundOnly) return false
  const unpaid = viewIsUnpaid(v)
  const paid = v.includedInGmv
  const cancelled = viewIsCancelled(v)

  if (unpaid && !paid) {
    return viewHasRefundAfterSaleSignal(v)
  }
  if (viewHasRefundAfterSaleSignal(v)) return true
  if (cancelled && paid) return true
  return false
}

export function viewHasActualProductRefund(v: AnalyzedOrderView): boolean {
  return v.productRefundAmountCent > 0
}

export { viewCountsAsRefundOrder, resolveViewRefundAmountCent } from './order-refund-metrics.service'



export function calculateBusinessMetrics(
  views: AnalyzedOrderView[],
  warnCtx?: import('./calc-refund-rate.service').RefundRateWarnContext,
): BusinessMetrics {

  const dedupedViews = dedupeCoreMetricViewsByOrderNoBestValue(views)

  let totalGmvCent = 0

  let actualSignedCent = 0

  let freightRefundCent = 0

  for (const v of dedupedViews) {

    if (v.includedInGmv) {
      totalGmvCent += v.paymentBaseCent
    }

    if (isEffectiveSignedView(v)) {
      actualSignedCent += v.actualSignAmountCent ?? v.actualSignedAmountCent ?? 0
    }

    freightRefundCent += v.freightRefundAmountCent
  }

  const validRevenue = sumValidRevenueFromViews(views)
  const validSalesCent = validRevenue.validAmountCent

  const { totalCent: refundCent, byOrderNo: refundByOrderNo } =
    aggregateRefundAmountCentByOrderNo(views)
  const refundWithAmountOrderCount = refundByOrderNo.size

  const metricSets = buildOrderMetricSets(
    views,
    warnCtx ?? { scope: 'board-summary' },
    getQualityBadCasesSync(),
  )
  const periodOrderNos = views.map((v) => resolveMetricOrderNo(v)).filter(Boolean)

  return {

    version: BUSINESS_METRICS_VERSION,

    totalGmv: centToYuan(totalGmvCent),

    validSalesAmount: centToYuan(validSalesCent),

    actualSignedAmount: centToYuan(actualSignedCent),

    refundAmount: centToYuan(refundCent),

    freightRefundAmount: centToYuan(freightRefundCent),

    orderCount: metricSets.paidOrderCount,

    periodOrderCount: dedupeOrderCountByOrderNo(periodOrderNos),

    signedOrderCount: metricSets.signedOrderCount,

    refundOrderCount: metricSets.refundOrderCount,
    afterSaleRecordCount: metricSets.afterSaleRecordCount,
    afterSaleRelatedOrderCount: metricSets.afterSaleRelatedOrderCount,
    refundWithAmountOrderCount,

    qualityRefundOrderCount: metricSets.qualityRefundOrderCount,

    returnOrderCount: metricSets.returnOrderCount,

    refundOnlyOrderCount: metricSets.refundOnlyOrderCount,

    unknownRefundTypeOrderCount: metricSets.unknownRefundTypeOrderCount,

    returnRefundTypeIncomplete: metricSets.returnRefundTypeIncomplete,

    refundRate: metricSets.refundRate,

    returnRate: metricSets.returnRate,

    qualityRefundRate: metricSets.qualityRefundRate,

    signRate: metricSets.signRate,

    shippedOrderCount: validRevenue.soldOrderCount,

  }

}



export type BoardMetricValueKey =

  | 'gmv'

  | 'effectiveGmv'

  | 'actualSignedAmount'

  | 'returnAmount'

  | 'freightRefundAmount'

  | 'orderCount'

  | 'signedCount'

  | 'returnCount'

  | 'qualityReturnCount'

  | 'returnRefundCount'

  | 'returnRate'

  | 'returnRefundRate'

  | 'qualityReturnRate'

  | 'signRate'



export function pickMetricValue(metrics: BusinessMetrics, key: BoardMetricValueKey): number {

  switch (key) {

    case 'gmv':

      return metrics.totalGmv

    case 'effectiveGmv':

      return metrics.validSalesAmount

    case 'actualSignedAmount':

      return metrics.actualSignedAmount

    case 'returnAmount':

      return metrics.refundAmount

    case 'freightRefundAmount':

      return metrics.freightRefundAmount

    case 'orderCount':

      return metrics.orderCount

    case 'signedCount':

      return metrics.signedOrderCount

    case 'returnCount':

      return metrics.refundOrderCount

    case 'returnRefundCount':

      return metrics.returnOrderCount

    case 'qualityReturnCount':

      return metrics.qualityRefundOrderCount

    case 'returnRate':

      return metrics.refundRate ?? 0

    case 'returnRefundRate':

      return metrics.returnRate ?? 0

    case 'qualityReturnRate':

      return metrics.qualityRefundRate ?? 0

    case 'signRate':

      return metrics.signRate ?? 0

    default:

      return 0

  }

}



export function buildBlacklistedBuyerIds(views: AnalyzedOrderView[]): Set<string> {

  const ids = new Set<string>()

  for (const v of views) {

    if (!isQualityRefundOrder(v)) continue

    const identity = resolveBuyerIdentityFromView(v)

    if (identity) ids.add(identity.key)

  }

  return ids

}



export function isBlacklistedBuyer(

  buyerId: string,

  nickname: string,

  blacklist: Set<string>,

): boolean {

  if (buyerId && buyerId !== '未知买家' && blacklist.has(buyerId)) return true

  if (nickname && blacklist.has(`nick:${nickname}`)) return true

  return false

}



/** 从 NormalizedOrder 判断（导出/诊断用） */

export function orderCountsForStats(
  order: import('../types/analysis').NormalizedOrder,
): boolean {
  return hasOrderPaymentTime(order) && !isOrderUnpaid(order)
}


