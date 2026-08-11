/**
 * AI 经营分析导出：物流 / 售后 / 低价排除统计 / live_review 质量 / 勾稽
 * 仅基于已过滤的 >= MIN_ANALYSIS 订单视图，禁止在最终 GMV 上事后扣减。
 */
import { formatDateKeyShanghai } from '../utils/business-timezone'
import type { AnalyzedOrderView } from '../types/analysis'
import {
  isLowPriceBrushOrderView,
  LOW_PRICE_BRUSH_THRESHOLD_CENT,
  resolvePaymentBaseCentForBrushCheck,
} from './low-price-brush-order.service'
import {
  isShippedOutOrderView,
  isStatusCompletedView,
  isStatusCourierSignedOnlyView,
} from './order-sign-status.service'
import {
  getAwaitingSignCompletionAmountCent,
  isAwaitingSignCompletionView,
} from './strict-after-sale-metrics.service'
import { readLiveReviewPartsStatus } from './xhs-api-sync/xhs-live-review-enrich.util'

export const ANALYSIS_ORDER_MIN_PAID_YUAN = LOW_PRICE_BRUSH_THRESHOLD_CENT / 100

function payYuan(v: AnalyzedOrderView): number {
  return resolvePaymentBaseCentForBrushCheck(v) / 100
}

function parseTimeMs(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw
  }
  const s = String(raw).trim()
  if (!s) return null
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return n < 1e12 ? n * 1000 : n
  }
  const ms = Date.parse(s.replace(/-/g, '/'))
  return Number.isFinite(ms) ? ms : null
}

function viewPayMs(v: AnalyzedOrderView & { raw?: Record<string, unknown> }): number | null {
  if (v.orderedAt instanceof Date && !Number.isNaN(v.orderedAt.getTime())) return v.orderedAt.getTime()
  const raw = v.raw
  if (!raw) return null
  return (
    parseTimeMs(raw.paidAt) ??
    parseTimeMs(raw.payTime) ??
    parseTimeMs(raw.paymentTime) ??
    parseTimeMs(raw.orderTime) ??
    parseTimeMs(raw.orderedAt)
  )
}

function viewShipMs(v: AnalyzedOrderView & { raw?: Record<string, unknown> }): number | null {
  const raw = v.raw
  if (!raw) return null
  return (
    parseTimeMs(raw.shipTime) ??
    parseTimeMs(raw.deliveryTime) ??
    parseTimeMs(raw.consignTime) ??
    parseTimeMs(raw.shippingTime)
  )
}

function viewSignMs(v: AnalyzedOrderView & { raw?: Record<string, unknown> }): number | null {
  const raw = v.raw
  if (!raw) return null
  return (
    parseTimeMs(raw.signTime) ??
    parseTimeMs(raw.confirmTime) ??
    parseTimeMs(raw.receiveTime) ??
    parseTimeMs(raw.finishedTime) ??
    parseTimeMs(raw.completeTime)
  )
}

