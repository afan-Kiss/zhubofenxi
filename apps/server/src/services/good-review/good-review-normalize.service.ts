function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key]
    if (val == null) continue
    const text = String(val).trim()
    if (text) return text
  }
  return null
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const val = obj[key]
    if (val == null || val === '') continue
    const num = Number(val)
    if (Number.isFinite(num)) return num
  }
  return null
}

function pickBool(obj: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'boolean') return val
    if (val === 1 || val === '1' || val === 'true') return true
    if (val === 0 || val === '0' || val === 'false') return false
  }
  return false
}

function pickStringArray(obj: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const val = obj[key]
    if (Array.isArray(val)) {
      return val.map((x) => String(x)).filter(Boolean)
    }
  }
  return []
}

function pickImages(obj: Record<string, unknown>): string[] {
  const direct = pickStringArray(obj, ['reviewImages', 'images', 'imageList', 'picList', 'pics'])
  if (direct.length) return direct

  const imageInfo = obj.imageInfo ?? obj.image_info ?? obj.reviewImageInfo
  if (Array.isArray(imageInfo)) {
    const urls: string[] = []
    for (const item of imageInfo) {
      const rec = asRecord(item)
      if (!rec) continue
      const url = pickString(rec, ['url', 'imageUrl', 'picUrl', 'src'])
      if (url) urls.push(url)
    }
    if (urls.length) return urls
  }

  const single = pickString(obj, ['imageUrl', 'picUrl', 'cover'])
  return single ? [single] : []
}

function parseReviewTime(raw: Record<string, unknown>): { date: Date | null; text: string | null } {
  const text = pickString(raw, [
    'createTime',
    'create_time',
    'reviewTime',
    'review_time',
    'commentTime',
    'comment_time',
    'time',
  ])
  if (!text) return { date: null, text: null }

  const ms = pickNumber(raw, ['createTimeMs', 'create_time_ms', 'reviewTimeMs'])
  if (ms != null && ms > 1_000_000_000_000) {
    return { date: new Date(ms), text }
  }

  const numeric = Number(text)
  if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
    const date = new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000)
    if (!Number.isNaN(date.getTime())) return { date, text }
  }

  const parsed = new Date(text.replace(/\./g, '-'))
  if (!Number.isNaN(parsed.getTime())) return { date: parsed, text }
  return { date: null, text }
}

export function buildGoodReviewDedupeKey(
  shopKey: string,
  reviewId: string | null,
  orderId: string | null,
  createTime: string | null,
): string {
  if (reviewId) return `${shopKey}::${reviewId}`
  return `${shopKey}::${orderId ?? 'unknown'}::${createTime ?? 'unknown'}`
}

export function normalizeGoodReviewRow(
  shopKey: string,
  raw: Record<string, unknown>,
): import('./good-review.types').NormalizedGoodReview | null {
  const reviewId = pickString(raw, ['reviewId', 'review_id', 'id', 'commentId', 'comment_id'])
  const orderId = pickString(raw, ['orderId', 'order_id', 'packageId', 'package_id', 'orderNo'])
  const { date, text } = parseReviewTime(raw)
  const dedupeKey = buildGoodReviewDedupeKey(shopKey, reviewId, orderId, text)

  const item = asRecord(raw.itemInfo) ?? asRecord(raw.item_info) ?? asRecord(raw.goodsInfo) ?? raw
  const sku = asRecord(raw.skuInfo) ?? asRecord(raw.sku_info) ?? item

  const reviewText = pickString(raw, [
    'content',
    'reviewContent',
    'review_content',
    'commentContent',
    'comment_content',
    'text',
  ])

  const priceYuan = pickNumber(item, ['price', 'salePrice', 'itemPrice', 'payPrice'])
  const priceCent =
    pickNumber(item, ['priceCent', 'price_cent']) ??
    (priceYuan != null ? Math.round(priceYuan * 100) : null)

  return {
    shopKey,
    dedupeKey,
    reviewId,
    orderId,
    itemId: pickString(item, ['itemId', 'item_id', 'goodsId', 'goods_id', 'productId']),
    skuId: pickString(sku, ['skuId', 'sku_id']),
    itemName: pickString(item, ['itemName', 'item_name', 'goodsName', 'goods_name', 'name', 'title']),
    itemImage: pickString(item, ['itemImage', 'item_image', 'image', 'cover', 'picUrl']),
    itemPriceCent: priceCent,
    itemQuantity: pickNumber(raw, ['quantity', 'itemQuantity', 'item_quantity', 'buyCount']),
    productScore: pickNumber(raw, ['productScore', 'product_score', 'goodsScore', 'score', 'itemScore']),
    serviceScore: pickNumber(raw, ['serviceScore', 'service_score', 'sellerScore']),
    logisticsScore: pickNumber(raw, ['logisticsScore', 'logistics_score', 'deliveryScore']),
    reviewText,
    reviewImages: pickImages(raw),
    reviewTags: pickStringArray(raw, ['tags', 'reviewTags', 'review_tags', 'labelList']),
    isAnonymous: pickBool(raw, ['anonymous', 'isAnonymous', 'is_anonymous']),
    likeCount: pickNumber(raw, ['likeCount', 'like_count', 'thumbUpCount']) ?? 0,
    replyCount: pickNumber(raw, ['replyCount', 'reply_count', 'commentReplyCount']) ?? 0,
    reviewTime: date,
    reviewTimeText: text,
    raw,
  }
}

