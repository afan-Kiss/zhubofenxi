import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { GOOD_REVIEW_SHOPS } from '../../config/good-review-shops.constants'
import { pickBuyerNicknameFromRaw } from '../buyer-identity.service'
import { getGoodReviewLastSyncedAt } from './good-review-store.service'
import {
  isPlausibleReviewImageUrl,
  normalizeReviewImageUrl,
  resolveReviewImages,
} from './good-review-normalize.service'
import type {
  GoodReviewCursorPayload,
  GoodReviewItemView,
  GoodReviewListFilters,
  GoodReviewPagePayload,
  GoodReviewShopView,
} from './good-review.types'

const DEFAULT_DAYS = 3
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

function pickBuyerNicknameFromReviewRawJson(rawJson: string | null | undefined): string | null {
  if (!rawJson?.trim()) return null
  try {
    const raw = JSON.parse(rawJson) as Record<string, unknown>
    const reviewData =
      raw.review_data && typeof raw.review_data === 'object'
        ? (raw.review_data as Record<string, unknown>)
        : raw.reviewData && typeof raw.reviewData === 'object'
          ? (raw.reviewData as Record<string, unknown>)
          : null
    const userInfo =
      (reviewData?.user_info as Record<string, unknown> | undefined) ??
      (reviewData?.userInfo as Record<string, unknown> | undefined) ??
      (raw.user_info as Record<string, unknown> | undefined) ??
      (raw.userInfo as Record<string, unknown> | undefined)
    if (userInfo && typeof userInfo === 'object') {
      const nick = pickBuyerNicknameFromRaw(userInfo)
      if (nick) return nick
    }
    const nick = pickBuyerNicknameFromRaw(raw)
    return nick || null
  } catch {
    return null
  }
}

function asOrderRawRecord(rawJson: unknown): Record<string, unknown> | undefined {
  if (!rawJson) return undefined
  if (typeof rawJson === 'string') {
    try {
      const parsed = JSON.parse(rawJson) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined
    } catch {
      return undefined
    }
  }
  if (typeof rawJson === 'object' && !Array.isArray(rawJson)) {
    return rawJson as Record<string, unknown>
  }
  return undefined
}

/** 好评接口无买家昵称：按订单号从订单缓存补齐 */
export async function resolveBuyerNicknamesByOrderIds(
  orderIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(orderIds.map((x) => String(x || '').trim()).filter(Boolean)),
  )
  const out = new Map<string, string>()
  if (ids.length === 0) return out

  const rows = await prisma.xhsRawOrder.findMany({
    where: {
      OR: [
        { packageId: { in: ids } },
        { orderId: { in: ids } },
        { displayOrderNo: { in: ids } },
      ],
    },
    select: {
      packageId: true,
      orderId: true,
      displayOrderNo: true,
      rawJson: true,
    },
  })

  for (const row of rows) {
    const nick = pickBuyerNicknameFromRaw(asOrderRawRecord(row.rawJson))
    if (!nick) continue
    for (const key of [row.packageId, row.orderId, row.displayOrderNo]) {
      const k = String(key || '').trim()
      if (k && !out.has(k)) out.set(k, nick)
    }
  }
  return out
}

function rowToReviewView(
  row: {
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
    materialTagsJson?: string
    rawJson: string | null
    isAnonymous: boolean
    likeCount: number
    replyCount: number
    reviewTime: Date | null
    reviewTimeText: string | null
    syncedAt: Date
  },
  buyerNicknameByOrderId?: Map<string, string>,
): GoodReviewItemView {
  const orderId = row.orderId?.trim() || null
  const fromOrder = orderId ? buyerNicknameByOrderId?.get(orderId) : undefined
  // 匿名评价仍展示订单匹配到的真实昵称（运营需要，不做脱敏）
  const buyerNickname =
    fromOrder?.trim() || pickBuyerNicknameFromReviewRawJson(row.rawJson) || null
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
    materialTags: parseJsonArray(row.materialTagsJson),
    buyerNickname,
    isAnonymous: row.isAnonymous,
    likeCount: row.likeCount,
    replyCount: row.replyCount,
    reviewTime: row.reviewTime?.toISOString() ?? null,
    reviewTimeText: row.reviewTimeText,
    syncedAt: row.syncedAt.toISOString(),
  }
}

export { rowToReviewView }

