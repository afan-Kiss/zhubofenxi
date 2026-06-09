/**
 * 买家详情 Drawer 订单标准字段与 Tab 筛选（排行外层、Drawer 顶部、列表、Tab 共用）
 */
import type { AnalyzedOrderView } from '../types/analysis'
import { formatBuyerIdentityCode, resolveBuyerIdentityFromView } from './buyer-identity.service'
import { resolveDisplayOrderNoForView } from './order-display-no.service'
import { isStatusSignedView } from './order-sign-status.service'
import { resolveQualityRefundInfo } from './quality-refund-resolution.service'
import { buyerOrderRowCountsTowardSpend } from './buyer-spend-eligibility.service'
import { resolveBuyerOrderBusinessMetrics } from './resolve-buyer-order-business-metrics.service'
import { resolveDisplayEarnedAmountCent } from './buyer-earned-amount.service'

export type BuyerAfterSaleType =
  | 'none'
  | 'refund_only'
  | 'return_refund'
  | 'shipping_compensation'
  | 'other_after_sale'

export type BuyerOrderTabKey =
  | 'all'
  | 'normal_signed'
  | 'after_sale'
  | 'refund_only'
  | 'return_refund'
  | 'shipping_compensation'
  | 'quality_refund'

export type AfterSaleDisplayTone = 'none' | 'pending' | 'success' | 'closed' | 'quality'

export interface AfterSaleDisplay {
  hasEffectiveAfterSale: boolean
  label: string
  tone: AfterSaleDisplayTone
}

export interface BuyerOrderStandardRow {
  orderNo: string
  buyerKey: string
  buyerNickname: string
  buyerDisplayId: string
  productName: string
  anchorName: string
  orderTime: string
  payTime: string | null
  signTime: string | null
  afterSaleApplyTime: string | null
  afterSaleCompleteTime: string | null
  goodsAmountCent: number
  freightAmountCent: number
  receivableAmountCent: number
  payAmountCent: number
  refundAmountCent: number
  freightRefundAmountCent: number
  netDealAmountCent: number
  realDealAmountCent: number
  isRealDealOrder: boolean
  /** 买家展示：单订单赚到金额 */
  earnedAmountCent: number
  orderStatusText: string
  /** 订单状态标签（不含售后） */
  orderStatusLabel: string
  afterSaleStatusText: string
  /** 售后状态标签 */
  afterSaleStatusLabel: string
  afterSaleDisplayTone: AfterSaleDisplayTone
  hasEffectiveAfterSale: boolean
  afterSaleReason: string
  refundSourceText: string
  afterSaleNo: string | null
  isPaid: boolean
  isSigned: boolean
  hasRefund: boolean
  hasAfterSale: boolean
  afterSaleType: BuyerAfterSaleType
  afterSaleTypeLabel: string
  isQualityRefund: boolean
  strictQualityRefund: boolean
  qualityRefundReasonMatched: string | null
  /** @deprecated 仅订单状态，不含售后组合文案 */
  cardStatusLabel: string
  refundAmountPending?: boolean
}

export interface BuyerOrderSummary {
  receivableAmountCent: number
  payAmountCent: number
  refundAmountCent: number
  freightRefundAmountCent: number
  netDealAmountCent: number
  realDealAmountCent: number
  /** 买家展示：赚到金额（= netDeal ?? realDeal） */
  displayEarnedAmountCent: number
  orderCount: number
  paidOrderCount: number
  realDealOrderCount: number
  refundOrderCount: number
  qualityRefundOrderCount: number
  /** 售后中/待同步且 refundAmountCent=0 的订单数（不计入退款统计） */
  pendingAfterSaleOrderCount: number
}

