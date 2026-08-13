/**
 * 同步账号 -> 官方 shopKey：稳定身份优先（liveAccountId / PlatformCredential），名称最后兜底。
 * 每个同步账号最多查一次 PlatformCredential（禁止按订单循环查询）。
 */
import { prisma } from '../lib/prisma'
import {
  resolveGoodReviewShopKey,
  type GoodReviewShopKey,
} from '../config/good-review-shops.constants'

export type SyncShopIdentitySource =
  | 'platform_credential'
  | 'platform_name'
  | 'live_account_name'
  | 'unknown'

export interface SyncShopIdentity {
  shopKey: GoodReviewShopKey | null
  source: SyncShopIdentitySource
  liveAccountId: string
  liveAccountName: string
  /** PlatformCredential.platformName（若已查到） */
  credentialPlatformName: string | null
}

/** sellerId 未知比例告警阈值（常量，勿散落魔法数） */
export const UNKNOWN_SELLER_WARN_RATE = 0.2
export const UNKNOWN_SELLER_WARN_MIN_COUNT = 20

export function computeUnknownSellerRate(unknownSellerCount: number, itemCount: number): number {
  if (!Number.isFinite(unknownSellerCount) || !Number.isFinite(itemCount) || itemCount <= 0) {
    return 0
  }
  return unknownSellerCount / itemCount
}

export function isUnknownSellerRateDegraded(
  unknownSellerCount: number,
  itemCount: number,
): boolean {
  return (
    unknownSellerCount >= UNKNOWN_SELLER_WARN_MIN_COUNT &&
    computeUnknownSellerRate(unknownSellerCount, itemCount) >= UNKNOWN_SELLER_WARN_RATE
  )
}

/** 订单同步跨店归属诊断（各层 return 统一复用，避免字段蒸发） */
export interface OrderOwnershipSyncDiagnostics {
  matchedCount: number
  crossShopSkippedCount: number
  unknownSellerCount: number
  unknownSellerRate: number
  /**
   * 处于「同步店未知」环境下处理的订单数。
   * 账号 shopKey 无法识别时 = itemCount；否则为订单级 unknown_sync_shop 计数。
   */
  unknownSyncShopCount: number
  resolvedSyncShopKey: string | null
  syncShopIdentitySource: SyncShopIdentitySource
  /** 当前账号本身无法识别官方 shopKey */
  syncShopUnknown: boolean
  ownershipDegraded: boolean
}

export function buildOwnershipSyncSummary(params: {
  itemCount: number
  matchedCount: number
  crossShopSkippedCount: number
  unknownSellerCount: number
  /** 订单级 status===unknown_sync_shop 计数（可与 unknown_seller 重叠统计维度不同） */
  orderLevelUnknownSyncShopCount: number
  syncIdentity: Pick<SyncShopIdentity, 'shopKey' | 'source'>
}): OrderOwnershipSyncDiagnostics {
  const syncShopUnknown = !params.syncIdentity.shopKey
  const unknownSellerRate = computeUnknownSellerRate(params.unknownSellerCount, params.itemCount)
  const unknownSyncShopCount = syncShopUnknown
    ? Math.max(0, params.itemCount)
    : Math.max(0, params.orderLevelUnknownSyncShopCount)
  const ownershipDegraded =
    syncShopUnknown || isUnknownSellerRateDegraded(params.unknownSellerCount, params.itemCount)
  return {
    matchedCount: params.matchedCount,
    crossShopSkippedCount: params.crossShopSkippedCount,
    unknownSellerCount: params.unknownSellerCount,
    unknownSellerRate,
    unknownSyncShopCount,
    resolvedSyncShopKey: params.syncIdentity.shopKey,
    syncShopIdentitySource: params.syncIdentity.source,
    syncShopUnknown,
    ownershipDegraded,
  }
}

/** 空诊断（未配置接口 / 未开始拉单） */
export function emptyOwnershipSyncSummary(
  syncIdentity?: Pick<SyncShopIdentity, 'shopKey' | 'source'> | null,
): OrderOwnershipSyncDiagnostics {
  return buildOwnershipSyncSummary({
    itemCount: 0,
    matchedCount: 0,
    crossShopSkippedCount: 0,
    unknownSellerCount: 0,
    orderLevelUnknownSyncShopCount: 0,
    syncIdentity: syncIdentity ?? { shopKey: null, source: 'unknown' },
  })
}

