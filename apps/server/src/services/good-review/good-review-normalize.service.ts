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

export function normalizeReviewImageUrl(url: string | null | undefined): string | null {
  if (url == null) return null
  const text = String(url).trim()
  if (!text) return null
  if (text.startsWith('//')) return `https:${text}`
  if (text.startsWith('http://') || text.startsWith('https://')) return text
  return text
}

function extractImageUrlFromValue(item: unknown): string | null {
  if (item == null) return null
  if (typeof item === 'string') return normalizeReviewImageUrl(item)
  const rec = asRecord(item)
  if (!rec) return null
  return normalizeReviewImageUrl(
    pickString(rec, [
      'link',
      'url',
      'imageUrl',
      'picUrl',
      'src',
      'image_url',
      'pic_url',
      'imageLink',
      'image_link',
      'cover',
      'path',
    ]),
  )
}

function pickImageUrlArray(obj: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const val = obj[key]
    if (!Array.isArray(val)) continue
    const urls: string[] = []
    for (const item of val) {
      const url = extractImageUrlFromValue(item)
      if (url) urls.push(url)
    }
    if (urls.length) return urls
  }
  return []
}

function pickImages(obj: Record<string, unknown>): string[] {
  const fromArrays = pickImageUrlArray(obj, ['reviewImages', 'images', 'imageList', 'picList', 'pics'])
  if (fromArrays.length) return fromArrays

  const content = asRecord(obj.content)
  const contentImages = content?.images
  if (Array.isArray(contentImages)) {
    const urls: string[] = []
    for (const item of contentImages) {
      const url = extractImageUrlFromValue(item)
      if (url) urls.push(url)
    }
    if (urls.length) return urls
  }

  const imageInfo = obj.imageInfo ?? obj.image_info ?? obj.reviewImageInfo
  if (Array.isArray(imageInfo)) {
    const urls: string[] = []
    for (const item of imageInfo) {
      const url = extractImageUrlFromValue(item)
      if (url) urls.push(url)
    }
    if (urls.length) return urls
  }

  const single = normalizeReviewImageUrl(pickString(obj, ['imageUrl', 'picUrl', 'cover', 'image_link']))
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
  const skuInfo = asRecord(raw.sku_info) ?? asRecord(raw.skuInfo)
  const reviewData = asRecord(raw.review_data) ?? asRecord(raw.reviewData)
  const content = asRecord(reviewData?.content) ?? reviewData
  const interaction = asRecord(raw.interation_info) ?? asRecord(raw.interaction_info)

  const flat = reviewData ? { ...raw, ...reviewData, content } : raw
  const item = skuInfo ?? asRecord(raw.itemInfo) ?? asRecord(raw.item_info) ?? asRecord(raw.goodsInfo) ?? flat
  const sku = asRecord(raw.skuInfo) ?? asRecord(raw.sku_info) ?? item

  const reviewId =
    pickString(reviewData ?? raw, ['review_id', 'reviewId', 'id', 'commentId', 'comment_id']) ??
    pickString(raw, ['reviewId', 'review_id', 'id'])
  const orderId =
    pickString(skuInfo ?? raw, ['order_id', 'orderId', 'packageId', 'package_id', 'orderNo']) ??
    pickString(raw, ['orderId', 'order_id', 'packageId'])
  const { date, text } = parseReviewTime({
    ...(reviewData ?? {}),
    ...raw,
    create_time: pickString(reviewData ?? raw, ['create_time', 'createTime']),
    createTime: pickString(reviewData ?? raw, ['create_time', 'createTime']),
  })
  const dedupeKey = buildGoodReviewDedupeKey(shopKey, reviewId, orderId, text)

  const reviewText =
    pickString(content ?? reviewData ?? raw, [
      'text',
      'content',
      'reviewContent',
      'review_content',
      'commentContent',
    ]) ?? null

  const priceRaw =
    pickNumber(skuInfo ?? item, ['price', 'salePrice', 'itemPrice', 'payPrice']) ??
    pickNumber(raw, ['price'])
  const priceCent =
    pickNumber(skuInfo ?? item, ['priceCent', 'price_cent']) ??
    (priceRaw != null ? Math.round(priceRaw * 100) : null)

  const itemImage = normalizeReviewImageUrl(
    pickString(skuInfo ?? item, ['image_link', 'imageLink', 'itemImage', 'item_image', 'image', 'cover', 'picUrl']),
  )

  return {
    shopKey,
    dedupeKey,
    reviewId,
    orderId,
    itemId: pickString(skuInfo ?? item, ['item_id', 'itemId', 'goodsId', 'goods_id', 'productId']),
    skuId: pickString(skuInfo ?? sku, ['sku_id', 'skuId']),
    itemName: pickString(skuInfo ?? item, ['name', 'itemName', 'item_name', 'goodsName', 'goods_name', 'title']),
    itemImage,
    itemPriceCent: priceCent,
    itemQuantity:
      pickNumber(skuInfo ?? raw, ['quantity', 'itemQuantity', 'item_quantity', 'buyCount']) ?? null,
    productScore:
      pickNumber(reviewData ?? raw, ['sku_score', 'skuScore', 'productScore', 'product_score', 'goodsScore', 'score']) ??
      null,
    serviceScore: pickNumber(reviewData ?? raw, ['service_score', 'serviceScore', 'sellerScore']) ?? null,
    logisticsScore:
      pickNumber(reviewData ?? raw, ['logistics_score', 'logisticsScore', 'deliveryScore']) ?? null,
    reviewText,
    reviewImages: pickImages({ ...(content ?? {}), ...(reviewData ?? {}), ...raw }),
    reviewTags: pickStringArray(reviewData ?? raw, ['tags', 'reviewTags', 'review_tags', 'labelList']),
    isAnonymous: pickBool(reviewData ?? raw, ['anonymous', 'isAnonymous', 'is_anonymous']),
    likeCount:
      pickNumber(interaction ?? raw, ['like_num', 'likeNum', 'likeCount', 'like_count', 'thumbUpCount']) ?? 0,
    replyCount:
      pickNumber(interaction ?? raw, ['reply_num', 'replyNum', 'replyCount', 'reply_count', 'commentReplyCount']) ??
      0,
    reviewTime: date,
    reviewTimeText: text ?? pickString(reviewData ?? raw, ['create_time', 'createTime']),
    raw,
  }
}

