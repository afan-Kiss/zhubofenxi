/**
 * 严格售后 / 品退 / 签收金额统一口径（看板、排行、导出、Drawer 共用）
 */
import type { AnalyzedOrderView, NormalizedOrder } from '../types/analysis'
import { parseMoneyToCent } from '../utils/money'
import { matchPlatformReturnReason } from '../utils/quality-return'
import {
  resolveBusinessProductRefundAmountCent,
  resolveBusinessRefundAmountCent,
} from './business-refund-caliber.service'
import {
  pickReturnsV3BuyerUserId,
  splitReturnsV3RefundCent,
} from './returns-v3-record.service'
import { isStatusSignedOrder, isStatusSignedView } from './order-sign-status.service'
import { resolveSuccessfulProductRefundCentForSign } from './sign-amount-refund.service'

function yuanApiAmountToCent(value: unknown): number {
  if (value == null || value === '') return 0
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0
    return Math.round(value * 100)
  }
  const parsed = parseMoneyToCent(value)
  return parsed.ok ? parsed.cent : 0
}

/** 无效/取消/关闭售后状态关键词（不计入退款、品退、签收净额） */
const INVALID_AFTER_SALE_KEYWORDS = [
  '已取消',
  '已关闭',
  '已撤销',
  '已拒绝',
  '拒绝退款',
  '用户取消',
  '用户撤销',
  '售后关闭',
  '取消售后',
  '审核拒绝',
  '商家拒绝',
  '平台拒绝',
  '售后取消',
  '买家取消售后',
  '关闭售后',
  '驳回',
  '撤销',
  '拒绝',
  '待处理',
  '处理中',
  '待买家退货',
  '待商家收货',
  '待平台介入',
  '待寄回',
  '待收货',
  '待用户收货',
  '商家拒绝收货',
  '售后中',
  'pending',
  'closed',
  'rejected',
  'cancel',
] as const

/** 有效成功售后状态关键词 */
const SUCCESS_AFTER_SALE_KEYWORDS = [
  '退款成功',
  '售后完成',
  '退货退款成功',
  '退货退款完成',
  '已退货退款',
  '已完成',
  '已退款',
  '退款完成',
  '平台已退款',
  '商家已退款',
  'success',
  'completed',
  'finished',
] as const

function pickString(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

const FLAT_REASON_KEYS = [
  'reason_name_zh',
  'reasonNameZh',
  'reason',
  'afterSaleReason',
  'refundReason',
  'returnReason',
  'reasonDesc',
  'applyReason',
  'applyReasonDesc',
  'problemReason',
  'disputeReason',
  'serviceReason',
] as const

const NESTED_REASON_CONTAINERS = [
  'afterSaleInfo',
  'after_sale_info',
  'afterSale',
  'detail',
  'raw',
] as const

/** 从售后 raw 记录提取原因文案（兼容多字段路径与 rawJson 嵌套） */
export function extractAfterSaleReasonText(
  rec: Record<string, unknown>,
  depth = 0,
): string {
  if (depth > 4) return ''
  for (const k of FLAT_REASON_KEYS) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  for (const nested of NESTED_REASON_CONTAINERS) {
    const inner = rec[nested]
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const found = extractAfterSaleReasonText(inner as Record<string, unknown>, depth + 1)
      if (found) return found
    }
  }
  return ''
}

function afterSaleStatusText(rec: Record<string, unknown>): string {
  return [
    rec.refund_status_name,
    rec.refundStatusName,
    rec.status_name,
    rec.statusName,
    rec.status_desc,
    rec.statusDesc,
  ]
    .filter(Boolean)
    .join(' ')
}

export function isCanceledOrInvalidAfterSale(rec: Record<string, unknown>): boolean {
  const text = afterSaleStatusText(rec)
  if (!text) return false
  if (INVALID_AFTER_SALE_KEYWORDS.some((k) => text.includes(k))) return true
  if (/待审核|处理中|进行中|待处理/.test(text) && !isSuccessfulAfterSale(rec)) return true
  return false
}

function businessRefundCentForSuccessCheck(rec: Record<string, unknown>): number {
  return resolveBusinessProductRefundAmountCent(rec)
}

