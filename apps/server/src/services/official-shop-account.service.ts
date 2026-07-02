import { prisma } from '../lib/prisma'
import type { PlatformCredential } from '@prisma/client'
import { decryptText, encryptText } from '../utils/crypto'
import {
  getGoodReviewShopName,
  isGoodReviewShopKey,
  resolveGoodReviewShopKey,
  type GoodReviewShopKey,
} from '../config/good-review-shops.constants'
import { resolveCanonicalShopName, type QianfanShopName } from '../config/qianfan-shops.constants'
import {
  persistLiveAccountCookieOnly,
  testLiveAccountCookie,
} from './live-account.service'
import { cookieContainsA1 } from '../utils/cookie-sync-status.util'

export type PlatformCredentialRow = PlatformCredential

function readPlainCookie(cookieEncrypted: string): string | null {
  const trimmed = cookieEncrypted.trim()
  if (!trimmed) return null
  try {
    const plain = decryptText(trimmed).trim()
    return plain || null
  } catch {
    if (trimmed.includes(';') || trimmed.includes('=')) return trimmed
    return null
  }
}

/** 四店官方账号：platformName === shopKey */
export function isOfficialShopPlatformName(platformName: string): platformName is GoodReviewShopKey {
  return isGoodReviewShopKey(platformName)
}

export function resolveShopKeyFromPlatformName(platformName: string): GoodReviewShopKey | null {
  return isOfficialShopPlatformName(platformName) ? platformName : null
}

export function resolveShopKeyFromAccountName(name: string): GoodReviewShopKey | null {
  return resolveGoodReviewShopKey(name)
}

/** 历史重复账号行：displayName/别名匹配四店，但 platformName 不是官方 shopKey */
export function isLegacyDuplicateShopAccountRow(row: {
  platformName: string
  displayName: string | null
}): boolean {
  if (isOfficialShopPlatformName(row.platformName)) return false
  const label = row.displayName?.trim() || row.platformName
  return resolveShopKeyFromAccountName(label) != null
}

/** 历史重复账号：displayName/别名匹配四店，但 platformName 不是官方 shopKey */
export async function findLegacyDuplicateShopAccounts(
  shopKey: GoodReviewShopKey,
): Promise<PlatformCredentialRow[]> {
  const shopName = getGoodReviewShopName(shopKey)
  const rows = await prisma.platformCredential.findMany({ orderBy: { createdAt: 'asc' } })
  return rows.filter((row) => {
    if (row.platformName === shopKey) return false
    const label = row.displayName?.trim() || row.platformName
    return resolveCanonicalShopName(label) === shopName
  })
}

/** 只读：获取四店官方 PlatformCredential（platformName === shopKey），不存在则 null */
export async function resolveOfficialShopAccount(
  shopKey: GoodReviewShopKey,
): Promise<PlatformCredentialRow | null> {
  return prisma.platformCredential.findUnique({ where: { platformName: shopKey } })
}

export async function resolveOfficialShopAccountByCanonicalName(
  shopName: QianfanShopName,
): Promise<PlatformCredentialRow | null> {
  const shopKey = resolveGoodReviewShopKey(shopName)
  if (!shopKey) return null
  return resolveOfficialShopAccount(shopKey)
}

function pickSeedCookieFromDuplicates(
  duplicates: PlatformCredentialRow[],
): string | null {
  for (const dup of duplicates) {
    if (!dup?.cookieEncrypted?.trim()) continue
    const plain = readPlainCookie(dup.cookieEncrypted)
    if (plain && cookieContainsA1(plain)) return plain
  }
  return null
}

/**
 * 确保四店官方账号存在（platformName === shopKey）。
 * 若官方账号无 Cookie 而历史重复账号有 Cookie，合并到官方账号（不删重复账号）。
 */
export async function ensureOfficialShopAccount(
  shopKey: GoodReviewShopKey,
  updatedBy: string,
): Promise<PlatformCredentialRow> {
  const existing = await resolveOfficialShopAccount(shopKey)
  if (existing) return existing

  const shopName = getGoodReviewShopName(shopKey)
  const duplicates = await findLegacyDuplicateShopAccounts(shopKey)
  const seedCookie = pickSeedCookieFromDuplicates(duplicates)

  return prisma.platformCredential.create({
    data: {
      platformName: shopKey,
      displayName: shopName,
      cookieEncrypted: seedCookie ? encryptText(seedCookie) : '',
      enabled: true,
      updatedBy,
      cookieStatus: 'unknown',
    },
  })
}

export interface UpsertOfficialShopCookieResult {
  account: PlatformCredentialRow
  savedAccountId: string
  shopKey: GoodReviewShopKey
  shopName: QianfanShopName
  savedContainsA1: boolean
  cookiePreview: string | null
  cookieStatus: string
  status: string
  createdOfficial: boolean
}

