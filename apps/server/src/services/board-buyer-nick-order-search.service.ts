/**
 * 按买家昵称搜索本地全量订单（不随日期 tabs 过滤）。
 * 匹配规则：分析缓存中的 buyerNickname / raw 买家昵称。
 */
import type { UserRole } from '../types/roles'
import type { AnalyzedOrderView } from '../types/analysis'
import { mapViewToBoardOrderRow } from './order-row-mapper.service'
import {
  isStaffUnbound,
  staffAnchorFilter,
  STAFF_UNBOUND_MESSAGE,
} from './staff-anchor-scope.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'
import { parseLiveSessionTimeMs } from '../utils/business-timezone'
import { pickBuyerNicknameFromRaw } from './buyer-identity.service'
import { buildRawAnalyzeBundleAll } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { loadOfflineDealViewsForRange } from './offline-deal.service'
import {
  bootstrapWorkbenchCache,
  getWorkbenchRefundMapForOrders,
  loadWorkbenchRefundMapFromDb,
  mergeWorkbenchRefundMaps,
  buildLiveAccountOrderQueries,
} from './xhs-after-sales-workbench.service'
import { remapViewsWithCanonicalAttribution } from './canonical-order-attribution.service'

const MAX_RESULTS = 40
const MIN_KEYWORD_LEN = 1
const SESSION_GRACE_MS = 30 * 60_000
const ALL_ORDERS_CACHE_TTL_MS = 5 * 60_000

export interface BuyerNickOrderSearchHit {
  orderNo: string
  displayOrderNo: string
  orderTime: string
  anchorName: string
  shopName: string
  sessionLabel: string | null
  buyerNickname: string
  buyerId: string
  productName: string
  payAmount: number
  refundAmount: number
  signedAmount: number
  orderStatus: string
  afterSaleStatus: string
  afterSaleReason: string
  statusText: string
}

type AllOrdersSearchPool = {
  builtAt: number
  views: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
}

let allOrdersPool: AllOrdersSearchPool | null = null
let allOrdersPoolBuild: Promise<AllOrdersSearchPool> | null = null

/** 同步/失效经营缓存时一并清空，避免搜到过期昵称池 */
export function invalidateBuyerNickOrderSearchPool(): void {
  allOrdersPool = null
  allOrdersPoolBuild = null
}

function lookupRaw(
  v: AnalyzedOrderView,
  rawByMatch: Map<string, Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const keys = [
    v.matchOrderId,
    v.orderId,
    v.packageId,
    v.displayOrderNo,
    v.officialOrderNo,
  ]
  for (const key of keys) {
    const k = String(key ?? '').trim()
    if (!k || k === '—') continue
    const raw = rawByMatch.get(k)
    if (raw) return raw
  }
  return undefined
}

function cacheBuyerNickname(
  v: AnalyzedOrderView,
  rawByMatch: Map<string, Record<string, unknown>>,
): string {
  const fromView = String(v.buyerNickname ?? '').trim()
  if (fromView && fromView !== '—' && fromView !== '未知买家') return fromView
  const fromRaw = pickBuyerNicknameFromRaw(lookupRaw(v, rawByMatch))
  if (fromRaw && fromRaw !== '—' && fromRaw !== '未知买家') return fromRaw
  return ''
}

function orderDateKeyShanghai(orderTime: string): string | null {
  const ms = parseLiveSessionTimeMs(orderTime)
  if (ms == null) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(orderTime.trim())
    return m ? m[1]! : null
  }
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

function clockHm(text: string | null | undefined): string | null {
  const raw = String(text ?? '').trim()
  if (!raw || raw === '—') return null
  const m = /(\d{1,2}):(\d{2})/.exec(raw)
  if (!m) return null
  return `${m[1]!.padStart(2, '0')}:${m[2]}`
}

