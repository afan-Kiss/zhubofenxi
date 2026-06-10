import type { AnalyzedOrderView } from '../types/analysis'
import type { UserRole } from '../types/roles'
import { centToYuan } from '../utils/money'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { formatDateTimeShanghai } from '../utils/business-timezone'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { resolveDisplayOrderNoForView } from './order-display-no.service'
import {
  getBoardScopedViewsForRange,
} from './board-scoped-views.service'
import { attachRawByMatchToViews, isLowPriceBrushOrderView } from './low-price-brush-order.service'
import { getAnchorConfigSync } from './anchor.service'
import {
  resolveAnchorLiveSessionsForRange,
  type AnchorLiveSessionBrief,
} from './anchor-live-sessions.service'
import { isFreightOnlyBoardRefundCent } from './sign-amount-refund.service'

const PRIVACY_KEY_RE =
  /phone|mobile|tel|address|idcard|id_card|identity|receiver|consignee|realname|real_name|recipient|detailaddr|street|province|city|district|town|zip/i

export interface DailyReportRawOrderRow {
  orderId: string
  orderTime: string
  payTime: string
  shipTime: string
  finishTime: string
  closeTime: string
  productName: string
  skuName: string
  quantity: number | null
  orderAmount: number | null
  payAmount: number | null
  shippedAmount: number | null
  refundAmount: number | null
  shippingFee: number | null
  orderStatus: string
  afterSaleStatus: string
  refundStatus: string
  anchorName: string
  matchedLiveSession: string
  liveAccountName: string
  shopName: string
  isLowPriceOrder: boolean
  isClosed: boolean
  isAfterSaleCompleted: boolean
  isRefunded: boolean
  isFreightRefundOnly: boolean
  includedInGmv: boolean
  gmvExcludeReason: string
  rawSource: string
}

export interface DailyReportRawLiveSessionRow {
  anchorName: string
  startTime: string
  endTime: string
  durationMinutes: number
  liveName: string
}

export interface DailyReportRawChatGptPayload {
  range: {
    start: string
    end: string
    label: string
  }
  rawOrders: DailyReportRawOrderRow[]
  liveSessions: DailyReportRawLiveSessionRow[]
}

function pickString(raw: Record<string, unknown> | undefined, keys: string[]): string {
  if (!raw) return ''
  for (const k of keys) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function pickTime(raw: Record<string, unknown> | undefined, keys: string[]): string {
  return pickString(raw, keys)
}

function pickShopName(raw: Record<string, unknown> | undefined): string {
  return pickString(raw, ['shopName', 'shop_name', 'sellerShopName', 'seller_shop_name', 'storeName', 'store_name'])
}

function pickSkuName(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    const name = first.skuName ?? first.displayName ?? first.name ?? first.spec
    if (name != null && String(name).trim()) return String(name).trim()
  }
  return pickString(raw, ['skuName', 'sku_name', 'spec', 'specification'])
}

function pickQuantity(raw: Record<string, unknown> | undefined): number | null {
  if (!raw) return null
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    let total = 0
    for (const row of skus) {
      if (!row || typeof row !== 'object') continue
      const sku = row as Record<string, unknown>
      const n = Number(sku.skuQuantity ?? sku.quantity ?? sku.qty ?? 1)
      total += Number.isFinite(n) && n > 0 ? n : 1
    }
    return total > 0 ? total : null
  }
  const n = Number(raw.quantity ?? raw.qty ?? raw.skuQuantity)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

function pickProductName(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    const name = first.skuName ?? first.displayName ?? first.name ?? first.productName
    if (name != null && String(name).trim()) return String(name).trim()
  }
  return pickString(raw, ['productName', 'product_name', 'title', 'itemName'])
}

function yuanFromCent(cent: number | null | undefined): number | null {
  if (cent == null || !Number.isFinite(cent)) return null
  return centToYuan(cent)
}

function isClosedOrder(v: AnalyzedOrderView): boolean {
  const text = (v.orderStatusText ?? '').trim()
  return ['已关闭', '交易关闭'].some((k) => text.includes(k))
}

function isAfterSaleCompleted(v: AnalyzedOrderView): boolean {
  return (v.afterSaleStatusText ?? '').includes('售后完成')
}

function resolveRefundStatus(v: AnalyzedOrderView): string {
  if (v.isFreightRefundOnly) return '纯运费退款'
  if (v.productRefundAmountCent > 0 || v.isRealProductRefund || v.isReturnRefund) {
    if (v.productRefundAmountCent >= v.paymentBaseCent && v.paymentBaseCent > 0) return '已退款'
    return '部分退款'
  }
  return '无'
}

function resolveMatchedLiveSession(v: AnalyzedOrderView): string {
  const start = v.matchedLiveStartTime?.trim()
  const end = v.matchedLiveEndTime?.trim()
  if (start && end) return `${start}~${end}`
  if (start) return start
  return ''
}