export async function rowToReviewViewWithBuyerNick(row: Parameters<typeof rowToReviewView>[0]) {
  const nickMap = await resolveBuyerNicknamesByOrderIds([row.orderId])
  return rowToReviewView(row, nickMap)
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

function buildMaterialFilters(filters?: GoodReviewListFilters): Prisma.GoodReviewWhereInput[] {
  if (!filters) return []
  const extra: Prisma.GoodReviewWhereInput[] = []
  if (filters.hasImage) {
    extra.push({ NOT: { reviewImagesJson: '[]' } }, { NOT: { reviewImagesJson: '' } })
  }
  if (filters.hasText) {
    extra.push({ reviewText: { not: null } }, { NOT: { reviewText: '' } })
  }
  if (filters.replyStatus === 'replied') {
    extra.push({ replyCount: { gt: 0 } })
  } else if (filters.replyStatus === 'unreplied') {
    extra.push({ replyCount: 0 })
  }
  const itemKeyword = filters.itemKeyword?.trim()
  if (itemKeyword) {
    extra.push({ itemName: { contains: itemKeyword } })
  }
  const reviewKeyword = filters.reviewKeyword?.trim()
  if (reviewKeyword) {
    extra.push({ reviewText: { contains: reviewKeyword } })
  }
  if (filters.minProductScore != null && Number.isFinite(filters.minProductScore)) {
    extra.push({ productScore: { gte: filters.minProductScore } })
  }
  const materialTag = filters.materialTag?.trim()
  if (materialTag) {
    extra.push({ materialTagsJson: { contains: `"${materialTag}"` } })
  }
  return extra
}

function buildShopReviewBaseWhere(params: {
  shopKey?: string
  filters?: GoodReviewListFilters
}): Prisma.GoodReviewWhereInput {
  const andParts: Prisma.GoodReviewWhereInput[] = [{ reviewTime: { not: null } }]
  const materialFilters = buildMaterialFilters(params.filters)
  if (params.shopKey) andParts.unshift({ shopKey: params.shopKey })
  andParts.push(...materialFilters)
  return andParts.length === 1 ? andParts[0]! : { AND: andParts }
}

function buildFilteredWhere(params: {
  shopKey?: string
  rangeStart: Date
  rangeEnd: Date
  filters?: GoodReviewListFilters
}): Prisma.GoodReviewWhereInput {
  const base: Prisma.GoodReviewWhereInput = {
    reviewTime: {
      not: null,
      gte: params.rangeStart,
      lte: params.rangeEnd,
    },
  }
  const materialFilters = buildMaterialFilters(params.filters)
  const andParts: Prisma.GoodReviewWhereInput[] = [base, ...materialFilters]
  if (params.shopKey) {
    andParts.unshift({ shopKey: params.shopKey })
  }
  return andParts.length === 1 ? andParts[0]! : { AND: andParts }
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
  hasImage?: boolean
  hasText?: boolean
  replyStatus?: 'replied' | 'unreplied'
  itemKeyword?: string
  reviewKeyword?: string
  minProductScore?: number
  materialTag?: string
}): Promise<GoodReviewPagePayload> {
  const shopKey = params?.shop?.trim()
  const limit = Math.min(Math.max(params?.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const filters: GoodReviewListFilters = {
    hasImage: params?.hasImage,
    hasText: params?.hasText,
    replyStatus: params?.replyStatus,
    itemKeyword: params?.itemKeyword,
    reviewKeyword: params?.reviewKeyword,
    minProductScore: params?.minProductScore,
    materialTag: params?.materialTag,
  }
  const rawCursor = params?.cursor?.trim() || ''
  const decodedCursor = rawCursor ? decodeGoodReviewCursor(rawCursor) : null
  const { rangeStart, rangeEnd } = resolveReviewRange({
    days: params?.days,
    startDate: params?.startDate,
    endDate: params?.endDate,
  })
  const recentFilteredWhere = buildFilteredWhere({ shopKey, rangeStart, rangeEnd, filters })
  // 非法 cursor 不要回落到「最近 N 天」首屏，否则加载更多会反复空转
  const pageWhere =
    decodedCursor != null
      ? buildCursorWhere(decodedCursor, buildShopReviewBaseWhere({ shopKey, filters }))
      : rawCursor
        ? buildShopReviewBaseWhere({ shopKey, filters })
        : recentFilteredWhere

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
      prisma.goodReview.count({ where: recentFilteredWhere }),
    ])

  let hasMore = reviewRows.length > limit
  const pageRows = hasMore ? reviewRows.slice(0, limit) : reviewRows
  const lastRow = pageRows[pageRows.length - 1]
  const historyBaseWhere = buildShopReviewBaseWhere({ shopKey, filters })

  if (!hasMore && lastRow?.reviewTime) {
    const olderWhere = buildCursorWhere(
      {
        reviewTime: lastRow.reviewTime.toISOString(),
        syncedAt: lastRow.syncedAt.toISOString(),
        id: lastRow.id,
      },
      historyBaseWhere,
    )
    const olderCount = await prisma.goodReview.count({ where: olderWhere })
    hasMore = olderCount > 0
  }

  // 最近 N 天窗口为空时，仍开放「加载更早」：用 rangeStart 作为哨兵游标
  let emptyWindowHistoryCursor: string | null = null
  if (!hasMore && !lastRow && decodedCursor == null) {
    const historyCount = await prisma.goodReview.count({ where: historyBaseWhere })
    if (historyCount > 0) {
      hasMore = true
      emptyWindowHistoryCursor = encodeGoodReviewCursor({
        reviewTime: rangeStart.toISOString(),
        syncedAt: new Date(8.64e15).toISOString(),
        id: '\uffff',
      })
    }
  }

  const nextCursor =
    emptyWindowHistoryCursor ??
    (hasMore && lastRow?.reviewTime
      ? encodeGoodReviewCursor({
          reviewTime: lastRow.reviewTime.toISOString(),
          syncedAt: lastRow.syncedAt.toISOString(),
          id: lastRow.id,
        })
      : null)

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

  const buyerNicknameByOrderId = await resolveBuyerNicknamesByOrderIds(
    pageRows.map((row) => row.orderId),
  )

  return {
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    shops,
    reviews: pageRows.map((row) => rowToReviewView(row, buyerNicknameByOrderId)),
    totalReviewCount,
    returnedReviewCount: pageRows.length,
    filteredReviewCount,
    nextCursor,
    hasMore,
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
  }
}
