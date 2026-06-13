import { prisma } from '../../lib/prisma'
import type { Prisma } from '@prisma/client'
import type { AnalyzeInput } from '../business-analysis.service'
import type { NormalizedOrder, SettlementDirection, SettlementRecord, SettlementType } from '../../types/analysis'
import { formatDateTime, getMonthKey, parseDateTime } from '../../utils/time'
import { extractOrderAnchorFields } from '../anchor-attribution.util'
import {
  extractFieldPair,
  parseMoneyToCent,
  pickBillFieldPair,
} from '../../utils/amount-parse.service'
import {
  pickOfficialDisplayOrderNo,
  pickOrderIdentifierString,
} from '../order-display-no.service'
import {
  attachBuyerIdentityToRaw,
  resolveBuyerIdentityForPackage,
} from '../buyer-identity.service'
import type { DateRangeResolved } from '../../utils/date-range'
import { orderPayTimeInRange } from '../../utils/order-stat-time.util'

/** DB 预筛缓冲：orderTime 存 orderedAt，统计口径用 paymentTime，需留余量 */
const RAW_ORDER_RANGE_DB_BUFFER_MS = 7 * 24 * 60 * 60 * 1000
const RAW_LIVE_RANGE_DB_BUFFER_MS = 1 * 24 * 60 * 60 * 1000

const SIGNED_KEYWORDS = ['已签收', '已完成', '交易完成', '已收货', '交易成功', '完成']
const RETURN_KEYWORDS = ['退款', '退货', '售后完成', '已退款', '退款成功']

function asRecord(raw: Prisma.JsonValue): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* ignore */
    }
  }
  return {}
}

function pickString(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (value != null && String(value).trim()) return String(value)
  }
  return ''
}

function parseYuanToCent(value: unknown): number {
  return parseMoneyToCent(value, undefined, 'amount').cent
}

function parseFieldCent(item: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const pair = extractFieldPair(item, key)
    if (pair.value != null || pair.displayValue != null) {
      const parsed = parseMoneyToCent(pair.value, pair.displayValue, key)
      if (parsed.cent !== 0) return parsed.cent
    }
    const flat = item[key]
    if (flat != null && flat !== '') {
      const parsed = parseMoneyToCent(flat, undefined, key)
      if (parsed.cent !== 0) return parsed.cent
    }
  }
  return 0
}

const SKU_UNIT_PRICE_KEYS = ['price', 'salePrice', 'skuPrice', 'skuSoldPrice']

const SKU_LINE_TOTAL_KEYS = [
  'paidAmount',
  'skuPayAmount',
  'goodsPayAmount',
  'itemAmount',
  'skuOriginTotalPaidAmount',
  'totalGoodsAmount',
  'goodsAmount',
  'totalSkuAmount',
  'productPayAmount',
]

const SKU_QTY_KEYS = ['skuQuantity', 'quantity', 'qty', 'count', 'buyCount', 'skuCount']

const ORDER_GOODS_AMOUNT_KEYS = [
  'totalGoodsPayAmount',
  'goodsPayAmount',
  'goodsAmount',
  'productAmount',
  'totalSkuAmount',
  'itemTotalAmount',
  'productPayAmount',
  'totalProductAmount',
  'itemPayAmount',
  'totalItemAmount',
]

/** 用户应付 / 订单应付（不含商家应收） */
const RECEIVABLE_KEYS = [
  'receivableAmount',
  'totalOrderAmount',
  'actualPaid',
  'actualPaidWithoutDeposit',
  'receivable_amount',
  'total_order_amount',
  'actual_paid',
]

const SELLER_RECEIVE_KEYS = [
  'actualSellerReceiveAmount',
  'sellerReceiveAmount',
  'actual_seller_receive_amount',
  'seller_receive_amount',
]

const FREIGHT_KEYS = ['shippingFee', 'originShippingFee', 'freight', 'freightAmount', 'totalFreightAmount']

const PLATFORM_DISCOUNT_KEYS = [
  'redDiscountAmount',
  'discountedAmount',
  'platformDiscountAmount',
  'platformDiscount',
  'totalPlatformDiscount',
]

const ACTUAL_PAID_KEYS = ['actualPaid', 'actualPaidWithoutDeposit', 'actual_paid']