/** 汇总账号级 warning（不刷屏）；已有同文案则不重复追加 */
export function appendOwnershipSyncWarnings(
  warnings: string[],
  diag: OrderOwnershipSyncDiagnostics,
  itemCount: number,
): void {
  const has = (fragment: string) => warnings.some((w) => w.includes(fragment))
  if (diag.syncShopUnknown && !has('跨店保护已降级为兼容模式')) {
    warnings.push('当前同步账号无法识别官方店铺归属，跨店保护已降级为兼容模式')
  }
  if (diag.unknownSellerCount > 0 && !has('sellerId 无法识别，已按兼容模式保存')) {
    warnings.push(
      `发现 ${diag.unknownSellerCount} 条订单 sellerId 无法识别，已按兼容模式保存，请检查平台 sellerId 字段是否变化`,
    )
  }
  if (
    isUnknownSellerRateDegraded(diag.unknownSellerCount, itemCount) &&
    !has('sellerId 无法识别比例异常')
  ) {
    warnings.push(
      `sellerId 无法识别比例异常（${diag.unknownSellerCount}/${itemCount}=${(diag.unknownSellerRate * 100).toFixed(1)}%），本次订单归属保护可能降级，请检查平台字段是否变化`,
    )
  }
  if (diag.crossShopSkippedCount > 0 && !has('跨店拦截')) {
    warnings.push(`跨店拦截 ${diag.crossShopSkippedCount} 条（sellerId 归属其他官方店，未写入本店）`)
  }
}

/**
 * 纯函数：在已知 credentialPlatformName / platformName / liveAccountName 时解析 shopKey。
 * 优先级：credentialPlatformName → platformName → liveAccountName。
 */
export function resolveSyncShopIdentityFromFields(params: {
  liveAccountId?: string | null
  liveAccountName?: string | null
  credentialPlatformName?: string | null
  platformName?: string | null
}): SyncShopIdentity {
  const liveAccountId = String(params.liveAccountId ?? '').trim() || 'legacy'
  const liveAccountName = String(params.liveAccountName ?? '').trim()
  const credentialPlatformName = String(params.credentialPlatformName ?? '').trim() || null
  const platformName = String(params.platformName ?? '').trim() || null

  if (credentialPlatformName) {
    const key = resolveGoodReviewShopKey(credentialPlatformName)
    if (key) {
      return {
        shopKey: key,
        source: 'platform_credential',
        liveAccountId,
        liveAccountName,
        credentialPlatformName,
      }
    }
  }

  if (platformName) {
    const key = resolveGoodReviewShopKey(platformName)
    if (key) {
      return {
        shopKey: key,
        source: 'platform_name',
        liveAccountId,
        liveAccountName,
        credentialPlatformName,
      }
    }
  }

  if (liveAccountName) {
    const key = resolveGoodReviewShopKey(liveAccountName)
    if (key) {
      return {
        shopKey: key,
        source: 'live_account_name',
        liveAccountId,
        liveAccountName,
        credentialPlatformName,
      }
    }
  }

  return {
    shopKey: null,
    source: 'unknown',
    liveAccountId,
    liveAccountName,
    credentialPlatformName,
  }
}

/**
 * 异步：按 liveAccountId 最多查一次 PlatformCredential，再解析 shopKey。
 */
export async function loadSyncShopIdentity(params: {
  liveAccountId?: string | null
  liveAccountName?: string | null
  platformName?: string | null
}): Promise<SyncShopIdentity> {
  const liveAccountId = String(params.liveAccountId ?? '').trim() || 'legacy'
  let credentialPlatformName: string | null = null

  if (liveAccountId && liveAccountId !== 'legacy') {
    const row = await prisma.platformCredential.findUnique({
      where: { id: liveAccountId },
      select: { platformName: true },
    })
    if (row?.platformName?.trim()) {
      credentialPlatformName = row.platformName.trim()
    }
  }

  return resolveSyncShopIdentityFromFields({
    liveAccountId,
    liveAccountName: params.liveAccountName,
    credentialPlatformName,
    platformName: params.platformName,
  })
}
