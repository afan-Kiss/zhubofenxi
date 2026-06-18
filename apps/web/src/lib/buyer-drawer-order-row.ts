import {
  normalizeBoardOrderRow,
  type BoardDrillOrderRow,
  displayCell,
} from './board-order-row'

function pickString(raw: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

/** 买家排行 Drawer：统一 API 行 → 展示行（避免内部字段名 / 英文 code 漏到界面） */
export function normalizeBuyerDrawerOrderRow(raw: Record<string, unknown>): BoardDrillOrderRow {
  const base = normalizeBoardOrderRow(raw)

  const orderStatusLabel =
    pickString(raw, ['orderStatusLabel', 'cardStatusLabel']) ||
    (base.orderStatusLabel && base.orderStatusLabel !== '—' ? base.orderStatusLabel : '') ||
    base.orderStatus

  const afterSaleStatusLabel =
    pickString(raw, ['afterSaleStatusLabel']) ||
    (base.afterSaleStatusLabel && base.afterSaleStatusLabel !== '—'
      ? base.afterSaleStatusLabel
      : '') ||
    base.afterSaleStatus

  const afterSaleTypeLabel =
    pickString(raw, ['afterSaleTypeLabel']) ||
    (base.afterSaleDisplayType && base.afterSaleDisplayType !== '—'
      ? base.afterSaleDisplayType
      : '')

  const refundSourceText = pickString(raw, ['refundSourceText'])

  const earned =
    raw.earnedAmount != null && Number.isFinite(Number(raw.earnedAmount))
      ? Math.max(0, Number(raw.earnedAmount))
      : raw.earnedAmountCent != null && Number.isFinite(Number(raw.earnedAmountCent))
        ? Math.max(0, Number(raw.earnedAmountCent) / 100)
        : base.earnedAmount ?? base.netDealAmount ?? 0

  const refund =
    raw.refundAmountCent != null && Number.isFinite(Number(raw.refundAmountCent))
      ? Number(raw.refundAmountCent) / 100
      : base.refundAmount

  return {
    ...base,
    orderNo: displayCell(pickString(raw, ['orderNo', 'displayOrderNo']) || base.orderNo),
    displayOrderNo: displayCell(pickString(raw, ['displayOrderNo', 'orderNo']) || base.displayOrderNo),
    orderStatus: orderStatusLabel,
    orderStatusLabel,
    afterSaleStatus: afterSaleStatusLabel,
    afterSaleStatusLabel,
    afterSaleDisplayType:
      afterSaleTypeLabel && afterSaleTypeLabel !== '—' ? afterSaleTypeLabel : base.afterSaleDisplayType,
    afterSaleDisplayTone:
      (raw.afterSaleDisplayTone as BoardDrillOrderRow['afterSaleDisplayTone']) ??
      base.afterSaleDisplayTone,
    hasEffectiveAfterSale:
      raw.hasEffectiveAfterSale != null
        ? Boolean(raw.hasEffectiveAfterSale)
        : base.hasEffectiveAfterSale,
    refundAmount: refund,
    productRefundAmount: refund,
    earnedAmount: earned,
    netDealAmount: earned,
    refundAmountPending: Boolean(raw.refundAmountPending ?? base.refundAmountPending),
    refundAmountSource:
      pickString(raw, ['refundAmountSource', 'buyerProductRefundSource']) ||
      base.refundAmountSource,
    refundSourceText: refundSourceText || undefined,
    isQualityReturn: Boolean(raw.isQualityReturn ?? raw.isQualityRefund ?? base.isQualityReturn),
  }
}
