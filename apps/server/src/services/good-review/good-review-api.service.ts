import { prisma } from '../../lib/prisma'
import { resolveLiveAccountCookie } from '../qianfan-cookie-resolver.service'
import { requestXhsJson } from '../xhs-http.service'
import { enqueueXhsRequest } from '../xhs-api-sync/xhs-rate-limiter.service'
import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  GOOD_REVIEW_API,
  GOOD_REVIEW_REFERER,
} from './good-review.types'
import {
  extractReviewList,
  extractReviewTotal,
  parseReviewManagerEnvelope,
} from './good-review-normalize.service'
import type { NormalizedGoodReview } from './good-review.types'
import { normalizeGoodReviewRow } from './good-review-normalize.service'

const REVIEW_PAGE_SIZE = 20
const MAX_REVIEW_PAGES = 100

/** HAR：review_manager / review_list_count_detail 使用 source: 0 */
const REVIEW_API_SOURCE = 0

async function resolveAccountIdForShop(shopName: string): Promise<string | undefined> {
  const rows = await prisma.platformCredential.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  })
  const { resolveCanonicalShopName } = await import('../../config/qianfan-shops.constants')
  for (const row of rows) {
    const name = row.displayName?.trim() || row.platformName
    if (resolveCanonicalShopName(name) === resolveCanonicalShopName(shopName)) {
      return row.id
    }
  }
  return undefined
}

async function postGoodReviewApi<T>(
  url: string,
  body: Record<string, unknown> | undefined,
  shop: GoodReviewShopDefinition,
  method: 'GET' | 'POST' = 'POST',
): Promise<T> {
  return enqueueXhsRequest(async () => {
    const accountId = await resolveAccountIdForShop(shop.shopName)
    if (!accountId) throw new Error('尚未配置该店铺 Cookie')
    const cookie = await resolveLiveAccountCookie(accountId, shop.shopName)
    if (!cookie) throw new Error('尚未配置该店铺 Cookie')
    return requestXhsJson<T>({
      method,
      url,
      body,
      cookie,
      referer: GOOD_REVIEW_REFERER,
      needSign: true,
      signLogContext: {
        tag: 'xhs-sign',
        accountName: shop.shopName,
        liveAccountId: accountId,
      },
      cmdLog: {
        accountName: shop.shopName,
        liveAccountId: accountId,
        apiLabel: url.split('/').slice(-1)[0] ?? 'good-review',
      },
    })
  })
}

export async function fetchShopScore(shop: GoodReviewShopDefinition): Promise<unknown> {
  return postGoodReviewApi<unknown>(GOOD_REVIEW_API.shopScore, { source: 'PC' }, shop, 'POST')
}

export async function fetchReviewCountDetail(shop: GoodReviewShopDefinition): Promise<unknown> {
  return postGoodReviewApi<unknown>(
    GOOD_REVIEW_API.reviewCountDetail,
    { source: REVIEW_API_SOURCE },
    shop,
  )
}

export async function fetchReviewOverview(shop: GoodReviewShopDefinition): Promise<unknown> {
  return postGoodReviewApi<unknown>(GOOD_REVIEW_API.reviewOverview, {}, shop)
}

export async function fetchReviewManagerPage(
  shop: GoodReviewShopDefinition,
  page: number,
): Promise<{
  payload: unknown
  items: NormalizedGoodReview[]
  total: number | null
  envelope: ReturnType<typeof parseReviewManagerEnvelope>
}> {
  const payload = await postGoodReviewApi<unknown>(GOOD_REVIEW_API.reviewManager, {
    source: REVIEW_API_SOURCE,
    page,
    page_size: REVIEW_PAGE_SIZE,
  }, shop)

  const envelope = parseReviewManagerEnvelope(payload)
  const rows = extractReviewList(payload)
  const items: NormalizedGoodReview[] = []
  for (const row of rows) {
    const normalized = normalizeGoodReviewRow(shop.shopKey, row)
    if (normalized) items.push(normalized)
  }
  return {
    payload,
    items,
    total: envelope.total ?? extractReviewTotal(payload),
    envelope,
  }
}

export async function fetchAllGoodReviews(shop: GoodReviewShopDefinition): Promise<{
  reviews: NormalizedGoodReview[]
  totalReviewCount: number | null
  managerEnvelope: ReturnType<typeof parseReviewManagerEnvelope> | null
}> {
  const all: NormalizedGoodReview[] = []
  const seen = new Set<string>()
  let total: number | null = null
  let lastEnvelope: ReturnType<typeof parseReviewManagerEnvelope> | null = null

  for (let page = 1; page <= MAX_REVIEW_PAGES; page++) {
    const pageResult = await fetchReviewManagerPage(shop, page)
    lastEnvelope = pageResult.envelope
    if (total == null && pageResult.total != null) total = pageResult.total
    if (pageResult.items.length === 0) break

    for (const item of pageResult.items) {
      if (seen.has(item.dedupeKey)) continue
      seen.add(item.dedupeKey)
      all.push(item)
    }

    if (pageResult.items.length < REVIEW_PAGE_SIZE) break
    if (total != null && all.length >= total) break
  }

  return {
    reviews: all,
    totalReviewCount: total ?? all.length,
    managerEnvelope: lastEnvelope,
  }
}
