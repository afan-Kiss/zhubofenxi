/**
 * 按买家昵称搜索经营缓存中的订单（主播业绩 · 自定义日期）。
 * 匹配规则：缓存 view.buyerNickname，以及 raw 中的买家昵称（同一字段口径）。
 */
import type { UserRole } from '../types/roles'
import type { AnalyzedOrderView } from '../types/analysis'
import { mapViewToBoardOrderRow } from './order-row-mapper.service'
import { normalizeBoardPreset } from './board-metrics.service'
import { resolveBusinessRange } from '../utils/business-range'
import { getOrBuildBusinessBoardCache } from './business-cache.service'
import {
  isStaffUnbound,
  staffAnchorFilter,
  STAFF_UNBOUND_MESSAGE,
} from './staff-anchor-scope.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'
import { parseLiveSessionTimeMs } from '../utils/business-timezone'
import { pickBuyerNicknameFromRaw } from './buyer-identity.service'

const MAX_RESULTS = 40
const MIN_KEYWORD_LEN = 1
const SESSION_GRACE_MS = 30 * 60_000

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

/** 经营缓存中的买家昵称（view 优先，再回落 raw） */
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

function resolveSessionLabel(params: {
  orderTime: string
  shopName: string
  anchorName: string
  scheduleRows: Array<{
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
  if (payMs == null) return null
  const shop = params.shopName.trim()
  const anchor = params.anchorName.trim()
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
  if (candidates.length === 0) return null

  if (anchor && anchor !== '未归属' && anchor !== '—') {
    const byAnchor = candidates.filter((row) => row.anchorName.trim() === anchor)
    if (byAnchor.length > 0) candidates = byAnchor
  }

  const best = [...candidates].sort((a, b) => {
    const aStart = parseLiveSessionTimeMs(a.startAt) ?? 0
    const bStart = parseLiveSessionTimeMs(b.startAt) ?? 0
    return Math.abs(payMs - aStart) - Math.abs(payMs - bStart)
  })[0]!
  return `${best.anchorName} ${best.startTime}-${best.endTime}`
}

export async function searchBoardOrdersByBuyerNick(
  q: {
    keyword: string
    preset?: string
    startDate?: string
    endDate?: string
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
  const preset = normalizeBoardPreset(q.preset ?? 'custom')
  const range = resolveBusinessRange(
    preset as import('../utils/business-range').BusinessRangePreset,
    q.startDate,
    q.endDate,
  )
  const cached = await getOrBuildBusinessBoardCache({
    preset: q.preset ?? 'custom',
    startDate: range.startDate,
    endDate: range.endDate,
  })

  const kwLower = keyword.toLowerCase()
  const matched = cached.views.filter((v) => {
    if (forcedAnchor && v.anchorName !== forcedAnchor) return false
    const nick = cacheBuyerNickname(v, cached.rawByMatch)
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
  const slice = matched.slice(0, limit)

  const scheduleByDate = new Map<
    string,
    Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>['rows']
  >()

  const items: BuyerNickOrderSearchHit[] = []
  for (const v of slice) {
    const raw = lookupRaw(v, cached.rawByMatch)
    const row = mapViewToBoardOrderRow(
      Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
    )
    const shopName =
      String(row.liveAccountName ?? '').trim() ||
      String(v.liveAccountName ?? '').trim() ||
      '—'
    const anchorName = row.anchorName || v.anchorName || '未归属'
    const dateKey = orderDateKeyShanghai(row.orderTime)
    let sessionLabel: string | null = null
    if (dateKey) {
      let rows = scheduleByDate.get(dateKey)
      if (!rows) {
        const table = await getEffectiveScheduleTableForDate(dateKey)
        rows = table.rows
        scheduleByDate.set(dateKey, rows)
      }
      sessionLabel = resolveSessionLabel({
        orderTime: row.orderTime,
        shopName,
        anchorName,
        scheduleRows: rows,
      })
    }
    items.push({
      orderNo: row.orderNo,
      displayOrderNo: row.displayOrderNo || row.orderNo,
      orderTime: row.orderTime,
      anchorName,
      shopName,
      sessionLabel,
      buyerNickname: cacheBuyerNickname(v, cached.rawByMatch) || row.buyerNickname || '—',
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

  return {
    keyword,
    total: matched.length,
    items,
    ...(matched.length > limit
      ? { message: `共 ${matched.length} 笔，已展示前 ${limit} 笔` }
      : {}),
  }
}