export interface OrderAmountExtract {
  gmvCent: number
  productAmountCent: number
  receivableAmountCent: number
  freightCent: number
  platformDiscountCent: number
  actualPaidCent: number
  actualSellerReceiveAmountCent: number
  sourceUsed: string
  warnings: string[]
}

function sumSkusProductGmvCent(pkg: Record<string, unknown>): { cent: number; ok: boolean } {
  const skus = pkg.skus
  if (!Array.isArray(skus) || skus.length === 0) return { cent: 0, ok: false }

  let sum = 0
  let hasLine = false
  for (const row of skus) {
    if (!row || typeof row !== 'object') continue
    const sku = row as Record<string, unknown>
    let qtyRaw: unknown = 1
    for (const key of SKU_QTY_KEYS) {
      if (sku[key] != null && sku[key] !== '') {
        qtyRaw = sku[key]
        break
      }
    }
    const qty = Number(qtyRaw)
    const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1

    let lineCent = 0
    for (const key of SKU_UNIT_PRICE_KEYS) {
      const pair = extractFieldPair(sku, key)
      const raw = pair.value ?? sku[key]
      if (raw == null || raw === '') continue
      const parsed = parseMoneyToCent(raw, pair.displayValue, key)
      if (parsed.cent > 0) {
        lineCent = Math.round(parsed.cent * safeQty)
        break
      }
    }

    if (lineCent <= 0) {
      for (const key of SKU_LINE_TOTAL_KEYS) {
        const pair = extractFieldPair(sku, key)
        const raw = pair.value ?? sku[key]
        if (raw == null || raw === '') continue
        const parsed = parseMoneyToCent(raw, pair.displayValue, key)
        if (parsed.cent > 0) {
          lineCent = parsed.cent
          break
        }
      }
    }

    if (lineCent > 0) {
      sum += lineCent
      hasLine = true
    }
  }

  return { cent: sum, ok: hasLine && sum > 0 }
}

export function extractOrderAmounts(pkg: Record<string, unknown>): OrderAmountExtract {
  const warnings: string[] = []

  const receivableAmountCent = parseFieldCent(pkg, RECEIVABLE_KEYS)
  const freightCent = parseFieldCent(pkg, FREIGHT_KEYS)
  const platformDiscountCent = parseFieldCent(pkg, PLATFORM_DISCOUNT_KEYS)
  const actualPaidCent = parseFieldCent(pkg, ACTUAL_PAID_KEYS)
  const actualSellerReceiveAmountCent = parseFieldCent(pkg, SELLER_RECEIVE_KEYS)

  const skuResult = sumSkusProductGmvCent(pkg)
  if (skuResult.ok) {
    return {
      gmvCent: skuResult.cent,
      productAmountCent: skuResult.cent,
      receivableAmountCent,
      freightCent,
      platformDiscountCent,
      actualPaidCent,
      actualSellerReceiveAmountCent:
        actualSellerReceiveAmountCent > 0 ? actualSellerReceiveAmountCent : receivableAmountCent,
      sourceUsed: 'skus_unit_price',
      warnings,
    }
  }

  const orderGoodsCent = parseFieldCent(pkg, ORDER_GOODS_AMOUNT_KEYS)
  if (orderGoodsCent > 0) {
    return {
      gmvCent: orderGoodsCent,
      productAmountCent: orderGoodsCent,
      receivableAmountCent,
      freightCent,
      platformDiscountCent,
      actualPaidCent,
      actualSellerReceiveAmountCent:
        actualSellerReceiveAmountCent > 0 ? actualSellerReceiveAmountCent : receivableAmountCent,
      sourceUsed: 'order_goods_field',
      warnings,
    }
  }

  if (receivableAmountCent > 0) {
    const derived = receivableAmountCent - freightCent + platformDiscountCent
    if (derived > 0) {
      warnings.push('无商品行金额，已用「应收 - 运费 + 平台优惠」估算商品 GMV，请核对')
      return {
        gmvCent: derived,
        productAmountCent: derived,
        receivableAmountCent,
        freightCent,
        platformDiscountCent,
        actualPaidCent,
        actualSellerReceiveAmountCent:
          actualSellerReceiveAmountCent > 0 ? actualSellerReceiveAmountCent : receivableAmountCent,
        sourceUsed: 'derived_receivable_minus_freight',
        warnings,
      }
    }
  }

  warnings.push('无法识别商品 GMV，请勿将应收金额当作 GMV')
  return {
    gmvCent: 0,
    productAmountCent: 0,
    receivableAmountCent,
    freightCent,
    platformDiscountCent,
    actualPaidCent,
    actualSellerReceiveAmountCent,
    sourceUsed: 'unrecognized',
    warnings,
  }
}