const TAB_DEFS: Array<{
  key: BuyerOrderTabKey
  label: string
  emptyText: string
  match: (r: BuyerOrderStandardRow) => boolean
}> = [
  { key: 'all', label: '全部订单', emptyText: '该买家暂无历史订单', match: () => true },
  {
    key: 'normal_signed',
    label: '正常签收',
    emptyText: '该买家暂无正常签收订单',
    match: (r) =>
      r.isSigned &&
      !r.hasRefund &&
      !r.hasAfterSale &&
      r.refundAmountCent === 0 &&
      r.afterSaleType === 'none',
  },
  {
    key: 'after_sale',
    label: '售后 / 退款',
    emptyText: '该买家暂无售后 / 退款订单',
    match: (r) =>
      r.refundAmountCent > 0 || r.refundAmountPending === true || r.hasEffectiveAfterSale,
  },
  {
    key: 'refund_only',
    label: '仅退款',
    emptyText: '该买家暂无仅退款订单',
    match: (r) => r.afterSaleType === 'refund_only',
  },
  {
    key: 'return_refund',
    label: '退货退款',
    emptyText: '该买家暂无退货退款订单',
    match: (r) => r.afterSaleType === 'return_refund',
  },
  {
    key: 'shipping_compensation',
    label: '运费补偿',
    emptyText: '该买家暂无运费补偿订单',
    match: (r) => r.afterSaleType === 'shipping_compensation',
  },
  {
    key: 'quality_refund',
    label: '品退',
    emptyText: '该买家暂无品退订单',
    match: (r) => r.isQualityRefund,
  },
]

export function normalizeBuyerOrderTabKey(tab?: string): BuyerOrderTabKey {
  const t = (tab ?? '').trim()
  const legacy: Record<string, BuyerOrderTabKey> = {
    '': 'all',
    all: 'all',
    signed: 'normal_signed',
    normal_signed: 'normal_signed',
    after_sale: 'after_sale',
    returned: 'return_refund',
    return_refund: 'return_refund',
    refund_only: 'refund_only',
    freight_refund: 'shipping_compensation',
    shipping_compensation: 'shipping_compensation',
    quality_return: 'quality_refund',
    quality_refund: 'quality_refund',
  }
  return legacy[t] ?? 'all'
}

function pickProductName(raw: Record<string, unknown> | undefined): string {
  if (!raw) return '—'
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    const name = first.skuName ?? first.displayName ?? first.name
    if (name != null && String(name).trim()) return String(name).trim()
  }
  const flat = raw.productName ?? raw.product_name ?? raw.title
  return flat != null && String(flat).trim() ? String(flat).trim() : '—'
}

function pickPayTime(raw: Record<string, unknown> | undefined): string | null {
  if (!raw) return null
  const t = raw.payTime ?? raw.pay_time ?? raw.paidTime ?? raw.paid_time
  return formatTimeValue(t)
}

function pickSignTime(raw: Record<string, unknown> | undefined): string | null {
  if (!raw) return null
  const t =
    raw.signedAt ?? raw.signTime ?? raw.receiveTime ?? raw.finishTime ?? raw.completedAt
  return formatTimeValue(t)
}

function formatTimeValue(value: unknown): string | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().replace('T', ' ').slice(0, 19)
    }
    return null
  }
  const s = String(value).trim()
  return s || null
}

function pickAfterSaleApplyTime(raw: Record<string, unknown> | undefined): string | null {
  if (!raw) return null
  const t =
    raw.afterSaleApplyTime ??
    raw.after_sale_apply_time ??
    raw.applyTime ??
    raw.apply_time ??
    raw.returnsCreateTime
  return formatTimeValue(t)
}

function pickAfterSaleCompleteTime(raw: Record<string, unknown> | undefined): string | null {
  if (!raw) return null
  const t =
    raw.afterSaleCompleteTime ??
    raw.after_sale_complete_time ??
    raw.refundTime ??
    raw.refund_time ??
    raw.refundOkTime ??
    raw.refund_ok_time
  return formatTimeValue(t)
}

const CLOSED_AFTER_SALE_KEYWORDS = [
  '取消',
  '关闭',
  '撤销',
  '拒绝',
  '驳回',
  '售后关闭',
  '买家取消',
]

