import {
  GOOD_REVIEW_SHOPS,
  type GoodReviewShopDefinition,
} from '../../config/good-review-shops.constants'
import { resolveLiveAccountCookie } from '../qianfan-cookie-resolver.service'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'
import { requestXhsJsonWithSyncAudit, buildXhsRequestHash } from '../sync-request-audit.service'
import { enqueueXhsRequest } from '../xhs-api-sync/xhs-rate-limiter.service'
import { parseJsonPreserveLargeIds } from './lucky-gift-json.util'
import {
  extractLuckyGiftLogistics,
  normalizeLuckyWinnerBoys,
} from './lucky-gift-normalize.service'
import {
  listLuckyGiftRoomIdsForAccount,
  resolveLuckyGiftHostIdForAccount,
  resolveLuckyGiftHostIdFromCookie,
} from './lucky-gift-host-resolver.service'
import {
  classifyLuckyGiftListPage,
  parseLuckyGiftListPage,
  type LuckyGiftSyncShopStatus,
} from './lucky-gift-platform-response.util'
import {
  LUCKY_GIFT_API,
  LUCKY_GIFT_LIST_PAGE_SIZE,
  LUCKY_GIFT_REFERER,
  type LuckyGiftFetchAllResult,
  type LuckyGiftListPageResult,
  type LuckyGiftRoomFetchStat,
  type NormalizedLuckyWinner,
  type NormalizedLuckyDraw,
} from './lucky-gift.types'

export { resolveLuckyGiftHostIdFromCookie as resolveLuckyGiftHostId }