/** 有效成功售后记录 */
export function isSuccessfulAfterSale(rec: Record<string, unknown>): boolean {
  if (isCanceledOrInvalidAfterSale(rec)) return false
  const businessCent = businessRefundCentForSuccessCheck(rec)
  if (rec.refunded === true && businessCent > 0) return true
  const text = afterSaleStatusText(rec)
  if (SUCCESS_AFTER_SALE_KEYWORDS.some((k) => text.includes(k))) {
    if (businessCent > 0 || rec.refunded === true) return true
  }
  if (businessCent > 0 && /成功|已退款/.test(text)) return true
  const refundStatus = rec.refund_status ?? rec.refundStatus
  if (businessCent > 0 && (refundStatus === 2 || refundStatus === '2')) return true
  if (businessCent > 0 && resolveBusinessRefundAmountCent(rec) > 0) {
    return SUCCESS_AFTER_SALE_KEYWORDS.some((k) => text.includes(k))
  }
  return false
}

/** @deprecated 别名 */
export const isSuccessfulAfterSaleRecord = isSuccessfulAfterSale

export function normalizeAfterSaleRecords(
  records: Record<string, unknown>[],
): Record<string, unknown>[] {
  const byReturnId = new Map<string, { rec: Record<string, unknown>; timeMs: number }>()
  for (const rec of records) {
    const rid = pickString(rec, ['returns_id', 'returnsId', 'return_id']) || JSON.stringify(rec)
    const timeMs = pickAfterSaleRecordTimeMs(rec)
    const cur = byReturnId.get(rid)
    if (!cur || timeMs >= cur.timeMs) {
      byReturnId.set(rid, { rec, timeMs })
    }
  }
  return [...byReturnId.values()].map((x) => x.rec)
}

function pickAfterSaleRecordTimeMs(rec: Record<string, unknown>): number {
  for (const k of [
    'refund_ok_time',
    'refundOkTime',
    'refund_time',
    'refundTime',
    'update_at',
    'updateAt',
    'time',
    'create_time',
    'createTime',
  ]) {
    const v = rec[k]
    if (v == null) continue
    if (typeof v === 'number' && Number.isFinite(v)) return v
    const t = Date.parse(String(v))
    if (Number.isFinite(t)) return t
  }
  return 0
}

export interface StrictOrderAfterSaleAgg {
  strictQualityRefund: boolean
  hasHistoricalQualityReason: boolean
  successfulRefundAmountCent: number
  finalAfterSaleReason: string
  finalAfterSaleStatus: string
  successfulRecordCount: number
}

/** 统计周期内有效成功售后退款金额（按 refund_ok_time / refund_time 落入周期） */
export function aggregateSuccessfulRefundCentInRange(
  records: Record<string, unknown>[],
  range: { startTimeMs: number; endTimeMs: number },
): number {
  const normalized = normalizeAfterSaleRecords(records)
  let sum = 0
  for (const rec of normalized) {
    if (!isSuccessfulAfterSale(rec)) continue
    const ms = pickAfterSaleRecordTimeMs(rec)
    if (!ms || ms < range.startTimeMs || ms > range.endTimeMs) continue
    const split = splitReturnsV3RefundCent(rec)
    if (split.isFreightOnly) continue
    sum += split.productRefundCent
  }
  return sum
}

export function aggregateStrictAfterSaleForOrder(
  records: Record<string, unknown>[],
): StrictOrderAfterSaleAgg {
  const normalized = normalizeAfterSaleRecords(records)
  let hasHistoricalQualityReason = false
  let strictQualityRefund = false
  const successful: Array<{
    reason: string
    refundCent: number
    timeMs: number
    status: string
  }> = []

  for (const rec of normalized) {
    const reason = extractAfterSaleReasonText(rec)
    if (reason && matchPlatformReturnReason(reason).isQualityReturn) {
      hasHistoricalQualityReason = true
    }
    if (!isSuccessfulAfterSale(rec)) continue
    const split = splitReturnsV3RefundCent(rec)
    if (split.isFreightOnly) continue
    successful.push({
      reason,
      refundCent: split.productRefundCent,
      timeMs: pickAfterSaleRecordTimeMs(rec),
      status: afterSaleStatusText(rec),
    })
    if (matchPlatformReturnReason(reason).isQualityReturn) {
      strictQualityRefund = true
    }
  }

  successful.sort((a, b) => b.timeMs - a.timeMs)
  const final = successful[0]
  const finalReason = final?.reason ?? ''

  let successfulRefundAmountCent = 0
  for (const s of successful) {
    successfulRefundAmountCent += s.refundCent
  }

  return {
    strictQualityRefund,
    hasHistoricalQualityReason,
    successfulRefundAmountCent,
    finalAfterSaleReason: finalReason,
    finalAfterSaleStatus: final?.status ?? '',
    successfulRecordCount: successful.length,
  }
}

