/**
 * 四店 Cookie 上传链路验收
 * 用法: npm run verify:shop-cookie-upload
 */
import { normalizeShopName, shopNamesMatch } from '../src/utils/shop-name-normalize.util'
import { resolveGoodReviewShopKey, getGoodReviewShopName } from '../src/config/good-review-shops.constants'
import { getShopCookieUploadToken } from '../src/config/env'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function run(): void {
  const issues: string[] = []

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

  const keys = ['shiyuju', 'hetianyayu', 'xiangyu', 'xyxiangyu'] as const
  for (const key of keys) {
    const resolved = resolveGoodReviewShopKey(key)
    assert(resolved === key, `shopKey ${key} 应可解析`, issues)
    const name = getGoodReviewShopName(key)
    assert(Boolean(name), `${key} 应有标准店名`, issues)
  }

  assert(resolveGoodReviewShopKey('XY祥钰') === 'xyxiangyu', 'XY祥钰 应映射 xyxiangyu', issues)

  if (issues.length) {
    console.error('verify:shop-cookie-upload FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:shop-cookie-upload OK')
}

run()
