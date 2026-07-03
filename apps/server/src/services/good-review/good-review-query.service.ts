import { prisma } from '../../lib/prisma'
import { GOOD_REVIEW_SHOPS } from '../../config/good-review-shops.constants'
import { getGoodReviewLastSyncedAt } from './good-review-store.service'
import {
  isPlausibleReviewImageUrl,
  normalizeReviewImageUrl,
  resolveReviewImages,
} from './good-review-normalize.service'
import type {
  GoodReviewItemView,
  GoodReviewPagePayload,
  GoodReviewShopView,
} from './good-review.types'

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : []
  } catch {
    return []
  }
}

function rowToShopView(row: {
  shopKey: string
  shopName: string
  shopScore: number | null
  totalReviewCount: number
  goodReviewCount: number
  mediumReviewCount: number
  badReviewCount: number
  withImageCount: number
  withTextCount: number
  unrepliedCount: number
  repliedCount: number
  pendingInteractionCount: number
  pendingBadReviewCount: number
  syncedAt: Date | null
}): GoodReviewShopView {
  return {
    shopKey: row.shopKey,
    shopName: row.shopName,
    shopScore: row.shopScore,
    totalReviewCount: row.totalReviewCount,
    goodReviewCount: row.goodReviewCount,
    mediumReviewCount: row.mediumReviewCount,
    badReviewCount: row.badReviewCount,
    withImageCount: row.withImageCount,
    withTextCount: row.withTextCount,
    unrepliedCount: row.unrepliedCount,
    repliedCount: row.repliedCount,
    pendingInteractionCount: row.pendingInteractionCount,
    pendingBadReviewCount: row.pendingBadReviewCount,
    syncedAt: row.syncedAt?.toISOString() ?? null,
  }
}

function rowToReviewView(row: {
  id: string
  shopKey: string
  reviewId: string | null
  orderId: string | null
  itemId: string | null
  skuId: string | null
  itemName: string | null
  itemImage: string | null
  itemPriceCent: number | null
  itemQuantity: number | null
  productScore: number | null
  serviceScore: number | null
  logisticsScore: number | null
  reviewText: string | null
  reviewImagesJson: string
  reviewTagsJson: string
  rawJson: string | null
  isAnonymous: boolean
  likeCount: number
  replyCount: number
  reviewTime: Date | null
  reviewTimeText: string | null
  syncedAt: Date
}): GoodReviewItemView {
  return {
    id: row.id,
    shopKey: row.shopKey,
    reviewId: row.reviewId,
    orderId: row.orderId,
    itemId: row.itemId,
    skuId: row.skuId,
    itemName: row.itemName,
    itemImage: isPlausibleReviewImageUrl(row.itemImage)
      ? normalizeReviewImageUrl(row.itemImage)
      : null,
    itemPriceCent: row.itemPriceCent,
    itemQuantity: row.itemQuantity,
    productScore: row.productScore,
    serviceScore: row.serviceScore,
    logisticsScore: row.logisticsScore,
    reviewText: row.reviewText,
    reviewImages: resolveReviewImages(row.reviewImagesJson, row.rawJson),
    reviewTags: parseJsonArray(row.reviewTagsJson),
    isAnonymous: row.isAnonymous,
    likeCount: row.likeCount,
    replyCount: row.replyCount,
    reviewTime: row.reviewTime?.toISOString() ?? null,
    reviewTimeText: row.reviewTimeText,
    syncedAt: row.syncedAt.toISOString(),
  }
}

export async function queryGoodReviews(params?: {
  shop?: string
  limit?: number
}): Promise<GoodReviewPagePayload> {
  const shopKey = params?.shop?.trim()
  const limit = Math.min(Math.max(params?.limit ?? 200, 1), 500)

  const reviewWhere = shopKey ? { shopKey } : undefined

  const [lastSyncedAt, snapshotRows, reviewRows, totalReviewCount] = await Promise.all([
    getGoodReviewLastSyncedAt(),
    prisma.goodReviewShopSnapshot.findMany({ orderBy: { shopKey: 'asc' } }),
    prisma.goodReview.findMany({
      where: reviewWhere,
      orderBy: [{ reviewTime: 'desc' }, { syncedAt: 'desc' }],
      take: limit,
    }),
    prisma.goodReview.count({ where: reviewWhere }),
  ])

  const snapshotByKey = new Map(snapshotRows.map((row) => [row.shopKey, row]))
  const shops: GoodReviewShopView[] = GOOD_REVIEW_SHOPS.map((def) => {
    const row = snapshotByKey.get(def.shopKey)
    if (row) return rowToShopView(row)
    return {
      shopKey: def.shopKey,
      shopName: def.shopName,
      shopScore: null,
      totalReviewCount: 0,
      goodReviewCount: 0,
      mediumReviewCount: 0,
      badReviewCount: 0,
      withImageCount: 0,
      withTextCount: 0,
      unrepliedCount: 0,
      repliedCount: 0,
      pendingInteractionCount: 0,
      pendingBadReviewCount: 0,
      syncedAt: null,
    }
  })

  return {
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    shops,
    reviews: reviewRows.map(rowToReviewView),
    totalReviewCount,
    returnedReviewCount: reviewRows.length,
  }
}
