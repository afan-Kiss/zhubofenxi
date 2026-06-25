import type { AnalyzedOrderView } from '../types/analysis'
import type { UserRole } from '../types/roles'
import { centToYuan } from '../utils/money'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { formatDateTimeShanghai } from '../utils/business-timezone'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { resolveDisplayOrderNoForView } from './order-display-no.service'
import { getBoardScopedViewsForRange } from './board-scoped-views.service'
import {
  ANCHOR_SESSION_DISPLAY_FROM_0613,
  isReportDateOnOrAfterShopSessionCutoff,
  remapViewsForAnchorPerformance,
  resolveDailyReportAnchorsForDate,
} from './anchor-performance-attribution.service'
import { attachRawByMatchToViews, isLowPriceBrushOrderView } from './low-price-brush-order.service'
import { getAnchorConfigSync } from './anchor.service'
import {
  formatLiveDurationMinutes,
  resolveAnchorLiveSessionsForRange,
  type AnchorLiveSessionBrief,
} from './anchor-live-sessions.service'
import { isFreightOnlyBoardRefundCent } from './sign-amount-refund.service'
import {
  sanitizeDailyReportRawOrderRow,
  shouldIncludeRawPlatformJson,
} from './operations-report-privacy.util'

export interface DailyReportRawOrderRow {
  orderId: string
  packageId: string
  bizOrderId: string
  matchOrderId: string
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
  freightRefundAmount: number | null
  shippingFee: number | null
  platformDiscount: number | null
  sellerReceiveAmount: number | null
  signedAmount: number | null
  actualSignedAmount: number | null
  orderStatus: string
  afterSaleStatus: string
  refundStatus: string
  afterSaleCategory: string
  afterSaleReason: string
  finalAfterSaleReason: string
  anchorName: string
  anchorId: string
  attributionType: string
  matchedRuleName: string
  matchedLiveSession: string
  matchedLiveStartTime: string
  matchedLiveEndTime: string
  liveAccountId: string
  liveAccountName: string
  shopName: string
  buyerId: string
  buyerNickname: string
  buyerDisplayName: string
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  isLowPriceOrder: boolean
  isClosed: boolean
  isAfterSaleCompleted: boolean
  isRefunded: boolean
  isReturnRefund: boolean
  isRefundOnly: boolean
  isFreightRefundOnly: boolean
  isSigned: boolean
  isActualSigned: boolean
  isQualityReturn: boolean
  strictQualityRefund: boolean
  officialQualityBadCase: boolean
  includedInGmv: boolean
  gmvExcludeReason: string
  paymentBaseSource: string
  rawSource: string
  platformRawJson: string
}

export interface DailyReportRawLiveSessionRow {
  anchorName: string
  sessionLabel: string
  shopName: string
  liveAccountName: string
  startTime: string
  endTime: string
  startDateTime: string
  endDateTime: string
  durationMinutes: number
  durationText: string
  liveName: string
  liveId: string
}

export interface DailyReportAnchorLiveBlock {
  anchorName: string
  sessionLabel: string
  shopName: string
  livePeriodText: string
  totalDurationMinutes: number
  totalDurationText: string
  sessions: DailyReportRawLiveSessionRow[]
}