function resolveSessionLabel(params: {
  orderTime: string
  shopName: string
  anchorName: string
  matchedScheduleId?: string | null
  matchedLiveStartTime?: string | null
  matchedLiveEndTime?: string | null
  scheduleRows: Array<{
    rowId?: string
    anchorName: string
    shopName: string
    liveRoomName: string
    startTime: string
    endTime: string
    startAt: string
    endAt: string
    enabled?: boolean
  }>
}): string | null {
  const payMs = parseLiveSessionTimeMs(params.orderTime)
  const shop = params.shopName.trim()
  const anchor = params.anchorName.trim()
  const hasNamedAnchor = Boolean(anchor && anchor !== '未归属' && anchor !== '—')

  // 优先用 canonical 命中的排班行，避免「主播A + 场次B」错配
  const matchedId = String(params.matchedScheduleId ?? '').trim()
  if (matchedId) {
    const hit = params.scheduleRows.find((row) => String(row.rowId ?? '').trim() === matchedId)
    if (hit) {
      if (!hasNamedAnchor || hit.anchorName.trim() === anchor) {
        return `${hit.anchorName} ${hit.startTime}-${hit.endTime}`
      }
    }
  }

  if (payMs != null) {
    const inGrace = (row: (typeof params.scheduleRows)[number]): boolean => {
      if (row.enabled === false) return false
      const startMs = parseLiveSessionTimeMs(row.startAt)
      const endMs = parseLiveSessionTimeMs(row.endAt)
      if (startMs == null || endMs == null) return false
      return payMs >= startMs - SESSION_GRACE_MS && payMs < endMs + SESSION_GRACE_MS
    }
    const shopOk = (row: (typeof params.scheduleRows)[number]): boolean => {
      if (!shop || shop === '—') return true
      return orderLiveRoomMatchesSchedule(shop, row.shopName, row.liveRoomName)
    }

    let candidates = params.scheduleRows.filter((row) => inGrace(row) && shopOk(row))
    // 已有归属主播时，只展示该主播场次；绝不用别的主播场次凑数
    if (hasNamedAnchor) {
      candidates = candidates.filter((row) => row.anchorName.trim() === anchor)
    }
    if (candidates.length > 0) {
      const best = [...candidates].sort((a, b) => {
        const aStart = parseLiveSessionTimeMs(a.startAt) ?? 0
        const bStart = parseLiveSessionTimeMs(b.startAt) ?? 0
        return Math.abs(payMs - aStart) - Math.abs(payMs - bStart)
      })[0]!
      return `${best.anchorName} ${best.startTime}-${best.endTime}`
    }
  }

  const startHm = clockHm(params.matchedLiveStartTime)
  const endHm = clockHm(params.matchedLiveEndTime)
  if (hasNamedAnchor && startHm && endHm) return `${anchor} ${startHm}-${endHm}`
  return null
}

async function buildAllOrdersSearchPool(): Promise<AllOrdersSearchPool> {
  const bundle = await buildRawAnalyzeBundleAll()
  const rawByMatch = new Map<string, Record<string, unknown>>()
  let views: AnalyzedOrderView[] = []

  if (bundle && bundle.orders.length > 0) {
    const orderQueries = buildLiveAccountOrderQueries(bundle.orders)
    await bootstrapWorkbenchCache()
    const fromDb = await loadWorkbenchRefundMapFromDb(orderQueries)
    const fromMem = getWorkbenchRefundMapForOrders(orderQueries)
    const workbenchByOrderNo = mergeWorkbenchRefundMaps(fromDb, fromMem)
    const artifacts = prepareAnalysisArtifactsFromRaw(bundle, { workbenchByOrderNo })
    views = artifacts?.views ?? []
    for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
      if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
    }
  }

  const offlineViews = await loadOfflineDealViewsForRange('2020-01-01', '2099-12-31')
  if (offlineViews.length > 0) {
    views = [...views, ...offlineViews]
  }

  return {
    builtAt: Date.now(),
    views,
    rawByMatch,
  }
}

function startAllOrdersPoolBuild(): Promise<AllOrdersSearchPool> {
  allOrdersPoolBuild = buildAllOrdersSearchPool()
    .then((pool) => {
      allOrdersPool = pool
      return pool
    })
    .catch((err) => {
      // 保留旧池；下次请求再试
      console.warn(
        '[buyer-nick-order-search] rebuild pool failed:',
        err instanceof Error ? err.message : err,
      )
      throw err
    })
    .finally(() => {
      allOrdersPoolBuild = null
    })
  return allOrdersPoolBuild
}

async function getAllOrdersSearchPool(): Promise<AllOrdersSearchPool> {
  const now = Date.now()
  if (allOrdersPool && now - allOrdersPool.builtAt < ALL_ORDERS_CACHE_TTL_MS) {
    return allOrdersPool
  }

  // TTL 过期：后台重建，先返回旧池，避免每次冷启动卡 7s+
  if (allOrdersPool && !allOrdersPoolBuild) {
    void startAllOrdersPoolBuild().catch(() => undefined)
    return allOrdersPool
  }

  if (allOrdersPoolBuild) return allOrdersPoolBuild

  return startAllOrdersPoolBuild()
}