function parseOrderTimestamp(raw: unknown): Date | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const parsed = parseDateTime(raw)
  return parsed.ok ? parsed.date : null
}

/** 支付时间优先；orderTime 仅表示下单时间 */
function extractOrderTimes(item: Record<string, unknown>): {
  paymentTime: Date | null
  orderedAt: Date | null
  orderTime: Date | null
  orderTimeText: string
  monthKey: string
} {
  const paymentTime = parseOrderTimestamp(
    item.paidAt ?? item.paid_at ?? item.payTime ?? item.pay_time ?? item.paymentTime,
  )
  const orderedAt = parseOrderTimestamp(
    item.orderedAt ?? item.ordered_at ?? item.createTime ?? item.create_time,
  )
  const orderTime = orderedAt
  const statTime = paymentTime ?? orderedAt
  if (statTime) {
    return {
      paymentTime,
      orderedAt,
      orderTime,
      orderTimeText: formatDateTime(statTime),
      monthKey: getMonthKey(statTime),
    }
  }
  const fallbackRaw =
    item.orderedAt ?? item.paidAt ?? item.ordered_at ?? item.paid_at ?? ''
  return {
    paymentTime,
    orderedAt,
    orderTime: null,
    orderTimeText: String(fallbackRaw ?? ''),
    monthKey: '',
  }
}

function containsAny(text: string, keywords: string[]): boolean {
  if (!text) return false
  return keywords.some((kw) => text.includes(kw))
}

function extractReasonText(item: Record<string, unknown>): string {
  return pickString(item, [
    'afterSaleReason',
    'after_sale_reason',
    'reason',
    'refundReason',
    'refund_reason',
  ])
}

export type NormalizeXhsOrderHints = {
  dbPackageId?: string | null
  dbOrderId?: string | null
  liveAccountId?: string | null
  liveAccountName?: string | null
}

