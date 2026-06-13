import { prisma } from '../lib/prisma'
import { getDecryptedCookie } from './credential.service'
import { getDecryptedCookieByAccountId } from './live-account.service'
import { requestXhsJson } from './xhs-http.service'
import { enqueueXhsRequest } from './xhs-api-sync/xhs-rate-limiter.service'
import { parseMoneyToCent } from '../utils/money'
import {
  buildLiveAccountOrderQueries,
  liveAccountOrderKey,
  resolveLiveAccountId,
  type LiveAccountOrderQuery,
} from '../utils/live-account-cache-key.util'
import {
  buildAfterSaleByOrderNo,
  normalizeAfterSaleRecord,
  type AfterSaleOrderAggregate,
  type NormalizedAfterSaleRecord,
} from './xhs-after-sales-range.service'
import {
  extractAfterSaleReasonText,
  isCanceledOrInvalidAfterSale,
  normalizeAfterSaleRecords,
  isSuccessfulAfterSale,
} from './strict-after-sale-metrics.service'
import {
  pickReturnsV3BuyerUserId,
  splitReturnsV3RefundCent,
} from './returns-v3-record.service'
import { yuanApiAmountToCent } from './business-refund-caliber.service'

const WORKBENCH_URL =
  'https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3'
const WORKBENCH_REFERER = 'https://ark.xiaohongshu.com/app-order/aftersale/list'

export type WorkbenchFetchStatus = 'pending' | 'success' | 'empty' | 'failed'

export interface AfterSalesWorkbenchRefund {
  liveAccountId?: string
  orderNo: string
  packageId: string | null
  /** 商品退款（不含纯运费退） */
  officialRefundAmountCent: number
  /** 纯运费退款 */
  freightRefundAmountCent: number
  expectedRefundAmountCent: number
  appliedAmountCent: number
  appliedShipFeeAmountCent: number
  payAmountCent: number
  settlementAmountCent: number
  refundIncludesFreight: boolean
  hasFreightOnlyRefund: boolean
  buyerUserId: string | null
  afterSaleReason: string | null
  afterSaleStatus: string | null
  successReturnCount: number
  returnsIds: string[]
  fetchStatus: WorkbenchFetchStatus
  fetchError: string | null
  fetchedAt: Date | null
  rawDetail?: unknown
}