export interface DailyReportRawChatGptPayload {
  range: {
    start: string
    end: string
    label: string
  }
  anchorLiveBlocks: DailyReportAnchorLiveBlock[]
  liveSessions: DailyReportRawLiveSessionRow[]
  rawOrders: DailyReportRawOrderRow[]
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
  return pickString(raw, [
    'shopName',
    'shop_name',
    'sellerShopName',
    'seller_shop_name',
    'storeName',
    'store_name',
  ])
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

function pickBuyerNickname(
  view: AnalyzedOrderView,
  raw: Record<string, unknown> | undefined,
): string {
  return (
    view.buyerNickname?.trim() ||
    view.buyerDisplayName?.trim() ||
    pickString(raw, [
      'buyerNickname',
      '_buyerNickname',
      'buyerNick',
      'buyer_nick',
      'userNick',
      'user_nick',
      'nickName',
      'nick_name',
    ]) ||
    ''
  )
}

function pickReceiverName(raw: Record<string, unknown> | undefined): string {
  return pickString(raw, [
    'receiverName',
    'receiver_name',
    'consignee',
    'consigneeName',
    'recipientName',
    'recipient_name',
    'realName',
    'real_name',
  ])
}

function pickReceiverPhone(raw: Record<string, unknown> | undefined): string {
  return pickString(raw, [
    'receiverPhone',
    'receiver_phone',
    'receiverMobile',
    'receiver_mobile',
    'mobile',
    'phone',
    'tel',
    'contactPhone',
    'contact_phone',
  ])
}

function pickReceiverAddress(raw: Record<string, unknown> | undefined): string {
  const parts = [
    pickString(raw, ['province', 'provinceName', 'receiverProvince']),
    pickString(raw, ['city', 'cityName', 'receiverCity']),
    pickString(raw, ['district', 'districtName', 'town', 'receiverDistrict']),
    pickString(raw, [
      'receiverAddress',
      'receiver_address',
      'address',
      'detailAddress',
      'detail_address',
      'street',
    ]),
  ].filter(Boolean)
  return parts.join('')
}

function yuanFromCent(cent: number | null | undefined): number | null {
  if (cent == null || !Number.isFinite(cent)) return null
  return centToYuan(cent)
}

function stringifyPlatformRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw || Object.keys(raw).length === 0) return ''
  try {
    return JSON.stringify(raw)
  } catch {
    return ''
  }
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

function buildLivePeriodText(sessions: DailyReportRawLiveSessionRow[]): string {
  if (sessions.length === 0) return '—'
  if (sessions.length === 1) {
    const s = sessions[0]!
    return `${s.startTime}~${s.endTime}`
  }
  const first = sessions[0]!
  const last = sessions[sessions.length - 1]!
  return `${first.startTime}~${last.endTime}`
}

function mapLiveSession(
  session: AnchorLiveSessionBrief,
  anchorName: string,
  sessionLabel: string,
  shopName: string,
): DailyReportRawLiveSessionRow {
  return {
    anchorName,
    sessionLabel,
    shopName,
    liveAccountName: shopName,
    startTime: session.startTime.slice(11, 16),
    endTime: session.endTime.slice(11, 16),
    startDateTime: session.startTime,
    endDateTime: session.endTime,
    durationMinutes: session.durationMinutes,
    durationText: session.durationText || formatLiveDurationMinutes(session.durationMinutes),
    liveName: session.liveName || '—',
    liveId: session.liveId || '—',
  }
}

