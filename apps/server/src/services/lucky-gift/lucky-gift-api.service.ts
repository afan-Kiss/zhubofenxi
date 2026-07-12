import {
  GOOD_REVIEW_SHOPS,
  type GoodReviewShopDefinition,
} from '../../config/good-review-shops.constants'
import { resolveLiveAccountCookie } from '../qianfan-cookie-resolver.service'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'
import { requestXhsJsonWithSyncAudit } from '../sync-request-audit.service'
import { enqueueXhsRequest } from '../xhs-api-sync/xhs-rate-limiter.service'
import { parseJsonPreserveLargeIds } from './lucky-gift-json.util'
import {
  normalizeLuckyDrawListPayload,
  normalizeLuckyWinnerBoys,
} from './lucky-gift-normalize.service'
import {
  LUCKY_GIFT_API,
  LUCKY_GIFT_LIST_PAGE_SIZE,
  LUCKY_GIFT_REFERER,
  type LuckyGiftListPageResult,
  type NormalizedLuckyWinner,
  type NormalizedLuckyDraw,
} from './lucky-gift.types'

function parseCookieMap(cookie: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(cookie || '').split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = v
  }
  return out
}

/** hostId / account-id：优先 Cookie 中的 ark user id */
export function resolveLuckyGiftHostId(cookie: string): string | null {
  const m = parseCookieMap(cookie)
  const candidates = [
    m['x-user-id-ark.xiaohongshu.com'],
    m['x-user-id'],
    m['customer-sso-user-id'],
  ]
  for (const c of candidates) {
    const v = String(c || '').trim()
    if (v) return v
  }
  return null
}

async function resolveShopAccount(shop: GoodReviewShopDefinition): Promise<{
  accountId: string
  accountName: string
  cookie: string
  hostId: string
}> {
  const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
  if (!account?.id) throw new Error(`${shop.shopName}：尚未配置官方直播号`)
  const cookie = await resolveLiveAccountCookie(account.id, shop.shopName)
  if (!cookie) throw new Error(`${shop.shopName}：尚未配置 Cookie`)
  const hostId = resolveLuckyGiftHostId(cookie)
  if (!hostId) throw new Error(`${shop.shopName}：Cookie 中缺少账号 ID（x-user-id-ark）`)
  return {
    accountId: account.id,
    accountName: account.displayName?.trim() || shop.shopName,
    cookie,
    hostId,
  }
}

async function requestLuckyGiftJson<T>(params: {
  shop: GoodReviewShopDefinition
  accountId: string
  accountName: string
  cookie: string
  hostId: string
  method: 'GET' | 'POST'
  url: string
  apiLabel: string
  pageNo?: number
  trigger?: string
}): Promise<{ json: T; rawText: string }> {
  let rawText = ''
  const json = await enqueueXhsRequest(async () =>
    requestXhsJsonWithSyncAudit<T>({
      shopId: params.accountId,
      shopName: params.accountName,
      apiName: 'lucky_gift',
      method: params.method,
      urlKey: params.url.split('?')[0]!.slice(-80),
      trigger: (params.trigger as 'scheduled') ?? 'scheduled',
      options: {
        method: params.method,
        url: params.url,
        cookie: params.cookie,
        referer: LUCKY_GIFT_REFERER,
        needSign: true,
        extraHeaders: {
          'account-id': params.hostId,
        },
        parseResponseText: <R>(text: string) => {
          rawText = text
          return parseJsonPreserveLargeIds<R>(text)
        },
        signLogContext: {
          tag: 'xhs-sign',
          accountName: params.accountName,
          liveAccountId: params.accountId,
        },
        cmdLog: {
          accountName: params.accountName,
          liveAccountId: params.accountId,
          apiLabel: params.apiLabel,
          pageNo: params.pageNo,
        },
      },
    }),
  )
  return { json, rawText }
}

export async function fetchLuckyGiftListPage(params: {
  shop: GoodReviewShopDefinition
  page: number
  pageSize?: number
  trigger?: string
}): Promise<
  LuckyGiftListPageResult & {
    accountId: string
    accountName: string
    hostId: string
  }
