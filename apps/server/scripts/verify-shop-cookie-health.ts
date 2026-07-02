/**
 * Cookie 健康状态统一口径验收
 * 用法: npx tsx apps/server/scripts/verify-shop-cookie-health.ts
 */
import { encryptText } from '../src/utils/crypto'
import { prisma } from '../src/lib/prisma'
import { resolveGoodReviewShopKey } from '../src/config/good-review-shops.constants'
import {
  clearShopCookieHealthCache,
  cookieHasArkToken,
  getShopCookieHealth,
  getShopCookieHealthPayload,
  isCookieHealthBlocking,
} from '../src/services/shop-cookie-health.service'
import { getCookieHealthPayload } from '../src/services/live-account.service'
import { uploadShopCookies } from '../src/services/shop-cookie-upload.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function makeCookie(tag: string, withArk = true): string {
  const a1 = tag.padEnd(32, '0').slice(0, 32)
  const ark = withArk ? '; access-token-ark.xiaohongshu.com=customer.ark.AT-test' : ''
  return `a1=${a1}; web_session=test${ark}`
}

async function main() {
  const issues: string[] = []

  assert(resolveGoodReviewShopKey('祥钰珠宝') === 'xiangyu', '祥钰珠宝 → xiangyu', issues)
  assert(resolveGoodReviewShopKey('XY祥钰珠宝') === 'xyxiangyu', 'XY祥钰珠宝 → xyxiangyu', issues)
  assert(resolveGoodReviewShopKey('xiangyu') === 'xiangyu', 'xiangyu → xiangyu', issues)
  assert(
    resolveGoodReviewShopKey('祥钰珠宝') !== resolveGoodReviewShopKey('XY祥钰珠宝'),
    '祥钰珠宝 与 XY祥钰珠宝 为不同 shopCode',
    issues,
  )

  clearShopCookieHealthCache()
  const missing = await getShopCookieHealth('xiangyu')
  assert(missing.status === 'missing' || missing.status === 'unknown', '无 Cookie 时不能返回 ok', issues)
  assert(!missing.ok, 'missing/unknown 时 ok=false', issues)
  assert(!isCookieHealthBlocking('unknown'), 'unknown 不应阻塞弹窗', issues)
  assert(isCookieHealthBlocking('invalid'), 'invalid 应阻塞弹窗', issues)

  const incompleteCookie = makeCookie('incomplete_no_ark', false)
  assert(!cookieHasArkToken(incompleteCookie), '测试 Cookie 应缺 ark', issues)

  await uploadShopCookies({
    body: { shops: { xiangyu: incompleteCookie } },
    updatedBy: 'verify-shop-cookie-health',
  })
  clearShopCookieHealthCache()
  const incomplete = await getShopCookieHealth('xiangyu')
  assert(incomplete.status === 'incomplete', '缺 ark token 应返回 incomplete', issues)
  assert(!incomplete.ok, 'incomplete 不能显示正常', issues)
  assert(isCookieHealthBlocking(incomplete.status), 'incomplete 应阻塞', issues)

  const validCookie = makeCookie('valid_cookie_' + Date.now(), true)
  await uploadShopCookies({
    body: { shops: { xiangyu: validCookie } },
    updatedBy: 'verify-shop-cookie-health',
  })
  clearShopCookieHealthCache()

  const dup = await prisma.platformCredential.create({
    data: {
      platformName: `legacy-xiangyu-${Date.now()}`,
      displayName: '祥钰珠宝',
      cookieEncrypted: encryptText(makeCookie('legacy_invalid', false)),
      enabled: true,
      cookieStatus: 'invalid',
      cookieLastErrorMessage: 'legacy stale invalid',
    },
  })

  const boardHealth = await getCookieHealthPayload({ fresh: false })
  const legacyInBoard = boardHealth.accounts.filter((a) => a.legacyShopKey === 'xiangyu')
  assert(legacyInBoard.length === 0, '经营页 Cookie 健康不应包含历史重复祥钰账号', issues)

  const officialBoard = boardHealth.accounts.find((a) => a.officialShopKey === 'xiangyu')
  assert(Boolean(officialBoard), '经营页应包含官方 xiangyu 账号', issues)
  assert(
    officialBoard?.healthStatus !== undefined,
    '官方账号应带 healthStatus',
    issues,
  )

  const payload = await getShopCookieHealthPayload({ fresh: false })
  const xiangyuShop = payload.shops.find((s) => s.shopCode === 'xiangyu')
  assert(Boolean(xiangyuShop), 'health payload 应包含 xiangyu', issues)

  if (issues.length > 0) {
    console.error('verify-shop-cookie-health FAILED')
    for (const issue of issues) console.error(' -', issue)
    process.exit(1)
  }

  await prisma.platformCredential.delete({ where: { id: dup.id } }).catch(() => undefined)
  console.log('verify-shop-cookie-health OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
