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
