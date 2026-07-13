import { getDecryptedCookie } from './credential.service'
import { requestXhsJsonWithSyncAudit } from './sync-request-audit.service'
import { enqueueXhsRequest } from './xhs-api-sync/xhs-rate-limiter.service'
import {
  extractApiHasMore,
  extractApiTotal,
  SAFE_MAX_PAGES,
  shouldStopPagination,
} from './xhs-api-sync/xhs-page-pagination.util'
import {
  aggregateWorkbenchRefund,
  extractAfterSalesList,
  mergeWorkbenchIntoMemory,
  type AfterSalesWorkbenchRefund,
  yuanApiAmountToCent,
} from './xhs-after-sales-workbench.service'
import {
  resolveBusinessProductRefundAmountCent,
} from './business-refund-caliber.service'
import { isSuccessfulAfterSale, extractAfterSaleReasonText } from './strict-after-sale-metrics.service'
import { matchPlatformReturnReason } from '../utils/quality-return'

const WORKBENCH_URL =
  'https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3'
const WORKBENCH_REFERER = 'https://ark.xiaohongshu.com/app-order/aftersale/list'

const DEFAULT_PAGE_SIZE = 50
const RANGE_EXPAND_DAYS = 60

export interface NormalizedAfterSaleRecord {
  orderNo: string
  returnId: string
  refundAmountCent: number
  appliedAmountCent: number
  payAmountCent: number
  settlementAmountCent: number
  status: string
  statusName: string
  refundStatus: string
  refundStatusName: string
  reason: string
  returnType: string
  returnTypeName: string
  refunded: boolean
  refundTime: string | number | null
  applyTime: string | number | null
  updateTime: string | number | null
  raw: Record<string, unknown>
}

export interface AfterSaleOrderAggregate {
  orderNo: string
  refundAmountCent: number
  returnRefundAmountCent: number
  afterSaleCount: number
  returnIds: string[]
  reasons: string[]
  statuses: string[]
  hasRefund: boolean
  hasReturnRefund: boolean
  hasProductQualityRefund: boolean
}

export type AfterSaleFetchProgressCb = (info: {
  message: string
  fetchedPages: number
  totalPages: number | null
  totalRows: number
}) => void

function pickOrderNoFromRecord(rec: Record<string, unknown>): string {
  for (const k of [
    'package_id',
    'delivery_package_id',
    'packageId',
    'deliveryPackageId',
    'order_id',
    'orderId',
  ]) {
    const v = rec[k]
    if (v != null) {
      const s = String(v).trim()
      if (s && /^P/i.test(s)) return s
    }
  }
  return ''
}