/** 售后工作台金额单位为「元」，转为分 */
export { yuanApiAmountToCent } from './business-refund-caliber.service'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function pickString(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export function recordMatchesOrderNo(rec: Record<string, unknown>, orderNo: string): boolean {
  const target = orderNo.trim()
  if (!target) return false
  for (const k of [
    'delivery_package_id',
    'package_id',
    'order_id',
    'deliveryPackageId',
    'packageId',
    'orderId',
  ]) {
    const v = rec[k]
    if (v != null && String(v).trim() === target) return true
  }
  return false
}

export function isSuccessfulAfterSaleRecord(rec: Record<string, unknown>): boolean {
  return isSuccessfulAfterSale(rec)
}

function isExcludedAfterSaleRecord(rec: Record<string, unknown>): boolean {
  return isCanceledOrInvalidAfterSale(rec) && !isSuccessfulAfterSale(rec)
}

export function aggregateWorkbenchRefund(
  afterSales: Record<string, unknown>[],
  orderNo: string,
): Omit<
  AfterSalesWorkbenchRefund,
  'fetchStatus' | 'fetchError' | 'fetchedAt'
> {
  const matched = afterSales.filter((r) => recordMatchesOrderNo(r, orderNo))
  const normalized = normalizeAfterSaleRecords(matched)

  const successRecords: Record<string, unknown>[] = []
  for (const rec of normalized) {
    if (isExcludedAfterSaleRecord(rec)) continue
    if (isSuccessfulAfterSaleRecord(rec)) successRecords.push(rec)
  }

  let officialRefundAmountCent = 0
  let freightRefundAmountCent = 0
  let expectedRefundAmountCent = 0
  let appliedAmountCent = 0
  let appliedShipFeeAmountCent = 0
  let payAmountCent = 0
  let settlementAmountCent = 0
  const returnsIds: string[] = []
  const reasons: string[] = []
  const statuses: string[] = []
  let buyerUserId: string | null = null
  let hasFreightOnlyRefund = false

  for (const rec of successRecords) {
    const split = splitReturnsV3RefundCent(rec)
    if (split.isFreightOnly) hasFreightOnlyRefund = true
    officialRefundAmountCent += split.productRefundCent
    freightRefundAmountCent += split.freightRefundCent
    expectedRefundAmountCent += yuanApiAmountToCent(
      rec.expected_refund_amount ?? rec.expectedRefundAmount,
    )
    appliedAmountCent += yuanApiAmountToCent(rec.applied_amount ?? rec.appliedAmount)
    appliedShipFeeAmountCent += yuanApiAmountToCent(
      rec.applied_ship_fee_amount ?? rec.appliedShipFeeAmount,
    )
    const pay = yuanApiAmountToCent(rec.pay_amount ?? rec.payAmount)
    const settle = yuanApiAmountToCent(rec.settlement_amount ?? rec.settlementAmount)
    if (pay > payAmountCent) payAmountCent = pay
    if (settle > settlementAmountCent) settlementAmountCent = settle
    const rid = pickString(rec, ['returns_id', 'returnsId'])
    if (rid) returnsIds.push(rid)
    const uid = pickReturnsV3BuyerUserId(rec)
    if (uid) buyerUserId = uid
    const reason = extractAfterSaleReasonText(rec)
    if (reason) reasons.push(reason)
    const st = pickString(rec, ['refund_status_name', 'status_name'])
    if (st) statuses.push(st)
  }

  let refundIncludesFreight = appliedShipFeeAmountCent > 0 && officialRefundAmountCent > 0
  if (
    !refundIncludesFreight &&
    payAmountCent > 0 &&
    officialRefundAmountCent > 0 &&
    officialRefundAmountCent >= payAmountCent
  ) {
    refundIncludesFreight = true
  }

  hasFreightOnlyRefund = officialRefundAmountCent === 0 && freightRefundAmountCent > 0

  return {
    orderNo,
    packageId: orderNo,
    officialRefundAmountCent,
    freightRefundAmountCent,
    expectedRefundAmountCent,
    appliedAmountCent,
    appliedShipFeeAmountCent,
    payAmountCent,
    settlementAmountCent,
    refundIncludesFreight,
    hasFreightOnlyRefund,
    buyerUserId,
    afterSaleReason: reasons[0] ?? null,
    afterSaleStatus: statuses.join('；') || null,
    successReturnCount: successRecords.length,
    returnsIds,
  }
}

function buildWorkbenchQueryKeywords(keywords: string): string {
  const u = new URL(WORKBENCH_URL)
  u.searchParams.set('page', '1')
  u.searchParams.set('number', '20')
  u.searchParams.set('keywords', keywords.trim())
  u.searchParams.append('goods_source[]', '1')
  u.searchParams.append('goods_source[]', '2')
  u.searchParams.set('return_type_in', '3,4,1,2,5')
  u.searchParams.set('sort', 'deadline_for_sort_v1')
  u.searchParams.set('order', 'asc')
  u.searchParams.set('status_in', '1,2,3,12,13,4,5,6,9,9001,14')
  return u.toString()
}

function buildWorkbenchQuery(orderNo: string): string {
  return buildWorkbenchQueryKeywords(orderNo)
}

async function fetchAfterSalesListByKeywords(
  keywords: string,
  cookie: string,
): Promise<Record<string, unknown>[]> {
  const url = buildWorkbenchQueryKeywords(keywords)
  const payload = await enqueueXhsRequest(() =>
    requestXhsJson<unknown>({
      method: 'GET',
      url,
      cookie,
      referer: WORKBENCH_REFERER,
      needSign: true,
      parseEnvelope: true,
    }),
  )
  return extractAfterSalesList(payload)
}

export function extractAfterSalesList(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  if (!root) return []
  const data = asRecord(root.data) ?? root
  const list = data.after_sales ?? data.afterSales
  if (!Array.isArray(list)) return []
  return list.map((item) => asRecord(item)).filter((x): x is Record<string, unknown> => x != null)
}

export async function fetchAfterSalesWorkbenchByOrderNo(
  orderNo: string,
  liveAccountId?: string,
  opts?: { fallbackBuyerUserId?: string },
): Promise<AfterSalesWorkbenchRefund> {
  const emptyFailed = (
    partial: Partial<AfterSalesWorkbenchRefund> & { fetchStatus: WorkbenchFetchStatus; fetchError: string | null },
  ): AfterSalesWorkbenchRefund => ({
    orderNo: partial.orderNo ?? orderNo.trim(),
    packageId: partial.packageId ?? null,
    officialRefundAmountCent: 0,
    freightRefundAmountCent: 0,
    expectedRefundAmountCent: 0,
    appliedAmountCent: 0,
    appliedShipFeeAmountCent: 0,
    payAmountCent: 0,
    settlementAmountCent: 0,
    refundIncludesFreight: false,
    hasFreightOnlyRefund: false,
    buyerUserId: null,
    afterSaleReason: null,
    afterSaleStatus: null,
    successReturnCount: 0,
    returnsIds: [],
    fetchedAt: null,
    ...partial,
  })
  const trimmed = orderNo.trim()
  const accountId = resolveLiveAccountId(liveAccountId)
  if (!trimmed || !/^P/i.test(trimmed)) {
    return emptyFailed({
      liveAccountId: accountId,
      orderNo: trimmed,
      packageId: null,
      fetchStatus: 'failed',
      fetchError: '无效订单号（需 P 开头官方订单号）',
    })
  }

  let cookie: string
  try {
    cookie =
      accountId !== 'legacy'
        ? await getDecryptedCookieByAccountId(accountId)
        : await getDecryptedCookie()
  } catch (e) {
    return emptyFailed({
      liveAccountId: accountId,
      orderNo: trimmed,
      packageId: trimmed,
      fetchStatus: 'failed',
      fetchError: e instanceof Error ? e.message : 'Cookie 未配置',
    })
  }

  try {
    let afterSales = await fetchAfterSalesListByKeywords(trimmed, cookie)
    if (
      afterSales.length === 0 &&
      opts?.fallbackBuyerUserId?.trim() &&
      opts.fallbackBuyerUserId.trim() !== trimmed
    ) {
      const byBuyer = await fetchAfterSalesListByKeywords(opts.fallbackBuyerUserId.trim(), cookie)
      afterSales = byBuyer.filter((r) => recordMatchesOrderNo(r, trimmed))
    }
    const agg = aggregateWorkbenchRefund(afterSales, trimmed)
    const status: WorkbenchFetchStatus =
      afterSales.length === 0 ? 'empty' : agg.successReturnCount > 0 ? 'success' : 'empty'
    return {
      ...agg,
      liveAccountId: accountId,
      fetchStatus: status,
      fetchError: null,
      fetchedAt: new Date(),
      rawDetail: afterSales,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '售后工作台查询失败'
    return emptyFailed({
      liveAccountId: accountId,
      orderNo: trimmed,
      packageId: trimmed,
      fetchStatus: 'failed',
      fetchError: msg.slice(0, 500),
    })
  }
}

function rowToRefund(row: {
  liveAccountId: string
  orderNo: string
  packageId: string | null
  officialRefundAmountCent: number
  expectedRefundAmountCent: number | null
  appliedAmountCent: number | null
  appliedShipFeeAmountCent: number
  payAmountCent: number | null
  settlementAmountCent: number | null
  refundIncludesFreight: boolean
  afterSaleReason: string | null
  afterSaleStatus: string | null
  successReturnCount: number
  returnsIds: string | null
  fetchStatus: string
  fetchError: string | null
  fetchedAt: Date | null
  rawDetail?: unknown
}): AfterSalesWorkbenchRefund {
  let freightRefundAmountCent = 0
  let hasFreightOnlyRefund = false
  let buyerUserId: string | null = null
  if (row.rawDetail && Array.isArray(row.rawDetail)) {
    const agg = aggregateWorkbenchRefund(row.rawDetail as Record<string, unknown>[], row.orderNo)
    freightRefundAmountCent = agg.freightRefundAmountCent
    hasFreightOnlyRefund = agg.hasFreightOnlyRefund
    buyerUserId = agg.buyerUserId
  }
  return {
    liveAccountId: resolveLiveAccountId(row.liveAccountId),
    orderNo: row.orderNo,
    packageId: row.packageId,
    officialRefundAmountCent: row.officialRefundAmountCent,
    freightRefundAmountCent,
    expectedRefundAmountCent: row.expectedRefundAmountCent ?? 0,
    appliedAmountCent: row.appliedAmountCent ?? 0,
    appliedShipFeeAmountCent: row.appliedShipFeeAmountCent,
    payAmountCent: row.payAmountCent ?? 0,
    settlementAmountCent: row.settlementAmountCent ?? 0,
    refundIncludesFreight: row.refundIncludesFreight,
    hasFreightOnlyRefund,
    buyerUserId,
    afterSaleReason: row.afterSaleReason,
    afterSaleStatus: row.afterSaleStatus,
    successReturnCount: row.successReturnCount,
    returnsIds: row.returnsIds ? row.returnsIds.split(',').filter(Boolean) : [],
    fetchStatus: row.fetchStatus as WorkbenchFetchStatus,
    fetchError: row.fetchError,
    fetchedAt: row.fetchedAt,
    rawDetail: row.rawDetail ?? undefined,
  }
}

let memoryCache = new Map<string, AfterSalesWorkbenchRefund>()
let memoryCacheAt = 0

export async function refreshWorkbenchMemoryCache(): Promise<number> {
  const rows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    where: { fetchStatus: { in: ['success', 'empty'] } },
  })
  const next = new Map<string, AfterSalesWorkbenchRefund>()
  for (const row of rows) {
    const refund = rowToRefund(row)
    // 内存缓存仅用于退款聚合字段，不保留 rawDetail，避免全量加载时 OOM
    refund.rawDetail = undefined
    next.set(liveAccountOrderKey(row.liveAccountId, row.orderNo), refund)
  }
  memoryCache = next
  memoryCacheAt = Date.now()
  return next.size
}

