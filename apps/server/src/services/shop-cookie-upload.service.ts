import { decryptText } from '../utils/crypto'
import { getShopCookieUploadToken } from '../config/env'
import {
  isShopCookieApiUploadEnabled,
  SHOP_COOKIE_API_UPLOAD_DISABLED_MESSAGE,
} from '../config/shop-cookie-api-upload.config'
import {
  GOOD_REVIEW_SHOPS,
  getGoodReviewShopName,
  resolveGoodReviewShopKey,
  type GoodReviewShopKey,
} from '../config/good-review-shops.constants'
import { refreshLiveAccountRowMapperContext } from './live-account.service'
import { clearSessionCookieCache } from './qianfan-cookie-resolver.service'
import { logInfo } from '../utils/server-log'
import {
  buildShopCookieSummary,
  cookieContainsA1,
  deriveCookieSyncState,
  type ShopCookieStatusSummary,
} from '../utils/cookie-sync-status.util'
import {
  clearShopCookieHealthCache,
  type ShopCookieHealthResult,
} from './shop-cookie-health.service'
import {
  resolveOfficialShopAccountForStatus,
  upsertOfficialShopAccountCookie,
} from './official-shop-account.service'

export interface ShopCookieUploadItemResult {
  shopKey: string
  shopName: string
  success: boolean
  accountId?: string
  cookiePreview?: string | null
  cookieStatus?: string
  status?: string
  error?: string
  cookieFieldUsed?: string | null
  receivedCookieLength?: number
  receivedCookieKeyCount?: number
  receivedContainsA1?: boolean
  savedContainsA1?: boolean
  normalizedShopKey?: string
  savedAccountId?: string | null
  savedAt?: string | null
  skipped?: boolean
  skipReason?: string
}

export interface ShopCookieUploadResult {
  ok: boolean
  updatedAt: string
  successCount: number
  failedCount: number
  shops: ShopCookieUploadItemResult[]
}

export interface ShopCookieStatusItem {
  shopKey: string
  shopName: string
  liveRoomName: string
  accountId: string | null
  accountDisplayName: string | null
  hasCookie: boolean
  cookiePreview: string | null
  cookieStatus: string
  status: string
  reason: string
  lastUploadAt: string | null
  lastValidateAt: string | null
  canSyncOrders: boolean
  cookieUpdatedAt: string | null
  statusLevel: 'ok' | 'warning' | 'error'
}