function mapViewToRawOrder(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): DailyReportRawOrderRow {
  const raw = view.raw
  return {
    orderId: resolveDisplayOrderNoForView(view) || resolveMetricOrderNo(view) || view.orderId,
    orderTime: view.orderTimeText || pickTime(raw, ['orderTime', 'order_time', 'createdAt']),
    payTime: pickTime(raw, ['payTime', 'pay_time', 'paidTime', 'paymentTime']) || view.orderTimeText || '',
    shipTime: pickTime(raw, ['shipTime', 'ship_time', 'deliveryTime', 'sendTime']),
    finishTime: pickTime(raw, ['finishTime', 'finish_time', 'completedAt', 'completeTime', 'signedAt', 'signTime']),
    closeTime: pickTime(raw, ['closeTime', 'close_time', 'closedAt', 'cancelTime']),
    productName: pickProductName(raw) || '—',
    skuName: pickSkuName(raw) || '—',
    quantity: pickQuantity(raw),
    orderAmount: yuanFromCent(view.receivableAmountCent || view.productAmountCent || view.paymentBaseCent),
    payAmount: yuanFromCent(view.paymentBaseCent || view.actualPaidCent || view.statPaidAmountCent),
    shippedAmount: yuanFromCent(view.effectiveGmvCent),
    refundAmount: yuanFromCent(
      view.productRefundAmountCent || view.buyerProductRefundAmountCent || view.realAfterSaleAmountCent,
    ),
    shippingFee: yuanFromCent(view.freightCent),
    orderStatus: view.orderStatusText || '—',
    afterSaleStatus: view.afterSaleStatusText || '—',
    refundStatus: resolveRefundStatus(view),
    anchorName: view.anchorName || '未归属',
    matchedLiveSession: resolveMatchedLiveSession(view),
    liveAccountName: view.liveAccountName || pickString(raw, ['liveAccountName', 'nickName']) || '—',
    shopName: pickShopName(raw) || '—',
    isLowPriceOrder: isLowPriceBrushOrderView(view),
    isClosed: isClosedOrder(view),
    isAfterSaleCompleted: isAfterSaleCompleted(view),
    isRefunded: view.productRefundAmountCent > 0 || view.isReturnRefund || view.isRefundOnly,
    isFreightRefundOnly: Boolean(
      view.isFreightRefundOnly ||
        isFreightOnlyBoardRefundCent(view.freightRefundAmountCent, view.productRefundAmountCent),
    ),
    includedInGmv: Boolean(view.includedInGmv),
    gmvExcludeReason: view.gmvExcludeReason || '',
    rawSource: 'xiaohongshu',
  }
}

/** 剔除 raw 中可能影响隐私的字段（供调试/扩展；复制文本不直接输出 raw JSON） */
export function sanitizeRawOrderForChatGpt(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (PRIVACY_KEY_RE.test(key)) continue
    if (key === 'buyerId' || key === '_buyerNickname' || key === 'buyerNickname') continue
    out[key] = value
  }
  return out
}

function mapLiveSession(session: AnchorLiveSessionBrief, anchorName: string): DailyReportRawLiveSessionRow {
  return {
    anchorName,
    startTime: session.startTime.slice(11, 16),
    endTime: session.endTime.slice(11, 16),
    durationMinutes: session.durationMinutes,
    liveName: session.liveName || '—',
  }
}

export async function buildDailyReportRawChatGptData(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<DailyReportRawChatGptPayload> {
  const preset = (params.preset ?? 'custom') as DateRangePreset
  const range = resolveDateRange(preset, params.startDate, params.endDate)
  const scoped = await getBoardScopedViewsForRange({
    preset,
    startDate: params.startDate,
    endDate: params.endDate,
    role: params.role,
    username: params.username,
  })

  const viewsWithRaw = attachRawByMatchToViews(scoped.views, scoped.rawByMatch)
  const rawOrders = dedupeViewsByMetricOrderNo(viewsWithRaw).map(mapViewToRawOrder)

  const config = getAnchorConfigSync()
  const liveSessions: DailyReportRawLiveSessionRow[] = []
  for (const anchor of config.anchors.filter((a) => a.enabled)) {
    const sessions = await resolveAnchorLiveSessionsForRange({
      preset,
      startDate: params.startDate,
      endDate: params.endDate,
      anchorId: anchor.id,
      anchorName: anchor.name,
    })
    for (const session of sessions) {
      liveSessions.push(mapLiveSession(session, anchor.name))
    }
  }

  const label =
    params.startDate === params.endDate ? params.startDate : `${params.startDate}~${params.endDate}`

  return {
    range: {
      start: formatDateTimeShanghai(new Date(range.startTimeMs)),
      end: formatDateTimeShanghai(new Date(range.endTimeMs)),
      label,
    },
    rawOrders,
    liveSessions,
  }
}