export function getWorkbenchRefundFromMemory(
  liveAccountId: string | undefined | null,
  orderNo: string,
): AfterSalesWorkbenchRefund | undefined {
  return memoryCache.get(liveAccountOrderKey(liveAccountId, orderNo))
}

export function mergeWorkbenchIntoMemory(
  liveAccountId: string | undefined | null,
  orderNo: string,
  refund: AfterSalesWorkbenchRefund,
): void {
  memoryCache.set(liveAccountOrderKey(liveAccountId, orderNo), refund)
}

export function getWorkbenchRefundMapForOrders(
  queries: LiveAccountOrderQuery[],
): Map<string, AfterSalesWorkbenchRefund> {
  const m = new Map<string, AfterSalesWorkbenchRefund>()
  for (const q of queries) {
    const key = liveAccountOrderKey(q.liveAccountId, q.orderNo)
    const hit = memoryCache.get(key)
    if (hit) m.set(key, hit)
  }
  return m
}

export async function saveWorkbenchCache(
  result: AfterSalesWorkbenchRefund & { rawDetail?: unknown },
  liveAccountId?: string,
): Promise<void> {
  const accountId = resolveLiveAccountId(liveAccountId ?? result.liveAccountId)
  await prisma.xhsAfterSalesWorkbenchCache.upsert({
    where: {
      liveAccountId_orderNo: {
        liveAccountId: accountId,
        orderNo: result.orderNo,
      },
    },
    create: {
      liveAccountId: accountId,
      orderNo: result.orderNo,
      packageId: result.packageId,
      officialRefundAmountCent: result.officialRefundAmountCent,
      expectedRefundAmountCent: result.expectedRefundAmountCent || null,
      appliedAmountCent: result.appliedAmountCent || null,
      appliedShipFeeAmountCent: result.appliedShipFeeAmountCent,
      payAmountCent: result.payAmountCent || null,
      settlementAmountCent: result.settlementAmountCent || null,
      refundIncludesFreight: result.refundIncludesFreight,
      afterSaleReason: result.afterSaleReason,
      afterSaleStatus: result.afterSaleStatus,
      successReturnCount: result.successReturnCount,
      returnsIds: result.returnsIds.join(',') || null,
      rawDetail: result.rawDetail ? (result.rawDetail as object) : undefined,
      fetchStatus: result.fetchStatus,
      fetchError: result.fetchError,
      fetchedAt: result.fetchedAt,
    },
    update: {
      liveAccountId: accountId,
      packageId: result.packageId,
      officialRefundAmountCent: result.officialRefundAmountCent,
      expectedRefundAmountCent: result.expectedRefundAmountCent || null,
      appliedAmountCent: result.appliedAmountCent || null,
      appliedShipFeeAmountCent: result.appliedShipFeeAmountCent,
      payAmountCent: result.payAmountCent || null,
      settlementAmountCent: result.settlementAmountCent || null,
      refundIncludesFreight: result.refundIncludesFreight,
      afterSaleReason: result.afterSaleReason,
      afterSaleStatus: result.afterSaleStatus,
      successReturnCount: result.successReturnCount,
      returnsIds: result.returnsIds.join(',') || null,
      rawDetail: result.rawDetail ? (result.rawDetail as object) : undefined,
      fetchStatus: result.fetchStatus,
      fetchError: result.fetchError,
      fetchedAt: result.fetchedAt,
    },
  })
  if (result.fetchStatus === 'success' || result.fetchStatus === 'empty') {
    memoryCache.set(liveAccountOrderKey(accountId, result.orderNo), {
      ...result,
      liveAccountId: accountId,
    })
  }
}

