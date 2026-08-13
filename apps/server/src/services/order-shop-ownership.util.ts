/**
 * 订单店铺归属：用 rawJson.sellerId 判定是否串店写入 / 去重时优先保留真店。
 */
import {
  resolveGoodReviewShopKey,
  resolveGoodReviewShopKeyBySellerId,
  type GoodReviewShopKey,
} from '../config/good-review-shops.constants'
import type { AnalyzedOrderView, NormalizedOrder } from '../types/analysis'

const SELLER_ID_KEYS = ['sellerId', 'seller_id'] as const

export function extractSellerIdFromOrderRaw(raw: Record<string, unknown> | null | undefined): string {
  if (!raw || typeof raw !== 'object') return ''
  for (const key of SELLER_ID_KEYS) {
    const v = raw[key]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  for (const nestKey of ['order', 'package', 'baseInfo', 'shopInfo', 'sellerInfo']) {
    const nest = raw[nestKey]
    if (!nest || typeof nest !== 'object' || Array.isArray(nest)) continue
    const rec = nest as Record<string, unknown>
    for (const key of SELLER_ID_KEYS) {
      const v = rec[key]
      if (v != null && String(v).trim()) return String(v).trim()
    }
  }
  return ''
}

export function resolveSyncShopKey(params: {
  liveAccountName?: string | null
  platformName?: string | null
}): GoodReviewShopKey | null {
  const byPlatform = resolveGoodReviewShopKey(String(params.platformName ?? '').trim())
  if (byPlatform) return byPlatform
  return resolveGoodReviewShopKey(String(params.liveAccountName ?? '').trim())
}

/**
 * 若 sellerId 明确属于另一官方店，则当前同步账号不应入库该单。
 * sellerId 未知 / 非四店 → 不拦截。
 */
export function shouldSkipCrossShopOrderSave(params: {
  syncShopKey: GoodReviewShopKey | null
  sellerId: string
}): { skip: boolean; ownerShopKey: GoodReviewShopKey | null } {
  const ownerShopKey = resolveGoodReviewShopKeyBySellerId(params.sellerId)
  if (!ownerShopKey || !params.syncShopKey) return { skip: false, ownerShopKey }
  if (ownerShopKey === params.syncShopKey) return { skip: false, ownerShopKey }
  return { skip: true, ownerShopKey }
}

function orderSellerOwnerShopKey(order: NormalizedOrder): GoodReviewShopKey | null {
  return resolveGoodReviewShopKeyBySellerId(extractSellerIdFromOrderRaw(order.raw))
}

function orderSyncShopKey(order: NormalizedOrder): GoodReviewShopKey | null {
  return resolveSyncShopKey({
    liveAccountName: order.liveAccountName,
    platformName: null,
  })
}

/** 同 P 多店去重：sellerId 归属店优先；否则保持原顺序（通常为 updatedAt desc） */
export function preferOrdersBySellerOwnership(orders: NormalizedOrder[]): NormalizedOrder[] {
  if (orders.length <= 1) return orders
  const scored = orders.map((order, index) => {
    const owner = orderSellerOwnerShopKey(order)
    const sync = orderSyncShopKey(order)
    const match = owner != null && sync != null && owner === sync
    return { order, index, match }
  })
  const hasMatch = scored.some((s) => s.match)
  if (!hasMatch) return orders
  scored.sort((a, b) => {
    if (a.match !== b.match) return a.match ? -1 : 1
    return a.index - b.index
  })
  return scored.map((s) => s.order)
}

function viewSellerOwnerShopKey(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): GoodReviewShopKey | null {
  const raw = (view as { raw?: Record<string, unknown> }).raw
  return resolveGoodReviewShopKeyBySellerId(extractSellerIdFromOrderRaw(raw))
}

function viewSyncShopKey(view: AnalyzedOrderView): GoodReviewShopKey | null {
  return resolveSyncShopKey({ liveAccountName: view.liveAccountName })
}

/** 看板视图去重：跨店同 P 优先 sellerId 归属店 */
export function preferViewsBySellerOwnership(
  views: Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>,
): AnalyzedOrderView[] {
  if (views.length <= 1) return views
  const scored = views.map((view, index) => {
    const owner = viewSellerOwnerShopKey(view)
    const sync = viewSyncShopKey(view)
    const match = owner != null && sync != null && owner === sync
    return { view, index, match }
  })
  const hasMatch = scored.some((s) => s.match)
  if (!hasMatch) return views
  scored.sort((a, b) => {
    if (a.match !== b.match) return a.match ? -1 : 1
    return a.index - b.index
  })
  return scored.map((s) => s.view)
}
