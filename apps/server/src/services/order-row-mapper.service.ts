import type { AnalyzedOrderView } from '../types/analysis'
import { formatBuyerIdentityCode, resolveBuyerIdentityFromView } from './buyer-identity.service'
import { resolveDisplayOrderNoForView } from './order-display-no.service'
import type { NormalizedQualityBadCase } from './quality-badcase.types'
import { matchStatusLabel } from './quality-badcase.types'
import { resolveBuyerOrderQualityRefund } from './buyer-order-standard.service'
import {
  qualityVerifyDisplayLabel,
  resolveQualityRefundInfo,
  viewCountsAsQualityRefund,
} from './quality-refund-resolution.service'
import { isEffectiveSignedView } from './strict-after-sale-metrics.service'
import { resolveViewRefundAmountCent } from './order-refund-metrics.service'
import { centToYuan } from '../utils/money'
import {
  getLiveAccountRowMapperContext,
  resolveLiveAccountDisplayName,
  type LiveAccountRowMapperContext,
} from './live-account.service'
import { resolveLowPriceBrushDebugFields } from './low-price-brush-order.service'
import { isStatusSignedView } from './order-sign-status.service'
import { isOfflineDealView } from '../utils/offline-deal-view.util'

export function pickProductName(raw: Record<string, unknown> | undefined): string {
  if (!raw) return '—'
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    const name = first.skuName ?? first.displayName ?? first.name
    if (name != null && String(name).trim()) return String(name).trim()
  }
  return pickString(raw, ['productName', 'product_name', 'title']) || '—'
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function pickSignTime(raw: Record<string, unknown> | undefined): string | null {
  if (!raw) return null
  const t =
    raw.signedAt ??
    raw.signTime ??
    raw.receiveTime ??
    raw.finishTime ??
    raw.completedAt
  return t != null && String(t).trim() ? String(t).trim() : null
}

function pickBuyerNickname(raw: Record<string, unknown> | undefined, buyerId: string): string {
  if (!raw) return buyerId === '未知买家' ? '—' : buyerId
  const nick = raw._buyerNickname
  if (nick != null && String(nick).trim()) return String(nick).trim()
  const u = raw.userInfo
  if (u && typeof u === 'object') {
    const n = pickString(u as Record<string, unknown>, ['nickName', 'nickname', 'nick_name'])
    if (n) return n
  }
  return buyerId === '未知买家' ? '—' : buyerId
}

function viewIsCancelled(v: AnalyzedOrderView): boolean {
  const text = v.orderStatusText ?? ''
  if (['已取消', '取消', '交易关闭', '已关闭'].some((k) => text.includes(k))) return true
  return (v.gmvExcludeReason ?? '').includes('取消')
}

function viewIsUnpaid(v: AnalyzedOrderView): boolean {
  if (v.includedInGmv) return false
  return (v.gmvExcludeReason ?? '').includes('未支付')
}

function viewIsRefunded(v: AnalyzedOrderView): boolean {
  return Boolean(
    v.isReturned ||
      v.isReturnRefund ||
      v.isRefundOnly ||
      v.isRealProductRefund ||
      v.productRefundAmountCent > 0,
  )
}

