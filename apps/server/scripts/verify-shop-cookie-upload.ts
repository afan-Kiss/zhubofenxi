/**
 * 四店 Cookie 上传链路验收（映射 + 官方账号唯一性）
 * 用法: npm run verify:shop-cookie-upload
 */
import { normalizeShopName, shopNamesMatch } from '../src/utils/shop-name-normalize.util'
import {
  resolveGoodReviewShopKey,
  getGoodReviewShopName,
  GOOD_REVIEW_SHOP_KEYS,
} from '../src/config/good-review-shops.constants'
import { getShopCookieUploadToken } from '../src/config/env'
import { isShopCookieApiUploadEnabled } from '../src/config/shop-cookie-api-upload.config'
import { prisma } from '../src/lib/prisma'
import { encryptText } from '../src/utils/crypto'
import {
  uploadShopCookies,
  getShopCookieStatusPayload,
} from '../src/services/shop-cookie-upload.service'
import { listLiveAccountsForSettings } from '../src/services/live-account.service'
import {
  isOfficialShopPlatformName,
  resolveOfficialShopAccount,
  upsertOfficialShopAccountCookie,
} from '../src/services/official-shop-account.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function makeCookie(tag: string): string {
  return `a1=${tag.padEnd(32, '0').slice(0, 32)}; verify_tag=${tag}; session=test_session_value`
}

async function runAsyncChecks(issues: string[]): Promise<void> {
  assert(!isShopCookieApiUploadEnabled(), 'API Cookie 上传应默认关闭', issues)
  let apiBlocked = false
  try {
    await uploadShopCookies({
      body: { shops: { xyxiangyu: makeCookie('blocked') } },
      updatedBy: 'verify-shop-cookie-upload',
    })
  } catch {
    apiBlocked = true
  }
  assert(apiBlocked, 'uploadShopCookies 在 API 关闭时应 throw', issues)

  const shopKey = 'xyxiangyu' as const
  const cookieA = makeCookie('upload_a_' + Date.now())
  const cookieB = makeCookie('upload_b_' + Date.now())

  const first = await upsertOfficialShopAccountCookie(shopKey, cookieA, 'verify-shop-cookie-upload')
  assert(Boolean(first.savedAccountId), '第一次 xyxiangyu 手动落库应成功', issues)
  const accountId1 = first.savedAccountId

  const second = await upsertOfficialShopAccountCookie(shopKey, cookieB, 'verify-shop-cookie-upload')
  const accountId2 = second.savedAccountId
  assert(accountId1 === accountId2, '连续两次手动落库 xyxiangyu 必须更新同一 accountId', issues)

  const officialCount = await prisma.platformCredential.count({
    where: { platformName: shopKey },
  })
  assert(officialCount === 1, '数据库中 xyxiangyu 官方账号只能有一条', issues)

  const dupPlatform = `xy-duplicate-${Date.now()}`
  const dup = await prisma.platformCredential.create({
    data: {
      platformName: dupPlatform,
      displayName: 'XY祥钰珠宝',
      cookieEncrypted: encryptText(makeCookie('dup_seed')),
      enabled: true,
      cookieStatus: 'unknown',
    },
  })

  await upsertOfficialShopAccountCookie(shopKey, cookieB, 'verify-shop-cookie-upload')
  const status = await getShopCookieStatusPayload()
  const statusXy = status.shops.find((s) => s.shopKey === shopKey)
  const settings = await listLiveAccountsForSettings()
  const settingsOfficial = settings.find((a) => a.officialShopKey === shopKey)

  assert(status.apiUploadEnabled === false, 'status 应标记 apiUploadEnabled=false', issues)
  assert(statusXy?.accountId === accountId2, 'shop-cookies/status 应指向官方 accountId', issues)
  assert(settingsOfficial?.id === accountId2, 'settings/live-accounts 官方账号 ID 应一致', issues)

  const dupStillThere = await prisma.platformCredential.findUnique({ where: { id: dup.id } })
  assert(Boolean(dupStillThere), '历史重复账号不应被删除', issues)

  const official = await resolveOfficialShopAccount(shopKey)
  if (official) {
    await prisma.platformCredential.update({
      where: { id: official.id },
      data: { enabled: false },
    })
  }

  const disabledSaved = await upsertOfficialShopAccountCookie(
    shopKey,
    cookieA,
    'verify-shop-cookie-upload',
  )
  assert(Boolean(disabledSaved.savedAccountId), 'disabled 官方账号手动落库应成功', issues)
  assert(
    disabledSaved.savedAccountId === accountId2,
    'disabled 官方账号落库不能新建第二条',
    issues,
  )
  assert(
    (await prisma.platformCredential.count({ where: { platformName: shopKey } })) === 1,
    'disabled 上传后仍只能有一条官方账号',
    issues,
  )

  const settingsAfter = await listLiveAccountsForSettings()
  const pageOfficial = settingsAfter.find((a) => a.id === accountId2)
  assert(Boolean(pageOfficial?.cookieText?.includes('verify_tag=upload_a_')), '页面 cookieText 应与上传明文一致', issues)

  const noA1 = 'session=only_no_a1; test_cookie_field=should_not_apply'
  let apiNoA1Blocked = false
  try {
    await uploadShopCookies({
      body: { shops: { [shopKey]: noA1 } },
      updatedBy: 'verify-shop-cookie-upload',
    })
  } catch {
    apiNoA1Blocked = true
  }
  assert(apiNoA1Blocked, 'API 关闭后缺少 a1 的批量上传应被拒绝', issues)

  await prisma.platformCredential.delete({ where: { id: dup.id } }).catch(() => undefined)
  if (official) {
    await prisma.platformCredential.update({
      where: { id: official.id },
      data: { enabled: true },
    })
  }
}

