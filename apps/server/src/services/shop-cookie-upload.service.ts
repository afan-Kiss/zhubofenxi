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

export interface ShopCookieUploadItemResult {
  shopKey: string
  shopName: string
  success: boolean
  accountId?: string
  cookiePreview?: string | null
  cookieStatus?: string
  error?: string
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
}

function maskCookiePreview(cookie: string): string {
  const trimmed = cookie.trim()
  if (trimmed.length <= 16) return '已保存'
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-8)}`
}

function buildCookieReason(row: {
  cookieEncrypted: string | null
  cookieStatus: string
  cookieLastCheckedAt: Date | null
  cookieLastErrorMessage: string | null
  cookieLastErrorCode: string | null
  updatedAt: Date
} | null): { status: string; reason: string; canSyncOrders: boolean } {
  if (!row?.cookieEncrypted?.trim()) {
    return { status: 'missing', reason: '未收到该店铺 Cookie', canSyncOrders: false }
  }
  const st = row.cookieStatus || 'unknown'
  if (st === 'valid') {
    return { status: 'valid', reason: 'Cookie 已验证有效，可同步订单', canSyncOrders: true }
  }
  if (st === 'unknown') {
    return { status: 'uploaded', reason: '已收到 Cookie，待验证', canSyncOrders: false }
  }
  if (st === 'suspected') {
    return {
      status: 'suspected',
      reason: row.cookieLastErrorMessage?.trim() || '已收到 Cookie，但平台接口疑似异常',
      canSyncOrders: false,
    }
  }
  if (st === 'invalid') {
    const code = row.cookieLastErrorCode?.trim()
    const msg = row.cookieLastErrorMessage?.trim()
    if (code === '401' || code === '403' || msg?.includes('401') || msg?.includes('403')) {
      return {
        status: 'invalid',
        reason: msg || '已收到 Cookie，但平台接口返回 401/403',
        canSyncOrders: false,
      }
    }
    return {
      status: 'invalid',
      reason: msg || '已收到 Cookie，但验证失败',
      canSyncOrders: false,
    }
  }
  return { status: st, reason: 'Cookie 状态待确认', canSyncOrders: false }
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

function normalizeUploadPayload(raw: unknown): Array<{ shopKey: GoodReviewShopKey; cookie: string }> {
  const items: Array<{ shopKey: GoodReviewShopKey; cookie: string }> = []

  if (!raw || typeof raw !== 'object') return items
  const body = raw as Record<string, unknown>

  if (typeof body.shop === 'string' && body.cookie != null) {
    const key = resolveGoodReviewShopKey(body.shop)
    const cookie = String(body.cookie).trim()
    if (key && cookie) items.push({ shopKey: key, cookie })
    return items
  }

  const shops = body.shops
  if (!shops || typeof shops !== 'object' || Array.isArray(shops)) return items

  for (const [rawKey, rawCookie] of Object.entries(shops as Record<string, unknown>)) {
    const key = resolveGoodReviewShopKey(rawKey)
    const cookie = String(rawCookie ?? '').trim()
    if (!key || !cookie) continue
    items.push({ shopKey: key, cookie })
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
    try {
      let accountId = await findAccountIdForShop(item.shopKey)
      if (!accountId) {
        accountId = await ensureAccountForShop(item.shopKey, item.cookie, params.updatedBy)
      } else {
        await persistLiveAccountCookieOnly(accountId, item.cookie, params.updatedBy)
        void testLiveAccountCookie(accountId).catch(() => undefined)
      }

      const row = await prisma.platformCredential.findUnique({ where: { id: accountId } })
      results.push({
        shopKey: item.shopKey,
        shopName,
        success: true,
        accountId,
        cookiePreview: row?.cookieEncrypted ? maskCookiePreview(item.cookie) : null,
        cookieStatus: row?.cookieStatus ?? 'unknown',
      })
      logInfo('Cookie上传', `${shopName} 已落库，状态=${row?.cookieStatus ?? 'unknown'}`)
    } catch (err) {
      results.push({
        shopKey: item.shopKey,
        shopName,
        success: false,
        error: err instanceof Error ? err.message : String(err),
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
  shops: ShopCookieStatusItem[]
  shopsByKey: Record<string, ShopCookieStatusItem>
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
    }
  })

  const shopsByKey: Record<string, ShopCookieStatusItem> = {}
  for (const s of shops) shopsByKey[s.shopKey] = s

  return {
    ok: true,
    serverTokenConfigured: Boolean(getShopCookieUploadToken()),
    shops,
    shopsByKey,
    checkedAt: new Date().toISOString(),
  }
}
