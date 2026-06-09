/**
 * 订单主表与售后匹配：售后只能补充主订单，不能单独造单
 */
import type { NormalizedOrder } from '../types/analysis'
import {
  buildAfterSaleByOrderNo,
  type AfterSaleOrderAggregate,
  type NormalizedAfterSaleRecord,
} from './xhs-after-sales-range.service'
import { isPrimaryOrderForMetrics } from './order-primary-source.service'

/** 订单号 normalize：去空格/不可见字符，避免科学计数法 */
export function normalizeOrderIdentifier(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  let s = String(value).trim()
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '')
  if (/e\+?\d+/i.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) return String(Math.trunc(n))
  }
  return s
}

export interface OrderMasterEntry {
  orderNo: string
  matchOrderId: string
}

export type UnmatchedAfterSaleReason =
  | 'not_found_in_order_master'
  | 'after_sale_only_pseudo_order'

export interface UnmatchedAfterSaleRecord {
  package_id: string
  delivery_package_id: string
  returns_id: string
  refund_fee_cent: number
  settlement_amount_cent: number
  pay_amount_cent: number
  status_name: string
  refund_status_name: string
  reason_name_zh: string
  return_type_name: string
  time: string
  unmatchedReason: UnmatchedAfterSaleReason
  explanation: string
  /** @deprecated 使用 unmatchedReason */
  reasonExcluded: string
}

/** 回归用例兜底（非主判断逻辑） */
export const REGRESSION_AFTER_SALE_ONLY_BLOCKLIST = new Set(['P795576476520390821'])

const REAL_ORDER_FULFILLMENT_STATUS = [
  '待配货',
  '待发货',
  '已发货',
  '运输中',
  '待收货',
  '已签收',
  '待付款',
  '已取消',
  '已关闭',
  '已完成',
  '交易成功',
  '交易关闭',
  '配货中',
] as const

export interface AfterSalePseudoDetection {
  isPseudo: boolean
  confidence: 'structural' | 'blocklist_fallback'
  signals: string[]
}

