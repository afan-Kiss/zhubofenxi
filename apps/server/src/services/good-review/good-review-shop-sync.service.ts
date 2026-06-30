import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  fetchAllGoodReviews,
  fetchReviewCountDetail,
  fetchReviewOverview,
  fetchShopScore,
} from './good-review-api.service'
import {
  mergeShopStats,
  parseReviewCountDetail,
  parseReviewOverview,
  parseShopScore,
} from './good-review-normalize.service'
import { saveGoodReviewShopStats, saveGoodReviews } from './good-review-store.service'
import type { GoodReviewSyncShopResult, NormalizedGoodReviewShopStats } from './good-review.types'

export async function syncGoodReviewsForShop(
  shop: GoodReviewShopDefinition,
): Promise<GoodReviewSyncShopResult> {
  const syncedAt = new Date()
  try {
    const [scorePayload, countPayload, overviewPayload, reviewPayload] = await Promise.all([
      fetchShopScore(shop),
      fetchReviewCountDetail(shop),
      fetchReviewOverview(shop),
      fetchAllGoodReviews(shop),
    ])

    const scorePart = parseShopScore(scorePayload)
    const stats: NormalizedGoodReviewShopStats = mergeShopStats(shop.shopKey, shop.shopName, [
      { shopScore: scorePart.shopScore, scoreRaw: scorePart.raw },
      parseReviewCountDetail(countPayload),
      parseReviewOverview(overviewPayload),
    ])

    if (reviewPayload.totalReviewCount != null && reviewPayload.totalReviewCount > 0) {
      stats.totalReviewCount = Math.max(stats.totalReviewCount, reviewPayload.totalReviewCount)
    }
    if (reviewPayload.reviews.length > 0) {
      stats.goodReviewCount = Math.max(stats.goodReviewCount, reviewPayload.reviews.length)
    }

    await saveGoodReviewShopStats(stats, syncedAt)
    await saveGoodReviews(reviewPayload.reviews, syncedAt)

    const latest = reviewPayload.reviews
      .map((r) => r.reviewTime ?? (r.reviewTimeText ? new Date(r.reviewTimeText) : null))
      .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0]

    return {
      shopKey: shop.shopKey,
      shopName: shop.shopName,
      success: true,
      syncedReviewCount: reviewPayload.reviews.length,
      totalReviewCount: stats.totalReviewCount,
      latestReviewTime: latest?.toISOString(),
    }
  } catch (err) {
    return {
      shopKey: shop.shopKey,
      shopName: shop.shopName,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