export interface BoardOrderRow {
  orderNo: string
  displayOrderNo: string
  officialOrderNo: string
  packageId: string
  buyerNickname: string
  buyerId: string
  productName: string
  orderTime: string
  signTime: string | null
  productTotalAmount: number
  freightAmount: number
  userPayableAmount: number
  merchantReceivableAmount: number
  receivableAmount: number
  statPaidAmount: number
  /** 买家 Drawer：官方真实已支付，缺失时不应用应收兜底 */
  officialPaidAmount?: number
  officialPaidConfirmed?: boolean
  paymentBaseAmount: number
  paymentBaseSource: string
  refundAmount: number
  buyerKey: string
  buyerIdentityCode: string
  productRefundAmount: number
  refundAmountSource?: string
  refundAmountPending?: boolean
  refundAmountDisplay?: string
  freightRefundAmount: number
  actualDealAmount: number
  signedAmount: number
  orderStatus: string
  afterSaleStatus: string
  afterSaleReason: string
  afterSaleReasonText?: string
  refundReason?: string
  afterSalesWorkbenchReason?: string
  isCancelled: boolean
  isUnpaid: boolean
  isSigned: boolean
  isRefunded: boolean
  isQualityReturn: boolean
  includedInGmv: boolean
  gmvExcludeReason: string | null
  anchorName: string
  anchorId: string
  liveAccountName?: string
  liveAccountId?: string
  isBlacklistedBuyer?: boolean
  /** @deprecated 兼容旧字段 */
  payAmount: number
  actualAmount: number
  afterSaleDisplayType: string
  statusText: string
  isActualSigned: boolean
  officialQualityBadCase?: boolean
  officialQualityReason?: string
  officialQualityFeedbackContent?: string
  officialQualityFeedbackTime?: string | null
  officialQualitySourceBizId?: string
  qualityMatchStatus?: string
  qualitySource?: string
  qualitySourceLabel?: string
  qualityVerifyStatus?: string
  qualityVerifyDisplayLabel?: string
  qualityReasonText?: string
  officialReasonText?: string
  afterSaleSuccessTime?: string | null
  qualityFeedbackContent?: string
  qualityFeedbackTime?: string | null
  qualityPackagePayTime?: string | null
  qualityItemName?: string
  /** 线下成交备注（台账展示，非售后原因） */
  offlineDealNote?: string
  unitPriceCentForBrushCheck?: number
  isLowPriceBrushOrder?: boolean
  lowPriceBrushReason?: string | null
  /** 排班/场次归属来源（remap 后） */
  attributionSource?: string | null
  attributionExplain?: string | null
  scheduleConfirmed?: boolean
  /** 品退场次归属主播（若视图上有） */
  qualityAttributionAnchorName?: string | null
  /** 支付归属主播（= remap 后的 anchorName） */
  paymentAnchorName?: string | null
  /** 是否手动指定覆盖 */
  manualOverride?: boolean
  /** online | offline */
  dealSource?: 'online' | 'offline'
  offlineDealKey?: string | null
  attributedBy?: string | null
  attributedAt?: string | null
  /** 退货退款分类 */
  isReturnRefundOrder?: boolean
  isRefundOnlyOrder?: boolean
  isRefundTypeUnknown?: boolean
  returnRefundClassificationSource?: string | null
}

export type BoardDrillOrderRow = BoardOrderRow

function buildOrderStatusLabel(v: AnalyzedOrderView): string {
  const text = v.orderStatusText || '进行中'
  if (['已关闭', '已取消', '交易关闭'].some((k) => text.includes(k))) {
    return '已关闭'
  }
  if (v.isEffectiveSigned || v.isActualSigned || isStatusSignedView(v)) {
    return '已签收'
  }
  if (v.afterSaleClosedNoRefund && (isStatusSignedView(v) || text.includes('已完成'))) {
    return '已完成'
  }
  if (v.afterSaleCancelled && (isStatusSignedView(v) || text.includes('已完成'))) {
    return '已完成'
  }
  if (v.isReturnRefund || v.isRealProductRefund) return '售后关闭'
  if (
    ['已发货', '待收货', '运输中', '派送中', '待签收'].some((k) => text.includes(k))
  ) {
    return '已发货未签收'
  }
  return text
}

function buildAfterSaleStatusLabel(v: AnalyzedOrderView): string {
  if (v.afterSaleCancelled) return '售后已取消'
  const displayType =
    (v as AnalyzedOrderView & { afterSaleDisplayType?: string }).afterSaleDisplayType ?? '—'
  return displayType !== '—' ? displayType : v.afterSaleStatusLabel || '—'
}

function pickStringFrom(obj: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!obj) return ''
  for (const k of keys) {
    const v = obj[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function pickReasonFromNestedRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  const reasonKeys = [
    'reason_name_zh',
    'reasonNameZh',
    'reason_name',
    'reasonName',
    'reason',
  ]
  for (const k of ['afterSaleInfo', 'after_sale_info', 'returnInfo', 'return_info']) {
    const nested = raw[k]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const hit = pickStringFrom(nested as Record<string, unknown>, reasonKeys)
      if (hit) return hit
    }
  }
  return ''
}

