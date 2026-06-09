import type { DateRangeResolved } from '../utils/date-range'

import { resolveDateRange } from '../utils/date-range'

import type { AnalyzedOrderView } from '../types/analysis'

import { prepareAnalysisArtifactsFromRaw, type RawAnalyzeBundle } from './business-analysis.service'

import { normalizeXhsOrderPackage } from './xhs-api-sync/xhs-json-normalizer.service'

import { fetchOrderPackagesForRange } from './xhs-api-sync/xhs-order-sync.service'

import { syncLiveSessionList } from './xhs-api-sync/xhs-live-sync.service'

import { normalizeLiveSessionsFromRaw } from './xhs-api-sync/xhs-json-normalizer.service'

import { formatDateTime } from '../utils/time'

import { orderStatTimeInRange } from '../utils/order-stat-time.util'

import { bootstrapWorkbenchCache } from './xhs-after-sales-workbench.service'

import {

  expandDateRangeMs,

  fetchAfterSalesForTimeRange,

  mergeAfterSaleAggregatesIntoWorkbench,

} from './xhs-after-sales-range.service'
import {
  buildOrderMap,
  matchAfterSaleToOrders,
  mergeUnmatchedAfterSaleRecords,
  pseudoStrippedToUnmatchedRecords,
  stripAfterSaleOnlyFromPrimaryOrders,
} from './order-master-match.service'
import {
  filterPrimaryOrdersForMetrics,
  isOrderListPrimaryPackage,
  warnPrimaryOrderIntegrity,
} from './order-primary-source.service'

import { resolveDisplayOrderNoForView } from './order-display-no.service'

import { viewCountsAsPaidOrder } from './business-metrics.service'

import type { LiveSession } from '../types/analysis'

import type { XhsRequestAuditContext } from './xhs-http.service'



export type LiveAnalysisProgressCb = (info: {

  message: string

  fetchedPages: number

  totalPages: number | null

  totalOrders: number

}) => void



function liveInRange(

  session: { startTime: Date | null },

  range: DateRangeResolved,

): boolean {

  if (!session.startTime) return false

  const ms = session.startTime.getTime()

  return ms >= range.startTimeMs && ms <= range.endTimeMs

}



function toLiveSession(

  session: {

    liveId: string

    startTime: Date | null

    endTime: Date | null

    anchorName: string

    durationMinutes: number

    errors: string[]

    raw: Record<string, unknown>

    id: string

  },

  index: number,

): LiveSession | null {

  if (!session.startTime || session.errors.length > 0) return null

  const endTime =

    session.endTime ??

    new Date(session.startTime.getTime() + session.durationMinutes * 60_000)

  return {

    id: session.liveId || session.id,

    sourceRowIndex: index + 1,

    startTime: session.startTime,

    endTime,

    startTimeText: formatDateTime(session.startTime),

    endTimeText: formatDateTime(endTime),

    anchorName: session.anchorName || undefined,

    durationMinutes: session.durationMinutes,

    errors: session.errors,

    raw: session.raw,

  }

}



/**

 * 拉取指定日期范围订单并仅基于本次接口返回数据做分析（不读本地历史订单缓存）。

 */

