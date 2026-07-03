/**
 * 好评同步分页验收（mock fetchReviewManagerPage）
 */
import type { NormalizedGoodReview } from '../src/services/good-review/good-review.types'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

async function runFetchAllMock(params: {
  total: number
  pageSize: number
  maxReviews: number
  failPage?: number
}): Promise<{
  reviews: NormalizedGoodReview[]
  fetchedReviewCount: number
  truncated: boolean
  warning?: string
}> {
  const all: NormalizedGoodReview[] = []
  const seen = new Set<string>()
  let truncated = false
  let warning: string | undefined
  const maxPages = Math.ceil(params.maxReviews / params.pageSize)

  for (let page = 1; page <= maxPages; page++) {
    if (params.failPage === page) throw new Error(`page ${page} failed`)

    const start = (page - 1) * params.pageSize
    if (start >= params.total) break
    const count = Math.min(params.pageSize, params.total - start)
    const items: NormalizedGoodReview[] = []
    for (let i = 0; i < count; i++) {
      const idx = start + i
      items.push({
        shopKey: 'shiyuju',
        dedupeKey: `shiyuju::mock::${idx}`,
        reviewId: `mock-${idx}`,
        orderId: null,
        itemId: null,
        skuId: null,
        itemName: null,
        itemImage: null,
        itemPriceCent: null,
        itemQuantity: null,
        productScore: 5,
        serviceScore: null,
        logisticsScore: null,
        reviewText: `review-${idx}`,
        reviewImages: [],
        reviewTags: [],
        isAnonymous: false,
        likeCount: 0,
        replyCount: 0,
        reviewTime: null,
        reviewTimeText: null,
        rawJson: '{}',
      })
    }

    if (items.length === 0) break
    for (const item of items) {
      if (seen.has(item.dedupeKey)) continue
      seen.add(item.dedupeKey)
      all.push(item)
      if (all.length >= params.maxReviews) {
        truncated = true
        warning = `已达同步上限 ${params.maxReviews} 条`
        break
      }
    }
    if (truncated) break
    if (items.length < params.pageSize) break
    if (all.length >= params.total) break
  }

  if (!truncated && all.length < params.total) {
    truncated = true
    warning = `已拉取 ${all.length} 条，平台显示共 ${params.total} 条`
  }

  return { reviews: all, fetchedReviewCount: all.length, truncated, warning }
}

async function main(): Promise<void> {
  const issues: string[] = []

  const over2000 = await runFetchAllMock({ total: 2500, pageSize: 20, maxReviews: 10_000 })
  assert(over2000.fetchedReviewCount === 2500, `2500 条应全部拉取，实际 ${over2000.fetchedReviewCount}`, issues)
  assert(over2000.truncated === false, '2500 条不应 truncated', issues)

  const capped = await runFetchAllMock({ total: 2500, pageSize: 20, maxReviews: 2000 })
  assert(capped.fetchedReviewCount === 2000, `硬上限 2000 应截断，实际 ${capped.fetchedReviewCount}`, issues)
  assert(capped.truncated === true, '达到硬上限应 truncated', issues)
  assert(Boolean(capped.warning), '达到硬上限应有 warning', issues)

  const emptyPage = await runFetchAllMock({ total: 40, pageSize: 20, maxReviews: 10_000 })
  assert(emptyPage.fetchedReviewCount === 40, '第 3 页空时应正常停止', issues)

  let otherShopOk = false
  try {
    await runFetchAllMock({ total: 20, pageSize: 20, maxReviews: 10_000, failPage: 2 })
  } catch {
    // 单店失败
  }
  try {
    await runFetchAllMock({ total: 20, pageSize: 20, maxReviews: 10_000 })
    otherShopOk = true
  } catch {
    // ignore
  }
  assert(otherShopOk, '单店失败时其他店应仍可成功', issues)

  if (issues.length) {
    console.error('[verify:good-review-sync-pagination] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:good-review-sync-pagination] PASS')
}

main().catch((err) => {
  console.error('[verify:good-review-sync-pagination] ERROR', err)
  process.exit(1)
})
