import { prisma } from '../../lib/prisma'
import { resolveGoodReviewShopKey } from '../../config/good-review-shops.constants'
import { resolveReviewImages } from './good-review-normalize.service'
import {
  isAllowedGoodReviewImageUrl,
  normalizeProxyImageUrl,
} from './good-review-image-proxy.service'

export interface GoodReviewImageDiagnosticSample {
  reviewId: string | null
  itemName: string | null
  itemImage: string | null
  firstReviewImage: string | null
  itemImageAllowed: boolean
  firstReviewImageAllowed: boolean
  itemImageProxyUrl: string | null
  firstReviewImageProxyUrl: string | null
}

export interface GoodReviewImageDiagnosticsResult {
  totalChecked: number
  withItemImage: number
  withReviewImages: number
  sampleImages: GoodReviewImageDiagnosticSample[]
}

function buildProxyPath(rawUrl: string | null): string | null {
  if (!rawUrl) return null
  const normalized = normalizeProxyImageUrl(rawUrl)
  if (!normalized) return null
  return `/api/good-reviews/image-proxy?url=${encodeURIComponent(rawUrl)}`
}

export async function diagnoseGoodReviewImages(params: {
  shop?: string
  limit?: number
}): Promise<GoodReviewImageDiagnosticsResult> {
  const shopKey = params.shop ? resolveGoodReviewShopKey(params.shop) : null
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 50)
  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)

  const rows = await prisma.goodReview.findMany({
    where: {
      ...(shopKey ? { shopKey } : {}),
      reviewTime: { gte: cutoff },
    },
    orderBy: [{ reviewTime: 'desc' }, { id: 'desc' }],
    take: Math.max(limit * 3, 60),
    select: {
      reviewId: true,
      itemName: true,
      itemImage: true,
      reviewImagesJson: true,
      rawJson: true,
    },
  })

  let withItemImage = 0
  let withReviewImages = 0
  const sampleImages: GoodReviewImageDiagnosticSample[] = []

  for (const row of rows) {
    const reviewImages = resolveReviewImages(row.reviewImagesJson, row.rawJson)
    const itemImage = row.itemImage?.trim() || null
    const firstReviewImage = reviewImages[0] ?? null
    if (itemImage) withItemImage++
    if (reviewImages.length > 0) withReviewImages++

    if (!itemImage && !firstReviewImage) continue
    if (sampleImages.length >= limit) continue

    sampleImages.push({
      reviewId: row.reviewId,
      itemName: row.itemName,
      itemImage,
      firstReviewImage,
      itemImageAllowed: itemImage ? isAllowedGoodReviewImageUrl(itemImage) : false,
      firstReviewImageAllowed: firstReviewImage
        ? isAllowedGoodReviewImageUrl(firstReviewImage)
        : false,
      itemImageProxyUrl: buildProxyPath(itemImage),
      firstReviewImageProxyUrl: buildProxyPath(firstReviewImage),
    })
  }

  return {
    totalChecked: rows.length,
    withItemImage,
    withReviewImages,
    sampleImages,
  }
}