export function extractReviewList(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload)
  if (!root) return []
  const data = asRecord(root.data) ?? root
  const candidates = [
    data.review_info_list,
    data.reviewInfoList,
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

export function parseReviewManagerEnvelope(payload: unknown): {
  success: boolean
  total: number | null
  platformCode: number | string | null
  platformMsg: string | null
  listCount: number
} {
  const root = asRecord(payload)
  const data = asRecord(root?.data)
  const list = extractReviewList(payload)
  return {
    success: root?.success === true && data != null,
    total: pickNumber(data ?? {}, ['total', 'totalCount', 'total_count', 'count']),
    platformCode:
      root?.code == null
        ? null
        : typeof root.code === 'number' || typeof root.code === 'string'
          ? root.code
          : String(root.code),
    platformMsg: pickString(root ?? {}, ['msg', 'message']),
    listCount: list.length,
  }
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

function pickOverviewMetric(data: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const block = asRecord(data[key])
    if (!block) continue
    const value = pickNumber(block, ['current_data_value', 'currentDataValue', 'value', 'count'])
    if (value != null) return value
  }
  return pickNumber(data, keys)
}

export function parseShopScore(payload: unknown): {
  shopScore: number | null
  raw: Record<string, unknown> | null
} {
  const root = asRecord(payload)
  if (!root) return { shopScore: null, raw: null }
  const data = asRecord(root.data) ?? root
  const scoreDto = asRecord(data.shop_score_dto) ?? asRecord(data.shopScoreDto)
  const shopScore =
    pickNumber(scoreDto ?? {}, ['score', 'shopScore', 'shop_score']) ??
    pickNumber(data, ['shopScore', 'shop_score', 'score', 'totalScore', 'sellerScore']) ??
    pickNumber(root, ['shopScore', 'score'])
  return { shopScore, raw: data }
}

export function parseReviewCountDetail(payload: unknown): Partial<
  import('./good-review.types').NormalizedGoodReviewShopStats
> {
  const root = asRecord(payload)
  const data = asRecord(root?.data) ?? root ?? {}
  const level =
    asRecord(data.review_level_count_detail) ?? asRecord(data.reviewLevelCountDetail) ?? data
  const content =
    asRecord(data.review_content_count_detail) ?? asRecord(data.reviewContentCountDetail) ?? data
  const reply =
    asRecord(data.review_reply_count_detail) ?? asRecord(data.reviewReplyCountDetail) ?? data

  const goodReviewCount =
    pickNumber(level, ['good_review_count', 'goodReviewCount', 'goodCount', 'positiveCount']) ?? 0
  const mediumReviewCount =
    pickNumber(level, ['middle_review_count', 'mediumReviewCount', 'mediumCount', 'neutralCount']) ??
    0
  const badReviewCount =
    pickNumber(level, ['bad_review_count', 'badReviewCount', 'badCount', 'negativeCount']) ?? 0
  const totalFromLevel = goodReviewCount + mediumReviewCount + badReviewCount

  return {
    totalReviewCount:
      pickNumber(data, ['totalCount', 'total', 'allCount', 'reviewTotal']) ??
      (totalFromLevel > 0 ? totalFromLevel : 0),
    goodReviewCount,
    mediumReviewCount,
    badReviewCount,
    withImageCount:
      pickNumber(content, [
        'has_image_review_count',
        'hasImageReviewCount',
        'withImageCount',
        'hasImageCount',
        'picCount',
      ]) ?? 0,
    withTextCount:
      pickNumber(content, [
        'has_text_review_count',
        'hasTextReviewCount',
        'withTextCount',
        'hasTextCount',
        'textCount',
      ]) ?? 0,
    unrepliedCount:
      pickNumber(reply, ['un_reply_review_count', 'unReplyReviewCount', 'unrepliedCount', 'noReplyCount']) ??
      0,
    repliedCount:
      pickNumber(reply, ['replied_review_count', 'repliedReviewCount', 'repliedCount', 'replyCount']) ??
      0,
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
      pickOverviewMetric(data, [
        'pending_interactive_positive_review',
        'pendingInteractionCount',
        'waitInteractionCount',
        'pendingGoodReviewCount',
        'waitReplyGoodCount',
      ]) ?? 0,
    pendingBadReviewCount:
      pickOverviewMetric(data, [
        'pending_negative_review',
        'pendingBadReviewCount',
        'waitHandleBadCount',
        'badReviewPendingCount',
      ]) ?? 0,
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