export async function enqueueWorkbenchSync(
  orderNo: string,
  liveAccountId?: string,
): Promise<void> {
  const trimmed = orderNo.trim()
  const accountId = resolveLiveAccountId(liveAccountId)
  if (!trimmed || !/^P/i.test(trimmed)) return
  await prisma.xhsAfterSalesWorkbenchQueue.upsert({
    where: {
      liveAccountId_orderNo: {
        liveAccountId: accountId,
        orderNo: trimmed,
      },
    },
    create: { liveAccountId: accountId, orderNo: trimmed, status: 'pending' },
    update: {},
  })
}

/** @deprecated 请使用 shouldFetchAfterSalesWorkbench */
export function orderNeedsWorkbenchSync(order: {
  orderStatusText?: string
  afterSaleStatusText?: string
  isReturned?: boolean
  displayOrderNo?: string
  officialOrderNo?: string
  raw?: Record<string, unknown>
}): boolean {
  const text = [order.orderStatusText, order.afterSaleStatusText].filter(Boolean).join(' ')
  if (order.isReturned) return true
  return /退款|退货|售后|已关闭|其他售后/.test(text)
}

export async function syncWorkbenchForOrderNo(
  orderNo: string,
  liveAccountId?: string,
  opts?: { fallbackBuyerUserId?: string },
): Promise<AfterSalesWorkbenchRefund> {
  const accountId = resolveLiveAccountId(liveAccountId)
  const result = await fetchAfterSalesWorkbenchByOrderNo(orderNo, accountId, opts)
  if (result.fetchStatus !== 'failed') {
    await saveWorkbenchCache(result, accountId)
  }
  await prisma.xhsAfterSalesWorkbenchQueue.updateMany({
    where: { liveAccountId: accountId, orderNo: orderNo.trim() },
    data: {
      status: result.fetchStatus === 'failed' ? 'failed' : 'done',
      lastError: result.fetchError,
      attempts: { increment: 1 },
    },
  })
  return result
}

