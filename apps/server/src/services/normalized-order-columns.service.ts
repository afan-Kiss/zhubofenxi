/**
 * Wave4 P2：XhsRawOrder 结构化读模型列（与 normalizeXhsOrderPackage 同源）。
 * rawJson 仍为权威原稿；结构化列仅用于 DB 预筛 / 诊断，不另开口径。
 */
import { createHash } from 'node:crypto'
import type { NormalizedOrder } from '../types/analysis'
import { normalizeXhsOrderPackage, type NormalizeXhsOrderHints } from './xhs-api-sync/xhs-json-normalizer.service'

export const NORMALIZED_ORDER_COLUMNS_VERSION = 'norm-order-cols-v1'

export type NormalizedOrderColumnData = {
  paymentTime: Date | null
  orderedAt: Date | null
  displayOrderNo: string | null
  gmvCent: number | null
  productAmountCent: number | null
  actualPaidCent: number | null
  sellerReceiveCent: number | null
  freightCent: number | null
  platformDiscountCent: number | null
  orderStatusText: string | null
  afterSaleStatusText: string | null
  isSigned: boolean | null
  isReturned: boolean | null
  isQualityReturn: boolean | null
  normalizedVersion: string
  businessFingerprint: string
}

function fingerprintOf(order: NormalizedOrder): string {
  const parts = [
    order.displayOrderNo || order.packageId || order.orderId || '',
    order.paymentTime?.toISOString() ?? '',
    order.orderedAt?.toISOString() ?? '',
    String(order.gmvCent ?? 0),
    String(order.productAmountCent ?? 0),
    String(order.actualPaidCent ?? 0),
    String(order.actualSellerReceiveAmountCent ?? 0),
    String(order.freightCent ?? 0),
    String(order.platformDiscountCent ?? 0),
    order.orderStatusText || '',
    order.afterSaleStatusText || '',
    order.isSigned ? '1' : '0',
    order.isReturned ? '1' : '0',
    order.isQualityReturn ? '1' : '0',
  ]
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)
}

export function normalizedOrderToColumnData(order: NormalizedOrder): NormalizedOrderColumnData {
  return {
    paymentTime: order.paymentTime ?? null,
    orderedAt: order.orderedAt ?? null,
    displayOrderNo: (order.displayOrderNo || order.packageId || order.orderId || '').trim() || null,
    gmvCent: Number.isFinite(order.gmvCent) ? order.gmvCent : null,
    productAmountCent: Number.isFinite(order.productAmountCent) ? order.productAmountCent : null,
    actualPaidCent: Number.isFinite(order.actualPaidCent) ? order.actualPaidCent : null,
    sellerReceiveCent: Number.isFinite(order.actualSellerReceiveAmountCent)
      ? order.actualSellerReceiveAmountCent
      : null,
    freightCent: Number.isFinite(order.freightCent) ? order.freightCent : null,
    platformDiscountCent: Number.isFinite(order.platformDiscountCent)
      ? order.platformDiscountCent
      : null,
    orderStatusText: order.orderStatusText?.trim() || null,
    afterSaleStatusText: order.afterSaleStatusText?.trim() || null,
    isSigned: Boolean(order.isSigned),
    isReturned: Boolean(order.isReturned),
    isQualityReturn: Boolean(order.isQualityReturn),
    normalizedVersion: NORMALIZED_ORDER_COLUMNS_VERSION,
    businessFingerprint: fingerprintOf(order),
  }
}

export function extractNormalizedOrderColumnsFromRaw(
  pkg: Record<string, unknown>,
  hints?: NormalizeXhsOrderHints,
): NormalizedOrderColumnData {
  const order = normalizeXhsOrderPackage(pkg, 0, hints)
  return normalizedOrderToColumnData(order)
}

export function toPrismaNormalizedOrderColumns(
  cols: NormalizedOrderColumnData,
): {
  paymentTime: Date | null
  orderedAt: Date | null
  displayOrderNo: string | null
  gmvCent: number | null
  productAmountCent: number | null
  actualPaidCent: number | null
  sellerReceiveCent: number | null
  freightCent: number | null
  platformDiscountCent: number | null
  orderStatusText: string | null
  afterSaleStatusText: string | null
  isSigned: boolean | null
  isReturned: boolean | null
  isQualityReturn: boolean | null
  normalizedVersion: string
  businessFingerprint: string
} {
  return {
    paymentTime: cols.paymentTime,
    orderedAt: cols.orderedAt,
    displayOrderNo: cols.displayOrderNo,
    gmvCent: cols.gmvCent,
    productAmountCent: cols.productAmountCent,
    actualPaidCent: cols.actualPaidCent,
    sellerReceiveCent: cols.sellerReceiveCent,
    freightCent: cols.freightCent,
    platformDiscountCent: cols.platformDiscountCent,
    orderStatusText: cols.orderStatusText,
    afterSaleStatusText: cols.afterSaleStatusText,
    isSigned: cols.isSigned,
    isReturned: cols.isReturned,
    isQualityReturn: cols.isQualityReturn,
    normalizedVersion: cols.normalizedVersion,
    businessFingerprint: cols.businessFingerprint,
  }
}
