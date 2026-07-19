/**
 * 好评中心页面静态验收
 *
 * npm run verify:good-reviews-page-static
 */
import fs from 'node:fs'
import path from 'node:path'

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

function main(): void {
  console.log('verify-good-reviews-page-static')

  const page = read('web/src/pages/good-reviews/GoodReviewsPage.tsx')
  const lib = read('web/src/lib/good-reviews.ts')
  if (lib.includes('GOOD_REVIEWS_DEFAULT_DAYS = 3')) ok('默认 days=3')
  else fail('未设置 GOOD_REVIEWS_DEFAULT_DAYS = 3')
  if (page.includes('nextCursor') && page.includes('hasMore')) ok('GoodReviewsPage 使用 cursor/hasMore')
  else fail('GoodReviewsPage 缺少 cursor/hasMore')
  if (page.includes('IntersectionObserver')) ok('GoodReviewsPage 无限滚动')
  else fail('GoodReviewsPage 缺少 IntersectionObserver')
  if (!page.includes('syncCurrentShop') && !page.includes('autoSyncStatusByShopRef')) {
    ok('GoodReviewsPage 已移除打开页自动同步')
  } else {
    fail('GoodReviewsPage 仍含自动同步逻辑')
  }
  if (page.includes('AbortController') && page.includes('requestSeqRef')) {
    ok('GoodReviewsPage AbortController + requestSeqRef')
  } else {
    fail('GoodReviewsPage 缺少 AbortController/requestSeqRef')
  }
  if (
    (page.includes('loadingMoreRef') || page.includes('inFlightCursorRef')) &&
    page.includes('inFlightCursorRef')
  ) {
    ok('GoodReviewsPage 懒加载硬锁 loadingMoreRef / inFlightCursorRef')
  } else {
    fail('GoodReviewsPage 缺少 loadingMoreRef 或 inFlightCursorRef')
  }
  if (page.includes('requestAnimationFrame(probeVisible)')) {
    ok('GoodReviewsPage 列表懒加载含首屏探测')
  } else {
    fail('GoodReviewsPage 列表懒加载缺少首屏探测')
  }
  if (
    page.includes('自动更新失败') ||
    page.includes('打开页面会自动尝试更新')
  ) {
    fail('仍保留打开页自动更新提示')
  } else {
    ok('无打开页自动更新提示')
  }
  if (
    page.includes('当前先展示本地已有好评') ||
    page.includes('最后同步')
  ) {
    ok('背景自动同步失败有用户可见提示')
  } else {
    fail('缺少本地列表说明')
  }
  if (page.includes('累计评价总数') && page.includes('最近 3 天')) {
    ok('统计卡片区分累计与最近 3 天')
  } else {
    fail('统计卡片未区分累计与最近 3 天')
  }
  if (page.includes('formatGoodReviewBuyerLabel') && page.includes('买家：')) {
    ok('好评卡片展示买家昵称')
  } else {
    fail('好评卡片未展示买家昵称')
  }
  if (
    !page.includes('review.reviewText') &&
    !page.includes('买家未填写文字评价')
  ) {
    ok('好评卡片不再展示评价正文')
  } else {
    fail('好评卡片仍展示评价正文')
  }

  const image = read('web/src/components/good-reviews/GoodReviewImage.tsx')
  if (image.includes('try') && image.includes('sessionStorage')) ok('GoodReviewImage try/catch sessionStorage')
  else fail('GoodReviewImage 缺少 try/catch')
  if (image.includes('IntersectionObserver')) ok('GoodReviewImage 视口懒加载')
  else fail('GoodReviewImage 缺少 IntersectionObserver 懒加载')

  const drawer = read('web/src/components/good-reviews/GoodReviewDetailDrawer.tsx')
  if (drawer.includes('buildGoodReviewImageProxyUrl')) ok('DetailDrawer 图片用 buildGoodReviewImageProxyUrl')
  else fail('DetailDrawer 未用 buildGoodReviewImageProxyUrl')
  if (drawer.includes('formatGoodReviewBuyerLabel') && !drawer.includes('review.reviewText')) {
    ok('DetailDrawer 展示买家昵称且不展示评价正文')
  } else {
    fail('DetailDrawer 仍展示评价正文或缺少买家昵称')
  }

  if (lib.includes('buyerNickname') && lib.includes('formatGoodReviewBuyerLabel')) {
    ok('前端类型含 buyerNickname')
  } else {
    fail('前端类型缺少 buyerNickname')
  }

  const orderRow = read('web/src/components/good-reviews/GoodReviewOrderRow.tsx')
  if (orderRow.includes('if (!trimmed)')) ok('OrderRow 空 orderId 不展示千帆按钮')
  else fail('OrderRow 缺少空 orderId 分支')

  console.log('\n=== 结果 ===')
  if (issues.length > 0) {
    console.log(`FAIL (${issues.length})`)
    for (const i of issues) console.log(` - ${i}`)
    process.exit(1)
  }
  console.log('PASS')
}

main()
