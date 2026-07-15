/**
 * 售后按时间范围查询（交叉印证用，非品退主来源）
 * 按店独立判断完整性；success_empty 写 meta
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
import { TIME_SEARCH_CACHE_TTL_MS } from './workbench-cache-validity.service'
import { scheduleBusinessBoardCacheInvalidationForPayTime } from './business-cache-range-invalidation.service'

const WORKBENCH_URL =
  'https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3'
const WORKBENCH_REFERER = 'https://ark.xiaohongshu.com/app-order/aftersale/list'
const DEFAULT_PAGE_SIZE = 50
export const RANGE_SYNC_SOURCE_VERSION = 'after-sales-range-v1'

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

export type ShopRangeSyncStatus =
  | 'success'
  | 'success_empty'
  | 'partial_success'
  | 'failed'
  | 'blocked'
  | 'running'

export type ShopRangeSyncMetaView = {
  liveAccountId: string
  platformName: string
  status: ShopRangeSyncStatus
  lastSuccessAt: string | null
  recordCount: number
  orderCount: number
  errorType: string | null
  errorMessage: string | null
  fresh: boolean
}

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
}): Promise<{
  records: NormalizedAfterSaleRecord[]
  warnings: string[]
  authFailed?: boolean
  pageCount: number
}> {
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
  let pageCount = 0

  logAfterSaleSyncStart(accountCtx, params.dateRange)

  let cookie: string
  try {
    cookie = await getDecryptedCookieByAccountId(params.liveAccountId)
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Cookie 未配置'
    warnings.push(`${params.accountName}: ${reason}`)
    logAfterSaleSyncFailed(accountCtx, reason)
    return { records, warnings, authFailed: true, pageCount: 0 }
  }

  let page = 1
  while (page <= maxPages) {
    pageCount++
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
      const isAuth = /401|403|406|429|Cookie|失效|权限|限流|unauthorized/i.test(msg)
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
        return { records, warnings, authFailed: true, pageCount }
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

  return { records, warnings, pageCount }
}

function isShopMetaFresh(meta: {
  status: string
  lastSuccessAt: Date | null
  sourceVersion: string
}): boolean {
  if (meta.sourceVersion !== RANGE_SYNC_SOURCE_VERSION) return false
  if (meta.status !== 'success' && meta.status !== 'success_empty') return false
  if (!meta.lastSuccessAt) return false
  return Date.now() - meta.lastSuccessAt.getTime() <= TIME_SEARCH_CACHE_TTL_MS
}

export async function evaluateRangeShopFreshness(
  range: DateRangeResolved,
): Promise<{
  fromCache: boolean
  overall: 'complete' | 'partial' | 'blocked'
  shops: ShopRangeSyncMetaView[]
}> {
  const key = rangeKey(range)
  const accounts = await listEnabledLiveAccountsWithCookie()
  const metas = await prisma.xhsAfterSalesRangeSyncMeta.findMany({
    where: { rangeKey: key },
  })
  const byId = new Map(metas.map((m) => [m.liveAccountId, m]))
  const shops: ShopRangeSyncMetaView[] = accounts.map((a) => {
    const m = byId.get(a.id)
    const fresh = m
      ? isShopMetaFresh({
          status: m.status,
          lastSuccessAt: m.lastSuccessAt,
          sourceVersion: m.sourceVersion,
        })
      : false
    return {
      liveAccountId: a.id,
      platformName: a.platformName,
      status: (m?.status as ShopRangeSyncStatus) ?? 'failed',
      lastSuccessAt: m?.lastSuccessAt?.toISOString() ?? null,
      recordCount: m?.recordCount ?? 0,
      orderCount: m?.orderCount ?? 0,
      errorType: m?.errorType ?? (m ? null : 'missing_meta'),
      errorMessage: m?.errorMessage ?? (m ? null : '无同步元数据'),
      fresh,
    }
  })
  const allFresh = shops.length > 0 && shops.every((s) => s.fresh)
  const anyBlocked = shops.some((s) => s.status === 'blocked')
  return {
    fromCache: allFresh,
    overall: allFresh ? 'complete' : anyBlocked ? 'blocked' : 'partial',
    shops,
  }
}

async function replaceShopRangeRowsInTransaction(params: {
  rangeKey: string
  liveAccountId: string
  platformName: string
  records: NormalizedAfterSaleRecord[]
  pageCount: number
  status: 'success' | 'success_empty'
}): Promise<void> {
  const now = new Date()
  const orderCount = new Set(params.records.map((r) => r.orderNo)).size
  await prisma.$transaction(async (tx) => {
    await tx.xhsAfterSalesTimeSearchCache.deleteMany({
      where: { rangeKey: params.rangeKey, liveAccountId: params.liveAccountId },
    })
    for (const rec of params.records) {
      const returnId = rec.returnId || `${rec.orderNo}:${rec.refundAmountCent}`
      await tx.xhsAfterSalesTimeSearchCache.create({
        data: {
          liveAccountId: params.liveAccountId,
          returnId,
          orderNo: rec.orderNo,
          platformName: params.platformName,
          rangeKey: params.rangeKey,
          rawJson: rec.raw as object,
          syncedAt: now,
        },
      })
    }
    await tx.xhsAfterSalesRangeSyncMeta.upsert({
      where: {
        liveAccountId_rangeKey: {
          liveAccountId: params.liveAccountId,
          rangeKey: params.rangeKey,
        },
      },
      create: {
        liveAccountId: params.liveAccountId,
        rangeKey: params.rangeKey,
        platformName: params.platformName,
        status: params.status,
        lastAttemptAt: now,
        lastSuccessAt: now,
        completedAt: now,
        recordCount: params.records.length,
        orderCount,
        pageCount: params.pageCount,
        errorType: null,
        errorMessage: null,
        sourceVersion: RANGE_SYNC_SOURCE_VERSION,
      },
      update: {
        platformName: params.platformName,
        status: params.status,
        lastAttemptAt: now,
        lastSuccessAt: now,
        completedAt: now,
        recordCount: params.records.length,
        orderCount,
        pageCount: params.pageCount,
        errorType: null,
        errorMessage: null,
        sourceVersion: RANGE_SYNC_SOURCE_VERSION,
      },
    })
  })
}

async function markShopRangeMetaFailed(params: {
  rangeKey: string
  liveAccountId: string
  platformName: string
  errorType: string
  errorMessage: string
  status: 'failed' | 'blocked'
}): Promise<void> {
  const now = new Date()
  await prisma.xhsAfterSalesRangeSyncMeta.upsert({
    where: {
      liveAccountId_rangeKey: {
        liveAccountId: params.liveAccountId,
        rangeKey: params.rangeKey,
      },
    },
    create: {
      liveAccountId: params.liveAccountId,
      rangeKey: params.rangeKey,
      platformName: params.platformName,
      status: params.status,
      lastAttemptAt: now,
      recordCount: 0,
      orderCount: 0,
      pageCount: 0,
      errorType: params.errorType,
      errorMessage: params.errorMessage,
      sourceVersion: RANGE_SYNC_SOURCE_VERSION,
    },
    update: {
      status: params.status,
      lastAttemptAt: now,
      errorType: params.errorType,
      errorMessage: params.errorMessage,
      // 不覆盖 lastSuccessAt / 不删缓存
    },
  })
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
  shops?: ShopRangeSyncMetaView[]
  overall?: string
}> {
  const key = rangeKey(range)
  if (!options?.force) {
    const freshness = await evaluateRangeShopFreshness(range)
    if (freshness.fromCache) {
      const cached = await prisma.xhsAfterSalesTimeSearchCache.count({
        where: { rangeKey: key },
      })
      const orderNos = await prisma.xhsAfterSalesTimeSearchCache.groupBy({
        by: ['orderNo'],
        where: { rangeKey: key },
      })
      return {
        recordCount: cached,
        orderCount: orderNos.length,
        warnings: [],
        fromCache: true,
        shops: freshness.shops,
        overall: freshness.overall,
      }
    }
  }

  const accounts = await listEnabledLiveAccountsWithCookie()
  const freshness = await evaluateRangeShopFreshness(range)
  const warnings: string[] = []
  const dateRange = formatSyncDateRange(range.startDate, range.endDate)
  const accountTotal = accounts.length
  let anySuccess = false

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i]!
    const shopFresh = freshness.shops.find((s) => s.liveAccountId === account.id)
    if (!options?.force && shopFresh?.fresh) {
      continue // 只刷新过期店
    }

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
    if (single.authFailed) {
      await markShopRangeMetaFailed({
        rangeKey: key,
        liveAccountId: account.id,
        platformName: account.platformName,
        errorType: 'cookie_or_auth',
        errorMessage: single.warnings.join('; ') || 'auth_failed',
        status: 'blocked',
      })
      if (i + 1 < accounts.length) {
        logBusinessSyncContinueNext({
          accountName: accounts[i + 1]!.name,
          liveAccountId: accounts[i + 1]!.id,
          accountIndex: i + 2,
          accountTotal,
        })
      }
      continue
    }

    try {
      await replaceShopRangeRowsInTransaction({
        rangeKey: key,
        liveAccountId: account.id,
        platformName: account.platformName,
        records: single.records,
        pageCount: single.pageCount,
        status: single.records.length === 0 ? 'success_empty' : 'success',
      })
      anySuccess = true
      // 用范围中点近似触发失效（支付日期归属业务日由订单侧更精确）
      scheduleBusinessBoardCacheInvalidationForPayTime(
        new Date(range.startTimeMs + (range.endTimeMs - range.startTimeMs) / 2),
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warnings.push(`${account.name}: DB写入失败 ${msg}`)
      await markShopRangeMetaFailed({
        rangeKey: key,
        liveAccountId: account.id,
        platformName: account.platformName,
        errorType: 'db_write_failed',
        errorMessage: msg,
        status: 'failed',
      })
      // 事务回滚后旧数据仍在，不会半删
    }
  }

  // 单账号 fallback（兼容旧路径）
  if (!anySuccess && accounts.length === 1) {
    const fallback = await fetchAfterSalesForTimeRange({
      startMs: range.startTimeMs,
      endMs: range.endTimeMs,
      maxPages: options?.maxPages,
    })
    warnings.push(...fallback.warnings)
    try {
      await replaceShopRangeRowsInTransaction({
        rangeKey: key,
        liveAccountId: accounts[0]!.id,
        platformName: accounts[0]!.platformName,
        records: fallback.records,
        pageCount: 1,
        status: fallback.records.length === 0 ? 'success_empty' : 'success',
      })
      anySuccess = true
    } catch {
      // ignore
    }
  }

  const after = await evaluateRangeShopFreshness(range)
  const totalCached = await prisma.xhsAfterSalesTimeSearchCache.count({ where: { rangeKey: key } })
  const orderNos = await prisma.xhsAfterSalesTimeSearchCache.groupBy({
    by: ['orderNo'],
    where: { rangeKey: key },
  })
  if (after.overall !== 'complete') {
    warnings.push(
      `range_${after.overall}: ${after.shops.filter((s) => s.fresh).length}/${after.shops.length} 店新鲜`,
    )
  }
  return {
    recordCount: totalCached,
    orderCount: orderNos.length,
    warnings,
    fromCache: false,
    shops: after.shops,
    overall: after.overall,
  }
}

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

export function mergeAfterSaleRecordMaps(
  base: Map<string, Record<string, unknown>[]>,
  extra: Map<string, Record<string, unknown>[]>,
): Map<string, Record<string, unknown>[]> {
  const out = new Map(base)
  for (const [k, list] of extra) {
    const prev = out.get(k) ?? []
    out.set(k, [...prev, ...list])
  }
  return out
}
