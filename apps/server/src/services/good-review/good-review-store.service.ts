import { prisma } from '../../lib/prisma'
import { resolveReviewImages } from './good-review-normalize.service'
import type {
  NormalizedGoodReview,
  NormalizedGoodReviewShopStats,
} from './good-review.types'

export async function saveGoodReviewShopStats(
  stats: NormalizedGoodReviewShopStats,
  syncedAt: Date,
): Promise<void> {
  await prisma.goodReviewShopSnapshot.upsert({
    where: { shopKey: stats.shopKey },
    create: {
      shopKey: stats.shopKey,
      shopName: stats.shopName,
      shopScore: stats.shopScore,
      totalReviewCount: stats.totalReviewCount,
      goodReviewCount: stats.goodReviewCount,
      mediumReviewCount: stats.mediumReviewCount,
      badReviewCount: stats.badReviewCount,
      withImageCount: stats.withImageCount,
      withTextCount: stats.withTextCount,
      unrepliedCount: stats.unrepliedCount,
      repliedCount: stats.repliedCount,
      pendingInteractionCount: stats.pendingInteractionCount,
      pendingBadReviewCount: stats.pendingBadReviewCount,
      scoreRawJson: stats.scoreRaw ? JSON.stringify(stats.scoreRaw) : null,
      countDetailRawJson: stats.countDetailRaw ? JSON.stringify(stats.countDetailRaw) : null,
      overviewRawJson: stats.overviewRaw ? JSON.stringify(stats.overviewRaw) : null,
      syncedAt,
    },
    update: {
      shopName: stats.shopName,
      shopScore: stats.shopScore,
      totalReviewCount: stats.totalReviewCount,
      goodReviewCount: stats.goodReviewCount,
      mediumReviewCount: stats.mediumReviewCount,
      badReviewCount: stats.badReviewCount,
      withImageCount: stats.withImageCount,
      withTextCount: stats.withTextCount,
      unrepliedCount: stats.unrepliedCount,
      repliedCount: stats.repliedCount,
      pendingInteractionCount: stats.pendingInteractionCount,
      pendingBadReviewCount: stats.pendingBadReviewCount,
      scoreRawJson: stats.scoreRaw ? JSON.stringify(stats.scoreRaw) : null,
      countDetailRawJson: stats.countDetailRaw ? JSON.stringify(stats.countDetailRaw) : null,
      overviewRawJson: stats.overviewRaw ? JSON.stringify(stats.overviewRaw) : null,
      syncedAt,
    },
  })
}

export async function saveGoodReviews(
  reviews: NormalizedGoodReview[],
  syncedAt: Date,
): Promise<number> {
  let saved = 0
  for (const review of reviews) {
    await prisma.goodReview.upsert({
      where: {
        shopKey_dedupeKey: {
          shopKey: review.shopKey,
          dedupeKey: review.dedupeKey,
        },
      },
      create: {
        shopKey: review.shopKey,
        dedupeKey: review.dedupeKey,
        reviewId: review.reviewId,
        orderId: review.orderId,
        itemId: review.itemId,
        skuId: review.skuId,
        itemName: review.itemName,
        itemImage: review.itemImage,
        itemPriceCent: review.itemPriceCent,
        itemQuantity: review.itemQuantity,
        productScore: review.productScore,
        serviceScore: review.serviceScore,
        logisticsScore: review.logisticsScore,
        reviewText: review.reviewText,
        reviewImagesJson: JSON.stringify(review.reviewImages),
        reviewTagsJson: JSON.stringify(review.reviewTags),
        isAnonymous: review.isAnonymous,
        likeCount: review.likeCount,
        replyCount: review.replyCount,
        reviewTime: review.reviewTime,
        reviewTimeText: review.reviewTimeText,
        rawJson: JSON.stringify(review.raw),
        syncedAt,
      },
      update: {
        reviewId: review.reviewId,
        orderId: review.orderId,
        itemId: review.itemId,
        skuId: review.skuId,
        itemName: review.itemName,
        itemImage: review.itemImage,
        itemPriceCent: review.itemPriceCent,
        itemQuantity: review.itemQuantity,
        productScore: review.productScore,
        serviceScore: review.serviceScore,
        logisticsScore: review.logisticsScore,
        reviewText: review.reviewText,
        reviewImagesJson: JSON.stringify(review.reviewImages),
        reviewTagsJson: JSON.stringify(review.reviewTags),
        isAnonymous: review.isAnonymous,
        likeCount: review.likeCount,
        replyCount: review.replyCount,
        reviewTime: review.reviewTime,
        reviewTimeText: review.reviewTimeText,
        rawJson: JSON.stringify(review.raw),
        syncedAt,
      },
    })
    saved += 1
  }
  return saved
}

export async function touchGoodReviewSyncMeta(syncedAt: Date): Promise<void> {
  await prisma.goodReviewSyncMeta.upsert({
    where: { id: 'default' },
    create: { id: 'default', lastSyncedAt: syncedAt },
    update: { lastSyncedAt: syncedAt },
  })
}

export async function getGoodReviewLastSyncedAt(): Promise<Date | null> {
  const row = await prisma.goodReviewSyncMeta.findUnique({ where: { id: 'default' } })
  return row?.lastSyncedAt ?? null
}

export async function repairCorruptedGoodReviewImages(): Promise<number> {
  const rows = await prisma.goodReview.findMany({
    where: { reviewImagesJson: { contains: 'object Object' } },
    select: { id: true, reviewImagesJson: true, rawJson: true },
  })

  let fixed = 0
  for (const row of rows) {
    const images = resolveReviewImages(row.reviewImagesJson, row.rawJson)
    if (!images.length) continue
    await prisma.goodReview.update({
      where: { id: row.id },
      data: { reviewImagesJson: JSON.stringify(images) },
    })
    fixed += 1
  }
  return fixed
}