export function normalizeXhsOrderPackage(
  pkg: Record<string, unknown>,
  sourceRowIndex: number,
  hints?: NormalizeXhsOrderHints,
): NormalizedOrder {
  const errors: string[] = []
  const packageIdFromRaw = pickOrderIdentifierString(pkg, [
    'packageId',
    'package_id',
    'packageNo',
    'package_no',
  ])
  const bizOrderIdFromRaw = pickOrderIdentifierString(pkg, [
    'orderId',
    'order_id',
    'orderNo',
    'order_no',
  ])
  const dbPackageId = hints?.dbPackageId?.trim() || ''
  const dbOrderId = hints?.dbOrderId?.trim() || ''
  const official = pickOfficialDisplayOrderNo(pkg, {
    packageId: packageIdFromRaw,
    bizOrderId: bizOrderIdFromRaw,
    dbPackageId,
    dbOrderId,
  })
  const packageId =
    packageIdFromRaw ||
    (official.displayOrderNo && /^P/i.test(official.displayOrderNo) ? official.displayOrderNo : '') ||
    dbPackageId
  const bizOrderId = bizOrderIdFromRaw || dbOrderId
  const matchOrderId = packageId || bizOrderId || official.displayOrderNo
  const orderId = bizOrderId || packageId || official.displayOrderNo
  if (!matchOrderId) errors.push('缺少订单号/包裹号')

  const { paymentTime, orderedAt, orderTime, orderTimeText, monthKey } = extractOrderTimes(pkg)
  if (!orderTime) errors.push('时间解析失败')

  const displayNoForIdentity =
    official.displayOrderNo || packageId || bizOrderId || matchOrderId || ''
  const buyerIdentity = resolveBuyerIdentityForPackage(pkg, displayNoForIdentity)
  const buyerNickname = buyerIdentity?.buyerNickname ?? buyerIdentity?.buyerDisplayName ?? ''
  const buyerId = buyerIdentity?.buyerId ?? '未知买家'
  if (buyerIdentity) {
    attachBuyerIdentityToRaw(pkg, buyerIdentity)
  } else if (buyerNickname) {
    pkg._buyerNickname = buyerNickname
  }

  const amounts = extractOrderAmounts(pkg)
  const gmvCent = amounts.gmvCent
  if (gmvCent <= 0) errors.push('商品 GMV 解析失败')
  if (amounts.warnings.length > 0) {
    errors.push(...amounts.warnings)
  }

  const orderStatusText =
    pickString(pkg, ['statusDesc', 'status_desc']) || pickString(pkg, ['status'])
  const afterSaleStatusText =
    pickString(pkg, ['afterSaleStatusDesc', 'after_sale_status_desc']) ||
    pickString(pkg, ['afterSaleStatus', 'after_sale_status'])

  const combined = [orderStatusText, afterSaleStatusText].filter(Boolean).join(' ')
  const isSigned = containsAny(orderStatusText, SIGNED_KEYWORDS) || containsAny(combined, SIGNED_KEYWORDS)
  const isReturned =
    containsAny(orderStatusText, RETURN_KEYWORDS) ||
    containsAny(afterSaleStatusText, RETURN_KEYWORDS) ||
    containsAny(combined, RETURN_KEYWORDS)

  const reasonText = extractReasonText(pkg)
  const actualSigned = isSigned && !isReturned
  const signedBase =
    amounts.receivableAmountCent > 0
      ? amounts.receivableAmountCent
      : amounts.actualSellerReceiveAmountCent > 0
        ? amounts.actualSellerReceiveAmountCent
        : amounts.actualPaidCent
  const actualSignedAmountCent = actualSigned && signedBase > 0 ? signedBase : 0

  const isQualityReturn = false

  const { orderAnchorId, orderAnchorName, orderLiveId } = extractOrderAnchorFields(pkg)

  return {
    sourceRowIndex,
    orderId,
    packageId,
    bizOrderId,
    officialOrderNo: official.displayOrderNo,
    displayOrderNo: official.displayOrderNo,
    matchOrderId,
    paymentTime,
    orderedAt,
    orderTime,
    orderTimeText,
    monthKey,
    buyerId,
    orderAnchorId: orderAnchorId || undefined,
    orderAnchorName: orderAnchorName || undefined,
    orderLiveId: orderLiveId || undefined,
    liveAccountId: hints?.liveAccountId?.trim() || undefined,
    liveAccountName: hints?.liveAccountName?.trim() || undefined,
    gmvCent,
    productAmountCent: amounts.productAmountCent,
    receivableAmountCent: amounts.receivableAmountCent,
    freightCent: amounts.freightCent,
    platformDiscountCent: amounts.platformDiscountCent,
    actualPaidCent: amounts.actualPaidCent,
    actualSellerReceiveAmountCent: amounts.actualSellerReceiveAmountCent,
    gmvSourceUsed: amounts.sourceUsed,
    amountWarnings: amounts.warnings,
    orderStatusText,
    afterSaleStatusText,
    reasonText,
    isSigned,
    isReturned,
    isQualityReturn,
    actualSigned,
    actualSignedAmountCent,
    errors,
    raw: pkg,
    sourceType: 'order_list',
    isPrimaryOrder: true,
  }
}

export interface NormalizedOrdersSummary {
  totalRaw: number
  normalizedCount: number
  abnormalCount: number
  gmvCent: number
  orderCount: number
  sample: NormalizedOrder | null
}

export async function summarizeNormalizedOrders(): Promise<NormalizedOrdersSummary> {
  const rows = await prisma.xhsRawOrder.findMany({ orderBy: { updatedAt: 'desc' } })
  const normalized: NormalizedOrder[] = rows.map((row, index) =>
    normalizeXhsOrderPackage(asRecord(row.rawJson), index + 1, {
      dbPackageId: row.packageId,
      dbOrderId: row.orderId,
    }),
  )

  const valid = normalized.filter((o) => o.errors.length === 0)
  const abnormalCount = normalized.length - valid.length
  const gmvCent = valid.reduce((sum, o) => sum + o.gmvCent, 0)

  return {
    totalRaw: rows.length,
    normalizedCount: valid.length,
    abnormalCount,
    gmvCent,
    orderCount: valid.length,
    sample: valid[0] ?? normalized[0] ?? null,
  }
}

function buildOrderTimeDbWhere(range: DateRangeResolved) {
  return {
    OR: [
      {
        orderTime: {
          gte: new Date(range.startTimeMs - RAW_ORDER_RANGE_DB_BUFFER_MS),
          lte: new Date(range.endTimeMs + RAW_ORDER_RANGE_DB_BUFFER_MS),
        },
      },
      { orderTime: null },
    ],
  }
}