export async function searchBoardOrdersByBuyerNick(
  q: {
    keyword: string
    limit?: number
  },
  role: UserRole,
  username: string,
): Promise<{
  keyword: string
  total: number
  items: BuyerNickOrderSearchHit[]
  message?: string
  staffUnbound?: boolean
}> {
  const keyword = q.keyword.trim()
  if (keyword.length < MIN_KEYWORD_LEN) {
    return { keyword, total: 0, items: [], message: '请输入买家昵称' }
  }
  if (isStaffUnbound(role, username)) {
    return {
      keyword,
      total: 0,
      items: [],
      message: STAFF_UNBOUND_MESSAGE,
      staffUnbound: true,
    }
  }

  const forcedAnchor = staffAnchorFilter(role, username)
  const pool = await getAllOrdersSearchPool()

  const kwLower = keyword.toLowerCase()
  const matched = pool.views.filter((v) => {
    const nick = cacheBuyerNickname(v, pool.rawByMatch)
    if (!nick) return false
    return nick.toLowerCase().includes(kwLower)
  })

  matched.sort((a, b) =>
    String(b.orderTimeText ?? '').localeCompare(String(a.orderTimeText ?? '')),
  )

  const requested = Number(q.limit)
  const limit = Number.isFinite(requested)
    ? Math.min(MAX_RESULTS, Math.max(1, Math.floor(requested)))
    : MAX_RESULTS
  // 员工账号需先 canonical 归属再过滤；多取候选避免 remap 后归属变动导致漏单
  const candidateLimit = forcedAnchor
    ? Math.min(matched.length, Math.max(limit * 8, 80))
    : limit
  const slice = matched.slice(0, candidateLimit)

  const withRaw = slice.map((v) =>
    Object.assign({}, v, { raw: lookupRaw(v, pool.rawByMatch) }),
  ) as Array<AnalyzedOrderView & { raw?: Record<string, unknown> }>

  const dateKeys = withRaw
    .map((v) => orderDateKeyShanghai(v.orderTimeText || ''))
    .filter((d): d is string => Boolean(d))
    .sort()
  const remapStart = dateKeys[0]
  const remapEnd = dateKeys[dateKeys.length - 1]
  const remapped =
    withRaw.length > 0
      ? await remapViewsWithCanonicalAttribution(withRaw, {
          startDate: remapStart,
          endDate: remapEnd,
          preload: Boolean(remapStart && remapEnd),
        })
      : []

  const scheduleByDate = new Map<
    string,
    Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>['rows']
  >()

  const items: BuyerNickOrderSearchHit[] = []
  let scopedTotal = 0
  for (const v of remapped) {
    const raw = lookupRaw(v, pool.rawByMatch)
    const row = mapViewToBoardOrderRow(
      Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
    )
    const shopName =
      String(row.liveAccountName ?? '').trim() ||
      String(v.liveAccountName ?? '').trim() ||
      '—'
    const anchorName = row.anchorName || v.anchorName || '未归属'
    if (forcedAnchor && anchorName !== forcedAnchor) continue
    scopedTotal += 1
    if (items.length >= limit) continue

    const dateKey = orderDateKeyShanghai(row.orderTime)
    let scheduleRows = [] as Awaited<
      ReturnType<typeof getEffectiveScheduleTableForDate>
    >['rows']
    if (dateKey) {
      let cached = scheduleByDate.get(dateKey)
      if (!cached) {
        const table = await getEffectiveScheduleTableForDate(dateKey)
        cached = table.rows
        scheduleByDate.set(dateKey, cached)
      }
      scheduleRows = cached
    }
    const remappedMeta = v as typeof v & {
      matchedScheduleId?: string | null
      matchedLiveStartTime?: string | null
      matchedLiveEndTime?: string | null
    }
    const sessionLabel = resolveSessionLabel({
      orderTime: row.orderTime,
      shopName,
      anchorName,
      matchedScheduleId: remappedMeta.matchedScheduleId,
      matchedLiveStartTime: remappedMeta.matchedLiveStartTime ?? v.matchedLiveStartTime,
      matchedLiveEndTime: remappedMeta.matchedLiveEndTime ?? v.matchedLiveEndTime,
      scheduleRows,
    })
    items.push({
      orderNo: row.orderNo,
      displayOrderNo: row.displayOrderNo || row.orderNo,
      orderTime: row.orderTime,
      anchorName,
      shopName,
      sessionLabel,
      buyerNickname: cacheBuyerNickname(v, pool.rawByMatch) || row.buyerNickname || '—',
      buyerId: row.buyerId,
      productName: row.productName,
      payAmount: row.payAmount,
      refundAmount: row.refundAmount,
      signedAmount: row.signedAmount,
      orderStatus: row.orderStatus,
      afterSaleStatus: row.afterSaleStatus,
      afterSaleReason: row.afterSaleReason,
      statusText: row.statusText,
    })
  }

  // 员工：total 以本批 remap 后可见数为近似；管理员用昵称全量命中数
  const total = forcedAnchor
    ? Math.max(scopedTotal, items.length)
    : matched.length

  return {
    keyword,
    total,
    items,
    ...(total > items.length
      ? { message: `共 ${total} 笔，已展示前 ${items.length} 笔` }
      : {}),
  }
}
