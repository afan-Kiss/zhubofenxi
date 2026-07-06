import { apiRequest } from './api'

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
  materialTags: string[]
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
  returnedReviewCount?: number
  filteredReviewCount?: number
  nextCursor?: string | null
  hasMore?: boolean
  rangeStart?: string
  rangeEnd?: string
}

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

export const GOOD_REVIEWS_DEFAULT_DAYS = 2
export const GOOD_REVIEWS_PAGE_LIMIT = 30
export const GOOD_REVIEWS_MAX_LIMIT = 50

export const GOOD_REVIEW_UI_VERSION = 'good-review-material-v2'

/** 列表/详情缩略图：商品图优先，否则买家晒图第一张 */
export function resolveGoodReviewThumb(review: {
  itemImage: string | null
  reviewImages?: string[] | null
}): string | null {
  return review.itemImage || review.reviewImages?.[0] || null
}

/** 全店手动同步顺序（与好评中心 Tab 一致） */
export const GOOD_REVIEW_SHOP_SYNC_ORDER = [
  'shiyuju',
  'hetianyayu',
  'xiangyu',
  'xyxiangyu',
] as const

export type GoodReviewShopKey = (typeof GOOD_REVIEW_SHOP_SYNC_ORDER)[number]

export function getGoodReviewShopTabIndex(shopKey: string): number {
  return (GOOD_REVIEW_SHOP_SYNC_ORDER as readonly string[]).indexOf(shopKey)
}

export function mergeGoodReviewSyncResults(
  shopResults: GoodReviewSyncShopResult[],
  startedAt: string,
): GoodReviewSyncResult {
  const finishedAt = new Date().toISOString()
  const successShopCount = shopResults.filter((s) => s.success).length
  return {
    ok: successShopCount > 0,
    startedAt,
    finishedAt,
    totalShopCount: shopResults.length,
    successShopCount,
    failedShopCount: shopResults.length - successShopCount,
    shops: shopResults,
  }
}

export const GOOD_REVIEW_MATERIAL_TAG_OPTIONS = [
  '手镯',
  '平安扣',
  '送礼',
  '性价比',
  '颜色好看',
  '细腻',
  '油润',
  '客服服务好',
  '物流快',
  '复购',
  '其他',
] as const

export type GoodReviewContentFilter = 'all' | 'hasImage' | 'hasText' | 'both'
export type GoodReviewReplyFilter = 'all' | 'unreplied' | 'replied'
export type GoodReviewMinScoreFilter = 'all' | '5' | '4'

export interface GoodReviewListFilters {
  content: GoodReviewContentFilter
  replyStatus: GoodReviewReplyFilter
  itemKeyword: string
  reviewKeyword: string
  minProductScore: GoodReviewMinScoreFilter
  materialTag: string
}

export const DEFAULT_GOOD_REVIEW_LIST_FILTERS: GoodReviewListFilters = {
  content: 'all',
  replyStatus: 'all',
  itemKeyword: '',
  reviewKeyword: '',
  minProductScore: 'all',
  materialTag: '',
}

export function buildGoodReviewsListUrl(params: {
  shop: string
  limit?: number
  days?: number
  cursor?: string | null
  filters?: GoodReviewListFilters
}): string {
  const q = new URLSearchParams()
  q.set('shop', params.shop)
  q.set('days', String(params.days ?? GOOD_REVIEWS_DEFAULT_DAYS))
  q.set('limit', String(params.limit ?? GOOD_REVIEWS_PAGE_LIMIT))
  if (params.cursor) q.set('cursor', params.cursor)
  const f = params.filters ?? DEFAULT_GOOD_REVIEW_LIST_FILTERS
  if (f.content === 'hasImage' || f.content === 'both') q.set('hasImage', 'true')
  if (f.content === 'hasText' || f.content === 'both') q.set('hasText', 'true')
  if (f.replyStatus === 'replied') q.set('replyStatus', 'replied')
  if (f.replyStatus === 'unreplied') q.set('replyStatus', 'unreplied')
  if (f.itemKeyword.trim()) q.set('itemKeyword', f.itemKeyword.trim())
  if (f.reviewKeyword.trim()) q.set('reviewKeyword', f.reviewKeyword.trim())
  if (f.minProductScore === '5') q.set('minProductScore', '5')
  if (f.minProductScore === '4') q.set('minProductScore', '4')
  if (f.materialTag.trim()) q.set('materialTag', f.materialTag.trim())
  return `/api/good-reviews?${q.toString()}`
}

