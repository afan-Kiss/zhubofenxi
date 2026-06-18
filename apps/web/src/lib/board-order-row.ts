import { displayOrderNoForRow, pickDisplayOrderNoFromRow } from './display-order-no'

/** 经营看板 Drawer 统一订单行（与后端 mapViewToBoardDrillRow 对齐） */
export interface BoardDrillOrderRow {
  orderNo: string
  displayOrderNo?: string
  officialOrderNo?: string
  orderTime: string
  payTime?: string | null
  signTime?: string | null
  afterSaleApplyTime?: string | null
  afterSaleCompleteTime?: string | null
  anchorName: string
  liveAccountName?: string
  buyerNickname: string
  buyerId: string
  buyerKey?: string
  buyerIdentityCode?: string
  productName?: string
  productTotalAmount?: number
  freightAmount?: number
  merchantReceivableAmount: number
  receivableAmount?: number
  statPaidAmount?: number
  /** 官方真实已支付（元），缺失时勿用应收兜底 */
  officialPaidAmount?: number
  officialPaidConfirmed?: boolean
  paymentBaseAmount: number
  refundAmount: number
  productRefundAmount?: number
  refundAmountSource?: string
  /** 买家 Drawer：后端已翻译的退款来源文案，优先展示 */
  refundSourceText?: string
  refundAmountPending?: boolean
  refundAmountDisplay?: string
  orderStatus: string
  afterSaleStatus: string
  afterSaleReason: string
  afterSaleReasonText?: string
  refundReason?: string
  afterSalesWorkbenchReason?: string
  includedInGmv: boolean
  gmvExcludeReason: string | null
  isQualityReturn: boolean
  isBlacklistedBuyer?: boolean
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
  /** @deprecated 兼容旧接口 */
  payAmount?: number
  afterSaleDisplayType?: string
  orderStatusLabel?: string
  afterSaleStatusLabel?: string
  afterSaleDisplayTone?: 'none' | 'pending' | 'success' | 'closed' | 'quality'
  hasEffectiveAfterSale?: boolean
  netDealAmount?: number
  /** 买家展示：单订单赚到金额（元） */
  earnedAmount?: number
  afterSaleNo?: string | null
  cardStatusLabel?: string
}

export function displayCell(v: unknown): string {
  if (v == null || v === '' || v === 'undefined' || v === 'null') return '—'
  return String(v)
}

export function displayYesNo(v: unknown): string {
  if (v === true || v === 'true' || v === 1) return '是'
  if (v === false || v === 'false' || v === 0) return '否'
  return '—'
}

export function displayAfterSaleReason(row: BoardDrillOrderRow): string {
  const text =
    row.afterSaleReasonText?.trim() ||
    row.afterSaleReason?.trim() ||
    row.refundReason?.trim() ||
    row.afterSalesWorkbenchReason?.trim() ||
    ''
  return text && text !== '—' ? text : '—'
}

