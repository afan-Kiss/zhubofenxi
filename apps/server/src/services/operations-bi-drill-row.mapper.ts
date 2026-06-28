import type { AnalyzedOrderView } from '../types/analysis'
import { centToYuan } from '../utils/money'
import { resolveDisplayOrderNoForView } from './order-display-no.service'
import { formatBuyerIdentityCode, pickBuyerNicknameFromView, resolveBuyerIdentityFromView } from './buyer-identity.service'
import {
  pickItemIdFromRaw,
  pickProductNameFromRaw,
  pickQuantityFromRaw,
  pickShopNameFromRaw,
  pickSkuNameFromRaw,
  parseBarTypeFromText,
  parseRingSizeFromText,
  resolveProductKey,
} from './operations-product-fields.util'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import {
  formatAfterSaleStatusDisplay,
  formatAfterSalesCategoryLabel,
  formatAfterSalesReasonDisplay,
} from './operations-after-sale-order.util'
import { resolveLowPriceBrushDebugFields } from './low-price-brush-order.service'
import type { OperationsBiDrillOrderRow } from './operations-bi-drill.types'

function maskBuyerLabel(raw: string): string {
  const t = raw.trim()
  if (!t) return '—'
  if (t.length <= 2) return `${t[0]}*`
  return `${t[0]}${'*'.repeat(Math.max(1, t.length - 2))}${t[t.length - 1]}`
}

export function mapViewToOperationsBiDrillRow(
  view: AnalyzedOrderView,
  rawByMatch: Map<string, Record<string, unknown>>,
  inclusionReason?: string,
): OperationsBiDrillOrderRow {
  const withRaw = attachRawByMatchToViews([view], rawByMatch)[0]!
  const raw = withRaw.raw
  const productName = pickProductNameFromRaw(raw) || '—'
  const skuName = pickSkuNameFromRaw(raw) || '—'
  const itemId = pickItemIdFromRaw(raw)
  const productKey = resolveProductKey({ itemId, productName, skuName })
  const shopFromRaw = pickShopNameFromRaw(raw)
  const shopName =
    (withRaw.liveAccountName && withRaw.liveAccountName !== '—'
      ? withRaw.liveAccountName
      : shopFromRaw) || null
  const ringSize = parseRingSizeFromText(`${productName} ${skuName}`) ?? null
  const barType = parseBarTypeFromText(`${productName} ${skuName}`) ?? null
  const brush = resolveLowPriceBrushDebugFields(withRaw)
  const identity = resolveBuyerIdentityFromView(withRaw)
  const buyerCode = identity
    ? formatBuyerIdentityCode(identity.buyerKey, identity.buyerId)
    : ''
  const reasonRaw =
    withRaw.afterSaleReasonText?.trim() ||
    withRaw.afterSalesWorkbenchReason?.trim() ||
    withRaw.reasonText?.trim() ||
    withRaw.finalAfterSaleReason?.trim() ||
    ''
  const displayNo = resolveDisplayOrderNoForView(withRaw)
  const orderNo = displayNo || withRaw.orderId || withRaw.packageId || '—'
  const buyerNickname = pickBuyerNicknameFromView(withRaw) || null
  const afterSaleStatus = formatAfterSaleStatusDisplay(withRaw)

  return {
    orderId: withRaw.orderId || withRaw.packageId || orderNo,
    orderNo,
    parentOrderNo: null,
    payTime: withRaw.orderTimeText ?? null,
    anchorName: withRaw.anchorName ?? null,
    liveAccountName: withRaw.liveAccountName ?? null,
    shopName,
    productKey,
    productName,
    skuName,
    productCode: null,
    ringSize,
    barType,
    quantity: pickQuantityFromRaw(raw),
    paymentAmountYuan: Math.round(centToYuan(withRaw.paymentBaseCent || 0)),
    validAmountYuan: Math.round(centToYuan(withRaw.effectiveGmvCent || 0)),
    includedInGmv: withRaw.includedInGmv ?? null,
    isLowPriceExcluded: brush.isLowPriceBrushOrder ?? null,
    orderStatusText: withRaw.orderStatusText ?? null,
    productRefundAmountYuan: Math.round(centToYuan(withRaw.productRefundAmountCent || 0)),
    freightRefundAmountYuan: Math.round(centToYuan(withRaw.freightRefundAmountCent || 0)),
    isFreightRefundOnly: withRaw.isFreightRefundOnly ?? null,
    returnReason: reasonRaw ? String(reasonRaw) : null,
    afterSaleStatus,
    normalizedAfterSalesReason: formatAfterSalesReasonDisplay(withRaw, reasonRaw),
    afterSalesCategoryLabel: formatAfterSalesCategoryLabel(withRaw, reasonRaw),
    buyerNickname,
    buyerDisplayName: buyerNickname || (buyerCode ? maskBuyerLabel(buyerCode) : null),
    buyerMasked: !buyerNickname && Boolean(buyerCode),
    qianfanDetailAvailable: Boolean(orderNo && orderNo !== '—'),
    inclusionReason: inclusionReason ?? null,
  }
}

const FORBIDDEN_DRILL_JSON_KEYS = [
  'phone',
  'mobile',
  'address',
  'receiver',
  'receiverName',
  'receiverPhone',
  'buyerPhone',
  'idCard',
  'platformRawJson',
  'rawJson',
  'cookie',
  'Cookie',
  'authorization',
  'token',
]

export function assertOperationsBiDrillPayloadPrivacy(payload: unknown): string[] {
  const json = JSON.stringify(payload)
  const issues: string[] = []
  for (const key of FORBIDDEN_DRILL_JSON_KEYS) {
    if (json.includes(`"${key}"`)) issues.push(`含禁止字段 ${key}`)
  }
  return issues
}