function isEmptyField(v: string | undefined | null): boolean {
  if (!v) return true
  const s = v.trim()
  return !s || s === '—'
}

function isAfterSaleClosedStatus(...texts: Array<string | undefined | null>): boolean {
  const combined = texts.filter(Boolean).join(' ')
  if (!combined) return false
  return CLOSED_AFTER_SALE_KEYWORDS.some((k) => combined.includes(k))
}

function refundSourceLabel(source: string | undefined, pending: boolean): string {
  if (pending) return '待同步'
  if (source === 'after_sales_workbench') return '售后工作台'
  if (source === 'after_sales_workbench_no_record') return '售后工作台(无记录)'
  if (source === 'after_sales_workbench_zero_refund') return '售后工作台(零退款)'
  if (source === 'settlement') return '结算明细'
  if (source === 'no_after_sale') return '无售后'
  return source?.trim() || '—'
}

function afterSaleTypeLabel(type: BuyerAfterSaleType): string {
  switch (type) {
    case 'refund_only':
      return '仅退款'
    case 'return_refund':
      return '退货退款'
    case 'shipping_compensation':
      return '运费补偿'
    case 'other_after_sale':
      return '其他售后'
    default:
      return '—'
  }
}

/** 买家 Drawer 售后状态展示（严格有效售后，不含宽松字段匹配） */
export function deriveAfterSaleDisplay(input: {
  refundAmountCent: number
  refundSource: string
  afterSaleType: BuyerAfterSaleType
  afterSaleTypeLabel: string
  afterSaleStatusText: string
  afterSaleReason: string
  isQualityRefund: boolean
  afterSaleClosedNoRefund: boolean
  refundAmountPending: boolean
  finalAfterSaleStatus?: string
  returnsIds?: string[]
}): AfterSaleDisplay {
  const refundCent = input.refundAmountCent
  const reasonEmpty = isEmptyField(input.afterSaleReason)
  const typeLabelEmpty = isEmptyField(input.afterSaleTypeLabel)
  const statusTextEmpty = isEmptyField(input.afterSaleStatusText)
  const noAfterSaleSource =
    !input.refundSource ||
    input.refundSource === 'no_after_sale' ||
    input.refundSource === 'after_sales_workbench_no_record'
  const noValidAfterSaleNo = !input.returnsIds?.length

  if (
    input.afterSaleClosedNoRefund ||
    isAfterSaleClosedStatus(input.afterSaleStatusText, input.finalAfterSaleStatus)
  ) {
    return { hasEffectiveAfterSale: false, label: '售后已关闭', tone: 'closed' }
  }

  if (input.isQualityRefund && refundCent > 0) {
    return { hasEffectiveAfterSale: true, label: '商品问题售后', tone: 'quality' }
  }

  if (refundCent > 0) {
    return { hasEffectiveAfterSale: true, label: '已退款', tone: 'success' }
  }

  if (input.refundAmountPending) {
    return { hasEffectiveAfterSale: true, label: '售后中', tone: 'pending' }
  }

  if (
    input.afterSaleType !== 'none' &&
    !isAfterSaleClosedStatus(input.afterSaleStatusText, input.finalAfterSaleStatus)
  ) {
    return { hasEffectiveAfterSale: true, label: '售后中', tone: 'pending' }
  }

  if (
    refundCent === 0 &&
    input.afterSaleType === 'none' &&
    typeLabelEmpty &&
    statusTextEmpty &&
    reasonEmpty &&
    noAfterSaleSource &&
    noValidAfterSaleNo
  ) {
    return { hasEffectiveAfterSale: false, label: '无售后', tone: 'none' }
  }

  return { hasEffectiveAfterSale: false, label: '无售后', tone: 'none' }
}

function buildOrderStatusLabel(orderStatusText: string): string {
  const text = orderStatusText.trim()
  return text || '—'
}