function maskCookiePreview(cookie: string): string {
  const trimmed = cookie.trim()
  if (trimmed.length <= 16) return '已保存'
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-8)}`
}

function extractCookieKeys(cookie: string): string[] {
  const keys: string[] = []
  for (const seg of cookie.split(';')) {
    const piece = seg.trim()
    if (!piece) continue
    const eq = piece.indexOf('=')
    if (eq <= 0) continue
    keys.push(piece.slice(0, eq).trim())
  }
  return [...new Set(keys)].sort()
}

function isGarbageCookieString(cookie: string): boolean {
  const trimmed = cookie.trim()
  if (!trimmed) return true
  if (trimmed === '[object Object]') return true
  if (trimmed === '已保存') return true
  return false
}

/** 从上传项中按优先级提取 Cookie 字符串 */
export function extractCookieFromShopEntry(raw: unknown): {
  cookie: string
  fieldUsed: string | null
} {
  if (typeof raw === 'string') {
    const cookie = raw.trim()
    return { cookie, fieldUsed: cookie ? 'string' : null }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { cookie: '', fieldUsed: null }
  }
  const obj = raw as Record<string, unknown>
  const priorities: Array<[string, unknown]> = [
    ['cookie', obj.cookie],
    ['cookieHeader', obj.cookieHeader],
    ['rawCookie', obj.rawCookie],
    ['cookies', obj.cookies],
  ]
  for (const [field, value] of priorities) {
    if (typeof value === 'string' && value.trim()) {
      return { cookie: value.trim(), fieldUsed: field }
    }
  }
  return { cookie: '', fieldUsed: null }
}

function buildCookieReason(
  row: {
    cookieEncrypted: string | null
    cookieStatus: string
    cookieLastCheckedAt: Date | null
    cookieLastErrorMessage: string | null
    cookieLastErrorCode: string | null
    updatedAt: Date
  } | null,
  plainCookie?: string | null,
): ReturnType<typeof deriveCookieSyncState> {
  return deriveCookieSyncState(row, { plainCookie })
}

function normalizeUploadPayload(raw: unknown): Array<{
  shopKey: GoodReviewShopKey
  cookie: string
  fieldUsed: string | null
}> {
  const items: Array<{ shopKey: GoodReviewShopKey; cookie: string; fieldUsed: string | null }> = []

  if (!raw || typeof raw !== 'object') return items
  const body = raw as Record<string, unknown>

  if (body.shop != null) {
    const key = resolveGoodReviewShopKey(String(body.shop))
    const extracted = extractCookieFromShopEntry({
      cookie: body.cookie,
      cookieHeader: body.cookieHeader,
      rawCookie: body.rawCookie,
      cookies: body.cookies,
    })
    if (key && extracted.cookie) items.push({ shopKey: key, ...extracted })
    return items
  }

  const shops = body.shops
  if (!shops || typeof shops !== 'object' || Array.isArray(shops)) return items

  for (const [rawKey, rawEntry] of Object.entries(shops as Record<string, unknown>)) {
    const key = resolveGoodReviewShopKey(rawKey)
    const extracted = extractCookieFromShopEntry(rawEntry)
    if (!key || !extracted.cookie) continue
    items.push({ shopKey: key, cookie: extracted.cookie, fieldUsed: extracted.fieldUsed })
  }
  return items
}

export async function uploadShopCookies(params: {
  body: unknown
  updatedBy: string
}): Promise<ShopCookieUploadResult> {
  if (!isShopCookieApiUploadEnabled()) {
    throw new Error(SHOP_COOKIE_API_UPLOAD_DISABLED_MESSAGE)
  }
  const items = normalizeUploadPayload(params.body)
  if (items.length === 0) {
    throw new Error('请提供至少一个店铺的 Cookie（shops.shiyuju / shops.hetianyayu / shops.xiangyu / shops.xyxiangyu）')
  }

  const results: ShopCookieUploadItemResult[] = []
  const seen = new Set<GoodReviewShopKey>()

  for (const item of items) {
    if (seen.has(item.shopKey)) continue
    seen.add(item.shopKey)

    const shopName = getGoodReviewShopName(item.shopKey)
    const receivedCookieLength = item.cookie.length
    const receivedCookieKeyCount = extractCookieKeys(item.cookie).length
    const receivedContainsA1 = cookieContainsA1(item.cookie)
    const baseDiag = {
      shopKey: item.shopKey,
      shopName,
      normalizedShopKey: item.shopKey,
      cookieFieldUsed: item.fieldUsed,
      receivedCookieLength,
      receivedCookieKeyCount,
      receivedContainsA1,
    }

    if (isGarbageCookieString(item.cookie)) {
      logInfo(
        'Cookie上传诊断',
        `${shopName} 收到无效 Cookie 字符串 field=${item.fieldUsed ?? '-'} len=${receivedCookieLength} containsA1=${receivedContainsA1}`,
      )
      results.push({
        ...baseDiag,
        success: false,
        skipped: true,
        skipReason: 'invalid_cookie_string',
        savedContainsA1: false,
        error: '收到的 Cookie 不是有效字符串（可能 payload 字段解析错误）',
        status: 'rejected',
      })
      continue
    }

    if (!receivedContainsA1) {
      logInfo(
        'Cookie上传诊断',
        `${shopName} 收到 Cookie 缺少 a1，跳过落库 field=${item.fieldUsed ?? '-'} keys=${receivedCookieKeyCount}`,
      )
      results.push({
        ...baseDiag,
        success: false,
        skipped: true,
        skipReason: 'missing_a1',
        savedContainsA1: false,
        error: '收到的 Cookie 缺少 a1，未覆盖已有记录',
        status: 'rejected',
      })
      continue
    }

    try {
      const saved = await upsertOfficialShopAccountCookie(
        item.shopKey,
        item.cookie,
        params.updatedBy,
      )

      logInfo(
        'Cookie上传诊断',
        `${shopName} field=${item.fieldUsed ?? '-'} receivedA1=${receivedContainsA1} savedA1=${saved.savedContainsA1} len=${receivedCookieLength} accountId=${saved.savedAccountId} official=${saved.createdOfficial ? 'created' : 'updated'}`,
      )

      results.push({
        ...baseDiag,
        success: true,
        accountId: saved.savedAccountId,
        savedAccountId: saved.savedAccountId,
        savedAt: saved.account.updatedAt?.toISOString() ?? new Date().toISOString(),
        savedContainsA1: saved.savedContainsA1,
        cookiePreview: saved.cookiePreview,
        cookieStatus: saved.cookieStatus,
        status: saved.status,
      })
      logInfo('Cookie上传', `${shopName} 已落库官方账号 ${saved.savedAccountId}，状态=${saved.cookieStatus}`)
    } catch (err) {
      results.push({
        ...baseDiag,
        success: false,
        savedContainsA1: false,
        error: err instanceof Error ? err.message : String(err),
        status: 'failed',
      })
    }
  }

  clearSessionCookieCache()
  clearShopCookieHealthCache()
  await refreshLiveAccountRowMapperContext()

  const successCount = results.filter((r) => r.success).length
  return {
    ok: successCount > 0,
    updatedAt: new Date().toISOString(),
    successCount,
    failedCount: results.length - successCount,
    shops: results,
  }
}

export async function getShopCookieStatus(): Promise<ShopCookieStatusItem[]> {
  const payload = await getShopCookieStatusPayload()
  return payload.shops
}

export async function getShopCookieStatusPayload(): Promise<{
  ok: true
  apiUploadEnabled: boolean
  serverTokenConfigured: boolean
  tokenRequired: false
  shops: ShopCookieStatusItem[]
  shopsByKey: Record<string, ShopCookieStatusItem>
  summary: ShopCookieStatusSummary
  checkedAt: string
  health?: ShopCookieHealthResult[]
}> {
  const healthPayload = await import('./shop-cookie-health.service').then((m) =>
    m.getShopCookieHealthPayload({ fresh: false }),
  )
  const shops: ShopCookieStatusItem[] = healthPayload.shops.map((health) => ({
    shopKey: health.shopCode,
    shopName: health.shopName,
    liveRoomName: health.shopName,
    accountId: health.accountId,
    accountDisplayName: health.displayName,
    hasCookie: health.hasCookie,
    cookiePreview: health.hasCookie ? '已保存' : null,
    cookieStatus: health.status === 'ok' ? 'valid' : health.status === 'unknown' ? 'unknown' : 'invalid',
    status: health.status,
    reason: health.reason,
    lastUploadAt: health.updatedAt,
    lastValidateAt: health.checkedAt,
    canSyncOrders: health.ok,
    cookieUpdatedAt: health.updatedAt,
    statusLevel: health.ok ? 'ok' : health.status === 'unknown' ? 'warning' : 'error',
  }))

  const summary = buildShopCookieSummary(
    shops.map((s) => ({
      hasCookie: s.hasCookie,
      canSyncOrders: s.canSyncOrders,
      reason: s.reason,
      status: s.status,
      cookieLastErrorCode: null,
    })),
  )

  const shopsByKey: Record<string, ShopCookieStatusItem> = {}
  for (const s of shops) shopsByKey[s.shopKey] = s

  return {
    ok: true,
    apiUploadEnabled: isShopCookieApiUploadEnabled(),
    serverTokenConfigured: Boolean(getShopCookieUploadToken()),
    tokenRequired: false,
    shops,
    shopsByKey,
    summary,
    checkedAt: healthPayload.checkedAt,
    health: healthPayload.shops,
  }
}

export {
  resolveOfficialShopAccount,
  resolveOfficialShopAccountForStatus,
  ensureOfficialShopAccount,
  upsertOfficialShopAccountCookie,
  isOfficialShopPlatformName,
  findLegacyDuplicateShopAccounts,
} from './official-shop-account.service'
