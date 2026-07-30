import type { AnalyzedOrderView } from '../types/analysis'
import { centToYuan } from '../utils/money'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { pickProductName } from './order-row-mapper.service'
import { isLowPriceBrushOrderView } from './low-price-brush-order.service'
import { isActualAfterSaleOrder } from './operations-after-sale-order.util'
import {
  aggregateRefundAmountCentByOrderNo,
  resolveViewRefundAmountCent,
} from './order-refund-metrics.service'
import { viewAfterSaleCancelled } from './order-refund-application.service'
import { isShippedOutOrderView, isStatusSignedView } from './order-sign-status.service'

const CLOSED_OR_CANCELLED_KEYWORDS = ['已关闭', '交易关闭', '已取消', '交易取消']

const SHIP_LOGISTICS_KEYWORDS = [
  '已发货',
  '运输中',
  '派送中',
  '待收货',
  '待签收',
  '已签收',
  '已完成',
  '交易成功',
  '交易完成',
  '已收货',
] as const

function normalizeOrderStatus(view: AnalyzedOrderView): string {
  return (view.orderStatusText ?? '').trim()
}

function isDailyReportClosedOrCancelledOrder(v: AnalyzedOrderView): boolean {
  const orderStatus = normalizeOrderStatus(v)
  return CLOSED_OR_CANCELLED_KEYWORDS.some((k) => orderStatus.includes(k))
}

/** 有成功商品退款（纯运费补偿不算，与退款口径一致） */
function hasDailyReportBlockingProductRefund(v: AnalyzedOrderView): boolean {
  if (v.isFreightRefundOnly) return false
  if (resolveViewRefundAmountCent(v) > 0) return true
  if ((v.returnAmountCent ?? 0) > 0 && !v.isFreightRefundOnly) return true
  if (v.isRealProductRefund || v.isReturnRefund || v.isReturnRefundOrder) {
    return resolveViewRefundAmountCent(v) > 0 || (v.returnAmountCent ?? 0) > 0
  }
  return false
}

/**
 * 已发货 / 有物流 / 已签收完成信号（真实发货准入用）。
 * 「售后已取消 + 已发货」依赖此信号，不要求必须已签收。
 */
export function hasDailyReportShipLogisticsSignal(v: AnalyzedOrderView): boolean {
  if (isStatusSignedView(v)) return true
  if (isShippedOutOrderView(v)) return true
  const text = normalizeOrderStatus(v)
  if (!text) return false
  if (/待发货|待配货|未支付|待支付/.test(text) && !/已发货/.test(text)) return false
  return SHIP_LOGISTICS_KEYWORDS.some((k) => text.includes(k))
}

/**
 * 关闭/退货单（不计入真实发货）：
 * - 订单已关闭 / 交易取消
 * - 有成功商品退款
 * - 售后处理中 / 退货在途等仍有效售后
 * - 售后已取消/关闭无退款但**尚未发货**（无物流）
 *
 * 例外：售后已取消或关闭无退款，且订单已发货（有物流）→ **不算** invalid，可计入真实发货。
 * 与有效成交「取消售后/关闭无退款可计」一致，但真实发货额外要求已发出。
 */
export function isDailyReportInvalidOrder(v: AnalyzedOrderView): boolean {
  if (isDailyReportClosedOrCancelledOrder(v)) return true
  if (hasDailyReportBlockingProductRefund(v)) return true
  if (viewAfterSaleCancelled(v)) {
    // 取消/关闭无退款：仅当已发货才放行；未发货仍进「退货/无效」池
    return !hasDailyReportShipLogisticsSignal(v)
  }
  return isActualAfterSaleOrder(v)
}

/**
 * 真实发货计入订单：主播业绩内订单，剔除低价刷单、关闭/取消、成功退款与进行中售后。
 * 售后已取消/关闭无退款且已发货的，计入。金额取 paymentBaseCent（与支付金额一致）。
 */
export function isDailyReportShippedOrder(v: AnalyzedOrderView): boolean {
  if (!v.includedInGmv) return false
  if (isLowPriceBrushOrderView(v)) return false
  if (isDailyReportInvalidOrder(v)) return false
  return (v.paymentBaseCent ?? 0) > 0
}

/** 真实卖出单数（与真实发货金额同一订单池） */
export function isDailyReportSoldOrder(v: AnalyzedOrderView): boolean {
  return isDailyReportShippedOrder(v)
}