export function normalizeBoardOrderRow(raw: Record<string, unknown>): BoardDrillOrderRow {
  const paymentBase = Number(raw.paymentBaseAmount ?? raw.payAmount ?? 0)
  const merchant = Number(
    raw.merchantReceivableAmount ?? raw.receivableAmount ?? raw.paymentBaseAmount ?? raw.payAmount ?? 0,
  )
  const receivable = Number(raw.receivableAmount ?? raw.merchantReceivableAmount ?? merchant)
  const officialPaid =
    raw.officialPaidAmount != null && Number(raw.officialPaidAmount) > 0
      ? Number(raw.officialPaidAmount)
      : undefined
  const officialPaidConfirmed = Boolean(raw.officialPaidConfirmed ?? officialPaid != null)
  const statPaid =
    officialPaid != null
      ? officialPaid
      : Number(raw.statPaidAmount ?? (raw.includedInGmv ? paymentBase : 0))
  const refund = Number(raw.refundAmount ?? raw.productRefundAmount ?? 0)
  const exclude =
    raw.gmvExcludeReason != null && String(raw.gmvExcludeReason).trim()
      ? String(raw.gmvExcludeReason).trim()
      : raw.excludeReason != null && String(raw.excludeReason).trim()
        ? String(raw.excludeReason).trim()
        : null

  const displayNo = pickDisplayOrderNoFromRow(raw)

  return {
    orderNo: displayCell(displayNo),
    displayOrderNo: displayCell(displayNo),
    officialOrderNo: displayCell(displayNo),
    orderTime: displayCell(raw.orderTime),
    payTime: raw.payTime != null ? displayCell(raw.payTime) : undefined,
    signTime: raw.signTime != null ? displayCell(raw.signTime) : undefined,
    afterSaleApplyTime:
      raw.afterSaleApplyTime != null ? displayCell(raw.afterSaleApplyTime) : undefined,
    afterSaleCompleteTime:
      raw.afterSaleCompleteTime != null ? displayCell(raw.afterSaleCompleteTime) : undefined,
    anchorName: displayCell(raw.anchorName ?? '未归属'),
    liveAccountName: displayCell(raw.liveAccountName ?? '未知直播号'),
    buyerNickname: displayCell(raw.buyerNickname),
    buyerId: displayCell(raw.buyerIdentityCode ?? raw.buyerId),
    buyerKey: displayCell(raw.buyerKey),
    buyerIdentityCode: displayCell(raw.buyerIdentityCode),
    productName: displayCell(raw.productName),
    productTotalAmount: Number(raw.productTotalAmount ?? 0),
    freightAmount: Number(raw.freightAmount ?? 0),
    merchantReceivableAmount: merchant,
    receivableAmount: receivable,
    statPaidAmount: statPaid,
    officialPaidAmount: officialPaid,
    officialPaidConfirmed,
    paymentBaseAmount: paymentBase,
    refundAmount: refund,
    productRefundAmount: Number(raw.productRefundAmount ?? refund),
    refundAmountSource: raw.refundAmountSource != null ? String(raw.refundAmountSource) : undefined,
    refundSourceText:
      raw.refundSourceText != null ? String(raw.refundSourceText).trim() : undefined,
    refundAmountPending: Boolean(raw.refundAmountPending),
    refundAmountDisplay:
      raw.refundAmountDisplay != null ? String(raw.refundAmountDisplay) : undefined,
    orderStatus: displayCell(raw.orderStatus ?? raw.statusText),
    afterSaleStatus: displayCell(raw.afterSaleStatus ?? raw.afterSaleDisplayType),
    afterSaleReason: displayCell(raw.afterSaleReason),
    afterSaleReasonText:
      raw.afterSaleReasonText != null ? String(raw.afterSaleReasonText).trim() : undefined,
    refundReason: raw.refundReason != null ? String(raw.refundReason).trim() : undefined,
    afterSalesWorkbenchReason:
      raw.afterSalesWorkbenchReason != null
        ? String(raw.afterSalesWorkbenchReason).trim()
        : undefined,
    includedInGmv: Boolean(raw.includedInGmv),
    gmvExcludeReason: exclude,
    isQualityReturn: Boolean(raw.isQualityReturn),
    isBlacklistedBuyer: Boolean(raw.isBlacklistedBuyer),
    qualitySource: raw.qualitySource != null ? String(raw.qualitySource) : undefined,
    qualitySourceLabel:
      raw.qualityVerifyDisplayLabel != null
        ? String(raw.qualityVerifyDisplayLabel)
        : raw.qualitySourceLabel != null
          ? String(raw.qualitySourceLabel)
          : undefined,
    qualityVerifyStatus:
      raw.qualityVerifyStatus != null ? String(raw.qualityVerifyStatus) : undefined,
    qualityVerifyDisplayLabel:
      raw.qualityVerifyDisplayLabel != null
        ? String(raw.qualityVerifyDisplayLabel)
        : undefined,
    qualityReasonText:
      raw.qualityReasonText != null ? String(raw.qualityReasonText) : undefined,
    officialReasonText:
      raw.officialReasonText != null ? String(raw.officialReasonText) : undefined,
    afterSaleSuccessTime:
      raw.afterSaleSuccessTime != null ? String(raw.afterSaleSuccessTime) : null,
    qualityFeedbackContent:
      raw.qualityFeedbackContent != null ? String(raw.qualityFeedbackContent) : undefined,
    qualityFeedbackTime:
      raw.qualityFeedbackTime != null ? String(raw.qualityFeedbackTime) : null,
    qualityPackagePayTime:
      raw.qualityPackagePayTime != null ? String(raw.qualityPackagePayTime) : null,
    qualityItemName: raw.qualityItemName != null ? String(raw.qualityItemName) : undefined,
    payAmount: paymentBase,
    afterSaleDisplayType: displayCell(raw.afterSaleDisplayType ?? raw.afterSaleStatus),
    orderStatusLabel: raw.orderStatusLabel != null ? displayCell(raw.orderStatusLabel) : undefined,
    afterSaleStatusLabel:
      raw.afterSaleStatusLabel != null ? displayCell(raw.afterSaleStatusLabel) : undefined,
    afterSaleDisplayTone: raw.afterSaleDisplayTone as BoardDrillOrderRow['afterSaleDisplayTone'],
    hasEffectiveAfterSale:
      raw.hasEffectiveAfterSale != null ? Boolean(raw.hasEffectiveAfterSale) : undefined,
    netDealAmount: raw.netDealAmount != null ? Number(raw.netDealAmount) : undefined,
    earnedAmount: raw.earnedAmount != null ? Number(raw.earnedAmount) : undefined,
    afterSaleNo: raw.afterSaleNo != null ? displayCell(raw.afterSaleNo) : undefined,
    cardStatusLabel: raw.cardStatusLabel != null ? displayCell(raw.cardStatusLabel) : undefined,
  }
}

