export const GOOD_REVIEW_API = {
  shopScore: 'https://ark.xiaohongshu.com/api/edith/home/get_shop_score',
  reviewManager: 'https://ark.xiaohongshu.com/api/edith/review/v2/seller/review_manager',
  reviewCountDetail: 'https://ark.xiaohongshu.com/api/edith/review/seller/review_list_count_detail',
  reviewOverview: 'https://ark.xiaohongshu.com/api/edith/review/get_review_data_overview',
} as const

export const GOOD_REVIEW_REFERER = 'https://ark.xiaohongshu.com/app-review/review-manage'

export interface GoodReviewSyncShopResult {
  shopKey: string
  shopName: string
  success: boolean
  syncedReviewCount?: number
  fetchedReviewCount?: number
  totalReviewCount?: number
  truncated?: boolean
  warning?: string
  latestReviewTime?: string
  error?: string
  shopScoreSuccess?: boolean
  countSuccess?: boolean
  overviewSuccess?: boolean
  managerSuccess?: boolean
  managerSyncedCount?: number
  managerError?: string
  platformCode?: number | string
  platformMsg?: string
}

export interface GoodReviewSyncResult {
  ok: boolean
  startedAt: string
  finishedAt: string
  totalShopCount: number
  successShopCount: number
  failedShopCount: number
  shops: GoodReviewSyncShopResult[]
}

export interface NormalizedGoodReview {
  shopKey: string
  dedupeKey: string
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
  reviewImages: string[]
  reviewTags: string[]
  isAnonymous: boolean
  likeCount: number
  replyCount: number
  reviewTime: Date | null
  reviewTimeText: string | null
  raw: Record<string, unknown>
}

export interface NormalizedGoodReviewShopStats {
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
  scoreRaw: Record<string, unknown> | null
  countDetailRaw: Record<string, unknown> | null
  overviewRaw: Record<string, unknown> | null
}

export interface GoodReviewShopView {
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
  syncedAt: string | null
}

export interface GoodReviewItemView {
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
  reviewImages: string[]
  reviewTags: string[]
  isAnonymous: boolean
  likeCount: number
  replyCount: number
  reviewTime: string | null
  reviewTimeText: string | null
  syncedAt: string
}

export interface GoodReviewPagePayload {
  lastSyncedAt: string | null
  shops: GoodReviewShopView[]
  reviews: GoodReviewItemView[]
  /** 数据库真实评价总数（不受 limit 影响） */
  totalReviewCount: number
  /** 本次接口返回的评价条数 */
  returnedReviewCount: number
}