/** 真实发货金额：当天主播业绩合计；剔除关闭/成功退款/进行中售后（取消售后且已发货仍计） */
export function sumDailyReportShippedFromViews(views: AnalyzedOrderView[]): {
  shippedAmountCent: number
  shippedAmountYuan: number
  soldOrderCount: number
} {
  const deduped = dedupeViewsByMetricOrderNo(views)
  let shippedAmountCent = 0
  let soldOrderCount = 0
  for (const v of deduped) {
    if (!resolveMetricOrderNo(v) && v.paymentBaseCent <= 0) continue
    if (!isDailyReportShippedOrder(v)) continue
    shippedAmountCent += v.paymentBaseCent
    soldOrderCount += 1
  }
  return {
    shippedAmountCent,
    shippedAmountYuan: roundMoneyYuan(centToYuan(shippedAmountCent)),
    soldOrderCount,
  }
}

export interface DailyReportShippedOrderLine {
  orderNo: string
  productTitle: string
  amountYuan: number
  anchorName?: string
}

function pickProductTitleFromView(v: AnalyzedOrderView): string {
  const raw = (v as AnalyzedOrderView & { raw?: Record<string, unknown> }).raw
  const title = pickProductName(raw)
  return title && title !== '—' ? title : '商品名称未同步'
}

export function sortDailyReportShippedOrders(
  lines: DailyReportShippedOrderLine[],
): DailyReportShippedOrderLine[] {
  return [...lines].sort((a, b) => {
    const anchorCmp = (a.anchorName ?? '').localeCompare(b.anchorName ?? '', 'zh-CN')
    if (anchorCmp !== 0) return anchorCmp
    return (a.productTitle ?? '').localeCompare(b.productTitle ?? '', 'zh-CN')
  })
}

/** 真实发货订单明细（与 sumDailyReportShippedFromViews 同一订单池） */
export function listDailyReportShippedOrders(
  views: AnalyzedOrderView[],
  anchorName?: string,
): DailyReportShippedOrderLine[] {
  const deduped = dedupeViewsByMetricOrderNo(views)
  const lines: DailyReportShippedOrderLine[] = []
  for (const v of deduped) {
    if (!resolveMetricOrderNo(v) && v.paymentBaseCent <= 0) continue
    if (!isDailyReportShippedOrder(v)) continue
    const orderNo = resolveMetricOrderNo(v) || String(v.orderId ?? '').trim()
    if (!orderNo) continue
    const resolvedAnchorName = (anchorName ?? v.anchorName ?? '').trim()
    lines.push({
      orderNo,
      productTitle: pickProductTitleFromView(v),
      amountYuan: Math.round(centToYuan(v.paymentBaseCent) * 100) / 100,
      ...(resolvedAnchorName ? { anchorName: resolvedAnchorName } : {}),
    })
  }
  return sortDailyReportShippedOrders(lines)
}

export function countDailyReportOrders(views: AnalyzedOrderView[]): {
  soldOrderCount: number
  invalidOrderCount: number
} {
  const deduped = dedupeViewsByMetricOrderNo(views)
  let soldOrderCount = 0
  let invalidOrderCount = 0
  for (const v of deduped) {
    if (!resolveMetricOrderNo(v) && v.paymentBaseCent <= 0) continue
    if (isDailyReportInvalidOrder(v)) {
      invalidOrderCount += 1
      continue
    }
    if (isDailyReportSoldOrder(v)) {
      soldOrderCount += 1
    }
  }
  return { soldOrderCount, invalidOrderCount }
}

/** 退货（关闭/成功退款/进行中售后等无效单）：单数 + 支付金额合计 */
export function sumDailyReportReturnFromViews(views: AnalyzedOrderView[]): {
  returnOrderCount: number
  returnAmountYuan: number
} {
  const deduped = dedupeViewsByMetricOrderNo(views)
  let returnOrderCount = 0
  let returnAmountCent = 0
  for (const v of deduped) {
    if (!resolveMetricOrderNo(v) && v.paymentBaseCent <= 0) continue
    if (!isDailyReportInvalidOrder(v)) continue
    returnOrderCount += 1
    returnAmountCent += Math.max(0, v.paymentBaseCent ?? 0)
  }
  return {
    returnOrderCount,
    returnAmountYuan: roundMoneyYuan(centToYuan(returnAmountCent)),
  }
}

/** 退款：成功退款单数 + 退款金额（与看板退款聚合同源） */
export function sumDailyReportRefundFromViews(views: AnalyzedOrderView[]): {
  refundOrderCount: number
  refundAmountYuan: number
} {
  const { totalCent, byOrderNo } = aggregateRefundAmountCentByOrderNo(views)
  return {
    refundOrderCount: byOrderNo.size,
    refundAmountYuan: roundMoneyYuan(centToYuan(totalCent)),
  }
}

export function safeRatioPercent(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0 || part < 0) return null
  return Math.round((part / total) * 100)
}

export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null
  }
  const v = numerator / denominator
  return Number.isFinite(v) ? v : null
}

export function roundYuan(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value)
}

/** 金额保留两位小数（元），与 formatMoney 展示一致 */
export function roundMoneyYuan(value: number): number {
  return Math.round(value * 100) / 100
}

export function roundMinutes(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value)
}