export function boardRowDisplayOrderNo(row: BoardDrillOrderRow): string {
  return displayOrderNoForRow(row)
}

export function merchantOrPaymentAmount(row: BoardDrillOrderRow): number {
  if (row.receivableAmount != null && row.receivableAmount > 0) return row.receivableAmount
  if (row.merchantReceivableAmount > 0) return row.merchantReceivableAmount
  if (row.paymentBaseAmount > 0) return row.paymentBaseAmount
  return row.payAmount ?? 0
}

/** 买家 Drawer：仅展示官方真实已支付，缺失返回 null */
export function officialPaidDisplayAmount(row: BoardDrillOrderRow): number | null {
  if (row.officialPaidAmount != null && row.officialPaidAmount > 0) {
    return row.officialPaidAmount
  }
  if (row.officialPaidConfirmed === false) return null
  if (row.officialPaidAmount === 0 && row.officialPaidConfirmed) return 0
  return null
}

export function officialPaidDisplayText(
  row: BoardDrillOrderRow,
  formatMoney: (n: number) => string,
): string {
  const amt = officialPaidDisplayAmount(row)
  if (amt == null) return '待确认'
  return formatMoney(amt)
}

export function statPaidDisplayAmount(row: BoardDrillOrderRow): number {
  const official = officialPaidDisplayAmount(row)
  if (official != null) return official
  if (row.statPaidAmount != null && row.statPaidAmount > 0) return row.statPaidAmount
  if (row.includedInGmv) return row.paymentBaseAmount || merchantOrPaymentAmount(row)
  return 0
}

export function buyerReceivableDisplayAmount(row: BoardDrillOrderRow): number {
  if (row.receivableAmount != null && row.receivableAmount > 0) return row.receivableAmount
  const product = Number(row.productTotalAmount ?? 0)
  const freight = Number(row.freightAmount ?? 0)
  if (product > 0 || freight > 0) return product + freight
  return row.merchantReceivableAmount ?? 0
}
