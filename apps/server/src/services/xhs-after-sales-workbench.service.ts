import { prisma } from '../lib/prisma'
import { getDecryptedCookie } from './credential.service'
import { getDecryptedCookieByAccountId } from './live-account.service'
import { requestXhsJsonWithSyncAudit } from './sync-request-audit.service'
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
import { deriveStructuredAfterSaleTypeFromRaw } from './resolve-return-refund-classification.service'
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
import {
  buildWorkbenchBusinessFingerprint,
  extractOrderAfterSaleContextFromRaw,
  resolvePreferredWorkbenchRefund,
  shouldReopenWorkbenchQueueTask,
  type OrderAfterSaleContext,
} from './workbench-cache-validity.service'
import { logInfo, logWarn } from '../utils/server-log'

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
  hasReturnRefund?: boolean
  hasRefundOnly?: boolean
  returnRefundCount?: number
  refundOnlyCount?: number
  afterSaleType?: string | null
  returnTypeCodes?: string | null
  classificationSource?: string | null
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

  const structured = deriveStructuredAfterSaleTypeFromRaw(successRecords)

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
    hasReturnRefund: structured.hasReturnRefund,
    hasRefundOnly: structured.hasRefundOnly,
    returnRefundCount: structured.returnRefundCount,
    refundOnlyCount: structured.refundOnlyCount,
    afterSaleType: structured.afterSaleType,
    returnTypeCodes: structured.returnTypeCodes || null,
    classificationSource: structured.classificationSource,
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
  liveAccountId?: string,
): Promise<Record<string, unknown>[]> {
  const url = buildWorkbenchQueryKeywords(keywords)
  const payload = await enqueueXhsRequest(() =>
    requestXhsJsonWithSyncAudit<unknown>({
      shopId: liveAccountId,
      apiName: 'after_sales_workbench',
      method: 'GET',
      urlKey: '/after-sales/workbench',
      trigger: 'scheduled',
      options: {
        method: 'GET',
        url,
        cookie,
        referer: WORKBENCH_REFERER,
        needSign: true,
        parseEnvelope: true,
      },
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
    let afterSales = await fetchAfterSalesListByKeywords(trimmed, cookie, accountId)
    if (
      afterSales.length === 0 &&
      opts?.fallbackBuyerUserId?.trim() &&
      opts.fallbackBuyerUserId.trim() !== trimmed
    ) {
      const byBuyer = await fetchAfterSalesListByKeywords(
        opts.fallbackBuyerUserId.trim(),
        cookie,
        accountId,
      )
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
  hasReturnRefund?: boolean
  hasRefundOnly?: boolean
  returnRefundCount?: number
  refundOnlyCount?: number
  afterSaleType?: string | null
  returnTypeCodes?: string | null
  classificationSource?: string | null
  fetchStatus: string
  fetchError: string | null
  fetchedAt: Date | null
  rawDetail?: unknown
}): AfterSalesWorkbenchRefund {
  let freightRefundAmountCent = 0
  let hasFreightOnlyRefund = false
  let buyerUserId: string | null = null
  let structured = {
    hasReturnRefund: Boolean(row.hasReturnRefund),
    hasRefundOnly: Boolean(row.hasRefundOnly),
    returnRefundCount: Number(row.returnRefundCount ?? 0),
    refundOnlyCount: Number(row.refundOnlyCount ?? 0),
    afterSaleType: row.afterSaleType ?? null,
    returnTypeCodes: row.returnTypeCodes ?? null,
    classificationSource: row.classificationSource ?? null,
  }
  if (row.rawDetail && Array.isArray(row.rawDetail)) {
    const agg = aggregateWorkbenchRefund(row.rawDetail as Record<string, unknown>[], row.orderNo)
    freightRefundAmountCent = agg.freightRefundAmountCent
    hasFreightOnlyRefund = agg.hasFreightOnlyRefund
    buyerUserId = agg.buyerUserId
    // rawDetail 可回填/覆盖结构化分类
    structured = {
      hasReturnRefund: Boolean(agg.hasReturnRefund),
      hasRefundOnly: Boolean(agg.hasRefundOnly),
      returnRefundCount: Number(agg.returnRefundCount ?? 0),
      refundOnlyCount: Number(agg.refundOnlyCount ?? 0),
      afterSaleType: agg.afterSaleType ?? null,
      returnTypeCodes: agg.returnTypeCodes ?? null,
      classificationSource: agg.classificationSource ?? null,
    }
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
    ...structured,
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

/** 合并 DB / 内存售后缓存：优先更新时间与完整性，金额越大不胜出 */
export function pickPreferredWorkbenchRefund(
  a: AfterSalesWorkbenchRefund,
  b: AfterSalesWorkbenchRefund,
  orderContext?: OrderAfterSaleContext,
): AfterSalesWorkbenchRefund {
  const aT = a.fetchedAt?.getTime() ?? 0
  const bT = b.fetchedAt?.getTime() ?? 0
  const incoming = aT >= bT ? a : b
  const current = aT >= bT ? b : a
  return resolvePreferredWorkbenchRefund({ current, incoming, orderContext }).preferred
}

export function mergeWorkbenchRefundMaps(
  ...maps: Array<Map<string, AfterSalesWorkbenchRefund>>
): Map<string, AfterSalesWorkbenchRefund> {
  const merged = new Map<string, AfterSalesWorkbenchRefund>()
  for (const map of maps) {
    for (const [k, v] of map) {
      const cur = merged.get(k)
      merged.set(k, cur ? pickPreferredWorkbenchRefund(v, cur) : v)
    }
  }
  return merged
}

/** 售后工作台缓存是否有晚于某时刻的更新（用于经营看板缓存失效） */
export async function getLatestWorkbenchCacheUpdatedAt(): Promise<Date | null> {
  const row = await prisma.xhsAfterSalesWorkbenchCache.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })
  return row?.updatedAt ?? null
}

export async function getLatestTimeSearchCacheUpdatedAt(): Promise<Date | null> {
  const row = await prisma.xhsAfterSalesTimeSearchCache.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })
  return row?.updatedAt ?? null
}

function workbenchRefundFingerprint(r: {
  fetchStatus?: string | null
  officialRefundAmountCent?: number | null
  freightRefundAmountCent?: number | null
  appliedAmountCent?: number | null
  appliedShipFeeAmountCent?: number | null
  expectedRefundAmountCent?: number | null
  successReturnCount?: number | null
  returnRefundCount?: number | null
  refundOnlyCount?: number | null
  hasReturnRefund?: boolean | null
  hasRefundOnly?: boolean | null
  hasFreightOnlyRefund?: boolean | null
  afterSaleStatus?: string | null
  afterSaleReason?: string | null
  afterSaleType?: string | null
  returnTypeCodes?: string | null
  classificationSource?: string | null
  returnsIds?: string | string[] | null
  refundIncludesFreight?: boolean | null
}): string {
  return buildWorkbenchBusinessFingerprint({
    ...r,
    freightRefundAmountCent: r.freightRefundAmountCent ?? r.appliedShipFeeAmountCent,
    hasFreightOnlyRefund:
      r.hasFreightOnlyRefund ??
      ((r.freightRefundAmountCent ?? r.appliedShipFeeAmountCent ?? 0) > 0 &&
        (r.officialRefundAmountCent ?? 0) === 0),
  })
}

export async function saveWorkbenchCache(
  result: AfterSalesWorkbenchRefund & { rawDetail?: unknown },
  liveAccountId?: string,
): Promise<void> {
  const accountId = resolveLiveAccountId(liveAccountId ?? result.liveAccountId)
  const prev = await prisma.xhsAfterSalesWorkbenchCache.findUnique({
    where: {
      liveAccountId_orderNo: {
        liveAccountId: accountId,
        orderNo: result.orderNo,
      },
    },
    select: {
      fetchStatus: true,
      officialRefundAmountCent: true,
      expectedRefundAmountCent: true,
      appliedAmountCent: true,
      appliedShipFeeAmountCent: true,
      successReturnCount: true,
      returnRefundCount: true,
      refundOnlyCount: true,
      hasReturnRefund: true,
      hasRefundOnly: true,
      afterSaleStatus: true,
      afterSaleReason: true,
      afterSaleType: true,
      returnTypeCodes: true,
      classificationSource: true,
      returnsIds: true,
      refundIncludesFreight: true,
      rawDetail: true,
    },
  })

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
      hasReturnRefund: Boolean(result.hasReturnRefund),
      hasRefundOnly: Boolean(result.hasRefundOnly),
      returnRefundCount: Number(result.returnRefundCount ?? 0),
      refundOnlyCount: Number(result.refundOnlyCount ?? 0),
      afterSaleType: result.afterSaleType ?? null,
      returnTypeCodes: result.returnTypeCodes ?? null,
      classificationSource: result.classificationSource ?? null,
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
      hasReturnRefund: Boolean(result.hasReturnRefund),
      hasRefundOnly: Boolean(result.hasRefundOnly),
      returnRefundCount: Number(result.returnRefundCount ?? 0),
      refundOnlyCount: Number(result.refundOnlyCount ?? 0),
      afterSaleType: result.afterSaleType ?? null,
      returnTypeCodes: result.returnTypeCodes ?? null,
      classificationSource: result.classificationSource ?? null,
      fetchStatus: result.fetchStatus,
      fetchError: result.fetchError,
      fetchedAt: result.fetchedAt,
    },
  })
  if (result.fetchStatus === 'success' || result.fetchStatus === 'empty') {
    const key = liveAccountOrderKey(accountId, result.orderNo)
    const memPrev = memoryCache.get(key)
    memoryCache.set(
      key,
      memPrev ? pickPreferredWorkbenchRefund({ ...result, liveAccountId: accountId }, memPrev) : {
        ...result,
        liveAccountId: accountId,
      },
    )
  }

  const nextFp = workbenchRefundFingerprint({
    ...result,
    returnsIds: result.returnsIds,
    freightRefundAmountCent: result.freightRefundAmountCent,
    hasFreightOnlyRefund: result.hasFreightOnlyRefund,
  })
  const prevFp = prev
    ? workbenchRefundFingerprint({
        ...prev,
        freightRefundAmountCent: prev.appliedShipFeeAmountCent,
        hasFreightOnlyRefund:
          (prev.appliedShipFeeAmountCent ?? 0) > 0 && (prev.officialRefundAmountCent ?? 0) === 0,
      })
    : ''
  const emptyToSuccess = prev?.fetchStatus === 'empty' && result.fetchStatus === 'success'
  // 业务指纹变化才失效；fetchedAt 变化不单独触发
  if (!prev || prevFp !== nextFp || emptyToSuccess) {
    try {
      const { invalidateBusinessBoardCache } = await import('./business-cache.service')
      invalidateBusinessBoardCache()
    } catch {
      // 构建期/脚本环境可能未加载经营缓存
    }
  }
}