function pickString(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export function normalizeAfterSaleRecord(rec: Record<string, unknown>): NormalizedAfterSaleRecord | null {
  const orderNo = pickOrderNoFromRecord(rec)
  if (!orderNo) return null

  const refundFee = resolveBusinessProductRefundAmountCent(rec)
  const refunded = rec.refunded === true
  const refundStatusName = pickString(rec, ['refund_status_name', 'refundStatusName'])
  const statusName = pickString(rec, ['status_name', 'statusName'])
  const success = isSuccessfulAfterSale(rec)

  let refundAmountCent = 0
  if (success && refundFee > 0) {
    refundAmountCent = refundFee
  } else if (success && refunded) {
    refundAmountCent = resolveBusinessProductRefundAmountCent(rec)
  }

  return {
    orderNo,
    returnId: pickString(rec, ['returns_id', 'returnsId', 'return_id']),
    refundAmountCent,
    appliedAmountCent: yuanApiAmountToCent(rec.applied_amount ?? rec.appliedAmount),
    payAmountCent: yuanApiAmountToCent(rec.pay_amount ?? rec.payAmount),
    settlementAmountCent: yuanApiAmountToCent(
      rec.settlement_amount ?? rec.settlementAmount,
    ),
    status: pickString(rec, ['status']),
    statusName,
    refundStatus: pickString(rec, ['refund_status', 'refundStatus']),
    refundStatusName,
    reason: extractAfterSaleReasonText(rec) || pickString(rec, ['reason_name_zh', 'reasonNameZh', 'reason']),
    returnType: pickString(rec, ['return_type', 'returnType']),
    returnTypeName: pickString(rec, ['return_type_name', 'returnTypeName']),
    refunded,
    refundTime: (rec.refund_time ?? rec.refundTime ?? rec.refund_ok_time ?? null) as
      | string
      | number
      | null,
    applyTime: (rec.time ?? rec.create_time ?? rec.createTime ?? null) as
      | string
      | number
      | null,
    updateTime: (rec.update_at ?? rec.updateAt ?? null) as string | number | null,
    raw: rec,
  }
}

export function isReturnRefundAfterSaleRecord(rec: NormalizedAfterSaleRecord): boolean {
  const text = [rec.returnTypeName, rec.statusName, rec.refundStatusName, rec.returnType].join(
    ' ',
  )
  if (/仅退款|未发货仅退款/.test(text)) return false
  return /退货|退货退款|需要寄回|已寄回|退货完成|退货退款成功|寄回/.test(text)
}

export function isQualityRefundAfterSaleRecord(rec: NormalizedAfterSaleRecord): boolean {
  return matchPlatformReturnReason(rec.reason).isQualityReturn
}

function buildRangeQueryUrl(page: number, pageSize: number, startMs: number, endMs: number): string {
  const u = new URL(WORKBENCH_URL)
  u.searchParams.set('page', String(page))
  u.searchParams.set('number', String(pageSize))
  u.searchParams.append('goods_source[]', '1')
  u.searchParams.append('goods_source[]', '2')
  u.searchParams.set('create_time_begin', String(startMs))
  u.searchParams.set('create_time_end', String(endMs))
  u.searchParams.set('return_type_in', '3,4,1,2,5')
  u.searchParams.set('sort', 'deadline_for_sort_v1')
  u.searchParams.set('order', 'asc')
  u.searchParams.set('status_in', '1,2,3,12,13,4,5,6,9,9001,14')
  return u.toString()
}

export function expandDateRangeMs(
  startMs: number,
  endMs: number,
  expandDays = RANGE_EXPAND_DAYS,
): { startMs: number; endMs: number } {
  const day = 24 * 60 * 60 * 1000
  return {
    startMs: startMs - expandDays * day,
    endMs: endMs + expandDays * day,
  }
}

/** 按退款申请时间范围分页拉取全量售后 */
export async function fetchAfterSalesForTimeRange(params: {
  startMs: number
  endMs: number
  pageSize?: number
  maxPages?: number
  onProgress?: AfterSaleFetchProgressCb
}): Promise<{
  records: NormalizedAfterSaleRecord[]
  pageCount: number
  totalEstimate: number
  warnings: string[]
}> {
  const warnings: string[] = []
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE
  const maxPages = params.maxPages ?? SAFE_MAX_PAGES
  const records: NormalizedAfterSaleRecord[] = []
  const seenReturnIds = new Set<string>()

  let cookie: string
  try {
    cookie = await getDecryptedCookie()
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Cookie 未配置')
    return { records: [], pageCount: 0, totalEstimate: 0, warnings }
  }

  let page = 1
  let pageCount = 0
  let totalEstimate = 0
  let totalPageEstimate: number | null = null

  while (page <= maxPages) {
    params.onProgress?.({
      message: `正在读取售后第 ${page} 页...`,
      fetchedPages: page,
      totalPages: totalPageEstimate,
      totalRows: records.length,
    })

    const url = buildRangeQueryUrl(page, pageSize, params.startMs, params.endMs)
    let payload: unknown
    try {
      payload = await enqueueXhsRequest(() =>
        requestXhsJsonWithSyncAudit<unknown>({
          apiName: 'after_sales_range',
          method: 'GET',
          urlKey: '/after-sales/range',
          trigger: 'scheduled',
          pageNo: page,
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
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : `售后第 ${page} 页失败`)
      break
    }

    pageCount++
    const rawList = extractAfterSalesList(payload)
    totalEstimate = extractApiTotal(payload) || totalEstimate
    if (totalEstimate > 0) totalPageEstimate = Math.ceil(totalEstimate / pageSize)

    for (const raw of rawList) {
      const norm = normalizeAfterSaleRecord(raw)
      if (!norm) continue
      const rid = norm.returnId || `${norm.orderNo}:${norm.refundAmountCent}:${norm.statusName}`
      if (seenReturnIds.has(rid)) continue
      seenReturnIds.add(rid)
      records.push(norm)
    }

    params.onProgress?.({
      message: `已读取 ${records.length} 条售后记录...`,
      fetchedPages: page,
      totalPages: totalPageEstimate,
      totalRows: records.length,
    })

    if (
      shouldStopPagination({
        rowsThisPage: rawList.length,
        pageSize,
        pageNo: page,
        hasMore: extractApiHasMore(payload),
        totalEstimate,
        accumulatedRows: records.length,
      })
    ) {
      break
    }
    page++
  }

  if (page > maxPages) {
    warnings.push(`售后已达到最大页数保护 ${maxPages}，可能未拉取完整`)
  }

  return { records, pageCount, totalEstimate, warnings }
}

/** 按 P 订单号汇总售后（仅保留 paidOrderNos 内的订单） */
export function buildAfterSaleByOrderNo(
  records: NormalizedAfterSaleRecord[],
  paidOrderNos: Set<string>,
): Map<string, AfterSaleOrderAggregate> {
  const map = new Map<string, AfterSaleOrderAggregate>()

  for (const rec of records) {
    if (!paidOrderNos.has(rec.orderNo)) continue

    let agg = map.get(rec.orderNo)
    if (!agg) {
      agg = {
        orderNo: rec.orderNo,
        refundAmountCent: 0,
        returnRefundAmountCent: 0,
        afterSaleCount: 0,
        returnIds: [],
        reasons: [],
        statuses: [],
        hasRefund: false,
        hasReturnRefund: false,
        hasProductQualityRefund: false,
      }
      map.set(rec.orderNo, agg)
    }

    if (rec.reason && !agg.reasons.includes(rec.reason)) agg.reasons.push(rec.reason)
    if (isQualityRefundAfterSaleRecord(rec)) agg.hasProductQualityRefund = true
    const stPending = rec.statusName || rec.refundStatusName
    if (stPending && !agg.statuses.includes(stPending)) agg.statuses.push(stPending)
    if (rec.returnId && !agg.returnIds.includes(rec.returnId)) {
      agg.returnIds.push(rec.returnId)
    }
    if (isReturnRefundAfterSaleRecord(rec)) agg.hasReturnRefund = true

    if (!isSuccessfulAfterSale(rec.raw)) continue

    agg.afterSaleCount += 1
    if (rec.returnId && !agg.returnIds.includes(rec.returnId)) {
      agg.returnIds.push(rec.returnId)
    }
    if (rec.reason && !agg.reasons.includes(rec.reason)) agg.reasons.push(rec.reason)
    const st = rec.statusName || rec.refundStatusName
    if (st && !agg.statuses.includes(st)) agg.statuses.push(st)

    if (rec.refundAmountCent > 0) {
      agg.refundAmountCent += rec.refundAmountCent
      agg.hasRefund = true
    }
    if (isReturnRefundAfterSaleRecord(rec)) {
      agg.hasReturnRefund = true
      if (rec.refundAmountCent > 0) {
        agg.returnRefundAmountCent += rec.refundAmountCent
      }
    }
    if (isQualityRefundAfterSaleRecord(rec)) {
      agg.hasProductQualityRefund = true
    }
  }

  return map
}

/** 从 liveAccountId::orderNo 或 orderNo 索引的 raw 售后重建聚合（含时间范围查询合并结果） */
export function buildAfterSaleAggregatesByOrderKey(
  rawByOrderKey: Map<string, Record<string, unknown>[]>,
  paidOrderNos: Set<string>,
): Map<string, AfterSaleOrderAggregate> {
  const out = new Map<string, AfterSaleOrderAggregate>()
  for (const [key, raws] of rawByOrderKey) {
    if (!raws.length) continue
    const orderNo = key.includes('::') ? key.split('::').slice(1).join('::') : key
    if (!paidOrderNos.has(orderNo)) continue
    const norms: NormalizedAfterSaleRecord[] = []
    for (const raw of raws) {
      const norm = normalizeAfterSaleRecord(raw)
      if (norm) norms.push(norm)
    }
    const built = buildAfterSaleByOrderNo(norms, paidOrderNos)
    const agg = built.get(orderNo)
    if (agg) out.set(key, agg)
  }
  return out
}

export function mergeAfterSaleAggregateMaps(
  base: Map<string, AfterSaleOrderAggregate>,
  extra: Map<string, AfterSaleOrderAggregate>,
): Map<string, AfterSaleOrderAggregate> {
  const out = new Map(base)
  for (const [key, agg] of extra) {
    const prev = out.get(key)
    if (!prev) {
      out.set(key, agg)
      continue
    }
    out.set(key, {
      ...prev,
      refundAmountCent: Math.max(prev.refundAmountCent, agg.refundAmountCent),
      returnRefundAmountCent: Math.max(prev.returnRefundAmountCent, agg.returnRefundAmountCent),
      afterSaleCount: Math.max(prev.afterSaleCount, agg.afterSaleCount),
      hasRefund: prev.hasRefund || agg.hasRefund,
      hasReturnRefund: prev.hasReturnRefund || agg.hasReturnRefund,
      hasProductQualityRefund: prev.hasProductQualityRefund || agg.hasProductQualityRefund,
      returnIds: [...new Set([...prev.returnIds, ...agg.returnIds])],
      reasons: [...new Set([...prev.reasons, ...agg.reasons])],
      statuses: [...new Set([...prev.statuses, ...agg.statuses])],
    })
  }
  return out
}

/** 将范围售后合并进工作台内存缓存，供 buildViews 使用 */
export function mergeAfterSaleAggregatesIntoWorkbench(
  aggregates: Map<string, AfterSaleOrderAggregate>,
  rawRecordsByOrder: Map<string, Record<string, unknown>[]>,
): void {
  for (const [key, agg] of aggregates) {
    let liveAccountId = 'legacy'
    let orderNo = key
    if (key.includes('::')) {
      const parts = key.split('::')
      liveAccountId = parts[0] ?? 'legacy'
      orderNo = parts.slice(1).join('::')
    }
    const raws = rawRecordsByOrder.get(key) ?? rawRecordsByOrder.get(orderNo) ?? []
    const wb = aggregateWorkbenchRefund(raws, orderNo)
    const merged: AfterSalesWorkbenchRefund = {
      ...wb,
      liveAccountId,
      officialRefundAmountCent: Math.max(wb.officialRefundAmountCent, agg.refundAmountCent),
      hasReturnRefund: Boolean(wb.hasReturnRefund || agg.hasReturnRefund),
      hasRefundOnly: Boolean(
        wb.hasRefundOnly || (agg.hasRefund && !agg.hasReturnRefund && agg.refundAmountCent > 0),
      ),
      returnRefundCount: Math.max(wb.returnRefundCount ?? 0, agg.hasReturnRefund ? 1 : 0),
      fetchStatus: agg.hasRefund || wb.officialRefundAmountCent > 0 ? 'success' : 'empty',
      fetchError: null,
      fetchedAt: new Date(),
    }
    mergeWorkbenchIntoMemory(liveAccountId, orderNo, merged)
  }
}

export function groupRawRecordsByOrderNo(
  records: NormalizedAfterSaleRecord[],
): Map<string, Record<string, unknown>[]> {
  const m = new Map<string, Record<string, unknown>[]>()
  for (const r of records) {
    const list = m.get(r.orderNo) ?? []
    list.push(r.raw)
    m.set(r.orderNo, list)
  }
  return m
}
