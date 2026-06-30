/**
 * 好评买家晒图 URL 提取验收
 * 用法: npm run verify:good-review-images
 */
import { normalizeGoodReviewRow } from '../src/services/good-review/good-review-normalize.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function run(): void {
  const issues: string[] = []
  const shopKey = 'shiyuju'

  const stringArray = normalizeGoodReviewRow(shopKey, {
    review_data: {
      content: {
        text: '好评',
        images: ['//qimg.xiaohongshu.com/a.jpg', 'https://qimg.xiaohongshu.com/b.jpg'],
      },
    },
  })
  assert(
    stringArray?.reviewImages.join(',') ===
      'https://qimg.xiaohongshu.com/a.jpg,https://qimg.xiaohongshu.com/b.jpg',
    `字符串数组图片提取失败: ${stringArray?.reviewImages.join('|')}`,
    issues,
  )

  const objectArray = normalizeGoodReviewRow(shopKey, {
    review_data: {
      content: {
        text: '有图',
        images: [{ link: '//qimg.xiaohongshu.com/obj.jpg' }, { url: 'https://qimg.xiaohongshu.com/obj2.jpg' }],
      },
    },
  })
  assert(
    !objectArray?.reviewImages.some((u) => u.includes('[object Object]')),
    '对象数组不应变成 [object Object]',
    issues,
  )
  assert(
    objectArray?.reviewImages[0] === 'https://qimg.xiaohongshu.com/obj.jpg',
    `link 字段提取失败: ${objectArray?.reviewImages[0]}`,
    issues,
  )
  assert(
    objectArray?.reviewImages[1] === 'https://qimg.xiaohongshu.com/obj2.jpg',
    `url 字段提取失败: ${objectArray?.reviewImages[1]}`,
    issues,
  )

  const topLevelImages = normalizeGoodReviewRow(shopKey, {
    images: [{ link: '//qimg.xiaohongshu.com/top.jpg' }],
    review_data: { content: { text: '顶层 images' } },
  })
  assert(
    topLevelImages?.reviewImages[0] === 'https://qimg.xiaohongshu.com/top.jpg',
    `顶层 images 对象提取失败: ${topLevelImages?.reviewImages[0]}`,
    issues,
  )

  const reviewDataLevel = normalizeGoodReviewRow(shopKey, {
    review_data: {
      content: { text: 'review_data 层 images' },
      images: [{ link: '//qimg.xiaohongshu.com/rd.jpg' }],
    },
  })
  assert(
    reviewDataLevel?.reviewImages[0] === 'https://qimg.xiaohongshu.com/rd.jpg',
    `review_data.images 提取失败: ${reviewDataLevel?.reviewImages[0]}`,
    issues,
  )

  if (issues.length) {
    console.error('verify:good-review-images FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:good-review-images OK')
}

run()