function runStaticChecks(issues: string[]): void {
  const token = getShopCookieUploadToken()
  if (process.env.CI || process.env.VERIFY_SHOP_COOKIE_STRICT === '1') {
    assert(Boolean(token), 'SHOP_COOKIE_UPLOAD_TOKEN 未配置', issues)
  } else if (!token) {
    console.warn('warn: SHOP_COOKIE_UPLOAD_TOKEN 未配置（本地可忽略，部署须配置）')
  }

  assert(normalizeShopName('XY祥钰') === normalizeShopName('XY祥钰珠宝'), 'XY祥钰别名应归一', issues)
  assert(shopNamesMatch('xy祥钰珠宝', 'XY祥钰珠宝'), '大小写别名应匹配', issues)
  assert(!shopNamesMatch('祥钰珠宝', 'XY祥钰珠宝'), '祥钰珠宝与 XY祥钰珠宝 为不同店铺', issues)
  assert(shopNamesMatch('和田雅玉', '和田雅玉'), '和田雅玉应匹配', issues)
  assert(shopNamesMatch('拾玉居', '拾玉居和田玉'), '拾玉居别名应匹配', issues)

  for (const key of GOOD_REVIEW_SHOP_KEYS) {
    const resolved = resolveGoodReviewShopKey(key)
    assert(resolved === key, `shopKey ${key} 应可解析`, issues)
    const name = getGoodReviewShopName(key)
    assert(Boolean(name), `${key} 应有标准店名`, issues)
    assert(isOfficialShopPlatformName(key), `${key} 应为官方 platformName`, issues)
  }

  assert(resolveGoodReviewShopKey('XY祥钰') === 'xyxiangyu', 'XY祥钰 应映射 xyxiangyu', issues)
}

async function run(): Promise<void> {
  const issues: string[] = []
  runStaticChecks(issues)
  await runAsyncChecks(issues)

  if (issues.length) {
    console.error('verify:shop-cookie-upload FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:shop-cookie-upload OK')
}

void run()