export async function loadNormalizedOrdersFromRaw(options?: {
  range?: DateRangeResolved
}): Promise<NormalizedOrder[]> {
  const rows = await prisma.xhsRawOrder.findMany({
    where: options?.range ? buildOrderTimeDbWhere(options.range) : undefined,
    orderBy: { updatedAt: 'desc' },
  })
  const normalized = rows.map((row, index) =>
    normalizeXhsOrderPackage(asRecord(row.rawJson), index + 1, {
      dbPackageId: row.packageId,
      dbOrderId: row.orderId,
      liveAccountId: row.liveAccountId,
      liveAccountName: row.liveAccountName,
    }),
  )
  if (!options?.range) return normalized
  return normalized.filter((o) => orderPayTimeInRange(o, options.range!))
}

/** @deprecated 旧流水线兼容：阶段八后由独立看板接口提供数据 */
export async function buildAnalyzeInputFromRawTables(): Promise<AnalyzeInput | null> {
  const orderCount = await prisma.xhsRawOrder.count()
  if (orderCount === 0) return null
  return null
}

// --- 直播场次标准化 ---

export interface NormalizedLiveSession {
  id: string
  liveId: string
  liveName: string
  anchorName: string
  startTime: Date | null
  endTime: Date | null
  durationMinutes: number
  liveGmvCent: number
  refundAmountCent: number
  dealOrderCount: number
  refundOrderCount: number
  raw: Record<string, unknown>
  errors: string[]
}

function extractLiveFieldValue(item: Record<string, unknown>, fieldName: string): unknown {
  const field = item[fieldName]
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const f = field as Record<string, unknown>
    if (f.value !== undefined && f.value !== null && String(f.value).trim() !== '') {
      return f.value
    }
    if (f.displayValue !== undefined && f.displayValue !== null && String(f.displayValue).trim() !== '') {
      return f.displayValue
    }
  }
  return item[fieldName]
}

function pickLiveString(item: Record<string, unknown>, fieldName: string): string {
  const value = extractLiveFieldValue(item, fieldName)
  return value != null ? String(value).trim() : ''
}

function parseLiveMoneyCent(item: Record<string, unknown>, fieldName: string): number {
  const pair = extractFieldPair(item, fieldName)
  if (pair.value != null || pair.displayValue != null) {
    return parseMoneyToCent(pair.value, pair.displayValue, fieldName).cent
  }
  return parseMoneyToCent(extractLiveFieldValue(item, fieldName), undefined, fieldName).cent
}

function parseLiveDate(raw: unknown): Date | null {
  if (raw == null) return null
  if (typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const parsed = parseDateTime(raw)
  return parsed.ok ? parsed.date : null
}

function parseDurationMinutes(raw: unknown, start: Date | null, end: Date | null): number {
  if (raw != null && raw !== '') {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.max(0, Math.round(raw))
    }
    const text = String(raw).trim()
    const asNum = Number(text.replace(/,/g, ''))
    if (Number.isFinite(asNum) && asNum > 0) {
      return Math.round(asNum)
    }
    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*小时/)
    const minMatch = text.match(/(\d+(?:\.\d+)?)\s*分/)
    let minutes = 0
    if (hourMatch) minutes += Math.round(Number(hourMatch[1]) * 60)
    if (minMatch) minutes += Math.round(Number(minMatch[1]))
    if (minutes > 0) return minutes
  }
  if (start && end) {
    let endMs = end.getTime()
    const startMs = start.getTime()
    if (endMs < startMs) endMs += 24 * 60 * 60 * 1000
    return Math.max(0, Math.round((endMs - startMs) / 60000))
  }
  return 0
}

function parseLiveCount(raw: unknown): number {
  if (raw == null || raw === '') return 0
  const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''))
  return Number.isFinite(num) ? Math.round(num) : 0
}

