import { prisma } from '../lib/prisma'
import { decryptText } from '../utils/crypto'
import { resolveCanonicalShopName } from '../config/qianfan-shops.constants'
import {
  GOOD_REVIEW_SHOPS,
  getGoodReviewShopName,
  resolveGoodReviewShopKey,
  type GoodReviewShopKey,
} from '../config/good-review-shops.constants'
import {
  createLiveAccount,
  refreshLiveAccountRowMapperContext,
  updateLiveAccountCookie,
} from './live-account.service'
import { clearSessionCookieCache } from './qianfan-cookie-resolver.service'

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
  accountId: string | null
  accountDisplayName: string | null
  hasCookie: boolean
  cookiePreview: string | null
  cookieStatus: string
  cookieUpdatedAt: string | null
}

function maskCookiePreview(cookie: string): string {
  const trimmed = cookie.trim()
  if (trimmed.length <= 16) return '已保存'
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-8)}`
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
  const created = await createLiveAccount({
    name: shopName,
    cookie,
    enabled: true,
    updatedBy,
  })
  return created.account.id
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
        await updateLiveAccountCookie(accountId, item.cookie, params.updatedBy)
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

  return GOOD_REVIEW_SHOPS.map((def) => {
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
    return {
      shopKey: def.shopKey,
      shopName: def.shopName,
      accountId: row?.id ?? null,
      accountDisplayName: row?.displayName?.trim() || row?.platformName || null,
      hasCookie,
      cookiePreview,
      cookieStatus: row?.cookieStatus ?? 'unknown',
      cookieUpdatedAt: hasCookie ? row!.updatedAt.toISOString() : null,
    }
  })
}