export async function fetchLiveRangeAnalysis(params: {

  startDate: string

  endDate: string

  requestId: string

  audit?: XhsRequestAuditContext

  onProgress?: LiveAnalysisProgressCb

}): Promise<{

  range: DateRangeResolved

  packages: Record<string, unknown>[]

  bundle: RawAnalyzeBundle

  views: AnalyzedOrderView[]

  rawByMatch: Map<string, Record<string, unknown>>

}> {

  const range = resolveDateRange('custom', params.startDate, params.endDate)



  const { packages, warnings: fetchWarnings, pageCount: orderPagesRead } =

    await fetchOrderPackagesForRange({

      startDate: params.startDate,

      endDate: params.endDate,

      onProgress: params.onProgress,

      context: params.audit,

    })



  if (fetchWarnings.length > 0 && packages.length === 0) {

    throw new Error(fetchWarnings.join('；') || '订单接口请求失败')

  }



  params.onProgress?.({

    message: '正在同步直播场次（主播归属）...',

    fetchedPages: orderPagesRead,

    totalPages: null,

    totalOrders: packages.length,

  })



  await syncLiveSessionList({

    syncJobId: `live-query-${params.requestId}`,

    startDate: params.startDate,

    endDate: params.endDate,

    context: params.audit,

  })



  const expanded = expandDateRangeMs(range.startTimeMs, range.endTimeMs)

  const afterSaleFetch = await fetchAfterSalesForTimeRange({

    startMs: expanded.startMs,

    endMs: expanded.endMs,

    onProgress: (info) => {

      params.onProgress?.({

        message: info.message,

        fetchedPages: info.fetchedPages,

        totalPages: info.totalPages,

        totalOrders: info.totalRows,

      })

    },

  })



  const primaryPackages = packages.filter((pkg) => isOrderListPrimaryPackage(pkg))
  const rejectedPackageCount = packages.length - primaryPackages.length

  let orders = filterPrimaryOrdersForMetrics(
    primaryPackages
      .map((pkg, i) => normalizeXhsOrderPackage(pkg, i + 1))
      .filter((o) => orderStatTimeInRange(o, range)),
  )

  const stripped = stripAfterSaleOnlyFromPrimaryOrders(orders, afterSaleFetch.records)
  orders = stripped.orders
  const primaryOrderNoSet = new Set(
    orders
      .map((o) => (o.displayOrderNo || o.officialOrderNo || o.packageId || '').trim())
      .filter(Boolean),
  )

  const orderMap = buildOrderMap(orders)

  await bootstrapWorkbenchCache()



  const afterSaleMatch = matchAfterSaleToOrders(afterSaleFetch.records, orderMap, {
    primaryOrderNos: primaryOrderNoSet,
  })
  const unmatchedAfterSaleRecords = mergeUnmatchedAfterSaleRecords(
    afterSaleMatch.unmatchedAfterSaleRecords,
    pseudoStrippedToUnmatchedRecords(stripped.stripped),
  )
  const afterSaleByOrderNo = afterSaleMatch.afterSaleByOrderNo
  const rawByOrder = afterSaleMatch.matchedRawByOrderNo

  mergeAfterSaleAggregatesIntoWorkbench(afterSaleByOrderNo, rawByOrder)



  const liveSessions = (await normalizeLiveSessionsFromRaw())

    .filter((s) => liveInRange(s, range))

    .map((s, i) => toLiveSession(s, i))

    .filter((s): s is LiveSession => s != null)



  const bundle: RawAnalyzeBundle = {

    orders,

    liveSessions,

    pendingRecords: [],

    settledRecords: [],

    hasPending: false,

    hasSettled: false,

    warnings: [
      ...fetchWarnings,
      ...afterSaleFetch.warnings,
      ...warnPrimaryOrderIntegrity(orders),
      ...(rejectedPackageCount > 0
        ? [`已排除 ${rejectedPackageCount} 条非订单主表包裹（疑似售后混入订单列表）`]
        : []),
      ...(stripped.stripped.length > 0
        ? [
            `已从主表剔除 ${stripped.stripped.length} 条售后伪包裹：${stripped.stripped.map((s) => s.orderNo).join(', ')}`,
          ]
        : []),
    ],

    afterSaleByOrderNo,

    rawAfterSalesByOrderNo: rawByOrder,

    unmatchedAfterSaleRecords,

    fetchMeta: {

      orderPagesRead,

      orderRowsRead: orders.length,

      afterSalePagesRead: afterSaleFetch.pageCount,

      afterSaleRowsRead: afterSaleFetch.records.length,

    },

  }



  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)

  const views = artifacts?.views ?? []



  const rawByMatch = new Map<string, Record<string, unknown>>()

  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {

    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)

  }



  params.onProgress?.({

    message: '正在统计数据...',

    fetchedPages: orderPagesRead,

    totalPages: null,

    totalOrders: views.length,

  })



  return { range, packages, bundle, views, rawByMatch }

}



/** @internal 供 debug 使用 */

export function collectPaidOrderNosFromViews(views: AnalyzedOrderView[]): Set<string> {

  const set = new Set<string>()

  for (const v of views) {

    if (!viewCountsAsPaidOrder(v)) continue

    const no = resolveDisplayOrderNoForView(v).trim()

    if (no && no !== '—') set.add(no)

  }

  return set

}