/** 买家画像品退：与经营总览 / 排行共用 resolveQualityRefundInfo */
export function resolveBuyerOrderQualityRefund(v: AnalyzedOrderView): {
  isQualityRefund: boolean
  qualityRefundReasonMatched: string | null
} {
  const info = resolveQualityRefundInfo({ view: v })
  return {
    isQualityRefund: info.isQualityRefund,
    qualityRefundReasonMatched: info.isQualityRefund
      ? info.matchedKeyword || info.reasonText || null
      : null,
  }
}

export function resolveBuyerAfterSaleType(v: AnalyzedOrderView): BuyerAfterSaleType {
  const refundCent = v.buyerProductRefundAmountCent ?? 0
  if (v.isFreightRefundOnly && (v.freightRefundAmountCent ?? 0) > 0) return 'shipping_compensation'
  if (v.afterSaleClosedNoRefund && refundCent === 0) return 'none'
  if (v.isFreightRefundOnly && refundCent > 0) return 'shipping_compensation'
  if (v.isReturnRefund && refundCent > 0) return 'return_refund'
  if (v.isRefundOnly && !v.isFreightRefundOnly && refundCent > 0) return 'refund_only'
  if (refundCent > 0 || v.isRealProductRefund) return 'other_after_sale'
  return 'none'
}

export function mapViewToBuyerOrderStandard(
  v: AnalyzedOrderView & { raw?: Record<string, unknown> },
): BuyerOrderStandardRow {
  const raw = v.raw
  const identity = resolveBuyerIdentityFromView(v)
  const buyerKey = identity?.buyerKey ?? v.buyerKey ?? v.buyerId ?? '—'
  const buyerDisplayId = identity
    ? formatBuyerIdentityCode(identity.buyerKey, identity.buyerId)
    : formatBuyerIdentityCode(buyerKey)
  const orderNo = resolveDisplayOrderNoForView(v)
  const goodsAmountCent = v.productAmountCent || v.gmvCent || 0
  const freightAmountCent = v.freightCent || 0
  const receivableAmountCent =
    v.buyerReceivableAmountCent ??
    (goodsAmountCent + freightAmountCent || v.receivableAmountCent || 0)
  const metrics = resolveBuyerOrderBusinessMetrics(v)
  const refundSource = v.buyerProductRefundSource?.trim() || ''
  const refundPending = refundSource === 'after_sales_workbench_pending'
  const payAmountCent = metrics.paidAmountCent
  const refundAmountCent = refundPending ? 0 : metrics.productRefundAmountCent
  const freightRefundAmountCent = metrics.freightRefundAmountCent
  const quality = resolveBuyerOrderQualityRefund(v)
  const afterSaleType = resolveBuyerAfterSaleType(v)
  const typeLabel = afterSaleTypeLabel(afterSaleType)
  const afterSaleStatusText =
    v.afterSaleDisplayType && v.afterSaleDisplayType !== '—'
      ? v.afterSaleDisplayType
      : v.afterSaleStatusLabel || v.afterSaleStatusText || '—'
  const afterSaleReason = (
    v.finalAfterSaleReason ||
    v.afterSalesWorkbenchReason ||
    v.reasonText ||
    ''
  ).trim() || '—'
  const display = deriveAfterSaleDisplay({
    refundAmountCent,
    refundSource,
    afterSaleType,
    afterSaleTypeLabel: typeLabel,
    afterSaleStatusText,
    afterSaleReason,
    isQualityRefund: quality.isQualityRefund,
    afterSaleClosedNoRefund: v.afterSaleClosedNoRefund,
    refundAmountPending: refundPending,
    finalAfterSaleStatus: v.finalAfterSaleStatus,
    returnsIds: [],
  })
  const hasAfterSale = display.hasEffectiveAfterSale
  const hasRefund = refundAmountCent > 0
  const isSigned = v.statusSigned === true || isStatusSignedView(v)
  const isPaid = metrics.isPaidOrder
  const orderStatusLabel = buildOrderStatusLabel(v.orderStatusText || '—')
  const netDealAmountCent = metrics.netDealAmountCent
  const realDealAmountCent = metrics.realDealAmountCent
  const isRealDealOrder = metrics.isRealDealOrder

  const row: BuyerOrderStandardRow = {
    orderNo,
    buyerKey,
    buyerNickname: v.buyerNickname || v.buyerDisplayName || '—',
    buyerDisplayId,
    productName: pickProductName(raw),
    anchorName: v.anchorName?.trim() || '未归属',
    orderTime: v.orderTimeText || '—',
    payTime: pickPayTime(raw),
    signTime: pickSignTime(raw),
    afterSaleApplyTime: pickAfterSaleApplyTime(raw),
    afterSaleCompleteTime: pickAfterSaleCompleteTime(raw),
    goodsAmountCent,
    freightAmountCent,
    receivableAmountCent,
    payAmountCent,
    refundAmountCent,
    freightRefundAmountCent,
    netDealAmountCent,
    realDealAmountCent,
    earnedAmountCent: realDealAmountCent,
    isRealDealOrder,
    orderStatusText: v.orderStatusText || '—',
    orderStatusLabel,
    afterSaleStatusText,
    afterSaleStatusLabel: display.label,
    afterSaleDisplayTone: display.tone,
    hasEffectiveAfterSale: display.hasEffectiveAfterSale,
    afterSaleReason,
    refundSourceText: refundSourceLabel(refundSource, refundPending),
    afterSaleNo: null,
    isPaid,
    isSigned,
    hasRefund,
    hasAfterSale,
    afterSaleType,
    afterSaleTypeLabel: typeLabel,
    isQualityRefund: quality.isQualityRefund,
    strictQualityRefund: v.strictQualityRefund === true,
    qualityRefundReasonMatched: quality.qualityRefundReasonMatched,
    cardStatusLabel: orderStatusLabel,
    refundAmountPending: refundPending,
  }
  return row
}