export function getSuccessfulRefundAmountByOrder(
  records: Record<string, unknown>[],
): number {
  return aggregateStrictAfterSaleForOrder(records).successfulRefundAmountCent
}

export function getFinalSuccessfulAfterSaleReason(
  records: Record<string, unknown>[],
): string {
  return aggregateStrictAfterSaleForOrder(records).finalAfterSaleReason
}

export function getActualSignAmount(params: {
  paymentBaseCent: number
  successfulRefundAmountCent: number
  statusSigned: boolean
  includedInGmv: boolean
}): number {
  return getActualSignAmountCent(params)
}

export function isStrictQualityRefundOrder(
  records: Record<string, unknown>[],
  includedInGmv = true,
): boolean {
  return includedInGmv && aggregateStrictAfterSaleForOrder(records).strictQualityRefund
}

export function getActualSignAmountCent(params: {
  paymentBaseCent: number
  successfulRefundAmountCent: number
  statusSigned: boolean
  includedInGmv: boolean
}): number {
  if (!params.includedInGmv || !params.statusSigned) return 0
  return Math.max(0, params.paymentBaseCent - params.successfulRefundAmountCent)
}

export function isEffectiveSignedOrder(params: {
  includedInGmv: boolean
  statusSigned: boolean
  actualSignAmountCent: number
}): boolean {
  return params.includedInGmv && params.statusSigned && params.actualSignAmountCent > 0
}

export function isEffectiveSignedView(v: AnalyzedOrderView): boolean {
  if (v.isEffectiveSigned != null) return v.isEffectiveSigned
  return isEffectiveSignedOrder({
    includedInGmv: v.includedInGmv,
    statusSigned: v.statusSigned === true || isStatusSignedView(v),
    actualSignAmountCent: v.actualSignAmountCent ?? v.actualSignedAmountCent ?? 0,
  })
}

export function isStrictQualityRefundView(v: AnalyzedOrderView): boolean {
  return v.strictQualityRefund === true
}

export interface StrictOrderViewFields {
  strictQualityRefund: boolean
  hasHistoricalQualityReason: boolean
  successfulRefundAmountCent: number
  actualSignAmountCent: number
  isEffectiveSigned: boolean
  finalAfterSaleReason: string
  finalAfterSaleStatus: string
}

export function computeStrictOrderViewFields(params: {
  order: NormalizedOrder
  includedInGmv: boolean
  paymentBaseCent: number
  boardRefundAmountCent: number
  afterSaleRecords: Record<string, unknown>[]
  isFreightRefundOnly?: boolean
  freightRefundAmountCent?: number
}): StrictOrderViewFields {
  const strictAgg = aggregateStrictAfterSaleForOrder(params.afterSaleRecords)
  const statusSigned = isStatusSignedOrder(params.order)
  const orderRaw = params.order.raw as Record<string, unknown> | undefined
  const refundCent = resolveSuccessfulProductRefundCentForSign({
    afterSaleRecords: params.afterSaleRecords,
    boardRefundAmountCent: params.boardRefundAmountCent,
    paymentBaseCent: params.paymentBaseCent,
    orderRaw,
    isFreightRefundOnly: params.isFreightRefundOnly,
    freightRefundAmountCent: params.freightRefundAmountCent,
  })
  const actualSignAmountCent = getActualSignAmountCent({
    paymentBaseCent: params.paymentBaseCent,
    successfulRefundAmountCent: refundCent,
    statusSigned,
    includedInGmv: params.includedInGmv,
  })
  const isEffectiveSigned = isEffectiveSignedOrder({
    includedInGmv: params.includedInGmv,
    statusSigned,
    actualSignAmountCent,
  })

  return {
    strictQualityRefund: params.includedInGmv && strictAgg.strictQualityRefund,
    hasHistoricalQualityReason: strictAgg.hasHistoricalQualityReason,
    successfulRefundAmountCent: refundCent,
    actualSignAmountCent,
    isEffectiveSigned,
    finalAfterSaleReason: strictAgg.finalAfterSaleReason,
    finalAfterSaleStatus: strictAgg.finalAfterSaleStatus,
  }
}

export const STRICT_QUALITY_REASON_KEYWORDS = [
  '做工粗糙/有瑕疵',
  '材质/颜色/款式与描述不符',
  '商品质量问题',
  '商品破损',
  '描述不符',
  '发错货',
  '少件',
  '漏发',
  '假货',
] as const