export function normalizeXhsLiveSession(
  item: Record<string, unknown>,
  id: string,
): NormalizedLiveSession {
  const errors: string[] = []
  const liveId = pickLiveString(item, 'liveId')
  const liveName = pickLiveString(item, 'liveName')
  if (!liveId) errors.push('缺少 liveId')

  const anchorName =
    pickLiveString(item, 'nickName') || pickLiveString(item, 'userId') || ''

  const startTime = parseLiveDate(extractLiveFieldValue(item, 'liveStartTime'))
  const endTime = parseLiveDate(extractLiveFieldValue(item, 'liveEndTime'))
  if (!startTime) errors.push('开始时间解析失败')

  const durationMinutes = parseDurationMinutes(
    extractLiveFieldValue(item, 'liveDuration'),
    startTime,
    endTime,
  )

  const liveGmvCent = parseLiveMoneyCent(item, 'sellerRealIncomeAmt')
  const refundAmountCent = parseLiveMoneyCent(item, 'refundAmt')
  const dealOrderCount = parseLiveCount(extractLiveFieldValue(item, 'dealOrderCnt'))
  const refundOrderCount = parseLiveCount(extractLiveFieldValue(item, 'refundsOrderCnt'))

  return {
    id,
    liveId,
    liveName,
    anchorName,
    startTime,
    endTime,
    durationMinutes,
    liveGmvCent,
    refundAmountCent,
    dealOrderCount,
    refundOrderCount,
    raw: item,
    errors,
  }
}

export interface NormalizedLiveSessionsSummary {
  totalRaw: number
  normalizedCount: number
  abnormalCount: number
  totalLiveGmvCent: number
  totalRefundCent: number
  totalDurationMinutes: number
  sample: NormalizedLiveSession[]
}

export async function normalizeLiveSessionsFromRaw(options?: {
  range?: DateRangeResolved
}): Promise<NormalizedLiveSession[]> {
  const rows = await prisma.xhsRawLiveSession.findMany({
    where: options?.range
      ? {
          OR: [
            {
              startTime: {
                gte: new Date(options.range.startTimeMs - RAW_LIVE_RANGE_DB_BUFFER_MS),
                lte: new Date(options.range.endTimeMs + RAW_LIVE_RANGE_DB_BUFFER_MS),
              },
            },
            { startTime: null },
          ],
        }
      : undefined,
    orderBy: { updatedAt: 'desc' },
  })
  return rows.map((row) => normalizeXhsLiveSession(asRecord(row.rawJson), row.id))
}

export async function summarizeNormalizedLiveSessions(): Promise<NormalizedLiveSessionsSummary> {
  const normalized = await normalizeLiveSessionsFromRaw()
  const valid = normalized.filter((s) => s.errors.length === 0)

  return {
    totalRaw: normalized.length,
    normalizedCount: valid.length,
    abnormalCount: normalized.length - valid.length,
    totalLiveGmvCent: valid.reduce((sum, s) => sum + s.liveGmvCent, 0),
    totalRefundCent: valid.reduce((sum, s) => sum + s.refundAmountCent, 0),
    totalDurationMinutes: valid.reduce((sum, s) => sum + s.durationMinutes, 0),
    sample: valid.slice(0, 3),
  }
}

// --- 结算标准化 ---

function extractSettleBillMap(item: Record<string, unknown>): Record<string, unknown> {
  const bill = item.settleBill
  if (!Array.isArray(bill)) return item
  const map: Record<string, unknown> = {}
  for (const entry of bill) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const code = e.code != null ? String(e.code) : ''
    if (code) map[code] = e
  }
  return map
}

function pickBillValue(map: Record<string, unknown>, code: string): unknown {
  const field = map[code]
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const f = field as Record<string, unknown>
    if (f.value !== undefined && f.value !== null && String(f.value).trim() !== '') return f.value
    if (f.displayValue !== undefined && f.displayValue !== null) return f.displayValue
  }
  return undefined
}

function parseSettlementMoneyCent(
  value: unknown,
  displayValue?: unknown,
  fieldName?: string,
): number {
  return parseMoneyToCent(value, displayValue, fieldName).cent
}