export function describeGoodReviewFilters(filters: GoodReviewListFilters): string[] {
  const parts: string[] = ['最近 2 天']
  if (filters.content === 'hasImage') parts.push('有图评价')
  else if (filters.content === 'hasText') parts.push('有文字评价')
  else if (filters.content === 'both') parts.push('有图有文字')
  if (filters.replyStatus === 'unreplied') parts.push('未回复')
  if (filters.replyStatus === 'replied') parts.push('已回复')
  if (filters.itemKeyword.trim()) parts.push(`商品：${filters.itemKeyword.trim()}`)
  if (filters.reviewKeyword.trim()) parts.push(`评价：${filters.reviewKeyword.trim()}`)
  if (filters.minProductScore === '5') parts.push('5 分')
  if (filters.minProductScore === '4') parts.push('4 分及以上')
  if (filters.materialTag.trim()) parts.push(`标签：${filters.materialTag.trim()}`)
  return parts
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fallback below
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } finally {
    document.body.removeChild(textarea)
  }
}

const LIVE_SCRIPT_FORBIDDEN = ['保证', '绝对', '升值', '收藏级']

function truncateReviewText(text: string, maxLen: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, maxLen)}…`
}

function sanitizeLiveScriptLine(line: string): string {
  let out = line
  for (const word of LIVE_SCRIPT_FORBIDDEN) {
    out = out.replaceAll(word, '')
  }
  return out.replace(/\s{2,}/g, ' ').trim()
}

export function buildGoodReviewLiveScript(
  review: GoodReviewItemView,
  shopName: string,
): string {
  const item = review.itemName?.trim() || ''
  const snippet = review.reviewText?.trim()
    ? truncateReviewText(review.reviewText.trim(), 60)
    : null

  let mainScript = ''
  if (snippet) {
    mainScript = `有玉友收到后说“${snippet}”。`
    if (item) {
      mainScript += `喜欢这款【${item}】的姐妹，可以重点看看。`
    } else {
      mainScript += '这种真实反馈比我们自己说更有参考。'
    }
  } else if (item) {
    mainScript = `有玉友反馈，这款【${item}】上手效果不错，细节也满意。喜欢这种感觉的可以重点看看。`
  } else {
    mainScript = '这条买家没有写很多字，但给了好评，说明收到后整体是认可的。'
  }

  const extras: string[] = []
  if (review.reviewImages.length > 0) {
    extras.push('这条还有买家实拍图，大家可以参考真实上手效果，不是只看灯光图。')
  }
  if (review.productScore != null) {
    extras.push(`商品评分 ${review.productScore} 分，说明收到后的满意度还是不错的。`)
  }

  const usableScript = sanitizeLiveScriptLine([mainScript, ...extras].join(''))

  const lines = ['【直播间可用好评】', `店铺：${shopName || review.shopKey}`]
  if (item) lines.push(`商品：${item}`)
  if (snippet) lines.push(`买家反馈：${snippet}`)
  lines.push('可用话术：', usableScript)
  return lines.join('\n')
}

export async function saveGoodReviewMaterialTags(
  reviewId: string,
  tags: string[],
): Promise<GoodReviewItemView> {
  const data = await apiRequest<{ review: GoodReviewItemView }>(
    `/api/good-reviews/${encodeURIComponent(reviewId)}/material-tags`,
    {
      method: 'POST',
      body: JSON.stringify({ tags }),
    },
  )
  return data.review
}

export function formatGoodReviewSyncMessage(result: GoodReviewSyncResult): {
  tone: 'success' | 'warning' | 'error'
  text: string
} {
  const detailLines = result.shops
    .filter((s) => s.error || s.managerError || s.warning)
    .map((s) => {
      const parts: string[] = []
      if (s.truncated && s.warning) {
        parts.push(`${s.shopName}：${s.warning}`)
      }
      if (s.managerSuccess === false && s.managerError) {
        parts.push(`${s.shopName}明细失败：${s.managerError}`)
      } else if (s.error) {
        parts.push(`${s.shopName}：${s.error}`)
      }
      return parts.join(' ')
    })
    .filter(Boolean)

  if (result.successShopCount === result.totalShopCount && result.totalShopCount > 0) {
    const allManagerOk = result.shops.every((s) => s.managerSuccess !== false)
    if (allManagerOk) {
      return {
        tone: 'success',
        text: `同步完成：${result.totalShopCount} 个店铺已更新`,
      }
    }
    return {
      tone: 'warning',
      text: `统计已同步，部分店铺明细未拉全。${detailLines.join('；')}`,
    }
  }
  if (result.successShopCount > 0) {
    return {
      tone: 'warning',
      text: `同步完成：成功 ${result.successShopCount} 个店铺，失败 ${result.failedShopCount} 个。${detailLines.join('；')}`,
    }
  }
  return {
    tone: 'error',
    text: '同步失败：店铺都没有同步成功，请检查 Cookie 或接口状态',
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
  const url = buildGoodReviewArkOrderDetailUrl(orderId, shopKey)
  const win = window.open('about:blank', '_blank', 'noopener,noreferrer')
  if (win) {
    try {
      win.location.href = url
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
