/**
 * Cookie 简化上传验收（API 上传已关闭，改验手动落库）
 * 用法: npm run verify:shop-cookie-simple-upload
 */
import {
  SHOP_COOKIE_API_UPLOAD_DISABLED_MESSAGE,
  isShopCookieApiUploadEnabled,
} from '../src/config/shop-cookie-api-upload.config'
import { uploadShopCookies, getShopCookieStatusPayload } from '../src/services/shop-cookie-upload.service'
import { upsertOfficialShopAccountCookie } from '../src/services/official-shop-account.service'
import { listLiveAccountsForSettings } from '../src/services/live-account.service'
import { prisma } from '../src/lib/prisma'
import { decryptText } from '../src/utils/crypto'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

async function run(): Promise<void> {
  const issues: string[] = []

  assert(!isShopCookieApiUploadEnabled(), '默认应关闭 API Cookie 上传', issues)

  let uploadRejected = false
  try {
    await uploadShopCookies({
      body: { shops: { xyxiangyu: 'a1=test' } },
      updatedBy: 'verify-script',
    })
  } catch (e) {
    uploadRejected = e instanceof Error && e.message.includes('已关闭 API 上传')
  }
  assert(uploadRejected, 'uploadShopCookies 在 API 关闭时应拒绝', issues)

  const testCookie =
    'a1=verify1234567890123456789012345678; test_cookie_field=abc123; session=test_session_value'
  const saved = await upsertOfficialShopAccountCookie('xyxiangyu', testCookie, 'verify-script-manual')

  assert(Boolean(saved.savedAccountId), '手动落库应返回 savedAccountId', issues)
  assert(saved.savedContainsA1 === true, '手动落库应包含 a1', issues)

  const status = await getShopCookieStatusPayload()
  assert(status.apiUploadEnabled === false, 'status 应标记 apiUploadEnabled=false', issues)
  assert(status.shops.length === 4, '应返回四店状态', issues)
  const xy = status.shops.find((s) => s.shopKey === 'xyxiangyu')
  assert(xy?.hasCookie === true, 'xyxiangyu 应有 Cookie', issues)
  assert(xy?.accountId === saved.savedAccountId, 'status 与手动落库 accountId 应一致', issues)

  const settings = await listLiveAccountsForSettings()
  const page = settings.find((a) => a.id === saved.savedAccountId)
  assert(page?.officialShopKey === 'xyxiangyu', '设置页应标记四店官方账号', issues)
  assert(page?.cookieText?.includes('test_cookie_field') === true, '页面 cookieText 应与手动粘贴一致', issues)

  const row = saved.savedAccountId
    ? await prisma.platformCredential.findUnique({ where: { id: saved.savedAccountId } })
    : null
  if (row?.cookieEncrypted) {
    const plain = decryptText(row.cookieEncrypted)
    assert(plain.includes('test_cookie_field'), 'Cookie 不应被清空', issues)
    assert(row.platformName === 'xyxiangyu', '官方账号 platformName 应为 xyxiangyu', issues)
  }

  if (issues.length) {
    console.error('verify:shop-cookie-simple-upload FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:shop-cookie-simple-upload OK')
  console.log(SHOP_COOKIE_API_UPLOAD_DISABLED_MESSAGE)
}

void run().finally(() => prisma.$disconnect())