function resolveAfterSaleReasonFields(v: AnalyzedOrderView & { raw?: Record<string, unknown> }): {
  afterSaleReason: string
  afterSaleReasonText: string
  refundReason: string
  afterSalesWorkbenchReason: string
} {
  if (isOfflineDealView(v)) {
    return {
      afterSaleReason: '—',
      afterSaleReasonText: '—',
      refundReason: '—',
      afterSalesWorkbenchReason: '—',
    }
  }
  const ext = v as AnalyzedOrderView & {
    afterSalesWorkbenchReason?: string
    afterSaleReasonText?: string
  }
  const raw = v.raw
  const wbReason = ext.afterSalesWorkbenchReason?.trim() || ''
  const fromRawNested = pickReasonFromNestedRaw(raw)
  const fromRawFlat = pickStringFrom(raw, ['afterSaleReason', 'refundReason', 'refund_reason'])
  const reasonText = v.reasonText?.trim() || ''

  const afterSalesWorkbenchReason = wbReason || '—'
  const afterSaleReasonText =
    wbReason || ext.afterSaleReasonText?.trim() || fromRawNested || reasonText || fromRawFlat || '—'
  const refundReason = fromRawFlat || afterSaleReasonText
  const afterSaleReason = afterSaleReasonText

  return { afterSaleReason, afterSaleReasonText, refundReason, afterSalesWorkbenchReason }
}

