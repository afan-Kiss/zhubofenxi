import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { GOOD_REVIEW_SHOPS } from '../../config/good-review-shops.constants'
import { getGoodReviewLastSyncedAt } from './good-review-store.service'
import {
  isPlausibleReviewImageUrl,
  normalizeReviewImageUrl,
  resolveReviewImages,
} from './good-review-normalize.service'
import type {
  GoodReviewCursorPayload,
  GoodReviewItemView,
  GoodReviewPagePayload,
  GoodReviewShopView,
} from './good-review.types'

const DEFAULT_DAYS = 2
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 50

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

export function encodeGoodReviewCursor(payload: GoodReviewCursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeGoodReviewCursor(raw: string): GoodReviewCursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as GoodReviewCursorPayload
    if (!parsed?.id || !parsed.reviewTime || !parsed.syncedAt) return null
    return parsed
  } catch {
    return null
  }
}

function resolveReviewRange(params: {
  days?: number
  startDate?: string
  endDate?: string
}): { rangeStart: Date; rangeEnd: Date } {
  const now = new Date()
  const startRaw = params.startDate?.trim()
  const endRaw = params.endDate?.trim()
  if (startRaw && endRaw) {
    const rangeStart = new Date(`${startRaw}T00:00:00.000Z`)
    const rangeEnd = new Date(`${endRaw}T23:59:59.999Z`)
    if (!Number.isNaN(rangeStart.getTime()) && !Number.isNaN(rangeEnd.getTime())) {
      return { rangeStart, rangeEnd }
    }
  }
  const days = Math.max(1, params.days ?? DEFAULT_DAYS)
  return {
    rangeStart: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    rangeEnd: now,
  }
}

function buildFilteredWhere(params: {
  shopKey?: string
  rangeStart: Date
  rangeEnd: Date
}): Prisma.GoodReviewWhereInput {
  const base: Prisma.GoodReviewWhereInput = {
    reviewTime: {
      not: null,
      gte: params.rangeStart,
      lte: params.rangeEnd,
    },
  }
  if (params.shopKey) {
    return { shopKey: params.shopKey, ...base }
  }
  return base
}

function buildCursorWhere(
  cursor: GoodReviewCursorPayload,
  baseWhere: Prisma.GoodReviewWhereInput,
): Prisma.GoodReviewWhereInput {
  const cursorReviewTime = new Date(cursor.reviewTime)
  const cursorSyncedAt = new Date(cursor.syncedAt)
  return {
    AND: [
      baseWhere,
      {
        OR: [
          { reviewTime: { lt: cursorReviewTime } },
          {
            reviewTime: cursorReviewTime,
            syncedAt: { lt: cursorSyncedAt },
          },
          {
            reviewTime: cursorReviewTime,
            syncedAt: cursorSyncedAt,
            id: { lt: cursor.id },
          },
        ],
      },
    ],
  }
}

export async function queryGoodReviews(params?: {
  shop?: string
  limit?: number
  cursor?: string
  days?: number
  startDate?: string
  endDate?: string
}): Promise<GoodReviewPagePayload> {
  const shopKey = params?.shop?.trim()
  const limit = Math.min(Math.max(params?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const { rangeStart, rangeEnd } = resolveReviewRange({
    days: params?.days,
    startDate: params?.startDate,
    endDate: params?.endDate,
  })
  const filteredWhere = buildFilteredWhere({ shopKey, rangeStart, rangeEnd })
  const decodedCursor = params?.cursor?.trim()
    ? decodeGoodReviewCursor(params.cursor.trim())
    : null
  const pageWhere =
    decodedCursor != null ? buildCursorWhere(decodedCursor, filteredWhere) : filteredWhere

  const reviewWhereAll = shopKey ? { shopKey } : undefined

  const [lastSyncedAt, snapshotRows, reviewRows, totalReviewCount, filteredReviewCount] =
    await Promise.all([
      getGoodReviewLastSyncedAt(),
      prisma.goodReviewShopSnapshot.findMany({ orderBy: { shopKey: 'asc' } }),
      prisma.goodReview.findMany({
        where: pageWhere,
        orderBy: [{ reviewTime: 'desc' }, { syncedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      prisma.goodReview.count({ where: reviewWhereAll }),
      prisma.goodReview.count({ where: filteredWhere }),
    ])

  const hasMore = reviewRows.length > limit
  const pageRows = hasMore ? reviewRows.slice(0, limit) : reviewRows
  const lastRow = pageRows[pageRows.length - 1]
  const nextCursor =
    hasMore && lastRow?.reviewTime
      ? encodeGoodReviewCursor({
          reviewTime: lastRow.reviewTime.toISOString(),
          syncedAt: lastRow.syncedAt.toISOString(),
          id: lastRow.id,
        })
      : null

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
    reviews: pageRows.map(rowToReviewView),
    totalReviewCount,
    returnedReviewCount: pageRows.length,
    filteredReviewCount,
    nextCursor,
    hasMore,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
  }
}
