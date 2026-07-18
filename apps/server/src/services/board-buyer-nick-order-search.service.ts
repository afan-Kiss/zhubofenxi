/**
 * 按买家昵称搜索当前日期范围内的订单（主播业绩页「主播日报」框内）。
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
import { resolveBuyerIdentityFromView } from './buyer-identity.service'

const MAX_RESULTS = 40
const MIN_KEYWORD_LEN = 1

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

function nickOfView(v: AnalyzedOrderView, raw?: Record<string, unknown>): string {
  const identity = resolveBuyerIdentityFromView(
    Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
  )
  return (
    identity?.buyerNickname?.trim() ||
    identity?.buyerDisplayName?.trim() ||
    v.buyerNickname?.trim() ||
    v.buyerDisplayName?.trim() ||
    ''
  )
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
  const candidates = params.scheduleRows.filter((row) => {
    if (row.enabled === false) return false
    if (shop && shop !== '—' && !orderLiveRoomMatchesSchedule(shop, row.shopName, row.liveRoomName)) {
      return false
    }
    const startMs = parseLiveSessionTimeMs(row.startAt)
    const endMs = parseLiveSessionTimeMs(row.endAt)
    if (startMs == null || endMs == null) return false
    const grace = 30 * 60_000
    return payMs >= startMs - grace && payMs < endMs + grace
  })
  if (candidates.length === 0) return null
  const best = candidates[0]!
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
  let matched = cached.views.filter((v) => {
    if (forcedAnchor && v.anchorName !== forcedAnchor) return false
    const raw = cached.rawByMatch.get(v.matchOrderId || v.orderId)
    const nick = nickOfView(v, raw)
    if (!nick) return false
    return nick.toLowerCase().includes(kwLower)
  })

  matched.sort((a, b) =>
    String(b.orderTimeText ?? '').localeCompare(String(a.orderTimeText ?? '')),
  )

  const limit = Math.min(MAX_RESULTS, Math.max(1, q.limit ?? MAX_RESULTS))
  const slice = matched.slice(0, limit)

  const scheduleByDate = new Map<
    string,
    Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>['rows']
  >()

  const items: BuyerNickOrderSearchHit[] = []
  for (const v of slice) {
    const raw = cached.rawByMatch.get(v.matchOrderId || v.orderId)
    const row = mapViewToBoardOrderRow(
      Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
    )
    const shopName =
      String(v.liveAccountName ?? '').trim() ||
      String(row.liveAccountName ?? '').trim() ||
      '—'
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
        scheduleRows: rows,
      })
    }
    items.push({
      orderNo: row.orderNo,
      displayOrderNo: row.displayOrderNo || row.orderNo,
      orderTime: row.orderTime,
      anchorName: row.anchorName || v.anchorName || '未归属',
      shopName,
      sessionLabel,
      buyerNickname: nickOfView(v, raw) || row.buyerNickname || '—',
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
