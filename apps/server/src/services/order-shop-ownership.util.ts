/**
 * 订单店铺归属：用 rawJson.sellerId 判定串店写入 / 去重过滤 / View 层防污染。
 * 全站唯一真值来源：OFFICIAL_SHOP_SELLER_IDS（good-review-shops.constants）。
 */
import {
  getGoodReviewShopName,
  resolveGoodReviewShopKey,
  resolveGoodReviewShopKeyBySellerId,
  type GoodReviewShopKey,
} from '../config/good-review-shops.constants'
import type { AnalyzedOrderView, NormalizedOrder } from '../types/analysis'

const SELLER_ID_KEYS = ['sellerId', 'seller_id'] as const

export type ShopOwnershipStatus =
  | 'match'
  | 'mismatch'
  | 'unknown_seller'
  | 'unknown_sync_shop'

export interface ShopOwnershipVerdict {
  status: ShopOwnershipStatus
  sellerId: string
  ownerShopKey: GoodReviewShopKey | null
  syncShopKey: GoodReviewShopKey | null
  /** 明确串店：同步入库应跳过 */
  skipSave: boolean
}

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

export function resolveOrderShopOwnership(params: {
  sellerId?: string | null
  liveAccountName?: string | null
  platformName?: string | null
  /** 已解析的稳定同步店；优先于名称解析 */
  syncShopKey?: GoodReviewShopKey | null
  raw?: Record<string, unknown> | null
}): ShopOwnershipVerdict {
  const sellerId =
    String(params.sellerId ?? '').trim() || extractSellerIdFromOrderRaw(params.raw ?? null)
  const syncShopKey =
    params.syncShopKey !== undefined
      ? params.syncShopKey
      : resolveSyncShopKey({
          liveAccountName: params.liveAccountName,
          platformName: params.platformName,
        })
  const ownerShopKey = resolveGoodReviewShopKeyBySellerId(sellerId)

  if (!sellerId || !ownerShopKey) {
    return {
      status: 'unknown_seller',
      sellerId,
      ownerShopKey: null,
      syncShopKey,
      skipSave: false,
    }
  }
  if (!syncShopKey) {
    return {
      status: 'unknown_sync_shop',
      sellerId,
      ownerShopKey,
      syncShopKey: null,
      skipSave: false,
    }
  }
  if (ownerShopKey === syncShopKey) {
    return {
      status: 'match',
      sellerId,
      ownerShopKey,
      syncShopKey,
      skipSave: false,
    }
  }
  return {
    status: 'mismatch',
    sellerId,
    ownerShopKey,
    syncShopKey,
    skipSave: true,
  }
}

export function resolveViewShopOwnership(view: AnalyzedOrderView): ShopOwnershipVerdict {
  // 主路径用稳定字段 sellerId；若旧缓存缺字段且已 attach raw，则回退 extractSellerIdFromOrderRaw
  const raw = (view as AnalyzedOrderView & { raw?: Record<string, unknown> }).raw
  return resolveOrderShopOwnership({
    sellerId: view.sellerId,
    liveAccountName: view.liveAccountName,
    raw,
  })
}

export function resolveNormalizedOrderShopOwnership(order: NormalizedOrder): ShopOwnershipVerdict {
  return resolveOrderShopOwnership({
    liveAccountName: order.liveAccountName,
    raw: order.raw,
  })
}

/**
 * 若 sellerId 明确属于另一官方店，则当前同步账号不应入库该单。
 * sellerId 未知 / 同步店无法识别 → 不拦截（兼容保存）。
 */
export function shouldSkipCrossShopOrderSave(params: {
  syncShopKey: GoodReviewShopKey | null
  sellerId: string
}): ShopOwnershipVerdict {
  return resolveOrderShopOwnership({
    sellerId: params.sellerId,
    platformName: params.syncShopKey,
    liveAccountName: params.syncShopKey ? getGoodReviewShopName(params.syncShopKey) : null,
  })
}

export function crossShopContaminationError(verdict: ShopOwnershipVerdict): string {
  const owner = verdict.ownerShopKey
    ? getGoodReviewShopName(verdict.ownerShopKey)
    : '未知归属店'
  const sync = verdict.syncShopKey
    ? getGoodReviewShopName(verdict.syncShopKey)
    : '未知同步店'
  return `跨店污染订单：sellerId归属${owner}，但数据挂在${sync}`
}

export interface OwnershipPartition<T> {
  /** 可进入正常合并/统计 */
  mergeable: T[]
  /** 明确 MISMATCH，不得参与金额合并 */
  contaminated: T[]
  /** 同组是否全部为明确 MISMATCH */
  allMismatch: boolean
  /** 组内是否存在 MATCH */
  hasMatch: boolean
  unknownCount: number
}

function ownershipShopIdentity(verdict: ShopOwnershipVerdict, liveAccountName?: string | null): string {
  if (verdict.syncShopKey) return `key:${verdict.syncShopKey}`
  const name = String(liveAccountName ?? '').trim()
  return name ? `name:${name}` : ''
}

