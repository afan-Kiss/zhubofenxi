/**
 * 好评 dedupeKey 验收：缺字段时用稳定 hash，不互相覆盖
 */
import { buildGoodReviewDedupeKey } from '../src/services/good-review/good-review-normalize.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function run(): void {
  const issues: string[] = []
  const shopKey = 'shiyuju'

  const withReviewId = buildGoodReviewDedupeKey(shopKey, 'r123', null, null)
  assert(withReviewId === `${shopKey}::r123`, `reviewId 规则应保持：${withReviewId}`, issues)

  const withOrderTime = buildGoodReviewDedupeKey(shopKey, null, 'o1', '2026-06-01 12:00:00')
  assert(
    withOrderTime === `${shopKey}::o1::2026-06-01 12:00:00`,
    `orderId+createTime 规则应保持：${withOrderTime}`,
    issues,
  )

  const rawA = { review_data: { content: { text: '好评A' } } }
  const rawB = { review_data: { content: { text: '好评B' } } }
  const keyA1 = buildGoodReviewDedupeKey(shopKey, null, null, null, rawA)
  const keyA2 = buildGoodReviewDedupeKey(shopKey, null, null, null, rawA)
  const keyB = buildGoodReviewDedupeKey(shopKey, null, null, null, rawB)
  assert(keyA1 === keyA2, '同一条 raw 重复同步 dedupeKey 应一致', issues)
  assert(keyA1 !== keyB, '不同 raw 缺字段时不应共用 dedupeKey', issues)
  assert(keyA1.includes('::hash::'), '缺字段应使用 hash fallback', issues)

  if (issues.length) {
    console.error('[verify:good-review-dedupe-key] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:good-review-dedupe-key] PASS')
}

run()
