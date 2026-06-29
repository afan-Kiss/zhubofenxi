import { prisma } from '../lib/prisma'
import { decryptText } from '../utils/crypto'
import { getQianfanCookie } from '../lib/controlCookieClient'
import {
  QIANFAN_SHOPS,
  readEnvFallbackCookie,
  resolveCanonicalShopName,
  type QianfanShopName,
} from '../config/qianfan-shops.constants'
import { logInfo, logWarn } from '../utils/server-log'

export type CookieSource = 'control' | 'env' | 'sqlite' | 'missing'

export interface ShopCookieState {
  shopName: QianfanShopName
  source: CookieSource
  updatedAt?: string
  cookieHash?: string
  staleWarning?: string
  failureReason?: string
}

export interface CookieBootstrapSummary {
  at: string
  controlOk: number
  envFallback: number
  sqliteFallback: number
  missing: number
  staleShops: string[]
  shops: ShopCookieState[]
}

interface SessionEntry {
  cookie: string
  source: CookieSource
  updatedAt?: string
  cookieHash?: string
  staleWarning?: string
}

const sessionByShop = new Map<QianfanShopName, SessionEntry>()
const sessionByAccountId = new Map<string, SessionEntry>()
let lastBootstrapSummary: CookieBootstrapSummary | null = null

export function getLastCookieBootstrapSummary(): CookieBootstrapSummary | null {
  return lastBootstrapSummary
}

export function clearSessionCookieCache(): void {
  sessionByShop.clear()
  sessionByAccountId.clear()
}

async function readSqliteCookieByAccountId(accountId: string): Promise<string | null> {
  const row = await prisma.platformCredential.findUnique({ where: { id: accountId } })
  if (!row?.cookieEncrypted?.trim()) return null
  try {
    const plain = decryptText(row.cookieEncrypted).trim()
    return plain || null
  } catch {
    const raw = row.cookieEncrypted.trim()
    if (raw.includes(';') || raw.includes('=')) return raw
    return null
  }
}

function cacheEntry(
  shopName: QianfanShopName,
  accountId: string | undefined,
  entry: SessionEntry,
): void {
  sessionByShop.set(shopName, entry)
  if (accountId) sessionByAccountId.set(accountId, entry)
}

async function resolveShopCookieInternal(
  shopName: QianfanShopName,
  accountId?: string,
  options?: { skipControl?: boolean; forceControl?: boolean },
): Promise<ShopCookieState> {
  const envFallback = readEnvFallbackCookie(shopName)
  let sqliteFallback: string | null = null
  if (accountId) {
    sqliteFallback = await readSqliteCookieByAccountId(accountId)
  }

  if (!options?.skipControl && !options?.forceControl) {
    const cached = sessionByShop.get(shopName)
    if (cached?.cookie) {
      return {
        shopName,
        source: cached.source,
        updatedAt: cached.updatedAt,
        cookieHash: cached.cookieHash,
        staleWarning: cached.staleWarning,
      }
    }
  }

  const localFallback = envFallback || sqliteFallback || undefined

  if (!options?.skipControl) {
    const control = await getQianfanCookie({
      shopName,
      fallbackValue: localFallback,
    })
    if (control.source === 'control' && control.value) {
      const entry: SessionEntry = {
        cookie: control.value,
        source: 'control',
        updatedAt: control.updatedAt,
        cookieHash: control.cookieHash,
        staleWarning: control.staleWarning,
      }
      cacheEntry(shopName, accountId, entry)
      return {
        shopName,
        source: 'control',
        updatedAt: control.updatedAt,
        cookieHash: control.cookieHash,
        staleWarning: control.staleWarning,
      }
    }
    if (control.value && control.source === 'fallback') {
      const source: CookieSource = envFallback ? 'env' : sqliteFallback ? 'sqlite' : 'missing'
      if (source !== 'missing') {
        const entry: SessionEntry = {
          cookie: control.value,
          source,
          updatedAt: control.updatedAt,
          cookieHash: control.cookieHash,
        }
        cacheEntry(shopName, accountId, entry)
        return { shopName, source, updatedAt: control.updatedAt, cookieHash: control.cookieHash }
      }
    }
  }

  if (envFallback) {
    const entry: SessionEntry = { cookie: envFallback, source: 'env' }
    cacheEntry(shopName, accountId, entry)
    return { shopName, source: 'env' }
  }

  if (sqliteFallback) {
    const entry: SessionEntry = { cookie: sqliteFallback, source: 'sqlite' }
    cacheEntry(shopName, accountId, entry)
    return { shopName, source: 'sqlite' }
  }

  return {
    shopName,
    source: 'missing',
    failureReason: '总控与本地均未配置 Cookie',
  }
}