function median(nums: number[]): number | null {
  if (!nums.length) return null
  const a = [...nums].sort((x, y) => x - y)
  const mid = Math.floor(a.length / 2)
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

function isUnshippedView(v: AnalyzedOrderView): boolean {
  if (!v.includedInGmv) return false
  if (isStatusCompletedView(v) || isStatusCourierSignedOnlyView(v) || isShippedOutOrderView(v)) {
    return false
  }
  const text = (v.orderStatusText ?? '').trim()
  if (!text) return false
  if (/已取消|已关闭|交易关闭|未支付|待支付/.test(text)) return false
  return /待发货|待配货|未发货/.test(text)
}

export function summarizeLowAmountExcluded(
  allViews: Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>,
) {
  const excluded = allViews.filter((v) => isLowPriceBrushOrderView(v))
  let paymentCent = 0
  let refundCent = 0
  let signedCent = 0
  for (const v of excluded) {
    paymentCent += resolvePaymentBaseCentForBrushCheck(v)
    refundCent += Math.max(0, v.returnAmountCent ?? v.productRefundAmountCent ?? 0)
    signedCent += Math.max(0, v.actualSignedAmountCent ?? 0)
  }
  return {
    orderCount: excluded.length,
    paymentAmount: Number((paymentCent / 100).toFixed(2)),
    refundAmount: Number((refundCent / 100).toFixed(2)),
    signedAmount: Number((signedCent / 100).toFixed(2)),
  }
}

type AgeBucketKey = '0-1d' | '1-2d' | '2-3d' | '3-5d' | '5d+'

function ageBucket(ageDays: number): AgeBucketKey {
  if (ageDays < 1) return '0-1d'
  if (ageDays < 2) return '1-2d'
  if (ageDays < 3) return '2-3d'
  if (ageDays < 5) return '3-5d'
  return '5d+'
}

function emptyBuckets(): Record<AgeBucketKey, { orderCount: number; amount: number }> {
  return {
    '0-1d': { orderCount: 0, amount: 0 },
    '1-2d': { orderCount: 0, amount: 0 },
    '2-3d': { orderCount: 0, amount: 0 },
    '3-5d': { orderCount: 0, amount: 0 },
    '5d+': { orderCount: 0, amount: 0 },
  }
}

export function buildLogisticsBlock(
  views: Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>,
  nowMs = Date.now(),
) {
  let paidOrders = 0
  let unshippedOrders = 0
  let unshippedAmount = 0
  let shippedUnsignedOrders = 0
  let shippedUnsignedAmount = 0
  let signedOrders = 0
  let signedAmount = 0
  let completedOrders = 0
  let completedAmount = 0
  const unsignedAgeBuckets = emptyBuckets()
  const payToShipHours: number[] = []
  const payToSignHours: number[] = []

  for (const v of views) {
    if (!v.includedInGmv && (v.paymentBaseCent ?? 0) <= 0) continue
    const amount = payYuan(v)
    paidOrders++
    const payMs = viewPayMs(v)
    const shipMs = viewShipMs(v)
    const signMs = viewSignMs(v)
    if (payMs != null && shipMs != null && shipMs >= payMs) {
      payToShipHours.push((shipMs - payMs) / 3600000)
    }
    if (payMs != null && signMs != null && signMs >= payMs) {
      payToSignHours.push((signMs - payMs) / 3600000)
    }

    const completed = isStatusCompletedView(v)
    const awaiting = isAwaitingSignCompletionView(v)
    const shippedOut = isShippedOutOrderView(v)
    const unshipped = isUnshippedView(v)

    if (completed) {
      completedOrders++
      completedAmount += amount
      signedOrders++
      signedAmount += Math.max(amount, (v.actualSignedAmountCent ?? 0) / 100)
    } else if (awaiting || shippedOut || isStatusCourierSignedOnlyView(v)) {
      shippedUnsignedOrders++
      shippedUnsignedAmount += awaiting ? getAwaitingSignCompletionAmountCent(v) / 100 : amount
      if (payMs != null) {
        const days = (nowMs - payMs) / 86400000
        const key = ageBucket(days)
        unsignedAgeBuckets[key].orderCount++
        unsignedAgeBuckets[key].amount += Number(amount.toFixed(2))
      }
    } else if (unshipped) {
      unshippedOrders++
      unshippedAmount += amount
      if (payMs != null) {
        const days = (nowMs - payMs) / 86400000
        const key = ageBucket(days)
        unsignedAgeBuckets[key].orderCount++
        unsignedAgeBuckets[key].amount += Number(amount.toFixed(2))
      }
    }
  }

  return {
    paidOrders,
    unshippedOrders,
    unshippedAmount: Number(unshippedAmount.toFixed(2)),
    shippedUnsignedOrders,
    shippedUnsignedAmount: Number(shippedUnsignedAmount.toFixed(2)),
    signedOrders,
    signedAmount: Number(signedAmount.toFixed(2)),
    completedOrders,
    completedAmount: Number(completedAmount.toFixed(2)),
    unsignedAgeBuckets,
    avgPayToShipHours: avg(payToShipHours),
    medianPayToShipHours: median(payToShipHours),
    avgPayToSignHours: avg(payToSignHours),
    medianPayToSignHours: median(payToSignHours),
  }
}

function hasAfterSaleSignal(v: AnalyzedOrderView): boolean {
  return (
    (v.returnAmountCent ?? 0) > 0 ||
    (v.productRefundAmountCent ?? 0) > 0 ||
    (v.realAfterSaleAmountCent ?? 0) > 0 ||
    v.isReturned === true ||
    v.isReturnRefundOrder === true ||
    v.isRefundOnlyOrder === true ||
    v.hasReturnRefundApplication === true ||
    v.hasRefundOnlyApplication === true ||
    Boolean((v.afterSaleStatusText ?? '').trim() && v.afterSaleStatusText !== '—')
  )
}

function afterSaleAmountYuan(v: AnalyzedOrderView): number {
  const cent = Math.max(
    0,
    v.returnAmountCent ?? 0,
    v.productRefundAmountCent ?? 0,
    v.realAfterSaleAmountCent ?? 0,
  )
  return cent / 100
}

function isPreShipmentRefund(v: AnalyzedOrderView & { raw?: Record<string, unknown> }): boolean {
  if (!hasAfterSaleSignal(v)) return false
  if (isShippedOutOrderView(v) || isStatusCompletedView(v) || isAwaitingSignCompletionView(v)) {
    return false
  }
  const text = `${v.orderStatusText ?? ''} ${v.afterSaleStatusText ?? ''}`
  return /未发货|待发货|待配货/.test(text) || isUnshippedView(v)
}

export function buildAfterSalesBlock(
  views: Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>,
) {
  let afterSaleOrderCount = 0
  let afterSaleAmount = 0
  let refundOnlyOrderCount = 0
  let refundOnlyAmount = 0
  let returnRefundOrderCount = 0
  let returnRefundAmount = 0
  let preShipmentRefundCount = 0
  let preShipmentRefundAmount = 0
  let platformInterventionCount = 0
  const reasonMap = new Map<string, { orderCount: number; amount: number }>()
  const payToAfterSaleHours: number[] = []
  const signedToAfterSaleHours: number[] = []
  const byAnchor = new Map<string, { afterSaleOrderCount: number; afterSaleAmount: number }>()
  const byShop = new Map<string, { afterSaleOrderCount: number; afterSaleAmount: number }>()

  for (const v of views) {
    if (!hasAfterSaleSignal(v)) continue
    const amount = afterSaleAmountYuan(v)
    afterSaleOrderCount++
    afterSaleAmount += amount

    const anchor = v.anchorName?.trim() || '未归属'
    const shop = v.liveAccountName?.trim() || '未知店铺'
    const a = byAnchor.get(anchor) ?? { afterSaleOrderCount: 0, afterSaleAmount: 0 }
    a.afterSaleOrderCount++
    a.afterSaleAmount += amount
    byAnchor.set(anchor, a)
    const s = byShop.get(shop) ?? { afterSaleOrderCount: 0, afterSaleAmount: 0 }
    s.afterSaleOrderCount++
    s.afterSaleAmount += amount
    byShop.set(shop, s)

    if (v.isRefundOnlyOrder || v.isRefundOnly || v.hasRefundOnlyApplication) {
      refundOnlyOrderCount++
      refundOnlyAmount += amount
    }
    if (v.isReturnRefundOrder || v.isReturnRefund || v.hasReturnRefundApplication) {
      returnRefundOrderCount++
      returnRefundAmount += amount
    }
    if (isPreShipmentRefund(v)) {
      preShipmentRefundCount++
      preShipmentRefundAmount += amount
    }
    const status = `${v.afterSaleStatusText ?? ''} ${v.afterSaleStatusLabel ?? ''}`
    if (/平台|介入|客服介入|仲裁/.test(status)) platformInterventionCount++

    const reason =
      (
        v.finalAfterSaleReason ||
        v.afterSaleReasonText ||
        v.afterSalesWorkbenchReason ||
        v.reasonText ||
        '未知原因'
      )
        .toString()
        .trim() || '未知原因'
    const r = reasonMap.get(reason) ?? { orderCount: 0, amount: 0 }
    r.orderCount++
    r.amount += amount
    reasonMap.set(reason, r)

    const payMs = viewPayMs(v)
    const afterMs =
      parseTimeMs(v.afterSaleSuccessTime) ??
      parseTimeMs(v.raw?.afterSaleTime) ??
      parseTimeMs(v.raw?.refundTime)
    if (payMs != null && afterMs != null && afterMs >= payMs) {
      payToAfterSaleHours.push((afterMs - payMs) / 3600000)
    }
    const signMs = viewSignMs(v)
    if (signMs != null && afterMs != null && afterMs >= signMs) {
      signedToAfterSaleHours.push((afterMs - signMs) / 3600000)
    }
  }

  const reasonDistribution = [...reasonMap.entries()]
    .map(([reason, v]) => ({
      reason,
      orderCount: v.orderCount,
      amount: Number(v.amount.toFixed(2)),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 40)

  return {
    afterSaleOrderCount,
    afterSaleAmount: Number(afterSaleAmount.toFixed(2)),
    refundOnlyOrderCount,
    refundOnlyAmount: Number(refundOnlyAmount.toFixed(2)),
    returnRefundOrderCount,
    returnRefundAmount: Number(returnRefundAmount.toFixed(2)),
    preShipmentRefundCount,
    preShipmentRefundAmount: Number(preShipmentRefundAmount.toFixed(2)),
    avgRefundAmount:
      afterSaleOrderCount > 0 ? Number((afterSaleAmount / afterSaleOrderCount).toFixed(2)) : null,
    reasonDistribution,
    platformInterventionCount,
    avgPayToAfterSaleHours: avg(payToAfterSaleHours),
    avgSignedToAfterSaleHours: avg(signedToAfterSaleHours),
    byAnchor: [...byAnchor.entries()].map(([anchorName, v]) => ({
      anchorName,
      afterSaleOrderCount: v.afterSaleOrderCount,
      afterSaleAmount: Number(v.afterSaleAmount.toFixed(2)),
    })),
    byShop: [...byShop.entries()].map(([shopName, v]) => ({
      shopName,
      afterSaleOrderCount: v.afterSaleOrderCount,
      afterSaleAmount: Number(v.afterSaleAmount.toFixed(2)),
    })),
  }
}

export function buildLiveReviewQualityByShop(
  sessions: Array<{
    shopName: string | null
    liveReviewFullyComplete: boolean
    liveReviewPartsStatus: ReturnType<typeof readLiveReviewPartsStatus>
    noteDetailAvailable: boolean
    overview: unknown
    traffic: unknown
  }>,
  remainingBackfill: number | null,
  lastEnrichAt: string | null,
) {
  const byShop = new Map<
    string,
    {
      totalSessions: number
      fullComplete: number
      partial: number
      missing: number
      failed: number
      noteDetailAvailable: number
    }
  >()

  for (const s of sessions) {
    const name = s.shopName?.trim() || '未知店铺'
    const row = byShop.get(name) ?? {
      totalSessions: 0,
      fullComplete: 0,
      partial: 0,
      missing: 0,
      failed: 0,
      noteDetailAvailable: 0,
    }
    row.totalSessions++
    const status = s.liveReviewPartsStatus
    const hasAny =
      s.overview != null ||
      s.traffic != null ||
      Object.values(status).some((x) => x === 'ok' || x === 'empty_ok' || x === 'failed')
    if (s.liveReviewFullyComplete) row.fullComplete++
    else if (hasAny && Object.values(status).some((x) => x === 'ok' || x === 'empty_ok')) {
      row.partial++
    } else if (Object.values(status).some((x) => x === 'failed') && hasAny) {
      row.failed++
    } else if (!hasAny) {
      row.missing++
    } else {
      row.failed++
    }
    if (s.noteDetailAvailable) row.noteDetailAvailable++
    byShop.set(name, row)
  }

  const shops = [...byShop.entries()].map(([shopName, v]) => ({
    shopName,
    ...v,
    remainingBackfill,
    lastEnrichAt,
  }))

  const totals = shops.reduce(
    (acc, s) => {
      acc.totalSessions += s.totalSessions
      acc.fullComplete += s.fullComplete
      acc.partial += s.partial
      acc.missing += s.missing
      acc.failed += s.failed
      acc.noteDetailAvailable += s.noteDetailAvailable
      return acc
    },
    {
      totalSessions: 0,
      fullComplete: 0,
      partial: 0,
      missing: 0,
      failed: 0,
      noteDetailAvailable: 0,
    },
  )

  return {
    ...totals,
    remainingBackfill,
    lastEnrichAt,
    byShop: shops,
  }
}

export function buildReconciliationBlock(params: {
  orderPaymentGmv: number
  sessionPaymentGmv: number
  eligibleOrderCount: number
  sessionDealOrders: number
  excluded: ReturnType<typeof summarizeLowAmountExcluded>
  offlineViews: AnalyzedOrderView[]
}) {
  const offlinePaymentGmv =
    params.offlineViews.reduce((s, v) => s + (v.paymentBaseCent ?? 0), 0) / 100
  return {
    orderPaymentGmv: Number(params.orderPaymentGmv.toFixed(2)),
    sessionPaymentGmv: Number(params.sessionPaymentGmv.toFixed(2)),
    difference: Number((params.orderPaymentGmv - params.sessionPaymentGmv).toFixed(2)),
    eligibleOrderCount: params.eligibleOrderCount,
    sessionDealOrders: params.sessionDealOrders,
    excludedLowAmountOrderCount: params.excluded.orderCount,
    excludedLowAmountPaymentGmv: params.excluded.paymentAmount,
    offlineOrderCount: params.offlineViews.length,
    offlinePaymentGmv: Number(offlinePaymentGmv.toFixed(2)),
  }
}

export function buildDataFreshness(params: {
  views: Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>
  sessions: Array<{
    startTime: string | null
    endTime: string | null
    overview: unknown
    traffic: unknown
  }>
  asOfDate: string
  now?: Date
}) {
  const now = params.now ?? new Date()
  let orderMax: number | null = null
  let afterSaleMax: number | null = null
  for (const v of params.views) {
    const p = viewPayMs(v)
    if (p != null) orderMax = orderMax == null ? p : Math.max(orderMax, p)
    const a =
      parseTimeMs(v.afterSaleSuccessTime) ??
      parseTimeMs(v.raw?.afterSaleTime) ??
      parseTimeMs(v.raw?.refundTime)
    if (a != null) afterSaleMax = afterSaleMax == null ? a : Math.max(afterSaleMax, a)
  }
  let sessionMax: number | null = null
  let liveReviewMax: number | null = null
  let openToday = false
  for (const s of params.sessions) {
    if (s.startTime) {
      const ms = Date.parse(s.startTime)
      if (Number.isFinite(ms)) sessionMax = sessionMax == null ? ms : Math.max(sessionMax, ms)
      const day = s.startTime.slice(0, 10)
      if (day === params.asOfDate && !s.endTime) openToday = true
    }
    if (s.endTime) {
      const ms = Date.parse(s.endTime)
      if (Number.isFinite(ms)) sessionMax = sessionMax == null ? ms : Math.max(sessionMax, ms)
    }
    if (s.overview != null || s.traffic != null) {
      const ms = s.endTime ? Date.parse(s.endTime) : s.startTime ? Date.parse(s.startTime) : NaN
      if (Number.isFinite(ms)) {
        liveReviewMax = liveReviewMax == null ? ms : Math.max(liveReviewMax, ms)
      }
    }
  }
  const todayKey = formatDateKeyShanghai(now)
  return {
    orderDataThrough: orderMax != null ? new Date(orderMax).toISOString() : null,
    afterSaleDataThrough: afterSaleMax != null ? new Date(afterSaleMax).toISOString() : null,
    logisticsDataThrough: orderMax != null ? new Date(orderMax).toISOString() : null,
    sessionDataThrough: sessionMax != null ? new Date(sessionMax).toISOString() : null,
    liveReviewDataThrough: liveReviewMax != null ? new Date(liveReviewMax).toISOString() : null,
    isCurrentDayComplete: !openToday && params.asOfDate < todayKey,
    generatedAt: now.toISOString(),
  }
}
