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
  if (page.includes('GOOD_REVIEWS_DEFAULT_DAYS') || page.includes('days: 2')) ok('GoodReviewsPage 使用 days=2')
  else fail('GoodReviewsPage 未使用 days=2')
  if (page.includes('nextCursor') && page.includes('hasMore')) ok('GoodReviewsPage 使用 cursor/hasMore')
  else fail('GoodReviewsPage 缺少 cursor/hasMore')
  if (page.includes('IntersectionObserver')) ok('GoodReviewsPage 无限滚动')
  else fail('GoodReviewsPage 缺少 IntersectionObserver')
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
    page.includes('自动更新失败') &&
    page.includes('当前先展示本地已有好评')
  ) {
    ok('背景自动同步失败有用户可见提示')
  } else {
    fail('缺少背景自动同步失败提示')
  }
  if (page.includes('累计评价总数') && page.includes('最近 2 天展示')) {
    ok('统计卡片区分累计与最近 2 天')
  } else {
    fail('统计卡片未区分累计与最近 2 天')
  }

  const image = read('web/src/components/good-reviews/GoodReviewImage.tsx')
  if (image.includes('try') && image.includes('sessionStorage')) ok('GoodReviewImage try/catch sessionStorage')
  else fail('GoodReviewImage 缺少 try/catch')
  if (image.includes('IntersectionObserver')) ok('GoodReviewImage 视口懒加载')
  else fail('GoodReviewImage 缺少 IntersectionObserver 懒加载')

  const drawer = read('web/src/components/good-reviews/GoodReviewDetailDrawer.tsx')
  if (drawer.includes('buildGoodReviewImageProxyUrl')) ok('DetailDrawer 图片用 buildGoodReviewImageProxyUrl')
  else fail('DetailDrawer 未用 buildGoodReviewImageProxyUrl')

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