export async function processWorkbenchQueueBatch(limit = 10): Promise<{
  processed: number
  errors: string[]
}> {
  const pending = await prisma.xhsAfterSalesWorkbenchQueue.findMany({
    where: { status: 'pending' },
    take: limit,
    orderBy: { createdAt: 'asc' },
  })
  const errors: string[] = []
  for (const item of pending) {
    try {
      await syncWorkbenchForOrderNo(item.orderNo, item.liveAccountId)
    } catch (e) {
      errors.push(`${item.liveAccountId}:${item.orderNo}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { processed: pending.length, errors }
}

export async function loadWorkbenchRefundMapFromDb(
  queries: LiveAccountOrderQuery[],
): Promise<Map<string, AfterSalesWorkbenchRefund>> {
  if (queries.length === 0) return new Map()
  const unique = new Map<string, LiveAccountOrderQuery>()
  for (const q of queries) {
    unique.set(liveAccountOrderKey(q.liveAccountId, q.orderNo), q)
  }
  const rows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    where: {
      OR: [...unique.values()].map((q) => ({
        liveAccountId: resolveLiveAccountId(q.liveAccountId),
        orderNo: q.orderNo.trim(),
      })),
      fetchStatus: 'success',
    },
  })
  const m = new Map<string, AfterSalesWorkbenchRefund>()
  for (const row of rows) {
    m.set(liveAccountOrderKey(row.liveAccountId, row.orderNo), rowToRefund(row))
  }
  for (const [key, q] of unique) {
    if (!m.has(key)) {
      const mem = memoryCache.get(key)
      if (mem) m.set(key, mem)
    }
  }
  return m
}

export async function bootstrapWorkbenchCache(): Promise<void> {
  if (memoryCache.size > 0 && Date.now() - memoryCacheAt < 60_000) return
  await refreshWorkbenchMemoryCache()
}

/** 从 DB 售后缓存加载 rawDetail，供本地看板 / 买家排行品退统计 */
export async function loadAfterSalesBundleForOrderNos(
  queries: LiveAccountOrderQuery[],
  paidOrderNos?: Set<string>,
): Promise<{
  rawAfterSalesByOrderNo: Map<string, Record<string, unknown>[]>
  afterSaleByOrderNo: Map<string, AfterSaleOrderAggregate>
}> {
  const rawAfterSalesByOrderNo = new Map<string, Record<string, unknown>[]>()
  const afterSaleByOrderNo = new Map<string, AfterSaleOrderAggregate>()

  if (queries.length === 0) {
    return { rawAfterSalesByOrderNo, afterSaleByOrderNo }
  }

  const unique = new Map<string, LiveAccountOrderQuery>()
  for (const q of queries) {
    unique.set(liveAccountOrderKey(q.liveAccountId, q.orderNo), q)
  }

  const rows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    where: {
      OR: [...unique.values()].map((q) => ({
        liveAccountId: resolveLiveAccountId(q.liveAccountId),
        orderNo: q.orderNo.trim(),
      })),
      fetchStatus: { in: ['success', 'empty'] },
    },
    select: { liveAccountId: true, orderNo: true, rawDetail: true },
  })

  for (const row of rows) {
    const detail = row.rawDetail
    if (!detail || !Array.isArray(detail)) continue
    const cacheKey = liveAccountOrderKey(row.liveAccountId, row.orderNo)
    const raws: Record<string, unknown>[] = []
    const norms: NormalizedAfterSaleRecord[] = []
    for (const item of detail) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      raws.push(rec)
      const norm = normalizeAfterSaleRecord(rec)
      if (norm) norms.push(norm)
    }
    if (raws.length > 0) {
      rawAfterSalesByOrderNo.set(cacheKey, raws)
    }
    const paidSet = paidOrderNos ?? new Set([row.orderNo])
    const built = buildAfterSaleByOrderNo(norms, paidSet)
    const agg = built.get(row.orderNo)
    if (agg) afterSaleByOrderNo.set(cacheKey, agg)
  }

  return { rawAfterSalesByOrderNo, afterSaleByOrderNo }
}

export { type LiveAccountOrderQuery, buildLiveAccountOrderQueries }

export async function syncAllOrdersWorkbenchFromRaw(): Promise<{
  enqueued: number
  processed: number
}> {
  const orders = await prisma.xhsRawOrder.findMany({
    select: { packageId: true, orderId: true, liveAccountId: true },
  })
  let enqueued = 0
  for (const o of orders) {
    const no = (o.packageId || o.orderId || '').trim()
    if (no && /^P/i.test(no)) {
      await enqueueWorkbenchSync(no, o.liveAccountId)
      enqueued += 1
    }
  }
  const { processed } = await processWorkbenchQueueBatch(5000)
  await refreshWorkbenchMemoryCache()
  return { enqueued, processed }
}
