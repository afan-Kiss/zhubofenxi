/**
 * returns/v3 售后单统一分类（买家排行 / Drawer / 经营看板共用业务退款口径）
 */
import { matchPlatformReturnReason } from '../utils/quality-return'
import {
  isFreightOnlyRefund,
  resolveBusinessProductRefundAmountCent,
  resolveBusinessRefundAmountCent,
} from './business-refund-caliber.service'
import {
  isReturnsV3CanceledOrClosed,
  isReturnsV3FreightOnlyRefund,
  isReturnsV3UnshippedRefundOnly,
  pickReturnsV3ReasonNameZh,
  pickReturnsV3ReturnTypeName,
  pickReturnsV3StatusName,
  RETURNS_V3_FREIGHT_REASON_CODE,
} from './returns-v3-record.service'

export interface ClassifiedAfterSaleRecord {
  isAfterSaleSuccess: boolean
  isAfterSalePending: boolean
  isAfterSaleCancelledOrClosed: boolean
  isFreightOnlyRefund: boolean
  isProductRefund: boolean
  isReturnRefund: boolean
  isQualityReturn: boolean
  isUnshippedRefundOnly: boolean
  productRefundAmountCent: number
  freightRefundAmountCent: number
  effectiveRefundAmountCent: number
  excludeReason: string | null
}

function yuanToCent(value: unknown): number {
  return resolveBusinessRefundAmountCent(
    typeof value === 'object' && value != null
      ? (value as Record<string, unknown>)
      : { refund_fee: value },
  )
}

