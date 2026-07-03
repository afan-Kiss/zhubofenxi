/**
 * 售后按时间范围查询（交叉印证用，非品退主来源）
 * 对应 HAR：售后根据时间查询.har → returns/v3 分页接口
 */
import { prisma } from '../lib/prisma'
import type { DateRangeResolved } from '../utils/date-range'
import {
  liveAccountOrderKey,
  resolveLiveAccountId,
  type LiveAccountOrderQuery,
} from '../utils/live-account-cache-key.util'
import { listEnabledLiveAccountsWithCookie } from './live-account.service'
import { getDecryptedCookieByAccountId } from './live-account.service'
import {
  fetchAfterSalesForTimeRange,
  normalizeAfterSaleRecord,
  type NormalizedAfterSaleRecord,
} from './xhs-after-sales-range.service'
import { requestXhsJsonWithSyncAudit } from './sync-request-audit.service'
import { enqueueXhsRequest } from './xhs-api-sync/xhs-rate-limiter.service'
import { extractAfterSalesList } from './xhs-after-sales-workbench.service'
import {
  extractApiHasMore,
  extractApiTotal,
  shouldStopPagination,
} from './xhs-api-sync/xhs-page-pagination.util'
import {
  formatSyncDateRange,
  logAfterSaleSyncComplete,
  logAfterSaleSyncFailed,
  logAfterSaleSyncStart,
  logBusinessSyncContinueNext,
  logXhsAccountAuthFailed,
  logXhsAccountRateLimited,
} from '../utils/sync-cmd-log'

const WORKBENCH_URL =
  'https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3'
const WORKBENCH_REFERER = 'https://ark.xiaohongshu.com/app-order/aftersale/list'
const DEFAULT_PAGE_SIZE = 50