function maskCookiePreview(cookie: string): string {
  const trimmed = cookie.trim()
  if (trimmed.length <= 16) return '已保存'
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-8)}`
}

/**
 * 四店 Cookie 唯一写入口：只更新 platformName === shopKey 的官方账号。
 * 不因 enabled=false 新建重复账号；上传时不改 enabled 状态。
 */
export async function upsertOfficialShopAccountCookie(
  shopKey: GoodReviewShopKey,
  cookie: string,
  updatedBy: string,
): Promise<UpsertOfficialShopCookieResult> {
  const trimmed = cookie.trim()
  if (!trimmed) throw new Error('Cookie 不能为空')

  const shopName = getGoodReviewShopName(shopKey)
  const before = await resolveOfficialShopAccount(shopKey)
  const createdOfficial = !before

  const official = before ?? (await ensureOfficialShopAccount(shopKey, updatedBy))

  await persistLiveAccountCookieOnly(official.id, trimmed, updatedBy)
  await testLiveAccountCookie(official.id).catch(() => undefined)

  const refreshed = await prisma.platformCredential.findUnique({ where: { id: official.id } })
  if (!refreshed) throw new Error('官方账号保存后读取失败')

  const plain = refreshed.cookieEncrypted ? readPlainCookie(refreshed.cookieEncrypted) : null
  const savedContainsA1 = plain ? cookieContainsA1(plain) : false

  return {
    account: refreshed,
    savedAccountId: refreshed.id,
    shopKey,
    shopName,
    savedContainsA1,
    cookiePreview: plain ? maskCookiePreview(plain) : null,
    cookieStatus: refreshed.cookieStatus ?? 'unknown',
    status: refreshed.cookieStatus ?? 'uploaded',
    createdOfficial,
  }
}

/** 状态/同步读取：优先官方账号；若无官方账号则尝试迁移（合并重复账号 Cookie） */
export async function resolveOfficialShopAccountForStatus(
  shopKey: GoodReviewShopKey,
): Promise<PlatformCredentialRow | null> {
  const official = await resolveOfficialShopAccount(shopKey)
  if (official) return official

  const duplicates = await findLegacyDuplicateShopAccounts(shopKey)
  if (duplicates.length === 0) return null

  return ensureOfficialShopAccount(shopKey, 'shop-status-migrate')
}

export async function resolveOfficialShopAccountByKeyOrName(
  shopKeyOrName: string,
  options?: { ensureForRead?: boolean },
): Promise<{
  shopKey: GoodReviewShopKey
  shopName: QianfanShopName
  account: PlatformCredentialRow
} | null> {
  const shopKey = resolveGoodReviewShopKey(shopKeyOrName)
  if (!shopKey) return null
  const shopName = getGoodReviewShopName(shopKey)
  const account =
    options?.ensureForRead === false
      ? await resolveOfficialShopAccount(shopKey)
      : await resolveOfficialShopAccountForStatus(shopKey)
  if (!account) return null
  return { shopKey, shopName, account }
}

/** 本机服务读取四店明文 Cookie（祥钰/协议桥接兜底） */
export async function getOfficialShopCookiePlaintext(shopKeyOrName: string): Promise<{
  shopKey: GoodReviewShopKey
  shopName: QianfanShopName
  cookie: string
  cookieStatus: string
  accountId: string
} | null> {
  const resolved = await resolveOfficialShopAccountByKeyOrName(shopKeyOrName, { ensureForRead: true })
  if (!resolved?.account) return null
  const plain = readPlainCookie(resolved.account.cookieEncrypted)
  if (!plain || plain.length < 80) return null
  return {
    shopKey: resolved.shopKey,
    shopName: resolved.shopName,
    cookie: plain,
    cookieStatus: resolved.account.cookieStatus || 'unknown',
    accountId: resolved.account.id,
  }
}

/** 同步/BI/品退/任务：启用且有 Cookie，排除四店历史重复账号 */
export async function listActiveLiveAccountsWithCookie(): Promise<
  Array<{ id: string; name: string; platformName: string }>
> {
  const rows = await prisma.platformCredential.findMany({
    where: { enabled: true, NOT: { cookieEncrypted: '' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, displayName: true, platformName: true },
  })
  return rows
    .filter((row) => !isLegacyDuplicateShopAccountRow(row))
    .map((row) => ({
      id: row.id,
      name: isOfficialShopPlatformName(row.platformName)
        ? getGoodReviewShopName(row.platformName)
        : row.displayName?.trim() || row.platformName,
      platformName: row.platformName,
    }))
}
