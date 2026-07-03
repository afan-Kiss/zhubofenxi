/**
 * 从 rawJson 修复库里 itemPriceCent 被 *100 的错误记录
 * 用法: npm run repair:good-review-prices
 */
import { prisma } from '../src/lib/prisma'
import { repairCorruptedGoodReviewPrices } from '../src/services/good-review/good-review-store.service'

async function main(): Promise<void> {
  const fixed = await repairCorruptedGoodReviewPrices()
  console.log(`repair:good-review-prices OK, fixed=${fixed}`)
}

void main()
  .catch((err) => {
    console.error('repair:good-review-prices FAILED', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
