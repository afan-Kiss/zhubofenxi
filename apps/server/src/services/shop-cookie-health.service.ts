import type { GoodReviewShopKey } from '../config/good-review-shops.constants'
import {
  GOOD_REVIEW_SHOPS,
  getGoodReviewShopName,
} from '../config/good-review-shops.constants'
import type { QianfanShopName } from '../config/qianfan-shops.constants'
import { decryptText } from '../utils/crypto'
import { cookieContainsA1 } from '../utils/cookie-sync-status.util'
import { logInfo, logWarn } from '../utils/server-log'
import {
  resolveOfficialShopAccountForStatus,
  type PlatformCredentialRow,
} from './official-shop-account.service'
import { testLiveAccountCookie } from './live-account.service'

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
const STALE_AFTER_MS = 7 * 24 * 60 * 60_000

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
      reason: '校验通过',
      source: 'db_status',
    }
  }

  if (row.cookieStatus === 'unknown') {
    return {
      ...base,
      status: 'unknown',
      ok: false,
      reason: '正在校验 Cookie',
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

  const lastCheckedMs = row.cookieLastCheckedAt?.getTime() ?? 0
  const updatedMs = row.updatedAt.getTime()
  const now = Date.now()
  if (
    row.cookieStatus !== 'valid' &&
    lastCheckedMs > 0 &&
    now - lastCheckedMs > STALE_AFTER_MS &&
    now - updatedMs > STALE_AFTER_MS
  ) {
    return {
      ...base,
      status: 'stale',
      ok: false,
      reason: 'Cookie 太久未校验，建议重新推送或点击检测',
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
  if (health.ok || health.status === 'unknown') return
  logWarn(
    'Cookie健康检查',
    JSON.stringify({
      shopCode: health.shopCode,
      shopName: health.shopName,
      source: health.source,
      failedEndpoint: health.failedEndpoint,
      httpStatus: health.httpStatus,
      reason: health.reason,
      checkedAt: health.checkedAt,
      status: health.status,
    }),
  )
}

async function probeLiveHealth(
  shopKey: GoodReviewShopKey,
  shopName: QianfanShopName,
  row: PlatformCredentialRow,
  plain: string,
): Promise<ShopCookieHealthResult> {
  const probe = await testLiveAccountCookie(row.id)
  const checkedAt = new Date().toISOString()
  const base = {
    shopCode: shopKey,
    shopName,
    displayName: shopName,
    checkedAt,
    updatedAt: row.updatedAt.toISOString(),
    hasCookie: true,
    hasA1: cookieContainsA1(plain),
    hasArkToken: cookieHasArkToken(plain),
    hasSellerToken: cookieHasSellerToken(plain),
    accountId: row.id,
    failedEndpoint: probe.ok ? null : 'order_list',
    httpStatus: null as number | null,
    source: 'live_probe' as const,
  }

  if (probe.ok) {
    logInfo('Cookie健康检查', `${shopName}(${shopKey}) 真实接口探测通过`)
    return {
      ...base,
      status: 'ok',
      ok: true,
      reason: '校验通过',
    }
  }

  const health: ShopCookieHealthResult = {
    ...base,
    status: 'invalid',
    ok: false,
    reason:
      probe.errorCode === '401' || probe.errorCode === '403' || /401|403|过期|未登录/i.test(probe.message)
        ? '登录状态校验失败，可能需要重新推送 Cookie'
        : `系统已检测到 Cookie，但真实接口访问失败：${probe.message}`,
  }
  logUnhealthyShop(health)
  return health
}

export function clearShopCookieHealthCache(shopKey?: GoodReviewShopKey): void {
  if (shopKey) {
    healthCache.delete(shopKey)
    return
  }
  healthCache.clear()
}

export function isCookieHealthBlocking(status: ShopCookieHealthStatus): boolean {
  return status === 'missing' || status === 'incomplete' || status === 'invalid' || status === 'stale'
}

/** 四店 Cookie 唯一健康检查入口 */
export async function getShopCookieHealth(
  shopKey: GoodReviewShopKey,
  options?: { fresh?: boolean },
): Promise<ShopCookieHealthResult> {
  const shopName = getGoodReviewShopName(shopKey)
  const fresh = options?.fresh === true

  if (!fresh) {
    const cached = healthCache.get(shopKey)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      const rowForCache = await resolveOfficialShopAccountForStatus(shopKey)
      const dbCheckedMs = rowForCache?.cookieLastCheckedAt?.getTime() ?? 0
      const cachedCheckedMs = cached.result.checkedAt
        ? Date.parse(cached.result.checkedAt)
        : 0
      if (!dbCheckedMs || dbCheckedMs <= cachedCheckedMs) {
        return { ...cached.result, source: 'cache' }
      }
      healthCache.delete(shopKey)
    }
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

  if (fresh) {
    const probed = await probeLiveHealth(shopKey, shopName, row, plain)
    healthCache.set(shopKey, { result: probed, cachedAt: Date.now() })
    return probed
  }

  const lastCheckedMs = row.cookieLastCheckedAt?.getTime() ?? 0
  const cacheFresh = lastCheckedMs > 0 && Date.now() - lastCheckedMs < CACHE_TTL_MS

  if (cacheFresh) {
    const fromDb = mapDbStatusToHealth(row, plain, shopKey, shopName)
    if (fromDb.status !== 'unknown' || row.cookieStatus === 'unknown') {
      healthCache.set(shopKey, { result: fromDb, cachedAt: Date.now() })
      if (!fromDb.ok) logUnhealthyShop(fromDb)
      return fromDb
    }
  }

  if (structural?.status === 'stale') {
    logUnhealthyShop(structural)
    healthCache.set(shopKey, { result: structural, cachedAt: Date.now() })
    return structural
  }

  const unknown: ShopCookieHealthResult = {
    shopCode: shopKey,
    shopName,
    displayName: shopName,
    status: 'unknown',
    ok: false,
    checkedAt: row.cookieLastCheckedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    reason: '正在校验 Cookie',
    failedEndpoint: null,
    httpStatus: null,
    hasCookie: true,
    hasA1: cookieContainsA1(plain),
    hasArkToken: cookieHasArkToken(plain),
    hasSellerToken: cookieHasSellerToken(plain),
    source: 'db_status',
    accountId: row.id,
  }
  healthCache.set(shopKey, { result: unknown, cachedAt: Date.now() })
  return unknown
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
