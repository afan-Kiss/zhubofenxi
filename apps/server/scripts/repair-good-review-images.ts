/**
 * 从 rawJson 修复库里 reviewImagesJson 为 [object Object] 的记录
 * 用法: npm run repair:good-review-images
 */
import { prisma } from '../src/lib/prisma'
import { repairCorruptedGoodReviewImages } from '../src/services/good-review/good-review-store.service'

async function main(): Promise<void> {
  const fixed = await repairCorruptedGoodReviewImages()
  console.log(`repair:good-review-images OK, fixed=${fixed}`)
}

void main()
  .catch((err) => {
    console.error('repair:good-review-images FAILED', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
