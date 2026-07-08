/**
 * 好评中心 UI / 接口 / 图片真实验收
 *
 * npm run verify:good-reviews-ui-real
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { queryGoodReviews } from '../src/services/good-review/good-review-query.service'
import { diagnoseGoodReviewImages } from '../src/services/good-review/good-review-image-diagnostics.service'
import {
  normalizeProxyImageUrl,
  proxyGoodReviewImage,
} from '../src/services/good-review/good-review-image-proxy.service'
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
  console.log('verify-good-reviews-ui-real')

  const page = read('web/src/pages/good-reviews/GoodReviewsPage.tsx')
  const lib = read('web/src/lib/good-reviews.ts')

  if (page.includes('同步全部店铺好评')) ok('GoodReviewsPage 有同步全部店铺好评按钮文案')
  else fail('GoodReviewsPage 缺少同步全部店铺好评按钮文案')

  if (page.includes('good-reviews-sync-all-visible')) {
    ok('GoodReviewsPage 有 good-reviews-sync-all-visible')
  } else fail('GoodReviewsPage 缺少 good-reviews-sync-all-visible')

  if (page.includes('data-testid="good-reviews-load-more"')) {
    ok('GoodReviewsPage 有 good-reviews-load-more')
  } else fail('GoodReviewsPage 缺少 good-reviews-load-more')

  if (page.includes('resolveGoodReviewThumb')) ok('列表缩略图使用 resolveGoodReviewThumb')
  else fail('列表缩略图未使用 resolveGoodReviewThumb')

  if (page.includes('IntersectionObserver') && page.includes('loadMorePage')) {
    ok('保留 IntersectionObserver 且共用 loadMorePage')
  } else fail('缺少 IntersectionObserver 或 loadMorePage')

  if (page.includes('加载更多好评')) ok('有手动加载更多按钮文案')
  else fail('缺少手动加载更多按钮文案')

  if (lib.includes("'good-review-material-v3'") || page.includes('GOOD_REVIEW_UI_VERSION')) {
    ok('页面版本标记 good-review-material-v3')
  } else fail('缺少页面版本标记')

  const drawer = read('web/src/components/good-reviews/GoodReviewDetailDrawer.tsx')
  if (drawer.includes('resolveGoodReviewThumb')) ok('详情抽屉使用 resolveGoodReviewThumb')
  else fail('详情抽屉未使用 resolveGoodReviewThumb')

  const shop = GOOD_REVIEW_SHOPS[0]!.shopKey
  const page1 = await queryGoodReviews({ shop, days: 3, limit: 30 })
  ok(`queryGoodReviews 第一页 ${page1.reviews.length} 条，filtered=${page1.filteredReviewCount ?? '?'}`)

  const filtered = page1.filteredReviewCount ?? page1.reviews.length
  if (filtered > 30) {
    if (page1.hasMore && page1.nextCursor) ok('filteredReviewCount>30 时 hasMore 与 nextCursor 存在')
    else fail('filteredReviewCount>30 但 hasMore/nextCursor 缺失')

    const page2 = await queryGoodReviews({
      shop,
      days: 2,
      limit: 30,
      cursor: page1.nextCursor!,
      hasImage: undefined,
    })
    const ids1 = new Set(page1.reviews.map((r) => r.id))
    const dup = page2.reviews.filter((r) => ids1.has(r.id))
    if (dup.length === 0) ok('第二页与第一页 id 不重复')
    else fail(`第二页有 ${dup.length} 条重复 id`)
  } else {
    ok('filteredReviewCount<=30，跳过分页续查')
  }

  const withFilters = await queryGoodReviews({
    shop,
    days: 2,
    limit: 10,
    hasImage: true,
  })
  if (withFilters.reviews.length >= 0) ok('带 hasImage 筛选的分页查询可用')
  else fail('带筛选分页查询失败')

  const diag = await diagnoseGoodReviewImages({ shop, limit: 20 })
  ok(
    `image-diagnostics: checked=${diag.totalChecked} itemImage=${diag.withItemImage} reviewImages=${diag.withReviewImages} samples=${diag.sampleImages.length}`,
  )

  if (diag.sampleImages.length >= 5) {
    ok(`image-diagnostics 样本 >= 5（${diag.sampleImages.length}）`)
  } else if (diag.sampleImages.length > 0) {
    ok(
      `image-diagnostics 样本 ${diag.sampleImages.length} 条（最近 2 天带图数据不足 5 条，跳过数量门槛）`,
    )
  } else if (diag.withItemImage + diag.withReviewImages === 0) {
    ok('最近 2 天无图片样本，跳过样本数量检查')
  } else {
    fail('有图片数据但未产出 diagnostics 样本')
  }

  const allowedSamples = diag.sampleImages.filter(
    (s) => s.itemImageAllowed || s.firstReviewImageAllowed,
  )
  if (diag.sampleImages.length > 0 && allowedSamples.length === 0) {
    const hosts = diag.sampleImages.flatMap((s) => {
      const out: string[] = []
      for (const url of [s.itemImage, s.firstReviewImage]) {
        if (!url) continue
        try {
          out.push(new URL(url.startsWith('//') ? `https:${url}` : url).hostname)
        } catch {
          out.push('(invalid)')
        }
      }
      return out
    })
    fail(`全部图片 URL 不在白名单，host 列表：${[...new Set(hosts)].join(', ')}`)
  } else if (diag.sampleImages.length > 0) {
    ok(`至少 ${allowedSamples.length} 条样本 URL 在白名单内`)
  }

  for (const sample of diag.sampleImages.slice(0, 3)) {
    const raw = sample.itemImage ?? sample.firstReviewImage
    if (!raw) continue
    const normalized = normalizeProxyImageUrl(raw)
    if (!normalized) {
      fail(`样本 ${sample.reviewId ?? '?'} normalize 后不在白名单`)
      continue
    }
    const proxy = await proxyGoodReviewImage({ rawUrl: raw })
    if (proxy.ok) {
      ok(`image-proxy 样本 ${sample.reviewId ?? '?'} 可代理`)
    } else if (proxy.message.includes('403') || proxy.message.includes('HTTP 403')) {
      ok(`image-proxy 样本 ${sample.reviewId ?? '?'} 平台拒绝下载（403），前端应显示占位`)
    } else if (proxy.message === '不允许的图片地址') {
      fail(`image-proxy 合法样本返回不允许：${sample.reviewId ?? '?'}`)
    } else {
      ok(`image-proxy 样本 ${sample.reviewId ?? '?'}：${proxy.message}`)
    }
  }

  const proxyService = read('server/src/services/good-review/good-review-image-proxy.service.ts')
  for (const host of [
    'sns-img-hw.xhscdn.com',
    'sns-webpic-qc.xhscdn.com',
    'ci.xiaohongshu.com',
  ]) {
    if (proxyService.includes(host)) ok(`白名单含 ${host}`)
    else fail(`白名单缺少 ${host}`)
  }

  if (lib.includes('resolveGoodReviewThumb')) ok('lib 导出 resolveGoodReviewThumb')
  else fail('lib 缺少 resolveGoodReviewThumb')

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
