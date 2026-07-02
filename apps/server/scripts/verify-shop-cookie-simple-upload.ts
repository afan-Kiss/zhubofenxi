/**
 * Cookie 简化上传验收
 * 用法: npm run verify:shop-cookie-simple-upload
 */
import { allowShopCookieAccess } from '../src/middleware/shop-cookie-upload.middleware'
import { uploadShopCookies, getShopCookieStatusPayload } from '../src/services/shop-cookie-upload.service'
import { listLiveAccountsForSettings } from '../src/services/live-account.service'
import { prisma } from '../src/lib/prisma'
import { decryptText } from '../src/utils/crypto'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

async function run(): Promise<void> {
  const issues: string[] = []

  const fakeReq = { headers: {}, body: {}, user: undefined } as import('express').Request
  let nextCalled = false
  allowShopCookieAccess(fakeReq, {} as import('express').Response, () => {
    nextCalled = true
  })
  assert(nextCalled, '无 Token 也应放行 Cookie 接口', issues)

  const testCookie =
    'a1=verify1234567890123456789012345678; test_cookie_field=abc123; session=test_session_value'
  const result = await uploadShopCookies({
    body: { shops: { xyxiangyu: testCookie } },
    updatedBy: 'verify-script',
  })
  assert(result.successCount >= 1, '无 Token 应能上传 Cookie', issues)

  const xyResult = result.shops.find((s) => s.shopKey === 'xyxiangyu')
  assert(Boolean(xyResult?.savedAccountId), '上传结果应包含 savedAccountId', issues)
  assert(xyResult?.shopKey === 'xyxiangyu', '上传结果应包含 shopKey', issues)
  assert(xyResult?.shopName === 'XY祥钰珠宝', '上传结果应包含 shopName', issues)
  assert(xyResult?.savedContainsA1 === true, '上传结果应标记 savedContainsA1', issues)
  assert(Boolean(xyResult?.cookiePreview), '上传结果应包含 cookiePreview', issues)

  const status = await getShopCookieStatusPayload()
  assert(status.tokenRequired === false, 'status 应标记 tokenRequired=false', issues)
  assert(status.shops.length === 4, '应返回四店状态', issues)
  const xy = status.shops.find((s) => s.shopKey === 'xyxiangyu')
  assert(xy?.hasCookie === true, 'xyxiangyu 应有 Cookie', issues)
  assert(xy?.accountId === xyResult?.savedAccountId, 'status 与上传 savedAccountId 应一致', issues)
  assert(xy?.status !== 'valid', '假 Cookie 不应标记为正常', issues)

  const settings = await listLiveAccountsForSettings()
  const page = settings.find((a) => a.id === xyResult?.savedAccountId)
  assert(page?.officialShopKey === 'xyxiangyu', '设置页应标记四店官方账号', issues)
  assert(page?.cookieText?.includes('test_cookie_field') === true, '页面 cookieText 应与上传明文一致', issues)

  const row = xy?.accountId
    ? await prisma.platformCredential.findUnique({ where: { id: xy.accountId } })
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
}

void run()
