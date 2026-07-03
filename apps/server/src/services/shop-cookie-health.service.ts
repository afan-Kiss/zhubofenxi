import type { GoodReviewShopKey } from '../config/good-review-shops.constants'
import {
  GOOD_REVIEW_SHOPS,
  getGoodReviewShopName,
} from '../config/good-review-shops.constants'
import type { QianfanShopName } from '../config/qianfan-shops.constants'
import { decryptText } from '../utils/crypto'
import { cookieContainsA1 } from '../utils/cookie-sync-status.util'
import { logWarn } from '../utils/server-log'
import {
  resolveOfficialShopAccountForStatus,
  type PlatformCredentialRow,
} from './official-shop-account.service'

export type ShopCookieHealthStatus =
  | 'ok'
  | 'missing'
  | 'incomplete'
  | 'stale'
  | 'invalid'
  | 'unknown'

export type ShopCookieHealthSource = 'cache' | 'structural' | 'live_probe' | 'db_status'

export interface ShopCookieHealthResult {
  shopCode: GoodReviewShopKey
  shopName: QianfanShopName
  displayName: QianfanShopName
  status: ShopCookieHealthStatus
  ok: boolean
  checkedAt: string | null
  updatedAt: string | null
  reason: string
  failedEndpoint: string | null
  httpStatus: number | null
  hasCookie: boolean
  hasArkToken: boolean
  hasSellerToken: boolean
  hasA1: boolean
  source: ShopCookieHealthSource
  accountId: string | null
}

const CACHE_TTL_MS = 5 * 60_000

const healthCache = new Map<
  GoodReviewShopKey,
  { result: ShopCookieHealthResult; cachedAt: number }
>()

function readPlainCookie(row: PlatformCredentialRow | null): string | null {
  if (!row?.cookieEncrypted?.trim()) return null
  try {
    const plain = decryptText(row.cookieEncrypted).trim()
    return plain || null
  } catch {
    const trimmed = row.cookieEncrypted.trim()
    if (trimmed.includes(';') || trimmed.includes('=')) return trimmed
    return null
  }
}

export function cookieHasArkToken(cookie: string): boolean {
  return /(?:^|;\s*)access-token-ark(?:\.xiaohongshu\.com)?=/i.test(cookie.trim())
}

export function cookieHasSellerToken(cookie: string): boolean {
  return /(?:^|;\s*)access-token(?:\.xiaohongshu\.com)?=/i.test(cookie.trim())
}

function mapDbStatusToHealth(
  row: PlatformCredentialRow,
  plain: string,
  shopKey: GoodReviewShopKey,
  shopName: QianfanShopName,
): ShopCookieHealthResult {
  const checkedAt = row.cookieLastCheckedAt?.toISOString() ?? null
  const updatedAt = row.updatedAt.toISOString()
  const base = {
    shopCode: shopKey,
    shopName,
    displayName: shopName,
    checkedAt,
    updatedAt,
    hasCookie: true,
    hasA1: cookieContainsA1(plain),
    hasArkToken: cookieHasArkToken(plain),
    hasSellerToken: cookieHasSellerToken(plain),
    accountId: row.id,
    httpStatus: null as number | null,
    failedEndpoint: row.cookieLastFailedApi ?? null,
  }

  if (row.cookieStatus === 'valid') {
    return {
      ...base,
      status: 'ok',
      ok: true,
      reason: row.cookieLastCheckedAt ? '校验通过' : '已收到 Cookie',
      source: 'db_status',
    }
  }

  if (row.cookieStatus === 'unknown') {
    if (cookieContainsA1(plain)) {
      return {
        ...base,
        status: 'ok',
        ok: true,
        reason: '已收到 Cookie',
        source: 'db_status',
      }
    }
    return {
      ...base,
      status: 'incomplete',
      ok: false,
      reason: 'Cookie 缺少 a1，请重新推送完整 Cookie',
      source: 'db_status',
    }
  }

  const msg = row.cookieLastErrorMessage?.trim() || '真实接口访问失败'
  return {
    ...base,
    status: 'invalid',
    ok: false,
    reason: msg.includes('401') || msg.includes('403') || /过期|未登录/i.test(msg)
      ? '登录状态校验失败，可能需要重新推送 Cookie'
      : `系统已检测到 Cookie，但真实接口访问失败：${msg}`,
    source: 'db_status',
  }
}