function mapViewToRawOrder(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): DailyReportRawOrderRow {
  const raw = view.raw
  return {
    orderId: resolveDisplayOrderNoForView(view) || resolveMetricOrderNo(view) || view.orderId,
    packageId: view.packageId || pickString(raw, ['packageId', 'package_id']) || '—',
    bizOrderId: view.bizOrderId || pickString(raw, ['bizOrderId', 'biz_order_id']) || '—',
    matchOrderId: view.matchOrderId || '—',
    orderTime: view.orderTimeText || pickTime(raw, ['orderTime', 'order_time', 'createdAt']),
    payTime:
      pickTime(raw, ['payTime', 'pay_time', 'paidTime', 'paymentTime']) || view.orderTimeText || '',
    shipTime: pickTime(raw, ['shipTime', 'ship_time', 'deliveryTime', 'sendTime']),
    finishTime: pickTime(raw, [
      'finishTime',
      'finish_time',
      'completedAt',
      'completeTime',
      'signedAt',
      'signTime',
    ]),
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
    freightRefundAmount: yuanFromCent(view.freightRefundAmountCent),
    shippingFee: yuanFromCent(view.freightCent),
    platformDiscount: yuanFromCent(view.platformDiscountCent),
    sellerReceiveAmount: yuanFromCent(
      view.actualSellerReceiveAmountCent || view.effectiveGmvCent,
    ),
    signedAmount: yuanFromCent(view.actualSignedAmountCent),
    actualSignedAmount: yuanFromCent(view.actualSignAmountCent ?? view.actualSignedAmountCent),
    orderStatus: view.orderStatusText || '—',
    afterSaleStatus: view.afterSaleStatusText || '—',
    refundStatus: resolveRefundStatus(view),
    afterSaleCategory: view.afterSaleCategory || view.afterSaleDisplayType || '—',
    afterSaleReason:
      view.reasonText ||
      view.afterSaleReasonText ||
      view.afterSalesWorkbenchReason ||
      pickString(raw, ['afterSaleReason', 'refundReason', 'reason']) ||
      '—',
    finalAfterSaleReason: view.finalAfterSaleReason || '—',
    anchorName: view.anchorName || '未归属',
    anchorId: view.anchorId || '—',
    attributionType: view.attributionType || '—',
    matchedRuleName: view.matchedRuleName || '—',
    matchedLiveSession: resolveMatchedLiveSession(view),
    matchedLiveStartTime: view.matchedLiveStartTime || '—',
    matchedLiveEndTime: view.matchedLiveEndTime || '—',
    liveAccountId: view.liveAccountId || pickString(raw, ['liveAccountId', 'live_account_id']) || '—',
    liveAccountName:
      view.liveAccountName || pickString(raw, ['liveAccountName', 'nickName', 'liveNick']) || '—',
    shopName: pickShopName(raw) || '—',
    buyerId: view.buyerId || pickString(raw, ['buyerId', 'buyer_id', 'userId', 'user_id']) || '—',
    buyerNickname: pickBuyerNickname(view, raw) || '—',
    buyerDisplayName: view.buyerDisplayName || view.buyerDisplayLabel || '—',
    receiverName: pickReceiverName(raw) || '—',
    receiverPhone: pickReceiverPhone(raw) || '—',
    receiverAddress: pickReceiverAddress(raw) || '—',
    isLowPriceOrder: isLowPriceBrushOrderView(view),
    isClosed: isClosedOrder(view),
    isAfterSaleCompleted: isAfterSaleCompleted(view),
    isRefunded: view.productRefundAmountCent > 0 || view.isReturnRefund || view.isRefundOnly,
    isReturnRefund: Boolean(view.isReturnRefund || view.isReturnRefundOrder),
    isRefundOnly: Boolean(view.isRefundOnly),
    isFreightRefundOnly: Boolean(
      view.isFreightRefundOnly ||
        isFreightOnlyBoardRefundCent(view.freightRefundAmountCent, view.productRefundAmountCent),
    ),
    isSigned: Boolean(view.isSigned || view.statusSigned),
    isActualSigned: Boolean(view.isActualSigned || view.isEffectiveSigned),
    isQualityReturn: Boolean(view.isQualityReturn || view.strictQualityRefund),
    strictQualityRefund: Boolean(view.strictQualityRefund),
    officialQualityBadCase: Boolean(view.officialQualityBadCase),
    includedInGmv: Boolean(view.includedInGmv),
    gmvExcludeReason: view.gmvExcludeReason || '',
    paymentBaseSource: view.paymentBaseSource || '—',
    rawSource: 'xiaohongshu',
    platformRawJson: stringifyPlatformRaw(raw),
  }
}

function resolveMatchedLiveSession(v: AnalyzedOrderView): string {
  const start = v.matchedLiveStartTime?.trim()
  const end = v.matchedLiveEndTime?.trim()
  if (start && end) return `${start}~${end}`
  if (start) return start
  return '—'
}