function partitionByOwnership<T>(
  items: T[],
  resolve: (item: T) => ShopOwnershipVerdict,
  pickLiveAccountName: (item: T) => string | null | undefined,
): OwnershipPartition<T> {
  if (items.length === 0) {
    return {
      mergeable: [],
      contaminated: [],
      allMismatch: false,
      hasMatch: false,
      unknownCount: 0,
    }
  }
  const matched: T[] = []
  const unknown: Array<{ item: T; verdict: ShopOwnershipVerdict }> = []
  const contaminated: T[] = []
  for (const item of items) {
    const v = resolve(item)
    if (v.status === 'match') matched.push(item)
    else if (v.status === 'mismatch') contaminated.push(item)
    else unknown.push({ item, verdict: v })
  }
  const hasMatch = matched.length > 0
  if (hasMatch) {
    // 有 MATCH：剔除全部 MISMATCH；同店 UNKNOWN 保留（兼容缺 sellerId 的多 SKU）；异店 UNKNOWN 不并入
    const matchIds = new Set(
      matched
        .map((m) => ownershipShopIdentity(resolve(m), pickLiveAccountName(m)))
        .filter(Boolean),
    )
    const unknownSameShop = unknown
      .filter((u) => {
        const id = ownershipShopIdentity(u.verdict, pickLiveAccountName(u.item))
        return id !== '' && matchIds.has(id)
      })
      .map((u) => u.item)
    return {
      mergeable: [...matched, ...unknownSameShop],
      contaminated,
      allMismatch: false,
      hasMatch: true,
      unknownCount: unknown.length,
    }
  }
  if (contaminated.length === items.length) {
    return {
      mergeable: [],
      contaminated,
      allMismatch: true,
      hasMatch: false,
      unknownCount: 0,
    }
  }
  // 无 MATCH：保留 UNKNOWN 兼容；明确 MISMATCH 仍剔除
  return {
    mergeable: unknown.map((u) => u.item),
    contaminated,
    allMismatch: false,
    hasMatch: false,
    unknownCount: unknown.length,
  }
}

export function partitionOrdersByShopOwnership(
  orders: NormalizedOrder[],
): OwnershipPartition<NormalizedOrder> {
  return partitionByOwnership(
    orders,
    resolveNormalizedOrderShopOwnership,
    (o) => o.liveAccountName,
  )
}

export function partitionViewsByShopOwnership(
  views: AnalyzedOrderView[],
): OwnershipPartition<AnalyzedOrderView> {
  return partitionByOwnership(views, resolveViewShopOwnership, (v) => v.liveAccountName)
}

/** 过滤后可合并行；全部 MISMATCH 返回空（不得进错误店） */
export function preferOrdersBySellerOwnership(orders: NormalizedOrder[]): NormalizedOrder[] {
  const part = partitionOrdersByShopOwnership(orders)
  if (part.mergeable.length > 0) return part.mergeable
  if (part.allMismatch || part.contaminated.length > 0) return []
  return orders
}

/** 看板视图：过滤 MISMATCH；有 MATCH 时只留真店(+同店 UNKNOWN)；全部 MISMATCH → 空 */
export function preferViewsBySellerOwnership(views: AnalyzedOrderView[]): AnalyzedOrderView[] {
  const part = partitionViewsByShopOwnership(views)
  if (part.mergeable.length > 0) return part.mergeable
  if (part.allMismatch || part.contaminated.length > 0) return []
  return views
}

/**
 * 清理脚本用：是否应删除该行（仅明确 MISMATCH）。
 * 覆盖 packageId / orderId-only；UNKNOWN 不删。
 */
export function shouldDeleteContaminatedOrderRow(params: {
  sellerId?: string | null
  liveAccountName?: string | null
  platformName?: string | null
  raw?: Record<string, unknown> | null
}): boolean {
  const verdict = resolveOrderShopOwnership(params)
  return (
    verdict.status === 'mismatch' &&
    verdict.ownerShopKey != null &&
    verdict.syncShopKey != null
  )
}

/** 看板挂载 raw 时补齐 sellerId，避免旧缓存 View 缺字段导致归属失效 */
export function attachOrderRawToView<T extends AnalyzedOrderView>(
  view: T,
  raw: Record<string, unknown> | null | undefined,
): T & { raw?: Record<string, unknown> } {
  const sellerId =
    String(view.sellerId ?? '').trim() || extractSellerIdFromOrderRaw(raw) || undefined
  return Object.assign({}, view, {
    raw: raw ?? undefined,
    sellerId: sellerId || undefined,
  }) as T & { raw?: Record<string, unknown> }
}

/** View 是否因明确串店而不得计入正常指标 */
export function isCrossShopContaminatedView(view: AnalyzedOrderView): boolean {
  return resolveViewShopOwnership(view).status === 'mismatch'
}

/** 过滤明确串店 View（UNKNOWN 保留） */
export function filterOutCrossShopContaminatedViews(
  views: AnalyzedOrderView[],
): AnalyzedOrderView[] {
  return views.filter((v) => !isCrossShopContaminatedView(v))
}
