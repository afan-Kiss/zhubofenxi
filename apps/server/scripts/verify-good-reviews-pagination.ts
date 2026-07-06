/**
 * 好评分页查询验收（只读，不改库）
 *
 * npm run verify:good-reviews-pagination
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { queryGoodReviews } from '../src/services/good-review/good-review-query.service'
import { GOOD_REVIEW_SHOPS } from '../src/config/good-review-shops.constants'

config({ path: path.resolve(__dirname, '../.env') })

const ROOT = path.resolve(__dirname, '../..')
const issues: string[] = []

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

async function main(): Promise<void> {
  console.log('verify-good-reviews-pagination')
  const shop = GOOD_REVIEW_SHOPS[0]!.shopKey
  const now = Date.now()
  const cutoff = now - 2 * 24 * 60 * 60 * 1000

  const page1 = await queryGoodReviews({ shop, days: 2, limit: 5 })
  if (page1.reviews.length <= 5) ok(`第一页最多 5 条，实际 ${page1.reviews.length}`)
  else fail(`第一页超过 5 条：${page1.reviews.length}`)

  for (const r of page1.reviews) {
    if (!r.reviewTime) {
      fail(`reviewTime 为空不应出现在最近两天列表：${r.id}`)
      continue
    }
    const t = new Date(r.reviewTime).getTime()
    if (t < cutoff || t > now + 60_000) {
      fail(`review ${r.id} 不在最近两天内`)
    }
  }
  if (page1.reviews.every((r) => r.reviewTime && new Date(r.reviewTime).getTime() >= cutoff)) {
    ok('第一页 reviews 均在最近两天内')
  }

  if (page1.hasMore && page1.nextCursor) {
    const page2 = await queryGoodReviews({
      shop,
      days: 2,
      limit: 5,
      cursor: page1.nextCursor,
    })
    const ids1 = new Set(page1.reviews.map((r) => r.id))
    const dup = page2.reviews.filter((r) => ids1.has(r.id))
    if (dup.length === 0) ok('第二页与第一页 id 不重复')
    else fail(`第二页有 ${dup.length} 条重复 id`)

    const times = [...page1.reviews, ...page2.reviews]
      .map((r) => (r.reviewTime ? new Date(r.reviewTime).getTime() : 0))
      .filter((t) => t > 0)
    const sorted = [...times].sort((a, b) => b - a)
    if (JSON.stringify(times) === JSON.stringify(sorted.slice(0, times.length))) {
      ok('跨页时间排序仍倒序')
    } else {
      fail('跨页时间排序不正确')
    }
  } else {
    ok('第一页 hasMore=false 或数据不足，跳过分页续查')
  }

  const capped = await queryGoodReviews({ shop, days: 2, limit: 100 })
  if (capped.reviews.length <= 50) ok(`limit 上限生效，100 请求返回 ${capped.reviews.length} 条`)
  else fail(`limit 未封顶：${capped.reviews.length}`)

  if (typeof page1.totalReviewCount === 'number') ok('totalReviewCount 存在')
  else fail('缺少 totalReviewCount')
  if (typeof page1.returnedReviewCount === 'number') ok('returnedReviewCount 存在')
  else fail('缺少 returnedReviewCount')
  if (typeof page1.filteredReviewCount === 'number') ok('filteredReviewCount 存在')
  else fail('缺少 filteredReviewCount')

  const orderRow = fs.readFileSync(
    path.resolve(ROOT, 'web/src/components/good-reviews/GoodReviewOrderRow.tsx'),
    'utf-8',
  )
  if (orderRow.includes('if (!trimmed)') && orderRow.includes('接口未返回')) {
    ok('GoodReviewOrderRow orderId 为空时不展示千帆按钮')
  } else {
    fail('GoodReviewOrderRow 缺少空 orderId 处理')
  }

  const imageTs = fs.readFileSync(
    path.resolve(ROOT, 'web/src/components/good-reviews/GoodReviewImage.tsx'),
    'utf-8',
  )
  if (imageTs.includes('try') && imageTs.includes('sessionStorage')) {
    ok('GoodReviewImage sessionStorage try/catch')
  } else {
    fail('GoodReviewImage 缺少 sessionStorage try/catch')
  }

  console.log('\n=== 结果 ===')
  if (issues.length > 0) {
    console.log(`FAIL (${issues.length})`)
    for (const i of issues) console.log(` - ${i}`)
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log('PASS')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