/** 保留完整原始字段，不做脱敏（供内部 ChatGPT 分析） */
export function sanitizeRawOrderForChatGpt(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw }
}

function buildAnchorLiveBlocks(
  reportAnchors: Array<{ anchorId: string; anchorName: string }>,
  sessionsByAnchor: Map<string, DailyReportRawLiveSessionRow[]>,
  useShopSessionRules: boolean,
): DailyReportAnchorLiveBlock[] {
  const blocks: DailyReportAnchorLiveBlock[] = []
  for (const anchor of reportAnchors) {
    const sessions = sessionsByAnchor.get(anchor.anchorName) ?? []
    const fixedDisplay = useShopSessionRules
      ? ANCHOR_SESSION_DISPLAY_FROM_0613[anchor.anchorName]
      : undefined
    const sessionLabel = fixedDisplay?.sessionLabel ?? anchor.anchorName
    const shopName =
      fixedDisplay?.shopName ??
      sessions[0]?.liveAccountName ??
      sessions[0]?.shopName ??
      '—'
    const totalDurationMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
    blocks.push({
      anchorName: anchor.anchorName,
      sessionLabel,
      shopName,
      livePeriodText: buildLivePeriodText(sessions),
      totalDurationMinutes,
      totalDurationText: formatLiveDurationMinutes(totalDurationMinutes),
      sessions,
    })
  }
  return blocks
}

export async function buildDailyReportRawChatGptData(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
  confirmRaw?: boolean
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

  const viewsWithRaw = remapViewsForAnchorPerformance(
    attachRawByMatchToViews(scoped.views, scoped.rawByMatch),
  )
  const rawOrdersBase = dedupeViewsByMetricOrderNo(viewsWithRaw).map(mapViewToRawOrder)
  const includeRaw = shouldIncludeRawPlatformJson({
    role: params.role,
    confirmRaw: params.confirmRaw,
  })
  const rawOrders = includeRaw
    ? rawOrdersBase
    : rawOrdersBase.map(sanitizeDailyReportRawOrderRow)

  const config = getAnchorConfigSync()
  const useShopSessionRules = isReportDateOnOrAfterShopSessionCutoff(params.startDate)
  const reportAnchors = resolveDailyReportAnchorsForDate(config, params.startDate)
  const sessionsByAnchor = new Map<string, DailyReportRawLiveSessionRow[]>()
  const liveSessions: DailyReportRawLiveSessionRow[] = []

  for (const anchor of reportAnchors) {
    const fixedDisplay = useShopSessionRules
      ? ANCHOR_SESSION_DISPLAY_FROM_0613[anchor.anchorName]
      : undefined
    const sessionLabel = fixedDisplay?.sessionLabel ?? anchor.anchorName
    const shopName = fixedDisplay?.shopName ?? '—'
    const anchorSessions: DailyReportRawLiveSessionRow[] = []

    const sessions = await resolveAnchorLiveSessionsForRange({
      preset,
      startDate: params.startDate,
      endDate: params.endDate,
      anchorId: anchor.anchorId,
      anchorName: anchor.anchorName,
    })
    for (const session of sessions) {
      const row = mapLiveSession(session, anchor.anchorName, sessionLabel, shopName)
      anchorSessions.push(row)
      liveSessions.push(row)
    }
    sessionsByAnchor.set(anchor.anchorName, anchorSessions)
  }

  const anchorLiveBlocks = buildAnchorLiveBlocks(reportAnchors, sessionsByAnchor, useShopSessionRules)

  const label =
    params.startDate === params.endDate ? params.startDate : `${params.startDate}~${params.endDate}`

  return {
    range: {
      start: formatDateTimeShanghai(new Date(range.startTimeMs)),
      end: formatDateTimeShanghai(new Date(range.endTimeMs)),
      label,
    },
    anchorLiveBlocks,
    liveSessions,
    rawOrders,
  }
}
