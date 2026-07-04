/**
 * 一次性：从千帆 manual-cookies.txt 导入四店 Cookie（不写 Git、不打印完整 Cookie）
 * 用法:
 *   npx tsx apps/server/scripts/import-manual-shop-cookies.ts
 *   MANUAL_COOKIES_FILE=/tmp/manual-cookies.txt npx tsx apps/server/scripts/import-manual-shop-cookies.ts
 */
import { readFileSync, existsSync } from 'node:fs'
import { prisma } from '../src/lib/prisma'
import {
  GOOD_REVIEW_SHOP_KEYS,
  getGoodReviewShopName,
  resolveGoodReviewShopKey,
  type GoodReviewShopKey,
} from '../src/config/good-review-shops.constants'
import { upsertOfficialShopAccountCookie } from '../src/services/official-shop-account.service'
import {
  cookieHasArkToken,
  getShopCookieHealth,
} from '../src/services/shop-cookie-health.service'

const DEFAULT_WINDOWS_PATH = 'E:\\我的软件源码\\千帆中转机器人\\data\\manual-cookies.txt'
const DEFAULT_SERVER_PATH = '/tmp/manual-cookies.txt'
const UPDATED_BY = 'reinit-manual-cookie'

function resolveCookiesFile(): string {
  const fromEnv = process.env.MANUAL_COOKIES_FILE?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  if (existsSync(DEFAULT_SERVER_PATH)) return DEFAULT_SERVER_PATH
  if (existsSync(DEFAULT_WINDOWS_PATH)) return DEFAULT_WINDOWS_PATH
  throw new Error(
    `未找到 Cookie 文件。请设置 MANUAL_COOKIES_FILE，或放置于 ${DEFAULT_SERVER_PATH} / ${DEFAULT_WINDOWS_PATH}`,
  )
}

function cookieHasWalleToken(cookie: string): boolean {
  return /(?:^|;\s*)access-token-walle(?:\.xiaohongshu\.com)?=/i.test(cookie.trim())
}

function countCookieKeys(cookie: string): number {
  return cookie
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean).length
}

export function parseManualShopCookies(content: string): Map<GoodReviewShopKey, string> {
  const lines = content.split(/\r?\n/)
  const parsed = new Map<GoodReviewShopKey, string>()
  let pendingKey: GoodReviewShopKey | null = null

  for (const line of lines) {
    const shopKeyMatch = line.match(/shopKey\s*=\s*([a-z0-9_]+)/i)
    if (shopKeyMatch) {
      const key = resolveGoodReviewShopKey(shopKeyMatch[1] ?? '')
      pendingKey = key
      continue
    }

    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('═') || trimmed.startsWith('【') || trimmed.startsWith('页面:')) {
      continue
    }
    if (trimmed.startsWith('URL:') || trimmed.startsWith('校验:') || trimmed.startsWith('──') || trimmed.startsWith('时间:')) {
      continue
    }

    if (pendingKey && trimmed.startsWith('a1=')) {
      parsed.set(pendingKey, trimmed)
      pendingKey = null
    }
  }

  return parsed
}

function summarizeCookie(shopKey: GoodReviewShopKey, cookie: string) {
  return {
    shopKey,
    displayName: getGoodReviewShopName(shopKey),
    hasA1: /^a1=/i.test(cookie.trim()) || /(?:^|;\s*)a1=/i.test(cookie),
    hasArkToken: cookieHasArkToken(cookie),
    hasWalleToken: cookieHasWalleToken(cookie),
    keyCount: countCookieKeys(cookie),
  }
}

async function main(): Promise<void> {
  const filePath = resolveCookiesFile()
  console.log(`[import-manual-shop-cookies] reading ${filePath}`)
  const content = readFileSync(filePath, 'utf-8')
  const parsed = parseManualShopCookies(content)

  const missing = GOOD_REVIEW_SHOP_KEYS.filter((key) => !parsed.get(key)?.trim())
  if (missing.length > 0) {
    throw new Error(`Cookie 文件缺少店铺: ${missing.join(', ')}`)
  }

  for (const shopKey of GOOD_REVIEW_SHOP_KEYS) {
    const cookie = parsed.get(shopKey)?.trim() ?? ''
    const summary = summarizeCookie(shopKey, cookie)
    console.log('[import-manual-shop-cookies] parsed', JSON.stringify(summary))

    const result = await upsertOfficialShopAccountCookie(shopKey, cookie, UPDATED_BY)
    await prisma.platformCredential.update({
      where: { id: result.savedAccountId },
      data: {
        displayName: getGoodReviewShopName(shopKey),
        enabled: true,
        cookieStatus: 'unknown',
        affectedBusinessSync: true,
        updatedBy: UPDATED_BY,
      },
    })
  }

  console.log('[import-manual-shop-cookies] db rows:')
  const rows = await prisma.platformCredential.findMany({
    where: { platformName: { in: [...GOOD_REVIEW_SHOP_KEYS] } },
    orderBy: { platformName: 'asc' },
    select: {
      platformName: true,
      displayName: true,
      enabled: true,
      cookieEncrypted: true,
      cookieStatus: true,
      affectedBusinessSync: true,
    },
  })
  for (const row of rows) {
    console.log(
      JSON.stringify({
        platformName: row.platformName,
        displayName: row.displayName,
        enabled: row.enabled,
        cookieStatus: row.cookieStatus,
        affectedBusinessSync: row.affectedBusinessSync,
        cookieEncryptedLength: row.cookieEncrypted?.length ?? 0,
      }),
    )
  }

  console.log('[import-manual-shop-cookies] structural health:')
  for (const shopKey of GOOD_REVIEW_SHOP_KEYS) {
    const health = await getShopCookieHealth(shopKey)
    console.log(
      JSON.stringify({
        shopKey,
        displayName: health.shopName,
        status: health.status,
        ok: health.ok,
        hasA1: health.hasA1,
        hasArkToken: health.hasArkToken,
        reason: health.reason,
      }),
    )
    if (!health.hasA1 || !health.hasArkToken) {
      throw new Error(`${shopKey} Cookie 结构不完整（缺 a1 或 access-token-ark）`)
    }
  }

  console.log('[import-manual-shop-cookies] OK')
}

const isMain = process.argv[1]?.includes('import-manual-shop-cookies')
if (isMain) {
  main()
    .catch((err) => {
      console.error('[import-manual-shop-cookies] FAILED', err instanceof Error ? err.message : err)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