function buildRangeQueryUrl(
  page: number,
  pageSize: number,
  startMs: number,
  endMs: number,
): string {
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

function rangeKey(range: DateRangeResolved): string {
  return `${range.startDate}_${range.endDate}`
}

/** 单账号按时间范围拉取售后（供多账号合并） */
async function fetchAfterSalesForTimeRangeAccount(params: {
  startMs: number
  endMs: number
  pageSize?: number
  maxPages?: number
  liveAccountId: string
  accountName: string
  platformName: string
  accountIndex?: number
  accountTotal?: number
  dateRange: string
}): Promise<{ records: NormalizedAfterSaleRecord[]; warnings: string[]; authFailed?: boolean }> {
  const warnings: string[] = []
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE
  const maxPages = params.maxPages ?? 200
  const records: NormalizedAfterSaleRecord[] = []
  const seenReturnIds = new Set<string>()
  const accountCtx = {
    accountName: params.accountName,
    liveAccountId: params.liveAccountId,
    accountIndex: params.accountIndex,
    accountTotal: params.accountTotal,
  }
  const syncStarted = Date.now()

  logAfterSaleSyncStart(accountCtx, params.dateRange)

  let cookie: string
  try {
    cookie = await getDecryptedCookieByAccountId(params.liveAccountId)
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Cookie 未配置'
    warnings.push(`${params.accountName}: ${reason}`)
    logAfterSaleSyncFailed(accountCtx, reason)
    return { records, warnings, authFailed: true }
  }

  let page = 1
  while (page <= maxPages) {
    const url = buildRangeQueryUrl(page, pageSize, params.startMs, params.endMs)
    let payload: unknown
    try {
      payload = await enqueueXhsRequest(() =>
        requestXhsJsonWithSyncAudit<unknown>({
          shopId: params.liveAccountId,
          shopName: params.accountName,
          apiName: 'after_sales_time_search',
          method: 'GET',
          urlKey: '/after-sales/time-search',
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
      const msg = e instanceof Error ? e.message : '失败'
      warnings.push(`${params.accountName} 第${page}页: ${msg}`)
      const isAuth =
        /401|403|406|429|Cookie|失效|权限|限流|unauthorized/i.test(msg)
      if (isAuth) {
        const reason = /429|406|限流/i.test(msg)
          ? '触发限流'
          : /401|403|Cookie|失效|权限/i.test(msg)
            ? 'Cookie 失效或权限不足'
            : msg.slice(0, 80)
        logAfterSaleSyncFailed(accountCtx, reason)
        if (/429|406|限流/i.test(msg)) {
          logXhsAccountRateLimited(accountCtx)
        } else if (/401|403|Cookie|失效|权限/i.test(msg)) {
          logXhsAccountAuthFailed(accountCtx)
        }
        return { records, warnings, authFailed: true }
      }
      logAfterSaleSyncFailed(accountCtx, msg.slice(0, 80))
      break
    }

    const rawList = extractAfterSalesList(payload)
    const totalEstimate = extractApiTotal(payload)

    for (const raw of rawList) {
      const norm = normalizeAfterSaleRecord(raw)
      if (!norm) continue
      const rid = norm.returnId || `${norm.orderNo}:${page}`
      if (seenReturnIds.has(rid)) continue
      seenReturnIds.add(rid)
      records.push(norm)
    }

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

  const durationSec = (Date.now() - syncStarted) / 1000
  const orderNos = new Set(records.map((r) => r.orderNo))
  logAfterSaleSyncComplete({
    ctx: accountCtx,
    apiRows: records.length,
    matchedOrders: orderNos.size,
    unmatched: Math.max(0, records.length - orderNos.size),
    durationSec,
  })

  return { records, warnings }
}

/** 多账号按 liveAccountId 拉取并写入缓存 */
export async function syncAfterSalesTimeSearchForRange(
  range: DateRangeResolved,
  options?: { force?: boolean; maxPages?: number },
): Promise<{
  recordCount: number
  orderCount: number
  warnings: string[]
  fromCache: boolean
}> {
  const key = rangeKey(range)
  if (!options?.force) {
    const cached = await prisma.xhsAfterSalesTimeSearchCache.count({
      where: { rangeKey: key },
    })
    if (cached > 0) {
      const orderNos = await prisma.xhsAfterSalesTimeSearchCache.groupBy({
        by: ['orderNo'],
        where: { rangeKey: key },
      })
      return {
        recordCount: cached,
        orderCount: orderNos.length,
        warnings: [],
        fromCache: true,
      }
    }
  }

  const accounts = await listEnabledLiveAccountsWithCookie()
  const byAccountReturnId = new Map<string, NormalizedAfterSaleRecord>()
  const warnings: string[] = []
  const dateRange = formatSyncDateRange(range.startDate, range.endDate)
  const accountTotal = accounts.length

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]!
    const single = await fetchAfterSalesForTimeRangeAccount({
      startMs: range.startTimeMs,
      endMs: range.endTimeMs,
      liveAccountId: account.id,
      accountName: account.name,
      platformName: account.platformName,
      accountIndex: i + 1,
      accountTotal,
      dateRange,
      maxPages: options?.maxPages,
    })
    warnings.push(...single.warnings)
    for (const rec of single.records) {
      const rid = `${account.id}::${rec.returnId || `${rec.orderNo}:${rec.statusName}`}`
      if (!byAccountReturnId.has(rid)) byAccountReturnId.set(rid, rec)
    }
    if (single.authFailed && i + 1 < accounts.length) {
      logBusinessSyncContinueNext({
        accountName: accounts[i + 1]!.name,
        liveAccountId: accounts[i + 1]!.id,
        accountIndex: i + 2,
        accountTotal,
      })
    }
  }

  if (byAccountReturnId.size === 0 && accounts.length === 1) {
    const fallback = await fetchAfterSalesForTimeRange({
      startMs: range.startTimeMs,
      endMs: range.endTimeMs,
      maxPages: options?.maxPages,
    })
    warnings.push(...fallback.warnings)
    for (const rec of fallback.records) {
      const rid = `${accounts[0]!.id}::${rec.returnId || `${rec.orderNo}:${rec.statusName}`}`
      if (!byAccountReturnId.has(rid)) byAccountReturnId.set(rid, rec)
    }
  }

  const now = new Date()
  if (options?.force) {
    await prisma.xhsAfterSalesTimeSearchCache.deleteMany({ where: { rangeKey: key } })
  }

  const records = [...byAccountReturnId.entries()]
  for (const [accountReturnKey, rec] of records) {
    const liveAccountId = accountReturnKey.split('::')[0]!
    const returnId = rec.returnId || `${rec.orderNo}:${rec.refundAmountCent}`
    const account = accounts.find((a) => a.id === liveAccountId)
    await prisma.xhsAfterSalesTimeSearchCache.upsert({
      where: {
        liveAccountId_returnId_rangeKey: {
          liveAccountId,
          returnId,
          rangeKey: key,
        },
      },
      create: {
        liveAccountId,
        returnId,
        orderNo: rec.orderNo,
        platformName: account?.platformName ?? 'merged',
        rangeKey: key,
        rawJson: rec.raw as object,
        syncedAt: now,
      },
      update: {
        orderNo: rec.orderNo,
        platformName: account?.platformName ?? 'merged',
        rawJson: rec.raw as object,
        syncedAt: now,
      },
    })
  }

  const orderNos = new Set([...byAccountReturnId.values()].map((r) => r.orderNo))
  return {
    recordCount: byAccountReturnId.size,
    orderCount: orderNos.size,
    warnings,
    fromCache: false,
  }
}

/** 从缓存加载时间范围售后 raw，按 liveAccountId + orderNo 索引 */
export async function loadAfterSalesTimeSearchByOrderNo(
  range: DateRangeResolved,
  queries: LiveAccountOrderQuery[],
): Promise<Map<string, Record<string, unknown>[]>> {
  const key = rangeKey(range)
  if (queries.length === 0) return new Map()

  const unique = new Map<string, LiveAccountOrderQuery>()
  for (const q of queries) {
    unique.set(liveAccountOrderKey(q.liveAccountId, q.orderNo), q)
  }

  const rows = await prisma.xhsAfterSalesTimeSearchCache.findMany({
    where: {
      rangeKey: key,
      OR: [...unique.values()].map((q) => ({
        liveAccountId: resolveLiveAccountId(q.liveAccountId),
        orderNo: q.orderNo.trim(),
      })),
    },
  })

  const m = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const cacheKey = liveAccountOrderKey(row.liveAccountId, row.orderNo)
    const raw = row.rawJson as Record<string, unknown>
    const list = m.get(cacheKey) ?? []
    list.push(raw)
    m.set(cacheKey, list)
  }
  return m
}

/** 合并工作台与时间查询售后记录（时间查询优先补充） */
export function mergeAfterSaleRecordMaps(
  base: Map<string, Record<string, unknown>[]>,
  extra: Map<string, Record<string, unknown>[]>,
): Map<string, Record<string, unknown>[]> {
  const out = new Map(base)
  for (const [orderKey, records] of extra) {
    const existing = out.get(orderKey) ?? []
    const byId = new Map<string, Record<string, unknown>>()
    for (const r of [...existing, ...records]) {
      const rid = String(r.returns_id ?? r.returnsId ?? r.return_id ?? JSON.stringify(r))
      byId.set(rid, r)
    }
    out.set(orderKey, [...byId.values()])
  }
  return out
}
