import { prisma } from '../../lib/prisma'
import { enqueueWorkbenchSync } from '../xhs-after-sales-workbench.service'
import { Prisma } from '@prisma/client'
import type { SyncOrderListOnlyParams, SyncOrderListOnlyResult } from './xhs-order-sync.service'
import {
  buildOrderListBody,
  extractOrderPackages,
} from './xhs-order-sync.service'
import { getApiDefinition, isApiConfigured } from './xhs-api-registry'
import { requestXhsApi } from './xhs-api-client.service'
import { resolveDateRange } from '../../utils/date-range'
import {
  extractApiHasMore,
  extractApiTotal,
  SAFE_MAX_PAGES,
  shouldStopPagination,
} from './xhs-page-pagination.util'
import {
  extractNormalizedOrderColumnsFromRaw,
  toPrismaNormalizedOrderColumns,
} from '../normalized-order-columns.service'

const DEFAULT_MAX_PAGES = SAFE_MAX_PAGES

function pickId(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (value != null && String(value).trim()) return String(value)
  }
  return null
}

function parseOrderTime(item: Record<string, unknown>): Date | null {
  const raw = item.orderedAt ?? item.paidAt ?? item.ordered_at ?? item.paid_at
  if (raw == null) return null
  if (typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? null : d
}

function extractBuyerId(item: Record<string, unknown>): string | null {
  const userInfo = item.userInfo
  if (userInfo && typeof userInfo === 'object') {
    const u = userInfo as Record<string, unknown>
    const id = u.userId ?? u.user_id
    if (id != null) return String(id)
  }
  const buyer = item.buyerId ?? item.buyer_id
  return buyer != null ? String(buyer) : null
}

function extractTotal(data: unknown): number {
  if (!data || typeof data !== 'object') return 0
  const root = data as Record<string, unknown>
  const inner =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root
  const total = inner.total ?? inner.totalCount
  return typeof total === 'number' ? total : 0
}

async function saveOrderPackage(
  item: Record<string, unknown>,
  syncJobId: string | null | undefined,
  liveAccountId: string,
  liveAccountName: string,
): Promise<{ saved: boolean; created: boolean }> {
  const packageId = pickId(item, ['packageId', 'package_id', 'packageNo', 'package_no'])
  const orderId = pickId(item, ['orderId', 'order_id', 'orderNo', 'order_no'])
  if (!packageId && !orderId) return { saved: false, created: false }

  const orderTime = parseOrderTime(item)
  const buyerId = extractBuyerId(item)
  const rawJson = item as Prisma.InputJsonValue
  const structured = toPrismaNormalizedOrderColumns(
    extractNormalizedOrderColumnsFromRaw(item, {
      dbPackageId: packageId,
      dbOrderId: orderId,
      liveAccountId,
      liveAccountName,
    }),
  )

  if (packageId) {
    const existing = await prisma.xhsRawOrder.findUnique({
      where: {
        liveAccountId_packageId: {
          liveAccountId,
          packageId,
        },
      },
      select: { id: true },
    })
    await prisma.xhsRawOrder.upsert({
      where: {
        liveAccountId_packageId: {
          liveAccountId,
          packageId,
        },
      },
      create: {
        packageId,
        orderId,
        liveAccountId,
        liveAccountName,
        orderTime,
        buyerId,
        rawJson,
        syncJobId: syncJobId ?? null,
        ...structured,
      },
      update: {
        orderId,
        liveAccountName,
        orderTime,
        buyerId,
        rawJson,
        syncJobId: syncJobId ?? null,
        ...structured,
      },
    })
    const displayNo = (packageId || orderId || '').trim()
    if (displayNo && /^P/i.test(displayNo)) {
      void enqueueWorkbenchSync(displayNo, liveAccountId)
    }
    return { saved: true, created: !existing }
  }

  const existing = await prisma.xhsRawOrder.findFirst({
    where: { liveAccountId, orderId: orderId! },
  })
  if (existing) {
    await prisma.xhsRawOrder.update({
      where: { id: existing.id },
      data: {
        orderId,
        liveAccountName,
        orderTime,
        buyerId,
        rawJson,
        syncJobId: syncJobId ?? null,
        ...structured,
      },
    })
  } else {
    await prisma.xhsRawOrder.create({
      data: {
        orderId,
        liveAccountId,
        liveAccountName,
        orderTime,
        buyerId,
        rawJson,
        syncJobId: syncJobId ?? null,
        ...structured,
      },
    })
  }
  return { saved: true, created: !existing }
}

export async function syncOrderListOnlyWithSave(
  params: SyncOrderListOnlyParams,
): Promise<SyncOrderListOnlyResult> {
  if (!isApiConfigured('order_list')) {
    return {
      total: 0,
      itemCount: 0,
      pageCount: 0,
      savedCount: 0,
      firstOrderId: null,
      firstPackageId: null,
      warnings: ['订单列表接口未配置'],
    }
  }

  const def = getApiDefinition('order_list')
  const pageSize = params.pageSize ?? def.pageSize
  const maxPages = params.maxPages ?? DEFAULT_MAX_PAGES
  const range = resolveDateRange('custom', params.startDate, params.endDate)

  const warnings: string[] = []
  let pageNo = 1
  let pageCount = 0
  let itemCount = 0
  let savedCount = 0
  let createdCount = 0
  let updatedCount = 0
  let total = 0
  let firstOrderId: string | null = null
  let firstPackageId: string | null = null
  let totalPageEstimate: number | null = null
  const syncStarted = Date.now()

  const liveAccountId = params.liveAccountId ?? 'legacy'
  const liveAccountName = params.liveAccountName ?? '未知直播号'
  const accountCtx = {
    accountName: liveAccountName,
    liveAccountId: params.liveAccountId,
    accountIndex: params.accountIndex,
    accountTotal: params.accountTotal,
  }
  const dateRange = `${range.startDate} 00:00:00 ~ ${range.endDate} 23:59:59`
  const {
    logOrderSyncComplete,
    logOrderSyncFailed,
    logOrderSyncPage,
    logOrderSyncPageResult,
    logOrderSyncStart,
    logXhsAccountAuthFailed,
    logXhsAccountRateLimited,
  } = await import('../../utils/sync-cmd-log')

  logOrderSyncStart(accountCtx, dateRange)

  while (pageNo <= maxPages) {
    await params.progress?.beforeRequest('order_list', pageNo, totalPageEstimate)

    logOrderSyncPage(accountCtx, pageNo)

    const res = await requestXhsApi({
      apiKey: 'order_list',
      liveAccountId: params.liveAccountId,
      liveAccountName,
      body: buildOrderListBody(pageNo, pageSize, range.startTimeMs, range.endTimeMs),
      context: params.context,
      accountIndex: params.accountIndex,
      accountTotal: params.accountTotal,
    })
    pageCount++
    const ok = Boolean(res.ok && res.data)
    await params.progress?.afterRequest(ok)

    if (!ok) {
      const errMsg =
        res.errorMessage?.includes('超时') || res.errorMessage?.includes('timeout')
          ? '订单列表接口请求超时'
          : (res.errorMessage ?? `第 ${pageNo} 页请求失败`)
      warnings.push(errMsg)
      if (res.authError) {
        const reason =
          res.httpStatus === 429 || res.httpStatus === 406
            ? '触发限流'
            : res.httpStatus === 401 || res.httpStatus === 403
              ? `Cookie 失效或权限不足（HTTP ${res.httpStatus}）`
              : errMsg
        logOrderSyncFailed(accountCtx, reason)
        if (res.authError.stopRound) {
          if (res.httpStatus === 429 || res.httpStatus === 406) {
            logXhsAccountRateLimited(accountCtx)
          } else {
            logXhsAccountAuthFailed(accountCtx, res.httpStatus)
          }
        }
        return {
          total,
          itemCount,
          pageCount,
          savedCount,
          firstOrderId,
          firstPackageId,
          warnings,
          authFailed: true,
          syncStopped: Boolean(res.authError.stopRound),
          createdCount,
          updatedCount,
          skippedCount: itemCount - savedCount,
        }
      }
      logOrderSyncFailed(accountCtx, errMsg)
      break
    }

    const packages = extractOrderPackages(res.data)
    logOrderSyncPageResult(accountCtx, pageNo, packages.length)
    total = extractApiTotal(res.data) || total
    if (total > 0) {
      totalPageEstimate = Math.ceil(total / pageSize)
    }

    for (const item of packages) {
      if (!firstOrderId) {
        firstOrderId = pickId(item, ['orderId', 'order_id', 'orderNo', 'order_no'])
      }
      if (!firstPackageId) {
        firstPackageId = pickId(item, ['packageId', 'package_id', 'packageNo', 'package_no'])
      }
      itemCount++
      const saved = await saveOrderPackage(
        item,
        params.syncJobId,
        liveAccountId,
        liveAccountName,
      )
      if (saved.saved) {
        savedCount++
        if (saved.created) createdCount++
        else updatedCount++
      }
    }

    await params.progress?.afterPage('order_list', pageNo, totalPageEstimate, savedCount)

    if (
      shouldStopPagination({
        rowsThisPage: packages.length,
        pageSize,
        pageNo,
        hasMore: extractApiHasMore(res.data),
        totalEstimate: total,
        accumulatedRows: itemCount,
      })
    ) {
      break
    }

    pageNo++
  }

  if (pageNo > maxPages) {
    warnings.push(`已达到最大页数保护 ${maxPages}，可能未拉取完整数据`)
  }

  const durationSec = (Date.now() - syncStarted) / 1000
  const skippedCount = Math.max(0, itemCount - savedCount)
  logOrderSyncComplete({
    ctx: accountCtx,
    apiRows: itemCount,
    created: createdCount,
    updated: updatedCount,
    skipped: skippedCount,
    durationSec,
  })

  return {
    total,
    itemCount,
    pageCount,
    savedCount,
    firstOrderId,
    firstPackageId,
    warnings,
    createdCount,
    updatedCount,
    skippedCount,
  }
}
