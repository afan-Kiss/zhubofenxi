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
  totalReviewCount: number
}

export interface GoodReviewSyncShopResult {
  shopKey: string
  shopName: string
  success: boolean
  syncedReviewCount?: number
  totalReviewCount?: number
  latestReviewTime?: string
  error?: string
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

export function formatGoodReviewSyncMessage(result: GoodReviewSyncResult): {
  tone: 'success' | 'warning' | 'error'
  text: string
} {
  if (result.successShopCount === result.totalShopCount && result.totalShopCount > 0) {
    return {
      tone: 'success',
      text: `同步完成：${result.totalShopCount} 个店铺已更新`,
    }
  }
  if (result.successShopCount > 0) {
    return {
      tone: 'warning',
      text: `同步完成：成功 ${result.successShopCount} 个店铺，失败 ${result.failedShopCount} 个店铺，可先查看已成功店铺数据`,
    }
  }
  return {
    tone: 'error',
    text: '同步失败：四个店铺都没有同步成功，请检查 Cookie 或接口状态',
  }
}

export function formatLocalDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatMoneyFromCent(cent: number | null | undefined): string | null {
  if (cent == null) return null
  return `¥${(cent / 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function buildGoodReviewArkOrderDetailUrl(orderId: string, shopKey: string): string {
  const params = new URLSearchParams({
    orderId,
    shop: shopKey,
  })
  return `/api/good-reviews/ark-order-detail?${params.toString()}`
}

export function openGoodReviewArkOrderDetail(orderId: string, shopKey: string): void {
  window.open(buildGoodReviewArkOrderDetailUrl(orderId, shopKey), '_blank', 'noopener,noreferrer')
}
