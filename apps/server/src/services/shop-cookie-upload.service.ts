import { prisma } from '../lib/prisma'
import { decryptText, encryptText } from '../utils/crypto'
import { getShopCookieUploadToken } from '../config/env'
import { resolveCanonicalShopName } from '../config/qianfan-shops.constants'
import {
  GOOD_REVIEW_SHOPS,
  getGoodReviewShopName,
  resolveGoodReviewShopKey,
  type GoodReviewShopKey,
} from '../config/good-review-shops.constants'
import {
  persistLiveAccountCookieOnly,
  refreshLiveAccountRowMapperContext,
  testLiveAccountCookie,
} from './live-account.service'
import { clearSessionCookieCache } from './qianfan-cookie-resolver.service'
import { logInfo } from '../utils/server-log'
import {
  buildShopCookieSummary,
  deriveCookieSyncState,
  type ShopCookieStatusSummary,
} from '../utils/cookie-sync-status.util'

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

function cookieContainsA1(cookie: string): boolean {
  return /(?:^|;\s*)a1=[^;]+/i.test(cookie.trim())
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

function buildCookieReason(row: {
  cookieEncrypted: string | null
  cookieStatus: string
  cookieLastCheckedAt: Date | null
  cookieLastErrorMessage: string | null
  cookieLastErrorCode: string | null
  updatedAt: Date
} | null): ReturnType<typeof deriveCookieSyncState> {
  return deriveCookieSyncState(row)
}

async function findAccountIdForShop(shopKey: GoodReviewShopKey): Promise<string | null> {
  const shopName = getGoodReviewShopName(shopKey)
  const targetCanonical = resolveCanonicalShopName(shopName)
  if (!targetCanonical) return null

  const rows = await prisma.platformCredential.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  })
  for (const row of rows) {
    const name = row.displayName?.trim() || row.platformName
    if (resolveCanonicalShopName(name) === targetCanonical) {
      return row.id
    }
  }
  return null
}

async function ensureAccountForShop(
  shopKey: GoodReviewShopKey,
  cookie: string,
  updatedBy: string,
): Promise<string> {
  const existingId = await findAccountIdForShop(shopKey)
  if (existingId) return existingId

  const shopName = getGoodReviewShopName(shopKey)
  const row = await prisma.platformCredential.create({
    data: {
      platformName: shopKey,
      displayName: shopName,
      cookieEncrypted: encryptText(cookie),
      enabled: true,
      updatedBy,
      cookieStatus: 'unknown',
    },
  })
  void testLiveAccountCookie(row.id).catch(() => undefined)
  return row.id
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
      let accountId = await findAccountIdForShop(item.shopKey)
      if (!accountId) {
        accountId = await ensureAccountForShop(item.shopKey, item.cookie, params.updatedBy)
      } else {
        await persistLiveAccountCookieOnly(accountId, item.cookie, params.updatedBy)
        void testLiveAccountCookie(accountId).catch(() => undefined)
      }

      const row = await prisma.platformCredential.findUnique({ where: { id: accountId } })
      let savedContainsA1 = false
      if (row?.cookieEncrypted?.trim()) {
        try {
          savedContainsA1 = cookieContainsA1(decryptText(row.cookieEncrypted))
        } catch {
          savedContainsA1 = cookieContainsA1(row.cookieEncrypted)
        }
      }

      logInfo(
        'Cookie上传诊断',
        `${shopName} field=${item.fieldUsed ?? '-'} receivedA1=${receivedContainsA1} savedA1=${savedContainsA1} len=${receivedCookieLength} accountId=${accountId}`,
      )

      results.push({
        ...baseDiag,
        success: true,
        accountId,
        savedAccountId: accountId,
        savedAt: row?.updatedAt?.toISOString() ?? new Date().toISOString(),
        savedContainsA1,
        cookiePreview: row?.cookieEncrypted ? maskCookiePreview(item.cookie) : null,
        cookieStatus: row?.cookieStatus ?? 'unknown',
        status: row?.cookieStatus ?? 'uploaded',
      })
      logInfo('Cookie上传', `${shopName} 已落库，状态=${row?.cookieStatus ?? 'unknown'}`)
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
  serverTokenConfigured: boolean
  tokenRequired: false
  shops: ShopCookieStatusItem[]
  shopsByKey: Record<string, ShopCookieStatusItem>
  summary: ShopCookieStatusSummary
  checkedAt: string
}> {
  const rows = await prisma.platformCredential.findMany({ orderBy: { createdAt: 'asc' } })
  const accountByShop = new Map<GoodReviewShopKey, (typeof rows)[number]>()

  for (const row of rows) {
    const name = row.displayName?.trim() || row.platformName
    const canonical = resolveCanonicalShopName(name)
    if (!canonical) continue
    const shopKey = GOOD_REVIEW_SHOPS.find((s) => s.shopName === canonical)?.shopKey
    if (shopKey && !accountByShop.has(shopKey)) {
      accountByShop.set(shopKey, row)
    }
  }

  const shops = GOOD_REVIEW_SHOPS.map((def) => {
    const row = accountByShop.get(def.shopKey)
    const hasCookie = Boolean(row?.cookieEncrypted?.trim())
    let cookiePreview: string | null = null
    if (hasCookie && row) {
      try {
        const plain = decryptText(row.cookieEncrypted).trim()
        cookiePreview = plain ? maskCookiePreview(plain) : '已保存'
      } catch {
        if (row.cookieEncrypted.includes(';')) {
          cookiePreview = maskCookiePreview(row.cookieEncrypted)
        } else {
          cookiePreview = '已保存'
        }
      }
    }
    const derived = buildCookieReason(row ?? null)
    return {
      shopKey: def.shopKey,
      shopName: def.shopName,
      liveRoomName: def.shopName,
      accountId: row?.id ?? null,
      accountDisplayName: row?.displayName?.trim() || row?.platformName || null,
      hasCookie,
      cookiePreview,
      cookieStatus: row?.cookieStatus ?? 'unknown',
      status: derived.status,
      reason: derived.reason,
      lastUploadAt: hasCookie ? row!.updatedAt.toISOString() : null,
      lastValidateAt: row?.cookieLastCheckedAt?.toISOString() ?? null,
      canSyncOrders: derived.canSyncOrders,
      cookieUpdatedAt: hasCookie ? row!.updatedAt.toISOString() : null,
      statusLevel: derived.statusLevel,
    }
  })

  const summary = buildShopCookieSummary(
    shops.map((s) => ({
      hasCookie: s.hasCookie,
      canSyncOrders: s.canSyncOrders,
      reason: s.reason,
      status: s.status,
      cookieLastErrorCode: accountByShop.get(
        s.shopKey as GoodReviewShopKey,
      )?.cookieLastErrorCode,
    })),
  )

  const shopsByKey: Record<string, ShopCookieStatusItem> = {}
  for (const s of shops) shopsByKey[s.shopKey] = s

  return {
    ok: true,
    serverTokenConfigured: Boolean(getShopCookieUploadToken()),
    tokenRequired: false,
    shops,
    shopsByKey,
    summary,
    checkedAt: new Date().toISOString(),
  }
}