export async function enqueueWorkbenchSync(
  orderNo: string,
  liveAccountId?: string,
  opts?: { force?: boolean; source?: string },
): Promise<{ reopened: boolean; reason: string }> {
  const trimmed = orderNo.trim()
  const accountId = resolveLiveAccountId(liveAccountId)
  if (!trimmed || !/^P/i.test(trimmed)) return { reopened: false, reason: 'invalid_order_no' }

  const { loadOrderAfterSaleContext } = await import('./after-sales-queue.service')

  const [existingQueue, cacheRow, orderCtx] = await Promise.all([
    prisma.xhsAfterSalesWorkbenchQueue.findUnique({
      where: { liveAccountId_orderNo: { liveAccountId: accountId, orderNo: trimmed } },
      select: {
        status: true,
        nextAttemptAt: true,
        errorType: true,
        lastError: true,
      },
    }),
    prisma.xhsAfterSalesWorkbenchCache.findUnique({
      where: { liveAccountId_orderNo: { liveAccountId: accountId, orderNo: trimmed } },
      select: {
        fetchStatus: true,
        fetchedAt: true,
        updatedAt: true,
        officialRefundAmountCent: true,
        expectedRefundAmountCent: true,
        appliedAmountCent: true,
        appliedShipFeeAmountCent: true,
        successReturnCount: true,
        returnRefundCount: true,
        refundOnlyCount: true,
        hasReturnRefund: true,
        hasRefundOnly: true,
        afterSaleStatus: true,
        afterSaleReason: true,
        afterSaleType: true,
        returnTypeCodes: true,
        classificationSource: true,
        returnsIds: true,
        refundIncludesFreight: true,
      },
    }),
    loadOrderAfterSaleContext(accountId, trimmed),
  ])

  const decision = shouldReopenWorkbenchQueueTask({
    queueStatus: existingQueue?.status,
    nextAttemptAt: existingQueue?.nextAttemptAt,
    errorType: existingQueue?.errorType,
    lastError: existingQueue?.lastError,
    cache: cacheRow
      ? {
          fetchStatus: cacheRow.fetchStatus,
          fetchedAt: cacheRow.fetchedAt,
          updatedAt: cacheRow.updatedAt,
          officialRefundAmountCent: cacheRow.officialRefundAmountCent,
          expectedRefundAmountCent: cacheRow.expectedRefundAmountCent,
          appliedAmountCent: cacheRow.appliedAmountCent,
          appliedShipFeeAmountCent: cacheRow.appliedShipFeeAmountCent,
          freightRefundAmountCent: cacheRow.appliedShipFeeAmountCent,
          successReturnCount: cacheRow.successReturnCount,
          returnRefundCount: cacheRow.returnRefundCount,
          refundOnlyCount: cacheRow.refundOnlyCount,
          hasReturnRefund: cacheRow.hasReturnRefund,
          hasRefundOnly: cacheRow.hasRefundOnly,
          afterSaleStatus: cacheRow.afterSaleStatus,
          afterSaleReason: cacheRow.afterSaleReason,
          afterSaleType: cacheRow.afterSaleType,
          returnTypeCodes: cacheRow.returnTypeCodes,
          classificationSource: cacheRow.classificationSource,
          returnsIds: cacheRow.returnsIds,
          refundIncludesFreight: cacheRow.refundIncludesFreight,
        }
      : null,
    order: orderCtx ?? extractOrderAfterSaleContextFromRaw({}),
    force: opts?.force === true,
    source: opts?.source ?? 'enqueueWorkbenchSync',
  })

  if (!existingQueue) {
    await prisma.xhsAfterSalesWorkbenchQueue.create({
      data: { liveAccountId: accountId, orderNo: trimmed, status: 'pending' },
    })
    logInfo(
      '售后补查',
      `入队 create pending shop=${accountId} order=${trimmed} source=${opts?.source ?? 'enqueue'}`,
    )
    return { reopened: true, reason: 'created' }
  }

  if (!decision.reopen) {
    return { reopened: false, reason: decision.reason }
  }

  // force 重开保留 errorType 到日志；写入时清空运行字段以便重新调度
  if (decision.force) {
    logWarn(
      '售后补查',
      `FORCE 重开 ${decision.fromStatus}→pending shop=${accountId} order=${trimmed} reason=${decision.reason} cache=${cacheRow?.fetchStatus ?? 'none'} afterSale=${orderCtx.afterSaleStatusText ?? ''}`,
    )
  } else {
    logInfo(
      '售后补查',
      `重开 ${decision.fromStatus}→pending shop=${accountId} order=${trimmed} reason=${decision.reason}`,
    )
  }

  await prisma.xhsAfterSalesWorkbenchQueue.update({
    where: { liveAccountId_orderNo: { liveAccountId: accountId, orderNo: trimmed } },
    data: {
      status: 'pending',
      completedAt: null,
      runningSince: null,
      lastError: null,
      errorType: null,
      nextAttemptAt: null,
    },
  })
  return { reopened: true, reason: decision.reason }
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

export function pickBuyerUserIdFromRawJson(
  raw: Record<string, unknown> | undefined,
  buyerId?: string | null,
): string | undefined {
  if (!raw) return buyerId?.trim() || undefined
  const fromMeta = raw._buyerOfficialId != null ? String(raw._buyerOfficialId).trim() : ''
  if (fromMeta) return fromMeta
  for (const k of ['user_id', 'userId', 'buyer_id', 'buyerId']) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  const userInfo = raw.userInfo
  if (userInfo && typeof userInfo === 'object') {
    for (const k of ['userId', 'user_id', 'buyerId', 'buyer_id']) {
      const v = (userInfo as Record<string, unknown>)[k]
      if (v != null && String(v).trim()) return String(v).trim()
    }
  }
  const id = buyerId?.trim()
  if (id && !id.startsWith('nick:')) return id
  return undefined
}

export async function syncWorkbenchForOrderNo(
  orderNo: string,
  liveAccountId?: string,
  opts?: { fallbackBuyerUserId?: string; queueId?: string },
): Promise<AfterSalesWorkbenchRefund> {
  const accountId = resolveLiveAccountId(liveAccountId)
  const result = await fetchAfterSalesWorkbenchByOrderNo(orderNo, accountId, opts)
  if (result.fetchStatus !== 'failed') {
    await saveWorkbenchCache(result, accountId)
  }
  if (opts?.queueId) {
    const { completeAfterSalesQueueTask } = await import('./after-sales-queue.service')
    await completeAfterSalesQueueTask({
      queueId: opts.queueId,
      liveAccountId: accountId,
      orderNo: orderNo.trim(),
      result,
    })
  } else {
    const { completeAfterSalesQueueTask } = await import('./after-sales-queue.service')
    const row = await prisma.xhsAfterSalesWorkbenchQueue.findFirst({
      where: { liveAccountId: accountId, orderNo: orderNo.trim() },
      select: { id: true },
    })
    if (row) {
      await completeAfterSalesQueueTask({
        queueId: row.id,
        liveAccountId: accountId,
        orderNo: orderNo.trim(),
        result,
      })
    }
  }
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
      const rawOrder = await prisma.xhsRawOrder.findFirst({
        where: {
          liveAccountId: item.liveAccountId,
          OR: [{ packageId: item.orderNo }, { orderId: item.orderNo }],
        },
        select: { rawJson: true, buyerId: true },
      })
      const fallbackBuyerUserId = pickBuyerUserIdFromRawJson(
        rawOrder?.rawJson as Record<string, unknown> | undefined,
        rawOrder?.buyerId,
      )
      await syncWorkbenchForOrderNo(item.orderNo, item.liveAccountId, {
        fallbackBuyerUserId,
      })
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

/** 从 DB 售后缓存加载售后聚合；优先 rawDetail，缺失时用结构化分类字段 */
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
    select: {
      liveAccountId: true,
      orderNo: true,
      rawDetail: true,
      officialRefundAmountCent: true,
      afterSaleReason: true,
      afterSaleStatus: true,
      hasReturnRefund: true,
      hasRefundOnly: true,
      returnRefundCount: true,
      refundOnlyCount: true,
      afterSaleType: true,
      returnTypeCodes: true,
      successReturnCount: true,
      returnsIds: true,
    },
  })

  for (const row of rows) {
    const cacheKey = liveAccountOrderKey(row.liveAccountId, row.orderNo)
    const detail = row.rawDetail
    if (detail && Array.isArray(detail)) {
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
      continue
    }

    // rawDetail 缺失：用结构化字段恢复 afterSaleAgg（保证退货退款统计不依赖全量 JSON）
    if (
      row.hasReturnRefund ||
      row.hasRefundOnly ||
      row.officialRefundAmountCent > 0 ||
      (row.afterSaleType && row.afterSaleType !== 'none')
    ) {
      afterSaleByOrderNo.set(cacheKey, {
        orderNo: row.orderNo,
        refundAmountCent: row.officialRefundAmountCent,
        returnRefundAmountCent: row.hasReturnRefund ? row.officialRefundAmountCent : 0,
        afterSaleCount: row.successReturnCount || (row.officialRefundAmountCent > 0 ? 1 : 0),
        returnIds: row.returnsIds ? row.returnsIds.split(',').filter(Boolean) : [],
        reasons: row.afterSaleReason ? [row.afterSaleReason] : [],
        statuses: row.afterSaleStatus ? [row.afterSaleStatus] : [],
        hasRefund: row.officialRefundAmountCent > 0,
        hasReturnRefund: Boolean(row.hasReturnRefund),
        hasProductQualityRefund: false,
      })
    }
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
