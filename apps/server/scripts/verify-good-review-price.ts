/**
 * 好评商品价格解析验收（平台 price 通常为分，不能 *100）
 * 用法: npm run verify:good-review-price
 */
import {
  normalizeGoodReviewRow,
  resolveGoodReviewItemPriceCent,
  resolveGoodReviewItemPriceCentFromRawJson,
} from '../src/services/good-review/good-review-normalize.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function run(): void {
  const issues: string[] = []
  const shopKey = 'shiyuju'

  // 生产样本：sku_info.price=120000 表示 ¥1200.00
  const prodSample = normalizeGoodReviewRow(shopKey, {
    sku_info: { name: '高冰浅晴52', price: 120000, order_id: 'P798114572830261211' },
    review_data: { sku_score: 5 },
  })
  assert(prodSample?.itemPriceCent === 120_000, `120000 分应存 120000，实际 ${prodSample?.itemPriceCent}`, issues)

  const prod268 = resolveGoodReviewItemPriceCent(
    { price: 268_000 },
    { price: 268_000 },
    { sku_info: { price: 268_000 } },
  )
  assert(prod268 === 268_000, `268000 分应解析为 268000，实际 ${prod268}`, issues)

  const yuanSample = resolveGoodReviewItemPriceCent({ price: 1288 }, { price: 1288 }, { price: 1288 })
  assert(yuanSample === 128_800, `1288 元应解析为 128800 分，实际 ${yuanSample}`, issues)

  const displayValueSample = resolveGoodReviewItemPriceCent(
    { price: { value: 120000, displayValue: '¥1,200.00' } },
    null,
    {},
  )
  assert(
    displayValueSample === 120_000,
    `displayValue 优先时应为 120000 分，实际 ${displayValueSample}`,
    issues,
  )

  const priceCentField = resolveGoodReviewItemPriceCent({ price_cent: 295000 }, null, {})
  assert(priceCentField === 295_000, `price_cent 应直接使用，实际 ${priceCentField}`, issues)

  const fromRaw = resolveGoodReviewItemPriceCentFromRawJson(
    JSON.stringify({ sku_info: { price: 240000, name: '湖水绿小宽54' } }),
  )
  assert(fromRaw === 240_000, `rawJson 修复应得到 240000 分，实际 ${fromRaw}`, issues)

  const oldWrongStored = 24_000_000
  const repaired = resolveGoodReviewItemPriceCentFromRawJson(
    JSON.stringify({ sku_info: { price: 240000 } }),
  )
  assert(repaired !== oldWrongStored, '修复后不应再等于旧错误值 24000000', issues)

  if (issues.length) {
    console.error('[verify:good-review-price] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:good-review-price] PASS')
}

run()