function pickString(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function hasOrderProductLines(pkg: Record<string, unknown>): boolean {
  for (const key of [
    'skus',
    'goodsList',
    'goods_list',
    'goods',
    'itemList',
    'item_list',
    'packageItemList',
    'package_detail_list',
  ]) {
    const v = pkg[key]
    if (Array.isArray(v) && v.length > 0) return true
  }
  return false
}

function isRefundOnlyReturnType(text: string): boolean {
  if (!text) return false
  return (
    text.includes('未发货仅退款') ||
    text.includes('仅退款') ||
    text === '退款' ||
    text.includes('仅退')
  )
}

function hasCompleteAfterSaleApiFields(rec: NormalizedAfterSaleRecord): boolean {
  return Boolean(
    rec.returnId &&
      (rec.returnTypeName || rec.reason) &&
      (rec.refundAmountCent > 0 || rec.statusName || rec.refundStatusName),
  )
}

function hasAfterSaleListShapeOnPackage(pkg: Record<string, unknown>): boolean {
  const returnsId = pickString(pkg, ['returns_id', 'returnsId', 'return_id'])
  const returnType = pickString(pkg, ['return_type_name', 'returnTypeName'])
  const reason = pickString(pkg, ['reason_name_zh', 'reasonNameZh', 'reason'])
  const refundFee = pkg.refund_fee ?? pkg.refundFee
  return Boolean(returnsId || (returnType && reason) || (returnType && refundFee != null))
}

function hasNormalOrderFulfillmentStatus(statusText: string): boolean {
  if (!statusText) return false
  return REAL_ORDER_FULFILLMENT_STATUS.some((k) => statusText.includes(k))
}

function isAfterSaleDominantStatus(text: string): boolean {
  if (!text) return false
  if (hasNormalOrderFulfillmentStatus(text)) return false
  return /售后|退款|退货|已关闭|审核/.test(text)
}

/** 订单详情应具备：下单时间 + 商品行 + 正常履约状态 */
export function hasRealOrderMainBody(order: NormalizedOrder): boolean {
  const pkg = order.raw as Record<string, unknown>
  const hasOrderedAt = Boolean(
    pkg.ordered_at ??
      pkg.orderedAt ??
      pkg.create_time ??
      pkg.createTime ??
      order.orderedAt ??
      order.orderTime,
  )
  const hasProducts = hasOrderProductLines(pkg)
  const status = pickString(pkg, [
    'statusDesc',
    'status_desc',
    'statusName',
    'status_name',
    'status',
  ])
  const hasFulfillmentStatus = hasNormalOrderFulfillmentStatus(status)
  return hasOrderedAt && hasProducts && hasFulfillmentStatus
}

function orderNoKeys(order: NormalizedOrder): string[] {
  return [order.displayOrderNo, order.officialOrderNo, order.packageId, order.matchOrderId]
    .map((s) => normalizeOrderIdentifier(s))
    .filter(Boolean)
}

export function resolveAfterSaleOrderKeys(
  rec: NormalizedAfterSaleRecord | Record<string, unknown>,
): string[] {
  const raw =
    'raw' in rec && rec.raw && typeof rec.raw === 'object'
      ? (rec.raw as Record<string, unknown>)
      : (rec as Record<string, unknown>)
  const keys = new Set<string>()
  const add = (v: unknown) => {
    const s = normalizeOrderIdentifier(v)
    if (s) keys.add(s)
  }
  if ('orderNo' in rec && rec.orderNo) add(rec.orderNo)
  for (const k of [
    'package_id',
    'packageId',
    'delivery_package_id',
    'deliveryPackageId',
    'order_id',
    'orderId',
    'orderNo',
    'order_no',
    'orderSn',
    'order_sn',
    'parentOrderNo',
    'parent_order_no',
    'parent_order_id',
  ]) {
    add(raw[k])
  }
  const pKeys = [...keys].filter((k) => /^P/i.test(k))
  const otherKeys = [...keys].filter((k) => !/^P/i.test(k))
  return [...pKeys, ...otherKeys]
}

export interface AfterSaleMasterMatchResult {
  matched: boolean
  matchedOrderNo: string | null
  reason: string | null
}

export function matchAfterSaleRawToMaster(
  raw: Record<string, unknown>,
  masterNos: Set<string>,
  fallbackOrderNo?: string,
): AfterSaleMasterMatchResult {
  const keys = resolveAfterSaleOrderKeys({ raw, orderNo: fallbackOrderNo ?? '' })
  for (const k of keys) {
    if (masterNos.has(k)) {
      return { matched: true, matchedOrderNo: k, reason: null }
    }
  }
  if (keys.length === 0) {
    return { matched: false, matchedOrderNo: null, reason: '售后记录缺少可匹配订单号' }
  }
  const display = keys.find((k) => /^P/i.test(k)) ?? keys[0]
  return {
    matched: false,
    matchedOrderNo: null,
    reason: `订单号 ${display} 不在本期订单主表`,
  }
}

export function findRelatedAfterSaleRecords(
  order: NormalizedOrder,
  afterSaleRecords: NormalizedAfterSaleRecord[],
): NormalizedAfterSaleRecord[] {
  const keys = orderNoKeys(order)
  if (keys.length === 0) return []
  return afterSaleRecords.filter((rec) => {
    const recKeys = resolveAfterSaleOrderKeys(rec)
    return keys.some(
      (k) => recKeys.some((rk) => rk === k || rk.includes(k) || k.includes(rk)),
    )
  })
}

/** 结构特征识别售后伪包裹（blocklist 仅兜底） */
export function detectAfterSalePseudoOrder(
  order: NormalizedOrder,
  afterSaleRecords: NormalizedAfterSaleRecord[],
): AfterSalePseudoDetection {
  const related = findRelatedAfterSaleRecords(order, afterSaleRecords)
  const signals: string[] = []
  const orderNo = (order.displayOrderNo || order.officialOrderNo || order.packageId || '').trim()
  const pkg = order.raw as Record<string, unknown>

  if (related.length === 0) {
    return { isPseudo: false, confidence: 'structural', signals }
  }

  const completeAfterSale = related.filter(hasCompleteAfterSaleApiFields)
  if (completeAfterSale.length > 0) signals.push('after_sale_api_complete_fields')

  const refundOnlyRelated = related.filter((r) => isRefundOnlyReturnType(r.returnTypeName || ''))
  if (refundOnlyRelated.length > 0) signals.push('refund_only_return_type')

  if (related.some((r) => Boolean(r.reason?.trim()))) signals.push('after_sale_reason_name_zh')

  if (related.some((r) => isAfterSaleDominantStatus(r.statusName || r.refundStatusName || ''))) {
    signals.push('after_sale_status_not_order_fulfillment')
  }

  const pkgAfterSaleShape = hasAfterSaleListShapeOnPackage(pkg)
  if (pkgAfterSaleShape) signals.push('pkg_after_sale_list_shape')

  const realBody = hasRealOrderMainBody(order)
  if (!realBody) signals.push('lacks_real_order_main_body')

  const hasOrderedAt = Boolean(
    pkg.ordered_at ??
      pkg.orderedAt ??
      pkg.create_time ??
      pkg.createTime ??
      order.orderedAt ??
      order.orderTime,
  )
  if (!hasOrderedAt) signals.push('pkg_missing_ordered_at')

  const pkgReturnType = pickString(pkg, ['return_type_name', 'returnTypeName'])
  if (pkgReturnType && isRefundOnlyReturnType(pkgReturnType)) {
    signals.push('pkg_refund_only_return_type')
  }

  let isPseudo = false

  // 结构主判：订单列表包裹本身呈售后列表字段形态（非仅有关联售后记录）
  if (pkgAfterSaleShape && completeAfterSale.length > 0) {
    if (!hasOrderedAt || !realBody) {
      isPseudo = true
    } else if (pkgReturnType && refundOnlyRelated.length > 0) {
      isPseudo = true
    }
  } else if (
    !realBody &&
    pkgAfterSaleShape &&
    completeAfterSale.length > 0 &&
    refundOnlyRelated.length > 0 &&
    related.some((r) => r.reason?.trim())
  ) {
    isPseudo = true
  }

  if (
    !isPseudo &&
    orderNo &&
    REGRESSION_AFTER_SALE_ONLY_BLOCKLIST.has(orderNo) &&
    completeAfterSale.length > 0 &&
    refundOnlyRelated.length > 0 &&
    related.some((r) => r.reason?.trim())
  ) {
    isPseudo = true
    signals.push('regression_blocklist_fallback')
    return { isPseudo: true, confidence: 'blocklist_fallback', signals }
  }

  return { isPseudo, confidence: 'structural', signals }
}

export interface StrippedPseudoOrder {
  orderNo: string
  detection: AfterSalePseudoDetection
  relatedAfterSales: NormalizedAfterSaleRecord[]
}

/**
 * 从主表剔除售后伪包裹；关联售后进入 unmatched（after_sale_only_pseudo_order）
 */
export function stripAfterSaleOnlyFromPrimaryOrders(
  orders: NormalizedOrder[],
  afterSaleRecords: NormalizedAfterSaleRecord[],
): { orders: NormalizedOrder[]; stripped: StrippedPseudoOrder[] } {
  const stripped: StrippedPseudoOrder[] = []
  const kept: NormalizedOrder[] = []

  for (const order of orders) {
    const detection = detectAfterSalePseudoOrder(order, afterSaleRecords)
    if (!detection.isPseudo) {
      kept.push(order)
      continue
    }
    const orderNo = (order.displayOrderNo || order.officialOrderNo || order.packageId || '').trim()
    stripped.push({
      orderNo,
      detection,
      relatedAfterSales: findRelatedAfterSaleRecords(order, afterSaleRecords),
    })
  }

  return { orders: kept, stripped }
}

export function toUnmatchedAfterSaleRecord(
  rec: NormalizedAfterSaleRecord,
  reason: UnmatchedAfterSaleReason,
  explanation: string,
): UnmatchedAfterSaleRecord {
  const raw = rec.raw
  return {
    package_id: pickString(raw, ['package_id', 'packageId']) || rec.orderNo,
    delivery_package_id: pickString(raw, ['delivery_package_id', 'deliveryPackageId']),
    returns_id: rec.returnId,
    refund_fee_cent: rec.refundAmountCent,
    settlement_amount_cent: rec.settlementAmountCent,
    pay_amount_cent: rec.payAmountCent,
    status_name: rec.statusName,
    refund_status_name: rec.refundStatusName,
    reason_name_zh: rec.reason,
    return_type_name: rec.returnTypeName,
    time: String(rec.applyTime ?? rec.refundTime ?? ''),
    unmatchedReason: reason,
    explanation,
    reasonExcluded: explanation,
  }
}

export function pseudoStrippedToUnmatchedRecords(
  stripped: StrippedPseudoOrder[],
): UnmatchedAfterSaleRecord[] {
  const seen = new Set<string>()
  const out: UnmatchedAfterSaleRecord[] = []
  for (const item of stripped) {
    for (const rec of item.relatedAfterSales) {
      const rid = rec.returnId || `${rec.orderNo}:${rec.refundAmountCent}`
      if (seen.has(rid)) continue
      seen.add(rid)
      out.push(
        toUnmatchedAfterSaleRecord(
          rec,
          'after_sale_only_pseudo_order',
          `售后伪包裹已剔除（${item.detection.signals.join('、')}），不计入主指标`,
        ),
      )
    }
    if (item.relatedAfterSales.length === 0 && item.orderNo) {
      const key = `pseudo:${item.orderNo}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push({
          package_id: item.orderNo,
          delivery_package_id: '',
          returns_id: '',
          refund_fee_cent: 0,
          settlement_amount_cent: 0,
          pay_amount_cent: 0,
          status_name: '',
          refund_status_name: '',
          reason_name_zh: '',
          return_type_name: '',
          time: '',
          unmatchedReason: 'after_sale_only_pseudo_order',
          explanation: `订单列表混入售后伪包裹 ${item.orderNo}，已剔除`,
          reasonExcluded: `订单列表混入售后伪包裹 ${item.orderNo}，已剔除`,
        })
      }
    }
  }
  return out
}

/** 从订单主表建立 orderNo → 订单 映射（仅 isPrimaryOrder 订单） */
export function buildOrderMap(orders: NormalizedOrder[]): Map<string, OrderMasterEntry> {
  const map = new Map<string, OrderMasterEntry>()
  for (const o of orders) {
    if (!isPrimaryOrderForMetrics(o)) continue
    if (o.sourceType === 'after_sale') continue
    const no = normalizeOrderIdentifier(o.displayOrderNo || o.officialOrderNo || o.packageId)
    if (!no) continue
    const entry: OrderMasterEntry = { orderNo: no, matchOrderId: o.matchOrderId }
    for (const key of orderNoKeys(o)) {
      if (!map.has(key)) map.set(key, entry)
    }
  }
  return map
}

export function getMasterOrderNos(orderMap: Map<string, OrderMasterEntry>): Set<string> {
  return new Set(orderMap.keys())
}

function isMatchedToPrimaryMaster(
  rec: NormalizedAfterSaleRecord,
  masterNos: Set<string>,
): boolean {
  return matchAfterSaleRawToMaster(rec.raw, masterNos, rec.orderNo).matched
}

/** 售后记录匹配订单主表；未匹配进入调试列表，不得进入主指标 */
export function matchAfterSaleToOrders(
  records: NormalizedAfterSaleRecord[],
  orderMap: Map<string, OrderMasterEntry>,
  options?: { primaryOrderNos?: Set<string> },
): {
  matchedRecords: NormalizedAfterSaleRecord[]
  unmatchedAfterSaleRecords: UnmatchedAfterSaleRecord[]
  afterSaleByOrderNo: Map<string, AfterSaleOrderAggregate>
  matchedRawByOrderNo: Map<string, Record<string, unknown>[]>
} {
  const masterNos = options?.primaryOrderNos ?? getMasterOrderNos(orderMap)
  const matchedRecords: NormalizedAfterSaleRecord[] = []
  const unmatchedAfterSaleRecords: UnmatchedAfterSaleRecord[] = []

  for (const rec of records) {
    if (isMatchedToPrimaryMaster(rec, masterNos)) {
      matchedRecords.push(rec)
    } else {
      unmatchedAfterSaleRecords.push(
        toUnmatchedAfterSaleRecord(
          rec,
          'not_found_in_order_master',
          '售后记录未匹配到本期订单主表，不计入主指标',
        ),
      )
    }
  }

  const afterSaleByOrderNo = buildAfterSaleByOrderNo(matchedRecords, masterNos)
  const matchedRawByOrderNo = new Map<string, Record<string, unknown>[]>()
  for (const rec of matchedRecords) {
    const list = matchedRawByOrderNo.get(rec.orderNo) ?? []
    list.push(rec.raw)
    matchedRawByOrderNo.set(rec.orderNo, list)
  }

  return {
    matchedRecords,
    unmatchedAfterSaleRecords,
    afterSaleByOrderNo,
    matchedRawByOrderNo,
  }
}

export function mergeUnmatchedAfterSaleRecords(
  ...groups: UnmatchedAfterSaleRecord[][]
): UnmatchedAfterSaleRecord[] {
  const seen = new Set<string>()
  const out: UnmatchedAfterSaleRecord[] = []
  for (const group of groups) {
    for (const rec of group) {
      const key = rec.returns_id || `${rec.package_id}:${rec.refund_fee_cent}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(rec)
    }
  }
  return out
}

/** 单数类指标：按订单号去重 */
export function dedupeOrderCountByOrderNo(orderNos: Iterable<string>): number {
  return new Set([...orderNos].filter(Boolean)).size
}