function parseSettlementDate(raw: unknown): Date | null {
  if (raw == null) return null
  if (typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const parsed = parseDateTime(raw)
  return parsed.ok ? parsed.date : null
}

function resolveSettlementDirection(
  amountCent: number,
  transType: string,
  statusText: string,
): SettlementDirection {
  const combined = `${transType} ${statusText}`.toLowerCase()
  if (
    combined.includes('服务费') ||
    combined.includes('佣金') ||
    combined.includes('技术服务费') ||
    combined.includes('平台扣费') ||
    combined.includes('运费险') ||
    combined.includes('扣费')
  ) {
    return 'fee'
  }
  if (amountCent < 0) return 'refund'
  if (amountCent > 0) return 'income'
  return 'unknown'
}

export function normalizeSettlementItem(
  item: Record<string, unknown>,
  sourceType: SettlementType,
  sourceRowIndex: number,
): SettlementRecord {
  const errors: string[] = []
  const map = extractSettleBillMap(item)

  const settleNo = String(pickBillValue(map, 'SETTLE_NO') ?? item.settleNo ?? '').trim()
  const packageId = String(pickBillValue(map, 'PACKAGE_ID') ?? item.packageId ?? '').trim()
  const orderId = packageId || settleNo
  if (!orderId) errors.push('缺少订单/包裹号')

  const orderTime = parseSettlementDate(pickBillValue(map, 'ORDER_CREATE_TIME'))
  const settleTime = parseSettlementDate(pickBillValue(map, 'SETTLE_TIME'))

  const transType = String(pickBillValue(map, 'TRANS_TYPE') ?? '').trim()
  const statusText = String(pickBillValue(map, 'ORDER_STATUS') ?? '').trim()

  const readBill = (code: string) => {
    const pair = pickBillFieldPair(map, code)
    return parseSettlementMoneyCent(pair.value, pair.displayValue, code)
  }

  const sellerIncome = readBill('SELLER_INCOME')
  const totalIn = readBill('TOTAL_IN_AMOUNT')
  const net = readBill('NET_AMOUNT') || readBill('SETTLE_AMOUNT')
  const refundAmt = readBill('TOTAL_REFUND_AMOUNT') || readBill('REFUND')
  const feeAmt =
    readBill('TOTAL_COMMISSION_AMOUNT') +
    readBill('SERVICE_FEE') +
    readBill('COMMISSION') +
    readBill('PLATFORM_FEE')
  const freightAmt = readBill('TOTAL_FREIGHT_AMOUNT') || readBill('FREIGHT')

  const incomeFromFields = sellerIncome || totalIn
  let amountCent = 0
  if (net !== 0 && incomeFromFields === 0 && refundAmt === 0 && feeAmt === 0 && freightAmt === 0) {
    amountCent = net
  } else {
    amountCent = incomeFromFields || net
  }

  const direction = resolveSettlementDirection(amountCent, transType, statusText)

  return {
    sourceRowIndex,
    settlementType: sourceType,
    orderId,
    amountCent,
    settlementTime: settleTime ?? orderTime ?? undefined,
    settlementTimeText: settleTime
      ? formatDateTime(settleTime)
      : orderTime
        ? formatDateTime(orderTime)
        : '',
    statusText: statusText || transType,
    direction,
    errors,
    raw: item,
  }
}

export async function normalizePendingSettlementsFromRaw(): Promise<SettlementRecord[]> {
  const rows = await prisma.xhsRawPendingSettlement.findMany({ orderBy: { updatedAt: 'desc' } })
  return rows.map((row, i) =>
    normalizeSettlementItem(asRecord(row.rawJson), 'pending', i + 1),
  )
}

export async function normalizeSettledSettlementsFromRaw(): Promise<SettlementRecord[]> {
  const rows = await prisma.xhsRawSettledSettlement.findMany({ orderBy: { updatedAt: 'desc' } })
  return rows.map((row, i) =>
    normalizeSettlementItem(asRecord(row.rawJson), 'settled', i + 1),
  )
}

export interface NormalizedSettlementsSummary {
  totalRaw: number
  normalizedCount: number
  amountCent: number
}

export async function summarizeNormalizedSettlements(): Promise<{
  pending: NormalizedSettlementsSummary
  settled: NormalizedSettlementsSummary
}> {
  const pendingAll = await normalizePendingSettlementsFromRaw()
  const settledAll = await normalizeSettledSettlementsFromRaw()
  const pendingValid = pendingAll.filter((r) => r.errors.length === 0)
  const settledValid = settledAll.filter((r) => r.errors.length === 0)

  return {
    pending: {
      totalRaw: pendingAll.length,
      normalizedCount: pendingValid.length,
      amountCent: pendingValid.reduce((s, r) => s + r.amountCent, 0),
    },
    settled: {
      totalRaw: settledAll.length,
      normalizedCount: settledValid.length,
      amountCent: settledValid.reduce((s, r) => s + r.amountCent, 0),
    },
  }
}