> {
  const ctx = await resolveShopAccount(params.shop)
  const pageSize = params.pageSize ?? LUCKY_GIFT_LIST_PAGE_SIZE
  // 平台前端 getAllDrawRecord({ hostId, page, pageSize })；HAR 未捕获列表，以 JS 源码为准
  const qs = new URLSearchParams({
    hostId: ctx.hostId,
    page: String(params.page),
    pageSize: String(pageSize),
  })
  const url = `${LUCKY_GIFT_API.listPage}?${qs.toString()}`
  const { json, rawText } = await requestLuckyGiftJson<unknown>({
    shop: params.shop,
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    cookie: ctx.cookie,
    hostId: ctx.hostId,
    method: 'GET',
    url,
    apiLabel: 'lucky_draw/page',
    pageNo: params.page,
    trigger: params.trigger,
  })
  const normalized = normalizeLuckyDrawListPayload(json, rawText)
  return {
    ...normalized,
    rawText,
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    hostId: ctx.hostId,
  }
}

export async function fetchAllLuckyGiftDraws(params: {
  shop: GoodReviewShopDefinition
  trigger?: string
  maxPages?: number
}): Promise<{
  accountId: string
  accountName: string
  hostId: string
  draws: NormalizedLuckyDraw[]
  platformTotal: number | null
  fetchedCount: number
  dedupedCount: number
  pageCount: number
}> {
  const maxPages = params.maxPages ?? 200
  const all: NormalizedLuckyDraw[] = []
  const seen = new Set<string>()
  let platformTotal: number | null = null
  let accountId = ''
  let accountName = ''
  let hostId = ''
  let page = 1
  let pageCount = 0

  while (page <= maxPages) {
    const res = await fetchLuckyGiftListPage({
      shop: params.shop,
      page,
      trigger: params.trigger,
    })
    accountId = res.accountId
    accountName = res.accountName
    hostId = res.hostId
    if (platformTotal == null && res.totalCount != null) platformTotal = res.totalCount
    pageCount += 1
    if (res.infos.length === 0) break
    for (const d of res.infos) {
      all.push(d)
      seen.add(d.luckyDrawId)
    }
    if (platformTotal != null && seen.size >= platformTotal) break
    if (res.infos.length < LUCKY_GIFT_LIST_PAGE_SIZE) break
    page += 1
  }

  return {
    accountId,
    accountName,
    hostId,
    draws: all,
    platformTotal,
    fetchedCount: all.length,
    dedupedCount: seen.size,
    pageCount,
  }
}

export async function fetchLuckyGiftWinners(params: {
  shop: GoodReviewShopDefinition
  luckyDrawId: string
  trigger?: string
}): Promise<{
  accountId: string
  accountName: string
  draw: NormalizedLuckyDraw | null
  winners: NormalizedLuckyWinner[]
  rawText: string
}> {
  const ctx = await resolveShopAccount(params.shop)
  // HAR 确认 query 名为 lucky_draw_id，值必须保持原始字符串
  const qs = new URLSearchParams({ lucky_draw_id: params.luckyDrawId })
  const url = `${LUCKY_GIFT_API.winnerWithAddress}?${qs.toString()}`
  const { json, rawText } = await requestLuckyGiftJson<unknown>({
    shop: params.shop,
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    cookie: ctx.cookie,
    hostId: ctx.hostId,
    method: 'GET',
    url,
    apiLabel: 'lucky_boy_with_address/get',
    trigger: params.trigger,
  })
  const { draw, winners } = normalizeLuckyWinnerBoys(json, params.luckyDrawId, rawText)
  return {
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    draw,
    winners,
    rawText,
  }
}

export function listLuckyGiftShopTargets(shopKey?: string): GoodReviewShopDefinition[] {
  if (!shopKey || shopKey === 'all') return [...GOOD_REVIEW_SHOPS]
  return GOOD_REVIEW_SHOPS.filter((s) => s.shopKey === shopKey)
}