function buildStructuralHealth(
  shopKey: GoodReviewShopKey,
  shopName: QianfanShopName,
  row: PlatformCredentialRow | null,
  plain: string | null,
): ShopCookieHealthResult | null {
  const updatedAt = row?.updatedAt.toISOString() ?? null
  const checkedAt = row?.cookieLastCheckedAt?.toISOString() ?? null
  const base = {
    shopCode: shopKey,
    shopName,
    displayName: shopName,
    checkedAt,
    updatedAt,
    accountId: row?.id ?? null,
    httpStatus: null as number | null,
    failedEndpoint: null as string | null,
  }

  if (!row?.cookieEncrypted?.trim() || !plain) {
    return {
      ...base,
      status: 'missing',
      ok: false,
      reason: '尚未收到 Cookie，请推送或粘贴完整 Cookie',
      hasCookie: false,
      hasA1: false,
      hasArkToken: false,
      hasSellerToken: false,
      source: 'structural',
    }
  }

  const hasA1 = cookieContainsA1(plain)
  const hasArkToken = cookieHasArkToken(plain)
  const hasSellerToken = cookieHasSellerToken(plain)

  if (!hasA1 || !hasArkToken) {
    const parts: string[] = []
    if (!hasA1) parts.push('缺少 a1')
    if (!hasArkToken) parts.push('缺少 access-token-ark')
    return {
      ...base,
      status: 'incomplete',
      ok: false,
      reason: `Cookie 不完整（${parts.join('、')}），请重新推送完整 Cookie`,
      hasCookie: true,
      hasA1,
      hasArkToken,
      hasSellerToken,
      source: 'structural',
    }
  }

  return null
}

function logUnhealthyShop(health: ShopCookieHealthResult): void {
  if (health.ok) return
  logWarn(
    'Cookie健康检查',
    JSON.stringify({
      shopCode: health.shopCode,
      shopName: health.shopName,
      source: health.source,
      reason: health.reason,
      status: health.status,
    }),
  )
}

export function clearShopCookieHealthCache(shopKey?: GoodReviewShopKey): void {
  if (shopKey) {
    healthCache.delete(shopKey)
    return
  }
  healthCache.clear()
}

export function isCookieHealthBlocking(status: ShopCookieHealthStatus): boolean {
  return status === 'missing' || status === 'incomplete' || status === 'invalid'
}

/** 四店 Cookie 状态（仅读库 + 结构检查，不主动调平台接口；真实探测仅 settings 页「检测」） */
export async function getShopCookieHealth(
  shopKey: GoodReviewShopKey,
  _options?: { fresh?: boolean },
): Promise<ShopCookieHealthResult> {
  const shopName = getGoodReviewShopName(shopKey)

  const cached = healthCache.get(shopKey)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    const rowForCache = await resolveOfficialShopAccountForStatus(shopKey)
    const dbUpdatedMs = rowForCache?.updatedAt.getTime() ?? 0
    const cachedUpdatedMs = cached.result.updatedAt ? Date.parse(cached.result.updatedAt) : 0
    if (!dbUpdatedMs || dbUpdatedMs <= cachedUpdatedMs) {
      return { ...cached.result, source: 'cache' }
    }
    healthCache.delete(shopKey)
  }

  const row = await resolveOfficialShopAccountForStatus(shopKey)
  const plain = readPlainCookie(row)

  const structural = buildStructuralHealth(shopKey, shopName, row, plain)
  if (structural && (structural.status === 'missing' || structural.status === 'incomplete')) {
    logUnhealthyShop(structural)
    healthCache.set(shopKey, { result: structural, cachedAt: Date.now() })
    return structural
  }

  if (!row || !plain) {
    const missing = buildStructuralHealth(shopKey, shopName, row, plain)!
    logUnhealthyShop(missing)
    healthCache.set(shopKey, { result: missing, cachedAt: Date.now() })
    return missing
  }

  const fromDb = mapDbStatusToHealth(row, plain, shopKey, shopName)
  healthCache.set(shopKey, { result: fromDb, cachedAt: Date.now() })
  if (!fromDb.ok) logUnhealthyShop(fromDb)
  return fromDb
}

export async function getAllShopCookieHealth(options?: {
  fresh?: boolean
}): Promise<ShopCookieHealthResult[]> {
  return Promise.all(GOOD_REVIEW_SHOPS.map((def) => getShopCookieHealth(def.shopKey, options)))
}

export async function getShopCookieHealthPayload(options?: { fresh?: boolean }): Promise<{
  ok: true
  checkedAt: string
  fresh: boolean
  shops: ShopCookieHealthResult[]
  shopsByKey: Record<string, ShopCookieHealthResult>
}> {
  const shops = await getAllShopCookieHealth(options)
  const shopsByKey: Record<string, ShopCookieHealthResult> = {}
  for (const shop of shops) shopsByKey[shop.shopCode] = shop
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    fresh: options?.fresh === true,
    shops,
    shopsByKey,
  }
}