export function extractReviewList(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  if (!root) return []
  const data = asRecord(root.data) ?? root
  const candidates = [
    data.reviewList,
    data.reviews,
    data.list,
    data.records,
    data.items,
    data.resultList,
    data.commentList,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map((x) => asRecord(x)).filter((x): x is Record<string, unknown> => Boolean(x))
    }
  }
  return []
}

export function extractReviewTotal(payload: unknown): number | null {
  const root = asRecord(payload)
  if (!root) return null
  const data = asRecord(root.data) ?? root
  return (
    pickNumber(data, ['total', 'totalCount', 'total_count', 'count']) ??
    pickNumber(root, ['total', 'totalCount'])
  )
}

export function parseShopScore(payload: unknown): {
  shopScore: number | null
  raw: Record<string, unknown> | null
} {
  const root = asRecord(payload)
  if (!root) return { shopScore: null, raw: null }
  const data = asRecord(root.data) ?? root
  const shopScore =
    pickNumber(data, ['shopScore', 'shop_score', 'score', 'totalScore', 'sellerScore']) ??
    pickNumber(root, ['shopScore', 'score'])
  return { shopScore, raw: data }
}

export function parseReviewCountDetail(payload: unknown): Partial<
  import('./good-review.types').NormalizedGoodReviewShopStats
> {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  return {
    totalReviewCount: pickNumber(data, ['totalCount', 'total', 'allCount', 'reviewTotal']) ?? 0,
    goodReviewCount:
      pickNumber(data, ['goodCount', 'goodReviewCount', 'positiveCount', 'scoreGoodCount']) ?? 0,
    mediumReviewCount:
      pickNumber(data, ['mediumCount', 'middleCount', 'neutralCount', 'scoreMediumCount']) ?? 0,
    badReviewCount:
      pickNumber(data, ['badCount', 'badReviewCount', 'negativeCount', 'scoreBadCount']) ?? 0,
    withImageCount: pickNumber(data, ['withImageCount', 'hasImageCount', 'picCount']) ?? 0,
    withTextCount: pickNumber(data, ['withTextCount', 'hasTextCount', 'textCount']) ?? 0,
    unrepliedCount: pickNumber(data, ['unrepliedCount', 'noReplyCount', 'waitReplyCount']) ?? 0,
    repliedCount: pickNumber(data, ['repliedCount', 'replyCount', 'hasReplyCount']) ?? 0,
    countDetailRaw: data,
  }
}

export function parseReviewOverview(payload: unknown): Partial<
  import('./good-review.types').NormalizedGoodReviewShopStats
> {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  return {
    pendingInteractionCount:
      pickNumber(data, [
        'pendingInteractionCount',
        'waitInteractionCount',
        'pendingGoodReviewCount',
        'waitReplyGoodCount',
      ]) ?? 0,
    pendingBadReviewCount:
      pickNumber(data, ['pendingBadReviewCount', 'waitHandleBadCount', 'badReviewPendingCount']) ??
      0,
    overviewRaw: data,
  }
}

export function mergeShopStats(
  shopKey: string,
  shopName: string,
  parts: Array<Partial<import('./good-review.types').NormalizedGoodReviewShopStats>>,
): import('./good-review.types').NormalizedGoodReviewShopStats {
  const merged: import('./good-review.types').NormalizedGoodReviewShopStats = {
    shopKey,
    shopName,
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
    scoreRaw: null,
    countDetailRaw: null,
    overviewRaw: null,
  }
  for (const part of parts) {
    if (part.shopScore != null) merged.shopScore = part.shopScore
    if (part.totalReviewCount != null) merged.totalReviewCount = part.totalReviewCount
    if (part.goodReviewCount != null) merged.goodReviewCount = part.goodReviewCount
    if (part.mediumReviewCount != null) merged.mediumReviewCount = part.mediumReviewCount
    if (part.badReviewCount != null) merged.badReviewCount = part.badReviewCount
    if (part.withImageCount != null) merged.withImageCount = part.withImageCount
    if (part.withTextCount != null) merged.withTextCount = part.withTextCount
    if (part.unrepliedCount != null) merged.unrepliedCount = part.unrepliedCount
    if (part.repliedCount != null) merged.repliedCount = part.repliedCount
    if (part.pendingInteractionCount != null) {
      merged.pendingInteractionCount = part.pendingInteractionCount
    }
    if (part.pendingBadReviewCount != null) merged.pendingBadReviewCount = part.pendingBadReviewCount
    if (part.scoreRaw) merged.scoreRaw = part.scoreRaw
    if (part.countDetailRaw) merged.countDetailRaw = part.countDetailRaw
    if (part.overviewRaw) merged.overviewRaw = part.overviewRaw
  }
  return merged
}