export function mapViewToBoardOrderRow(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
  opts?: { useBuyerRefund?: boolean; liveAccountContext?: LiveAccountRowMapperContext | null },
): BoardOrderRow {
  const raw = v.raw
  const useBuyerAmounts = Boolean(opts?.useBuyerRefund)
  const productTotalAmount = centToYuan(v.productAmountCent || v.gmvCent)
  const freightAmount = centToYuan(v.freightCent || 0)
  const userPayableAmount = centToYuan(v.actualPaidCent || 0)
  const receivableCent = useBuyerAmounts
    ? (v.buyerReceivableAmountCent ??
      ((v.productAmountCent || 0) + (v.freightCent || 0) || v.receivableAmountCent || 0))
    : v.receivableAmountCent || v.actualSellerReceiveAmountCent || 0
  const receivableAmount = centToYuan(receivableCent)
  const merchantReceivableAmount = receivableAmount
  const officialPaidConfirmed = Boolean(
    v.officialPaidConfirmed ?? (v.officialPaidAmountCent ?? 0) > 0,
  )
  const officialPaidAmount =
    useBuyerAmounts && officialPaidConfirmed && (v.officialPaidAmountCent ?? 0) > 0
      ? centToYuan(v.officialPaidAmountCent!)
      : undefined
  const statPaidAmount = useBuyerAmounts
    ? officialPaidAmount ?? 0
    : centToYuan(v.statPaidAmountCent ?? (v.includedInGmv ? v.paymentBaseCent || 0 : 0))
  const paymentBaseAmount = centToYuan(v.paymentBaseCent)
  const identity = resolveBuyerIdentityFromView(v)
  const buyerKey = identity?.buyerKey ?? v.buyerKey ?? v.buyerId ?? '—'
  const buyerIdentityCode = identity
    ? formatBuyerIdentityCode(identity.buyerKey, identity.buyerId)
    : formatBuyerIdentityCode(buyerKey)
  const productRefundCent = opts?.useBuyerRefund
    ? resolveViewRefundAmountCent(v)
    : v.productRefundAmountCent
  const refundSource = opts?.useBuyerRefund ? v.buyerProductRefundSource?.trim() || undefined : undefined
  const refundPending =
    (refundSource === 'after_sales_workbench_pending' ||
      v.buyerProductRefundSource === 'after_sales_workbench_pending') &&
    productRefundCent <= 0
  const productRefundAmount = refundPending ? 0 : centToYuan(productRefundCent)
  const freightRefundAmount = centToYuan(v.freightRefundAmountCent)
  const refundAmount = refundPending
    ? 0
    : centToYuan(productRefundCent + v.freightRefundAmountCent)
  const refundAmountDisplay = refundPending ? '售后金额待同步' : undefined
  const actualDealAmount = centToYuan(v.effectiveGmvCent)
  const signedAmount = centToYuan(
    isEffectiveSignedView(v) ? (v.actualSignAmountCent ?? v.actualSignedAmountCent ?? 0) : 0,
  )
  const payAmount = paymentBaseAmount || userPayableAmount || merchantReceivableAmount

  const orderStatus = buildOrderStatusLabel(v)
  const afterSaleStatus = buildAfterSaleStatusLabel(v)
  let statusText = afterSaleStatus !== '—' ? afterSaleStatus : orderStatus
  if (v.isFreightRefundOnly && v.isEffectiveSigned) {
    statusText = '已签收（运费补偿）'
  }

  const displayOrderNo = resolveDisplayOrderNoForView(v)
  const reasonFields = resolveAfterSaleReasonFields(v)
  const qualityInfo = resolveQualityRefundInfo({ view: v })
  const offline = isOfflineDealView(v)
  const liveAccountCtx = opts?.liveAccountContext ?? getLiveAccountRowMapperContext()
  const resolvedLive = resolveLiveAccountDisplayName(
    v.liveAccountId,
    v.liveAccountName,
    liveAccountCtx,
  )
  const remapped = v as AnalyzedOrderView & {
    scheduleAttributionSource?: string
    scheduleAttributionExplain?: string
    scheduleConfirmed?: boolean
    qualityAttributionAnchorName?: string | null
  }
  const attributionSource = remapped.scheduleAttributionSource?.trim() || null
  const paymentAnchorName = v.anchorName?.trim() || '未归属'
  const rawRec = (raw ?? {}) as Record<string, unknown>
  const dealSource: 'online' | 'offline' =
    v.dealSource === 'offline' ||
    v.sourceType === 'offline_deal' ||
    rawRec.dealSource === 'offline' ||
    String(displayOrderNo).startsWith('OFF-')
      ? 'offline'
      : 'online'
  const qualityAttributionAnchorName = offline
    ? null
    : remapped.qualityAttributionAnchorName != null
      ? String(remapped.qualityAttributionAnchorName).trim() || null
      : paymentAnchorName // 唯一归属后：品退主播默认等于订单主播
  const isQualityReturn = offline
    ? false
    : opts?.useBuyerRefund
      ? resolveBuyerOrderQualityRefund(v).isQualityRefund
      : viewCountsAsQualityRefund(v)

  return {
    orderNo: displayOrderNo,
    displayOrderNo,
    officialOrderNo: displayOrderNo,
    packageId: v.packageId || v.matchOrderId || '—',
    buyerNickname: pickBuyerNickname(raw, v.buyerId),
    buyerId: identity?.buyerId?.trim() || buyerIdentityCode || '—',
    buyerKey,
    buyerIdentityCode,
    productName: pickProductName(raw),
    orderTime: v.orderTimeText || '—',
    signTime: pickSignTime(raw),
    productTotalAmount,
    freightAmount,
    userPayableAmount,
    merchantReceivableAmount,
    receivableAmount,
    statPaidAmount,
    officialPaidAmount,
    officialPaidConfirmed: useBuyerAmounts ? officialPaidConfirmed : undefined,
    paymentBaseAmount,
    paymentBaseSource: v.paymentBaseSource?.trim() || '—',
    refundAmount,
    productRefundAmount,
    refundAmountSource: refundSource,
    refundAmountPending: refundPending,
    refundAmountDisplay,
    freightRefundAmount,
    actualDealAmount,
    signedAmount,
    orderStatus,
    afterSaleStatus,
    afterSaleReason: reasonFields.afterSaleReason,
    afterSaleReasonText:
      qualityInfo.afterSaleReasonText || reasonFields.afterSaleReasonText,
    refundReason: reasonFields.refundReason,
    afterSalesWorkbenchReason: reasonFields.afterSalesWorkbenchReason,
    isCancelled: viewIsCancelled(v),
    isUnpaid: viewIsUnpaid(v),
    isSigned: v.isSigned,
    isRefunded: viewIsRefunded(v),
    isQualityReturn,
    includedInGmv: v.includedInGmv,
    gmvExcludeReason: v.gmvExcludeReason?.trim() || null,
    anchorName: v.anchorName?.trim() || '未归属',
    anchorId: v.anchorId?.trim() || '—',
    liveAccountName: resolvedLive.liveAccountName,
    liveAccountId: resolvedLive.liveAccountId,
    payAmount,
    actualAmount: actualDealAmount,
    afterSaleDisplayType: afterSaleStatus,
    statusText,
    isActualSigned: isEffectiveSignedView(v),
    officialQualityBadCase: offline ? false : v.officialQualityBadCase === true,
    officialQualityReason: offline
      ? undefined
      : (v.officialQualityReasons ?? []).join('、') || undefined,
    officialQualityFeedbackContent: offline ? undefined : v.officialQualityFeedbackContent,
    officialQualityFeedbackTime: offline ? null : v.officialQualityFeedbackTime ?? null,
    officialQualitySourceBizId: offline ? undefined : v.officialQualitySourceBizId,
    qualityMatchStatus:
      !offline && v.officialQualityMatchStatus != null
        ? matchStatusLabel(
            v.officialQualityMatchStatus as NormalizedQualityBadCase['matchStatus'],
          )
        : undefined,
    qualitySource: offline ? undefined : qualityInfo.qualityMainSource,
    qualitySourceLabel: offline
      ? undefined
      : qualityInfo.isQualityRefund
        ? qualityInfo.verifyDisplayLabel
        : qualityInfo.suspectedQualityRefund
          ? qualityVerifyDisplayLabel('after_sale_only')
          : undefined,
    qualityVerifyStatus: offline ? 'none' : qualityInfo.qualityVerifyStatus,
    qualityVerifyDisplayLabel: offline ? '—' : qualityInfo.verifyDisplayLabel,
    qualityReasonText: offline ? undefined : qualityInfo.qualityReasonText || undefined,
    officialReasonText: offline ? undefined : qualityInfo.officialReasonText || undefined,
    afterSaleSuccessTime: offline ? null : qualityInfo.afterSaleSuccessTime || null,
    qualityFeedbackContent: offline ? undefined : qualityInfo.qualityFeedbackContent || undefined,
    qualityFeedbackTime: offline ? null : qualityInfo.qualityFeedbackTime || null,
    qualityPackagePayTime: offline ? null : qualityInfo.qualityPackagePayTime || null,
    qualityItemName: offline ? undefined : qualityInfo.qualityItemName || undefined,
    offlineDealNote:
      (v as AnalyzedOrderView & { offlineDealNote?: string }).offlineDealNote?.trim() ||
      (rawRec.offlineDealNote != null ? String(rawRec.offlineDealNote) : '') ||
      (rawRec.note != null ? String(rawRec.note) : '') ||
      undefined,
    ...resolveLowPriceBrushDebugFields(v),
    attributionSource,
    attributionExplain: remapped.scheduleAttributionExplain?.trim() || null,
    scheduleConfirmed:
      remapped.scheduleConfirmed != null ? Boolean(remapped.scheduleConfirmed) : undefined,
    qualityAttributionAnchorName,
    paymentAnchorName,
    manualOverride:
      attributionSource === 'manual_override' || attributionSource === 'offline_manual',
    dealSource,
    offlineDealKey: v.offlineDealKey ?? (dealSource === 'offline' ? displayOrderNo : null),
    attributedBy:
      rawRec.attributedBy != null
        ? String(rawRec.attributedBy)
        : rawRec.updatedBy != null
          ? String(rawRec.updatedBy)
          : rawRec.createdBy != null
            ? String(rawRec.createdBy)
            : null,
    attributedAt: rawRec.attributedAt != null ? String(rawRec.attributedAt) : null,
    isReturnRefundOrder: Boolean(v.isReturnRefundOrder),
    isRefundOnlyOrder: Boolean(v.isRefundOnlyOrder),
    isRefundTypeUnknown: Boolean(v.isRefundTypeUnknown),
    returnRefundClassificationSource: v.returnRefundClassificationSource ?? null,
  }
}

export function mapViewToBoardDrillRow(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
  opts?: {
    isBlacklistedBuyer?: boolean
    useBuyerRefund?: boolean
    liveAccountContext?: LiveAccountRowMapperContext | null
  },
): BoardDrillOrderRow {
  return {
    ...mapViewToBoardOrderRow(v, {
      useBuyerRefund: opts?.useBuyerRefund,
      liveAccountContext: opts?.liveAccountContext,
    }),
    isBlacklistedBuyer: opts?.isBlacklistedBuyer,
  }
}