function pickTimesFromWorkbenchRecords(
  orderNo: string,
  rawDetail: unknown,
): { applyTime: string | null; completeTime: string | null } {
  const records = Array.isArray(rawDetail) ? rawDetail : []
  let applyTime: string | null = null
  let completeTime: string | null = null
  for (const item of records) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const pkgId = String(
      rec.delivery_package_id ?? rec.package_id ?? rec.packageId ?? rec.order_id ?? '',
    ).trim()
    if (pkgId && pkgId !== orderNo) continue
    const apply = formatTimeValue(
      rec.create_time ?? rec.createTime ?? rec.apply_time ?? rec.applyTime,
    )
    const complete = formatTimeValue(
      rec.refund_time ?? rec.refundTime ?? rec.refund_ok_time ?? rec.update_time,
    )
    if (apply && !applyTime) applyTime = apply
    if (complete) completeTime = complete
  }
  return { applyTime, completeTime }
}

/** 用工单缓存补全售后单号与时间，并重新推导售后标签 */
export function enrichBuyerOrderRowFromWorkbench(
  row: BuyerOrderStandardRow,
  workbench?: {
    returnsIds?: string[]
    rawDetail?: unknown
  } | null,
  v?: AnalyzedOrderView,
): BuyerOrderStandardRow {
  const returnsIds = workbench?.returnsIds ?? []
  const wbTimes = workbench?.rawDetail
    ? pickTimesFromWorkbenchRecords(row.orderNo, workbench.rawDetail)
    : { applyTime: null, completeTime: null }
  const refundSource =
    v?.buyerProductRefundSource?.trim() ||
    (row.refundSourceText === '无售后' ? 'no_after_sale' : '')
  const display = deriveAfterSaleDisplay({
    refundAmountCent: row.refundAmountCent,
    refundSource,
    afterSaleType: row.afterSaleType,
    afterSaleTypeLabel: row.afterSaleTypeLabel,
    afterSaleStatusText: row.afterSaleStatusText,
    afterSaleReason: row.afterSaleReason,
    isQualityRefund: row.isQualityRefund,
    afterSaleClosedNoRefund: v?.afterSaleClosedNoRefund ?? false,
    refundAmountPending: row.refundAmountPending === true,
    finalAfterSaleStatus: v?.finalAfterSaleStatus,
    returnsIds,
  })
  return {
    ...row,
    afterSaleApplyTime: row.afterSaleApplyTime ?? wbTimes.applyTime,
    afterSaleCompleteTime: row.afterSaleCompleteTime ?? wbTimes.completeTime,
    afterSaleNo: returnsIds.length > 0 ? returnsIds.join('、') : null,
    afterSaleStatusLabel: display.label,
    afterSaleDisplayTone: display.tone,
    hasEffectiveAfterSale: display.hasEffectiveAfterSale,
    hasAfterSale: display.hasEffectiveAfterSale,
    hasRefund: row.refundAmountCent > 0,
  }
}