function pickRefundStatusName(rec: Record<string, unknown>): string {
  for (const k of ['refund_status_name', 'refundStatusName']) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function pickRefundStatus(rec: Record<string, unknown>): number | null {
  const raw = rec.refund_status ?? rec.refundStatus
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function isPendingAfterSaleRecord(rec: Record<string, unknown>, refundCent: number): boolean {
  if (refundCent > 0) return false
  const status = pickReturnsV3StatusName(rec)
  if (/待收货|寄回中|待商家|待买家|处理中|待审核|待处理/.test(status)) return true
  if (status.includes('待') && !status.includes('已完成')) return true
  return false
}

function isReturnRefundRecord(rec: Record<string, unknown>): boolean {
  const typeName = pickReturnsV3ReturnTypeName(rec)
  if (/退货/.test(typeName) && !typeName.includes('仅退款')) return true
  const rt = rec.return_type ?? rec.returnType
  return rt === 1 || rt === '1'
}

function detectFreightOnly(
  rec: Record<string, unknown>,
  refundCent: number,
  orderFreightCent?: number,
): boolean {
  if (refundCent <= 0) return false
  if (isReturnsV3FreightOnlyRefund(rec)) return true
  const reasonZh = pickReturnsV3ReasonNameZh(rec)
  const typeName = pickReturnsV3ReturnTypeName(rec)
  if (typeName.includes('已发货仅退款') && reasonZh.includes('退运费')) return true
  if (orderFreightCent != null && orderFreightCent > 0 && refundCent === orderFreightCent) {
    return true
  }
  const code = rec.reason ?? rec.reasonCode
  if (Number(code) === RETURNS_V3_FREIGHT_REASON_CODE) return true
  return false
}

function isSuccessfulRefundRecord(rec: Record<string, unknown>, refundCent: number): boolean {
  if (isReturnsV3CanceledOrClosed(rec)) return false
  if (isPendingAfterSaleRecord(rec, refundCent)) return false
  if (refundCent <= 0) return false
  const refundStatus = pickRefundStatus(rec)
  const refundStatusName = pickRefundStatusName(rec)
  if (refundStatus === 2 || refundStatusName.includes('退款成功')) return true
  if (rec.refunded === true && refundCent > 0) return true
  return false
}

/** 单条 returns/v3 售后记录分类 */
export function classifyAfterSaleRecord(
  afterSale: Record<string, unknown>,
  opts?: { orderFreightCent?: number; qualityReasonText?: string },
): ClassifiedAfterSaleRecord {
  const refundCent = resolveBusinessRefundAmountCent(afterSale)
  const productCent = resolveBusinessProductRefundAmountCent(afterSale)
  const cancelled = isReturnsV3CanceledOrClosed(afterSale)
  const pending = isPendingAfterSaleRecord(afterSale, refundCent)
  const success = isSuccessfulRefundRecord(afterSale, refundCent)
  const unshipped = isReturnsV3UnshippedRefundOnly(afterSale)
  const freightOnly =
    success && (isFreightOnlyRefund(afterSale, refundCent) || detectFreightOnly(afterSale, refundCent, opts?.orderFreightCent))
  const reasonText =
    opts?.qualityReasonText ??
    pickReturnsV3ReasonNameZh(afterSale) ??
    String(afterSale.reason_name_zh ?? afterSale.reason ?? '').trim()
  const quality = Boolean(reasonText && matchPlatformReturnReason(reasonText).isQualityReturn)

  let productRefundAmountCent = 0
  let freightRefundAmountCent = 0
  let excludeReason: string | null = null

  if (cancelled) {
    excludeReason = '售后已取消或关闭'
  } else if (pending) {
    excludeReason = '售后处理中'
  } else if (success && freightOnly) {
    freightRefundAmountCent = refundCent
    excludeReason = '纯运费退款'
  } else if (success) {
    productRefundAmountCent = productCent
  } else if (refundCent <= 0) {
    excludeReason = '无有效退款'
  }

  const isProductRefund = productRefundAmountCent > 0
  const isReturnRefund = isProductRefund && isReturnRefundRecord(afterSale)

  return {
    isAfterSaleSuccess: success && (productRefundAmountCent > 0 || freightRefundAmountCent > 0),
    isAfterSalePending: pending,
    isAfterSaleCancelledOrClosed: cancelled,
    isFreightOnlyRefund: freightOnly,
    isProductRefund,
    isReturnRefund,
    isQualityReturn: isProductRefund && quality,
    isUnshippedRefundOnly: unshipped && isProductRefund,
    productRefundAmountCent,
    freightRefundAmountCent,
    effectiveRefundAmountCent: productRefundAmountCent + freightRefundAmountCent,
    excludeReason,
  }
}

export function aggregateClassifiedAfterSalesForOrder(
  records: Record<string, unknown>[],
  opts?: { orderFreightCent?: number },
): {
  productRefundAmountCent: number
  freightRefundAmountCent: number
  hasSuccessfulProductRefund: boolean
  hasFreightOnlyRefund: boolean
  hasPendingAfterSale: boolean
  hasUnshippedRefundOnly: boolean
  hasCancelledAfterSale: boolean
  returnRefundOrderCount: number
  productRefundOrderCount: number
} {
  const byReturnId = new Map<string, Record<string, unknown>>()
  for (const rec of records) {
    const rid = String(rec.returns_id ?? rec.returnsId ?? rec.return_id ?? JSON.stringify(rec))
    if (!byReturnId.has(rid)) byReturnId.set(rid, rec)
  }

  let productRefundAmountCent = 0
  let freightRefundAmountCent = 0
  let hasSuccessfulProductRefund = false
  let hasFreightOnlyRefund = false
  let hasPendingAfterSale = false
  let hasUnshippedRefundOnly = false
  let hasCancelledAfterSale = false
  let returnRefundOrderCount = 0
  let productRefundOrderCount = 0

  for (const rec of byReturnId.values()) {
    const c = classifyAfterSaleRecord(rec, opts)
    if (c.isAfterSalePending) hasPendingAfterSale = true
    if (c.isAfterSaleCancelledOrClosed) hasCancelledAfterSale = true
    if (c.isFreightOnlyRefund) hasFreightOnlyRefund = true
    if (c.isProductRefund) {
      hasSuccessfulProductRefund = true
      productRefundAmountCent += c.productRefundAmountCent
      productRefundOrderCount += 1
      if (c.isReturnRefund) returnRefundOrderCount += 1
    }
    if (c.isFreightOnlyRefund) {
      freightRefundAmountCent += c.freightRefundAmountCent
    }
    if (c.isUnshippedRefundOnly) hasUnshippedRefundOnly = true
  }

  return {
    productRefundAmountCent,
    freightRefundAmountCent,
    hasSuccessfulProductRefund,
    hasFreightOnlyRefund,
    hasPendingAfterSale,
    hasUnshippedRefundOnly,
    hasCancelledAfterSale,
    returnRefundOrderCount,
    productRefundOrderCount,
  }
}