/** 180 分钟任务开始前：预拉四店 Cookie 并输出摘要 */
export async function bootstrapQianfanCookiesForSync(): Promise<CookieBootstrapSummary> {
  clearSessionCookieCache()

  const accounts = await prisma.platformCredential.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  })

  const accountByShop = new Map<QianfanShopName, string>()
  for (const row of accounts) {
    const name = row.displayName?.trim() || row.platformName
    const shop = resolveCanonicalShopName(name)
    if (shop && !accountByShop.has(shop)) {
      accountByShop.set(shop, row.id)
    }
  }

  const shops: ShopCookieState[] = []
  for (const shopName of QIANFAN_SHOPS) {
    const accountId = accountByShop.get(shopName)
    shops.push(await resolveShopCookieInternal(shopName, accountId, { forceControl: true }))
  }

  const summary: CookieBootstrapSummary = {
    at: new Date().toISOString(),
    controlOk: shops.filter((s) => s.source === 'control').length,
    envFallback: shops.filter((s) => s.source === 'env').length,
    sqliteFallback: shops.filter((s) => s.source === 'sqlite').length,
    missing: shops.filter((s) => s.source === 'missing').length,
    staleShops: shops.filter((s) => s.staleWarning).map((s) => s.shopName),
    shops,
  }

  lastBootstrapSummary = summary
  logInfo(
    '千帆Cookie',
    `任务开始前 Cookie 摘要：总控=${summary.controlOk} 本地env=${summary.envFallback} 本地sqlite=${summary.sqliteFallback} 缺失=${summary.missing}${
      summary.staleShops.length ? ` 超时未更新=${summary.staleShops.join('、')}` : ''
    }`,
  )
  return summary
}

/** 按直播号 ID 解析 Cookie（总控 → env → sqlite） */
export async function resolveLiveAccountCookie(
  accountId: string,
  displayName?: string,
): Promise<string | null> {
  const cached = sessionByAccountId.get(accountId)
  if (cached?.cookie) return cached.cookie

  const row = await prisma.platformCredential.findUnique({ where: { id: accountId } })
  const name = displayName?.trim() || row?.displayName?.trim() || row?.platformName || ''
  const shop = resolveCanonicalShopName(name)

  if (shop) {
    const state = await resolveShopCookieInternal(shop, accountId)
    if (state.source !== 'missing') {
      const entry = sessionByShop.get(shop)
      if (entry?.cookie) return entry.cookie
    }
  }

  const sqlite = await readSqliteCookieByAccountId(accountId)
  return sqlite
}

/** 401/403 等失效后：强制从总控重拉该店 Cookie */
export async function refreshShopCookieFromControl(shopName: string): Promise<string | null> {
  const canonical = resolveCanonicalShopName(shopName)
  if (!canonical) return null

  sessionByShop.delete(canonical)
  const accounts = await prisma.platformCredential.findMany({ where: { enabled: true } })
  for (const row of accounts) {
    if (resolveCanonicalShopName(row.displayName?.trim() || row.platformName) === canonical) {
      sessionByAccountId.delete(row.id)
    }
  }
  const accountId = accounts.find((a) => {
    const n = a.displayName?.trim() || a.platformName
    return resolveCanonicalShopName(n) === canonical
  })?.id

  const envFallback = readEnvFallbackCookie(canonical)
  const sqliteFallback = accountId ? await readSqliteCookieByAccountId(accountId) : null

  const control = await getQianfanCookie({
    shopName: canonical,
    fallbackValue: undefined,
  })

  if (control.source === 'control' && control.value) {
    cacheEntry(canonical, accountId, {
      cookie: control.value,
      source: 'control',
      updatedAt: control.updatedAt,
      cookieHash: control.cookieHash,
      staleWarning: control.staleWarning,
    })
    return control.value
  }
  return null
}

/** 重试最后一跳：仅 env / sqlite，不走总控 */
export async function resolveLocalFallbackCookie(
  accountId: string,
  displayName?: string,
): Promise<string | null> {
  const row = await prisma.platformCredential.findUnique({ where: { id: accountId } })
  const name = displayName?.trim() || row?.displayName?.trim() || row?.platformName || ''
  const shop = resolveCanonicalShopName(name)
  if (shop) {
    const env = readEnvFallbackCookie(shop)
    if (env) return env
  }
  return readSqliteCookieByAccountId(accountId)
}

export function getShopNameForAccount(displayName: string): QianfanShopName | null {
  return resolveCanonicalShopName(displayName)
}
