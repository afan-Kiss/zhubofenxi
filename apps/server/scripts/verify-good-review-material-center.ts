/**
 * 好评中心素材筛选 / 标签 / 复制话术验收
 *
 * npm run verify:good-review-material-center
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

function read(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf-8')
}

async function main(): Promise<void> {
  console.log('verify-good-review-material-center')

  const routes = read('server/src/routes/good-reviews.routes.ts')
  const querySvc = read('server/src/services/good-review/good-review-query.service.ts')
  const schema = read('server/prisma/schema.prisma')
  const page = read('web/src/pages/good-reviews/GoodReviewsPage.tsx')
  const drawer = read('web/src/components/good-reviews/GoodReviewDetailDrawer.tsx')
  const orderRow = read('web/src/components/good-reviews/GoodReviewOrderRow.tsx')
  const image = read('web/src/components/good-reviews/GoodReviewImage.tsx')

  for (const param of [
    'hasImage',
    'hasText',
    'replyStatus',
    'itemKeyword',
    'reviewKeyword',
    'minProductScore',
    'materialTag',
  ]) {
    if (routes.includes(param) && querySvc.includes(param)) ok(`GET 支持 ${param}`)
    else fail(`GET 缺少 ${param}`)
  }

  if (schema.includes('materialTagsJson')) ok('materialTagsJson 字段存在')
  else fail('materialTagsJson 字段缺失')

  if (routes.includes('/:id/material-tags')) ok('POST material-tags 路由存在')
  else fail('POST material-tags 路由缺失')

  if (page.includes('GoodReviewFiltersBar')) ok('前端存在筛选区')
  else fail('前端缺少筛选区')
  if (page.includes('复制直播话术') || page.includes('GoodReviewCopyScriptButton')) {
    ok('前端存在复制直播话术按钮')
  } else {
    fail('前端缺少复制直播话术按钮')
  }
  if (page.includes('GoodReviewMaterialTagPicker') || drawer.includes('GoodReviewMaterialTagPicker')) {
    ok('前端存在素材标签 UI')
  } else {
    fail('前端缺少素材标签 UI')
  }
  if (drawer.includes('直播间可用素材')) ok('详情抽屉有直播间可用素材区域')
  else fail('详情抽屉缺少直播间可用素材区域')
  if (orderRow.includes('if (!trimmed)')) ok('orderId 为空隐藏千帆按钮')
  else fail('千帆按钮空 orderId 判断缺失')
  if (
    page.includes('days: GOOD_REVIEWS_DEFAULT_DAYS') &&
    page.includes('IntersectionObserver') &&
    page.includes('nextCursor')
  ) {
    ok('days=2 + cursor + IntersectionObserver 未回退')
  } else {
    fail('懒加载主链路可能被回退')
  }
  if (image.includes('try') && image.includes('sessionStorage')) {
    ok('GoodReviewImage sessionStorage try/catch 未回退')
  } else {
    fail('GoodReviewImage try/catch 可能被回退')
  }

  const shop = GOOD_REVIEW_SHOPS[0]!.shopKey
  const capped = await queryGoodReviews({ shop, days: 2, limit: 100 })
  if (capped.reviews.length <= 50) ok(`limit 最大 50，实际 ${capped.reviews.length}`)
  else fail(`limit 未封顶：${capped.reviews.length}`)

  const withImage = await queryGoodReviews({ shop, days: 2, limit: 10, hasImage: true })
  if (withImage.reviews.every((r) => r.reviewImages.length > 0)) {
    ok('hasImage=true 返回均有 reviewImages')
  } else if (withImage.reviews.length === 0) {
    ok('hasImage=true 无样本，跳过内容断言')
  } else {
    fail('hasImage=true 存在无图评价')
  }

  const withText = await queryGoodReviews({ shop, days: 2, limit: 10, hasText: true })
  if (withText.reviews.every((r) => r.reviewText?.trim())) {
    ok('hasText=true 返回均有 reviewText')
  } else if (withText.reviews.length === 0) {
    ok('hasText=true 无样本，跳过内容断言')
  } else {
    fail('hasText=true 存在无文字评价')
  }

  const unreplied = await queryGoodReviews({
    shop,
    days: 2,
    limit: 10,
    replyStatus: 'unreplied',
  })
  if (unreplied.reviews.every((r) => r.replyCount === 0)) {
    ok('replyStatus=unreplied 返回 replyCount=0')
  } else if (unreplied.reviews.length === 0) {
    ok('replyStatus=unreplied 无样本，跳过内容断言')
  } else {
    fail('replyStatus=unreplied 存在已回复评价')
  }

  const score5 = await queryGoodReviews({ shop, days: 2, limit: 10, minProductScore: 5 })
  if (score5.reviews.every((r) => (r.productScore ?? 0) >= 5)) {
    ok('minProductScore=5 返回 productScore>=5')
  } else if (score5.reviews.length === 0) {
    ok('minProductScore=5 无样本，跳过内容断言')
  } else {
    fail('minProductScore=5 存在低分评价')
  }

  const sample = await prisma.goodReview.findFirst({
    where: { reviewTime: { not: null } },
    select: { id: true, materialTagsJson: true },
  })
  if (sample) {
    const tags = JSON.parse(sample.materialTagsJson ?? '[]') as unknown
    if (Array.isArray(tags)) ok('materialTagsJson 默认可解析为数组')
    else fail('materialTagsJson 不是数组 JSON')
  } else {
    ok('无 GoodReview 样本，跳过 materialTagsJson 解析检查')
  }

  if (withImage.nextCursor != null || !withImage.hasMore) ok('cursor 翻页字段仍存在')
  else fail('cursor 翻页字段缺失')

  console.log('\n=== 结果 ===')
  if (issues.length > 0) {
    console.log(`FAIL (${issues.length})`)
    for (const i of issues) console.log(` - ${i}`)
    process.exit(1)
  }
  console.log('PASS')
}

main()
  .catch((err) => {
    console.error('FAIL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