export function buildBuyerOrderSummary(rows: BuyerOrderStandardRow[]): BuyerOrderSummary {
  const orderNos = new Set<string>()
  const paidNos = new Set<string>()
  const realDealNos = new Set<string>()
  const refundNos = new Set<string>()
  const qualityNos = new Set<string>()
  const pendingNos = new Set<string>()
  let receivableAmountCent = 0
  let payAmountCent = 0
  let refundAmountCent = 0
  let freightRefundAmountCent = 0
  let netDealAmountCent = 0
  let realDealAmountCent = 0

  for (const r of rows) {
    orderNos.add(r.orderNo)
    receivableAmountCent += r.receivableAmountCent
    payAmountCent += r.payAmountCent
    refundAmountCent += r.refundAmountCent
    freightRefundAmountCent += r.freightRefundAmountCent
    netDealAmountCent += r.netDealAmountCent
    realDealAmountCent += r.realDealAmountCent
    if (r.isPaid && r.payAmountCent > 0) paidNos.add(r.orderNo)
    if (r.isRealDealOrder) realDealNos.add(r.orderNo)
    if (r.refundAmountCent > 0 && r.afterSaleType !== 'shipping_compensation') {
      refundNos.add(r.orderNo)
    }
    if (r.isQualityRefund) qualityNos.add(r.orderNo)
    if (r.refundAmountPending === true && r.refundAmountCent === 0) pendingNos.add(r.orderNo)
  }

  return {
    receivableAmountCent,
    payAmountCent,
    refundAmountCent,
    freightRefundAmountCent,
    netDealAmountCent,
    realDealAmountCent,
    displayEarnedAmountCent: resolveDisplayEarnedAmountCent({
      netDealAmountCent,
      realDealAmountCent,
    }),
    orderCount: orderNos.size,
    paidOrderCount: paidNos.size,
    realDealOrderCount: realDealNos.size,
    refundOrderCount: refundNos.size,
    qualityRefundOrderCount: qualityNos.size,
    pendingAfterSaleOrderCount: pendingNos.size,
  }
}

export function filterBuyerOrdersByTab(
  rows: BuyerOrderStandardRow[],
  tabKey: BuyerOrderTabKey,
): BuyerOrderStandardRow[] {
  const def = TAB_DEFS.find((d) => d.key === tabKey) ?? TAB_DEFS[0]!
  return rows.filter(def.match)
}

export function buildBuyerOrderTabs(rows: BuyerOrderStandardRow[]): Array<{
  key: BuyerOrderTabKey
  label: string
  count: number
  emptyText: string
}> {
  return TAB_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    count: rows.filter(def.match).length,
    emptyText: def.emptyText,
  }))
}

export function buyerOrderTabEmptyText(tabKey: BuyerOrderTabKey): string {
  return TAB_DEFS.find((d) => d.key === tabKey)?.emptyText ?? '暂无订单'
}

export function buildBuyerOrderFilterSummary(
  rows: BuyerOrderStandardRow[],
  tabKey: BuyerOrderTabKey,
): BuyerOrderSummary {
  return buildBuyerOrderSummary(rows)
}
