import type { NormalizedOrder } from '../types/analysis'
import {
  shouldFetchAfterSalesWorkbench,
  shouldFetchInputFromNormalizedOrder,
  isAfterSalesResultPending,
} from './after-sales-fetch-decision.service'
import {
  bootstrapWorkbenchCache,
  buildLiveAccountOrderQueries,
  enqueueWorkbenchSync,
  getWorkbenchRefundFromMemory,
  loadWorkbenchRefundMapFromDb,
  mergeWorkbenchIntoMemory,
  syncWorkbenchForOrderNo,
} from './xhs-after-sales-workbench.service'
import { liveAccountOrderKey } from '../utils/live-account-cache-key.util'

export interface WarmWorkbenchResult {
  /** 本次即时 API 同步成功的订单号 */
  synced: string[]
  /** 仍需异步补数的订单号 */
  pending: string[]
  /** 判定需要查工作台的总单数 */
  needFetchCount: number
  /** 跳过工作台查询的单数 */
  skippedCount: number
}

function orderNoOf(o: NormalizedOrder): string {
  return (o.displayOrderNo || o.officialOrderNo || o.packageId || '').trim()
}

function pickBuyerUserIdFromOrder(o: NormalizedOrder): string | undefined {
  const raw = o.raw as Record<string, unknown>
  const fromRaw = raw._buyerOfficialId != null ? String(raw._buyerOfficialId).trim() : ''
  if (fromRaw) return fromRaw
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
  const id = o.buyerId?.trim()
  if (id && !id.startsWith('nick:')) return id
  return undefined
}

function filterOrdersNeedingWorkbench(orders: NormalizedOrder[]): {
  needFetch: NormalizedOrder[]
  skipped: number
} {
  const needFetch: NormalizedOrder[] = []
  let skipped = 0
  for (const o of orders) {
    const input = shouldFetchInputFromNormalizedOrder(o)
    if (shouldFetchAfterSalesWorkbench(input)) {
      needFetch.push(o)
    } else {
      skipped += 1
    }
  }
  return { needFetch, skipped }
}

/**
 * 为需要售后工作台的订单预热缓存；可选即时同步最多 maxImmediateSync 单（走限流）
 */
export async function warmWorkbenchCacheForOrders(
  orders: NormalizedOrder[],
  opts?: { maxImmediateSync?: number },
): Promise<WarmWorkbenchResult> {
  await bootstrapWorkbenchCache()

  const { needFetch, skipped } = filterOrdersNeedingWorkbench(orders)
  const orderQueries = buildLiveAccountOrderQueries(needFetch)

  if (orderQueries.length > 0) {
    const fromDb = await loadWorkbenchRefundMapFromDb(orderQueries)
    for (const [k, v] of fromDb) {
      const [accountId, orderNo] = k.split('::')
      mergeWorkbenchIntoMemory(accountId, orderNo, v)
    }
  }

  const pending: string[] = []
  const toSyncNow: Array<{ liveAccountId: string; orderNo: string }> = []
  const maxSync = Math.max(0, opts?.maxImmediateSync ?? 0)

  for (const o of needFetch) {
    const no = orderNoOf(o)
    if (!no) continue
    const input = shouldFetchInputFromNormalizedOrder(o)
    const cached = getWorkbenchRefundFromMemory(o.liveAccountId, no)
    if (!isAfterSalesResultPending(input, cached, null)) continue

    await enqueueWorkbenchSync(no, o.liveAccountId)
    pending.push(liveAccountOrderKey(o.liveAccountId, no))
    if (toSyncNow.length < maxSync) {
      toSyncNow.push({ liveAccountId: o.liveAccountId ?? 'legacy', orderNo: no })
    }
  }

  const synced: string[] = []
  for (const item of toSyncNow) {
    try {
      const cacheKey = liveAccountOrderKey(item.liveAccountId, item.orderNo)
      const order = needFetch.find(
        (o) => liveAccountOrderKey(o.liveAccountId, orderNoOf(o)) === cacheKey,
      )
      const result = await syncWorkbenchForOrderNo(item.orderNo, item.liveAccountId, {
        fallbackBuyerUserId: order ? pickBuyerUserIdFromOrder(order) : undefined,
      })
      mergeWorkbenchIntoMemory(item.liveAccountId, item.orderNo, result)
      if (result.fetchStatus === 'success' || result.fetchStatus === 'empty') {
        synced.push(cacheKey)
      }
    } catch {
      /* 保留 pending，由队列或下次 Drawer 重试 */
    }
  }

  const pendingFinal = pending.filter((key) => {
    if (!synced.includes(key)) return true
    const [accountId, orderNo] = key.split('::')
    const cached = getWorkbenchRefundFromMemory(accountId, orderNo)
    const order = needFetch.find(
      (o) => liveAccountOrderKey(o.liveAccountId, orderNoOf(o)) === key,
    )
    if (!order) return false
    const input = shouldFetchInputFromNormalizedOrder(order)
    return isAfterSalesResultPending(input, cached, null)
  })

  return {
    synced,
    pending: pendingFinal,
    needFetchCount: needFetch.length,
    skippedCount: skipped,
  }
}

/** @deprecated 仅订单号列表时无法判断 shouldFetch，请传 NormalizedOrder[] */
export async function warmWorkbenchCacheForOrderNos(
  orderNos: string[],
  opts?: { maxImmediateSync?: number },
): Promise<WarmWorkbenchResult> {
  const pseudo: NormalizedOrder[] = orderNos
    .filter((n) => n.trim())
    .map((n, i) => ({
      sourceRowIndex: i,
      orderId: n,
      packageId: n,
      bizOrderId: n,
      officialOrderNo: n,
      displayOrderNo: n,
      matchOrderId: n,
      orderTime: null,
      orderTimeText: '',
      monthKey: '',
      buyerId: '',
      gmvCent: 0,
      productAmountCent: 0,
      receivableAmountCent: 0,
      freightCent: 0,
      platformDiscountCent: 0,
      actualPaidCent: 0,
      actualSellerReceiveAmountCent: 0,
      gmvSourceUsed: '',
      amountWarnings: [],
      orderStatusText: '',
      afterSaleStatusText: '',
      reasonText: '',
      isSigned: false,
      isReturned: false,
      isQualityReturn: false,
      actualSigned: false,
      actualSignedAmountCent: 0,
      errors: [],
      raw: {},
    }))
  return warmWorkbenchCacheForOrders(pseudo, opts)
}