async function resolveShopAccount(shop: GoodReviewShopDefinition): Promise<{
  accountId: string
  accountName: string
  cookie: string
  hostId: string
  hostIdSource: 'live_session' | 'cookie'
}> {
  const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
  if (!account?.id) throw new Error(`${shop.shopName}：尚未配置官方直播号`)
  const cookie = await resolveLiveAccountCookie(account.id, shop.shopName)
  if (!cookie) throw new Error(`${shop.shopName}：尚未配置 Cookie`)
  const hostResolved = await resolveLuckyGiftHostIdForAccount(account.id, cookie)
  return {
    accountId: account.id,
    accountName: account.displayName?.trim() || shop.shopName,
    cookie,
    hostId: hostResolved.hostId,
    hostIdSource: hostResolved.source,
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
  const query: Record<string, string> = {}
  try {
    for (const [k, v] of new URL(params.url).searchParams.entries()) query[k] = v
  } catch {
    /* ignore */
  }
  const requestHash = buildXhsRequestHash({
    apiName: 'lucky_gift',
    query,
  })
  const json = await enqueueXhsRequest(async () =>
    requestXhsJsonWithSyncAudit<T>({
      shopId: params.accountId,
      shopName: params.accountName,
      apiName: 'lucky_gift',
      method: params.method,
      urlKey: params.url.split('?')[0]!.slice(-80),
      requestHash,
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

async function fetchLuckyGiftListPageInternal(params: {
  shop: GoodReviewShopDefinition
  accountId: string
  accountName: string
  cookie: string
  hostId: string
  page: number
  pageSize?: number
  roomId?: string
  apiPath: 'lucky_draw/page' | 'lucky_draw_history/get'
  trigger?: string
}): Promise<LuckyGiftListPageResult & { parsed: ReturnType<typeof parseLuckyGiftListPage> }> {
  const pageSize = params.pageSize ?? LUCKY_GIFT_LIST_PAGE_SIZE
  const qs = new URLSearchParams({
    hostId: params.hostId,
    page: String(params.page),
    pageSize: String(pageSize),
  })
  if (params.roomId) qs.set('room_id', params.roomId)
  const baseUrl = params.apiPath === 'lucky_draw_history/get' ? LUCKY_GIFT_API.historyGet : LUCKY_GIFT_API.listPage
  const url = `${baseUrl}?${qs.toString()}`
  const { json, rawText } = await requestLuckyGiftJson<unknown>({
    shop: params.shop,
    accountId: params.accountId,
    accountName: params.accountName,
    cookie: params.cookie,
    hostId: params.hostId,
    method: 'GET',
    url,
    apiLabel: params.apiPath,
    pageNo: params.page,
    trigger: params.trigger,
  })
  const parsed = parseLuckyGiftListPage(json, rawText)
  return {
    infos: parsed.infos,
    totalCount: parsed.totalCount,
    rawText,
    rawIdTexts: parsed.rawIdTexts,
    parsed,
  }
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
    hostIdSource: 'live_session' | 'cookie'
  }
> {
  const ctx = await resolveShopAccount(params.shop)
  const res = await fetchLuckyGiftListPageInternal({
    shop: params.shop,
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    cookie: ctx.cookie,
    hostId: ctx.hostId,
    page: params.page,
    pageSize: params.pageSize,
    apiPath: 'lucky_draw/page',
    trigger: params.trigger,
  })
  return {
    ...res,
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    hostId: ctx.hostId,
    hostIdSource: ctx.hostIdSource,
  }
}

export async function fetchLuckyGiftHistoryPage(params: {
  shop: GoodReviewShopDefinition
  hostId: string
  roomId: string
  page: number
  pageSize?: number
  trigger?: string
  accountId?: string
  accountName?: string
  cookie?: string
}): Promise<LuckyGiftListPageResult & { parsed: ReturnType<typeof parseLuckyGiftListPage> }> {
  const ctx = params.accountId && params.cookie && params.accountName
    ? {
        accountId: params.accountId,
        accountName: params.accountName,
        cookie: params.cookie,
      }
    : await resolveShopAccount(params.shop)
  return fetchLuckyGiftListPageInternal({
    shop: params.shop,
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    cookie: ctx.cookie,
    hostId: params.hostId,
    page: params.page,
    pageSize: params.pageSize,
    roomId: params.roomId,
    apiPath: 'lucky_draw_history/get',
    trigger: params.trigger,
  })
}

function deriveOverallSyncStatus(input: {
  fetchedCount: number
  roomStats: LuckyGiftRoomFetchStat[]
  listPageStatus: LuckyGiftSyncShopStatus
  roomsScanned: number
}): { status: LuckyGiftSyncShopStatus; error?: string } {
  if (input.fetchedCount > 0) {
    // 仅真实接口失败算异常；confirmed_empty / ambiguous_empty 多为该场次无福袋，不算失败
    const hardFailedRooms = input.roomStats.filter((r) =>
      ['auth_failed', 'parse_failed', 'request_failed', 'parameter_failed'].includes(r.status),
    )
    if (hardFailedRooms.length > 0) {
      return {
        status: 'partial_success',
        error: `${hardFailedRooms.length} 个场次接口异常，已拉到 ${input.fetchedCount} 个福袋`,
      }
    }
    return { status: 'success_with_data' }
  }
  const hardFails = input.roomStats.filter((r) =>
    ['auth_failed', 'parse_failed', 'request_failed', 'parameter_failed'].includes(r.status),
  )
  if (hardFails.length > 0) {
    return { status: hardFails[0]!.status, error: hardFails[0]!.error }
  }
  if (input.roomsScanned === 0) {
    if (input.listPageStatus === 'confirmed_empty') {
      return { status: 'ambiguous_empty', error: '无直播场次记录，无法按场次核实历史福袋' }
    }
    return { status: input.listPageStatus, error: '无直播场次记录' }
  }
  const allConfirmedEmpty = input.roomStats.every((r) => r.status === 'confirmed_empty')
  if (allConfirmedEmpty && input.listPageStatus === 'confirmed_empty') {
    return { status: 'confirmed_empty' }
  }
  if (input.listPageStatus === 'ambiguous_empty') {
    return { status: 'ambiguous_empty', error: '接口返回空数据，尚不能确认该店无福袋' }
  }
  return { status: input.listPageStatus }
}

async function paginateRoomHistory(params: {
  shop: GoodReviewShopDefinition
  accountId: string
  accountName: string
  cookie: string
  hostId: string
  roomId: string
  trigger?: string
  maxPages?: number
  seen: Set<string>
  all: NormalizedLuckyDraw[]
  maxDraws?: number
}): Promise<LuckyGiftRoomFetchStat> {
  const maxPages = params.maxPages ?? 50
  let page = 1
  let pageCount = 0
  let fetchedCount = 0
  let lastStatus: LuckyGiftSyncShopStatus = 'ambiguous_empty'
  let lastError: string | undefined

  while (page <= maxPages) {
    let res
    try {
      res = await fetchLuckyGiftHistoryPage({
        shop: params.shop,
        hostId: params.hostId,
        roomId: params.roomId,
        page,
        accountId: params.accountId,
        accountName: params.accountName,
        cookie: params.cookie,
        trigger: params.trigger,
      })
    } catch (err) {
      return {
        roomId: params.roomId,
        pageCount,
        fetchedCount,
        status: 'request_failed',
        error: err instanceof Error ? err.message : String(err),
      }
    }
    pageCount += 1
    const classified = classifyLuckyGiftListPage(res.parsed, res.rawText)
    lastStatus = classified.status
    lastError = classified.error
    if (classified.status === 'auth_failed' || classified.status === 'parse_failed' || classified.status === 'parameter_failed') {
      return {
        roomId: params.roomId,
        pageCount,
        fetchedCount,
        status: classified.status,
        error: classified.error,
      }
    }
    if (res.infos.length === 0) break
    for (const d of res.infos) {
      if (params.seen.has(d.luckyDrawId)) continue
      params.seen.add(d.luckyDrawId)
      params.all.push(d)
      fetchedCount += 1
      if (params.maxDraws != null && params.all.length >= params.maxDraws) {
        return { roomId: params.roomId, pageCount, fetchedCount, status: 'success_with_data' }
      }
    }
    if (res.infos.length < LUCKY_GIFT_LIST_PAGE_SIZE) break
    if (res.totalCount != null && params.seen.size >= res.totalCount) break
    page += 1
  }

  return {
    roomId: params.roomId,
    pageCount,
    fetchedCount,
    status: fetchedCount > 0 ? 'success_with_data' : lastStatus,
    error: fetchedCount > 0 ? undefined : lastError,
  }
}

export async function fetchAllLuckyGiftDraws(params: {
  shop: GoodReviewShopDefinition
  trigger?: string
  maxPages?: number
  maxDraws?: number
  limitRooms?: number
}): Promise<LuckyGiftFetchAllResult> {
  const ctx = await resolveShopAccount(params.shop)
  const all: NormalizedLuckyDraw[] = []
  const seen = new Set<string>()
  const roomIds = await listLuckyGiftRoomIdsForAccount(ctx.accountId)
  const scanRooms = params.limitRooms != null ? roomIds.slice(0, params.limitRooms) : roomIds
  const roomStats: LuckyGiftRoomFetchStat[] = []
  let pageCount = 0
  let platformTotal: number | null = null

  for (const roomId of scanRooms) {
    const stat = await paginateRoomHistory({
      shop: params.shop,
      accountId: ctx.accountId,
      accountName: ctx.accountName,
      cookie: ctx.cookie,
      hostId: ctx.hostId,
      roomId,
      trigger: params.trigger,
      maxPages: params.maxPages,
      seen,
      all,
      maxDraws: params.maxDraws,
    })
    roomStats.push(stat)
    pageCount += stat.pageCount
    if (params.maxDraws != null && all.length >= params.maxDraws) break
  }

  let listPageStatus: LuckyGiftSyncShopStatus = 'ambiguous_empty'
  let listPageError: string | undefined
  try {
    const current = await fetchLuckyGiftListPageInternal({
      shop: params.shop,
      accountId: ctx.accountId,
      accountName: ctx.accountName,
      cookie: ctx.cookie,
      hostId: ctx.hostId,
      page: 1,
      apiPath: 'lucky_draw/page',
      trigger: params.trigger,
    })
    pageCount += 1
    const classified = classifyLuckyGiftListPage(current.parsed, current.rawText)
    listPageStatus = classified.status
    listPageError = classified.error
    if (platformTotal == null && current.totalCount != null) platformTotal = current.totalCount
    for (const d of current.infos) {
      if (seen.has(d.luckyDrawId)) continue
      seen.add(d.luckyDrawId)
      all.push(d)
      if (params.maxDraws != null && all.length >= params.maxDraws) break
    }
  } catch (err) {
    listPageStatus = 'request_failed'
    listPageError = err instanceof Error ? err.message : String(err)
  }

  const roomsWithData = roomStats.filter((r) => r.fetchedCount > 0).length
  const overall = deriveOverallSyncStatus({
    fetchedCount: all.length,
    roomStats,
    listPageStatus,
    roomsScanned: scanRooms.length,
  })

  return {
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    hostId: ctx.hostId,
    hostIdSource: ctx.hostIdSource,
    draws: all,
    platformTotal,
    fetchedCount: all.length,
    dedupedCount: seen.size,
    pageCount,
    roomsScanned: scanRooms.length,
    roomsWithData,
    roomStats,
    listPageStatus,
    listPageError,
    syncStatus: overall.status,
    syncStatusError: overall.error,
  }
}

/** 按中奖人拉取平台物流（快递单号）；失败返回 null，不阻断主同步 */
export async function fetchLuckyGiftWinnerLogistics(params: {
  shop: GoodReviewShopDefinition
  luckyDrawId: string
  winnerUserId: string
  accountId: string
  accountName: string
  cookie: string
  hostId: string
  trigger?: string
}): Promise<{
  officialCourier: string | null
  officialTrackingNo: string | null
  officialShipped: boolean
} | null> {
  const userId = String(params.winnerUserId || '').trim()
  if (!userId) return null
  // 平台参数命名不统一：依次尝试 user_id / lucky_boy_id
  const queryVariants: Array<Record<string, string>> = [
    { lucky_draw_id: params.luckyDrawId, user_id: userId },
    { lucky_draw_id: params.luckyDrawId, lucky_boy_id: userId },
  ]
  let lastErr: unknown = null
  for (const q of queryVariants) {
    const qs = new URLSearchParams(q)
    const url = `${LUCKY_GIFT_API.winnerLogistics}?${qs.toString()}`
    try {
      const { json } = await requestLuckyGiftJson<unknown>({
        shop: params.shop,
        accountId: params.accountId,
        accountName: params.accountName,
        cookie: params.cookie,
        hostId: params.hostId,
        method: 'GET',
        url,
        apiLabel: 'target_lucky_boy_with_address/get',
        trigger: params.trigger,
      })
      const logistics = extractLuckyGiftLogistics(json)
      if (logistics.officialTrackingNo || logistics.officialCourier) return logistics
    } catch (err) {
      lastErr = err
    }
  }
  if (lastErr) {
    console.warn(
      `[lucky-gift] logistics fail draw=${params.luckyDrawId} user=${userId}:`,
      lastErr instanceof Error ? lastErr.message : lastErr,
    )
  }
  return null
}

export async function fetchLuckyGiftWinners(params: {
  shop: GoodReviewShopDefinition
  luckyDrawId: string
  trigger?: string
  hostId?: string
}): Promise<{
  accountId: string
  accountName: string
  draw: NormalizedLuckyDraw | null
  winners: NormalizedLuckyWinner[]
  rawText: string
}> {
  const ctx = await resolveShopAccount(params.shop)
  const hostId = params.hostId || ctx.hostId
  const qs = new URLSearchParams({ lucky_draw_id: params.luckyDrawId })
  const url = `${LUCKY_GIFT_API.winnerWithAddress}?${qs.toString()}`
  const { json, rawText } = await requestLuckyGiftJson<unknown>({
    shop: params.shop,
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    cookie: ctx.cookie,
    hostId,
    method: 'GET',
    url,
    apiLabel: 'lucky_boy_with_address/get',
    trigger: params.trigger,
  })
  const { draw, winners } = normalizeLuckyWinnerBoys(json, params.luckyDrawId, rawText)

  // 列表详情常无 logistics：对已填地址且缺单号的中奖人补拉物流接口
  for (let i = 0; i < winners.length; i++) {
    const w = winners[i]!
    if (w.officialShipped || w.officialTrackingNo) continue
    if (!w.hasAddress || !w.winnerUserId) continue
    const logistics = await fetchLuckyGiftWinnerLogistics({
      shop: params.shop,
      luckyDrawId: params.luckyDrawId,
      winnerUserId: w.winnerUserId,
      accountId: ctx.accountId,
      accountName: ctx.accountName,
      cookie: ctx.cookie,
      hostId,
      trigger: params.trigger,
    })
    if (!logistics) continue
    winners[i] = {
      ...w,
      officialCourier: logistics.officialCourier ?? w.officialCourier,
      officialTrackingNo: logistics.officialTrackingNo ?? w.officialTrackingNo,
      officialShipped: logistics.officialShipped || w.officialShipped,
    }
  }

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
