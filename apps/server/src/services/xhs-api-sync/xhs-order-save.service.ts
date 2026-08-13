import { prisma } from '../../lib/prisma'
import { enqueueWorkbenchSync } from '../xhs-after-sales-workbench.service'
import { resolveAfterSalesQueueEligibility } from '../after-sales-fetch-decision.service'
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
import { ensureOrderRawCompletionFields } from '../order-raw-completion.util'
import { scheduleBusinessBoardCacheInvalidationForPayTime } from '../business-cache-range-invalidation.service'
import {
  extractSellerIdFromOrderRaw,
  resolveOrderShopOwnership,
  resolveSyncShopKey,
} from '../order-shop-ownership.util'
import { logWarn } from '../../utils/server-log'

const DEFAULT_MAX_PAGES = SAFE_MAX_PAGES

function normalizeStatusText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

function maybeInvalidateBoardCacheForOrderStatusChange(params: {
  previousStatusText?: string | null
  nextStatusText?: string | null
  orderTime: Date | null
  raw: Record<string, unknown>
  displayNo: string
}): void {
  const prev = normalizeStatusText(params.previousStatusText)
  const next = normalizeStatusText(params.nextStatusText)
  if (!next || prev === next) return
  const payTime =
    params.orderTime ??
    params.raw.paidAt ??
    params.raw.orderedAt ??
    params.raw.paid_at ??
    params.raw.ordered_at ??
    null
  scheduleBusinessBoardCacheInvalidationForPayTime(payTime as Date | string | null, params.displayNo)
}

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
): Promise<{
  saved: boolean
  created: boolean
  skippedCrossShop?: boolean
  ownershipStatus?: import('../order-shop-ownership.util').ShopOwnershipStatus
}> {
  // 定时同步入库前：晋升官方完成时间 / 交易完成文案到稳定字段
  ensureOrderRawCompletionFields(item)

  const packageId = pickId(item, ['packageId', 'package_id', 'packageNo', 'package_no'])
  const orderId = pickId(item, ['orderId', 'order_id', 'orderNo', 'order_no'])
  if (!packageId && !orderId) return { saved: false, created: false }

  // 串店拦截：sellerId 明确属于另一官方店时，禁止写入当前同步账号
  const sellerId = extractSellerIdFromOrderRaw(item)
  const syncShopKey = resolveSyncShopKey({ liveAccountName })
  const ownership = resolveOrderShopOwnership({
    sellerId,
    liveAccountName,
    platformName: syncShopKey,
    raw: item,
  })
  if (ownership.skipSave) {
    logWarn(
      '订单串店拦截',
      `skip packageId=${packageId || orderId || '—'} sync=${liveAccountName}/${ownership.syncShopKey} owner=${ownership.ownerShopKey} sellerId=${sellerId}`,
    )
    return {
      saved: false,
      created: false,
      skippedCrossShop: true,
      ownershipStatus: ownership.status,
    }
  }

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
      select: { id: true, orderStatusText: true },
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
    maybeInvalidateBoardCacheForOrderStatusChange({
      previousStatusText: existing?.orderStatusText,
      nextStatusText: structured.orderStatusText,
      orderTime,
      raw: item,
      displayNo: (packageId || orderId || '').trim(),
    })
    maybeEnqueueAfterSalesWorkbench({
      displayNo: (packageId || orderId || '').trim(),
      liveAccountId,
      structured,
      raw: item,
    })
    return { saved: true, created: !existing, ownershipStatus: ownership.status }
  }

  const existing = await prisma.xhsRawOrder.findFirst({
    where: { liveAccountId, orderId: orderId! },
    select: { id: true, orderStatusText: true },
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
  maybeInvalidateBoardCacheForOrderStatusChange({
    previousStatusText: existing?.orderStatusText,
    nextStatusText: structured.orderStatusText,
    orderTime,
    raw: item,
    displayNo: (packageId || orderId || '').trim(),
  })
  maybeEnqueueAfterSalesWorkbench({
    displayNo: (packageId || orderId || '').trim(),
    liveAccountId,
    structured,
    raw: item,
  })
  return { saved: true, created: !existing, ownershipStatus: ownership.status }
}

/** 仅有售后信号时入队；无信号的普通 P 单不进队列 */
function maybeEnqueueAfterSalesWorkbench(params: {
  displayNo: string
  liveAccountId: string
  structured: {
    afterSaleStatusText?: string | null
    orderStatusText?: string | null
    isReturned?: boolean | null
  }
  raw: Record<string, unknown>
}): void {
  const displayNo = params.displayNo.trim()
  if (!displayNo || !/^P/i.test(displayNo)) return
  const elig = resolveAfterSalesQueueEligibility({
    displayOrderNo: displayNo,
    officialOrderNo: displayNo,
    afterSaleStatusText: params.structured.afterSaleStatusText ?? undefined,
    orderStatusText: params.structured.orderStatusText ?? undefined,
    isReturned: Boolean(params.structured.isReturned),
    raw: params.raw,
  })
  if (!elig.eligible) return
  void enqueueWorkbenchSync(displayNo, params.liveAccountId, {
    source: 'order_save',
  })
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
  let matchedCount = 0
  let crossShopSkippedCount = 0
  let unknownSellerCount = 0
  let unknownSyncShopCount = 0
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
      if (saved.ownershipStatus === 'match') matchedCount++
      else if (saved.ownershipStatus === 'mismatch' || saved.skippedCrossShop) crossShopSkippedCount++
      else if (saved.ownershipStatus === 'unknown_seller') unknownSellerCount++
      else if (saved.ownershipStatus === 'unknown_sync_shop') unknownSyncShopCount++
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
  if (unknownSellerCount > 0) {
    warnings.push(
      `发现 ${unknownSellerCount} 条订单 sellerId 无法识别，已按兼容模式保存，请检查平台 sellerId 字段是否变化`,
    )
  }
  if (crossShopSkippedCount > 0) {
    warnings.push(`跨店拦截 ${crossShopSkippedCount} 条（sellerId 归属其他官方店，未写入本店）`)
  }
  if (unknownSyncShopCount > 0) {
    warnings.push(`发现 ${unknownSyncShopCount} 条订单同步店无法识别为四店官方账号`)
  }
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
    matchedCount,
    crossShopSkippedCount,
    unknownSellerCount,
    unknownSyncShopCount,
  }
}
