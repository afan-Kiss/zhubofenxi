import { prisma } from '../lib/prisma'
import {
  loadNormalizedOrdersFromRaw,
  normalizeLiveSessionsFromRaw,
} from './xhs-api-sync/xhs-json-normalizer.service'
import {
  endOfDay,
  endOfMonth,
  formatDateKey,
  resolveDateRange,
  startOfDay,
  startOfMonth,
} from '../utils/date-range'

export interface OrderBasicDashboardStats {
  hasData: boolean
  todayGmvCent: number
  todayOrderCount: number
  todayReturnCount: number
  monthGmvCent: number
  monthOrderCount: number
  lastSyncAt: string | null
  message: string | null
}

export interface LiveBasicDashboardStats {
  hasData: boolean
  todaySessionCount: number
  todayDurationMinutes: number
  todayLiveGmvCent: number
  todayRefundCent: number
  monthSessionCount: number
  monthDurationMinutes: number
  monthLiveGmvCent: number
  monthRefundCent: number
  lastSyncAt: string | null
  message: string | null
}

export interface ApiSyncBasicDashboardStats {
  orders: OrderBasicDashboardStats
  live: LiveBasicDashboardStats
}

function isInRange(time: Date | null, start: Date, end: Date): boolean {
  if (!time) return false
  const t = time.getTime()
  return t >= start.getTime() && t <= end.getTime()
}

export async function getOrderBasicDashboardStats(): Promise<OrderBasicDashboardStats> {
  const rawCount = await prisma.xhsRawOrder.count()
  if (rawCount === 0) {
    return {
      hasData: false,
      todayGmvCent: 0,
      todayOrderCount: 0,
      todayReturnCount: 0,
      monthGmvCent: 0,
      monthOrderCount: 0,
      lastSyncAt: null,
      message: '暂无接口采集数据，请管理员先同步订单列表',
    }
  }

  const orders = await loadNormalizedOrdersFromRaw()
  const valid = orders.filter((o) => o.errors.length === 0)

  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const monthStart = startOfMonth(now.getFullYear(), now.getMonth())
  const monthEnd = new Date(endOfMonth(now.getFullYear(), now.getMonth()))

  const todayOrders = valid.filter((o) => isInRange(o.orderTime, todayStart, todayEnd))
  const monthOrders = valid.filter((o) => isInRange(o.orderTime, monthStart, monthEnd))

  const latest = await prisma.xhsRawOrder.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })

  return {
    hasData: valid.length > 0,
    todayGmvCent: todayOrders.reduce((s, o) => s + o.gmvCent, 0),
    todayOrderCount: todayOrders.length,
    todayReturnCount: todayOrders.filter((o) => o.isReturned).length,
    monthGmvCent: monthOrders.reduce((s, o) => s + o.gmvCent, 0),
    monthOrderCount: monthOrders.length,
    lastSyncAt: latest?.updatedAt.toISOString() ?? null,
    message: valid.length > 0 ? null : '暂无接口采集数据，请管理员先同步订单列表',
  }
}

export async function getLiveBasicDashboardStats(): Promise<LiveBasicDashboardStats> {
  const rawCount = await prisma.xhsRawLiveSession.count()
  if (rawCount === 0) {
    return {
      hasData: false,
      todaySessionCount: 0,
      todayDurationMinutes: 0,
      todayLiveGmvCent: 0,
      todayRefundCent: 0,
      monthSessionCount: 0,
      monthDurationMinutes: 0,
      monthLiveGmvCent: 0,
      monthRefundCent: 0,
      lastSyncAt: null,
      message: '暂无直播场次数据，请管理员同步直播场次',
    }
  }

  const sessions = await normalizeLiveSessionsFromRaw()
  const valid = sessions.filter((s) => s.errors.length === 0)

  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const monthStart = startOfMonth(now.getFullYear(), now.getMonth())
  const monthEnd = new Date(endOfMonth(now.getFullYear(), now.getMonth()))

  const todaySessions = valid.filter((s) => isInRange(s.startTime, todayStart, todayEnd))
  const monthSessions = valid.filter((s) => isInRange(s.startTime, monthStart, monthEnd))

  const latest = await prisma.xhsRawLiveSession.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })

  return {
    hasData: valid.length > 0,
    todaySessionCount: todaySessions.length,
    todayDurationMinutes: todaySessions.reduce((s, x) => s + x.durationMinutes, 0),
    todayLiveGmvCent: todaySessions.reduce((s, x) => s + x.liveGmvCent, 0),
    todayRefundCent: todaySessions.reduce((s, x) => s + x.refundAmountCent, 0),
    monthSessionCount: monthSessions.length,
    monthDurationMinutes: monthSessions.reduce((s, x) => s + x.durationMinutes, 0),
    monthLiveGmvCent: monthSessions.reduce((s, x) => s + x.liveGmvCent, 0),
    monthRefundCent: monthSessions.reduce((s, x) => s + x.refundAmountCent, 0),
    lastSyncAt: latest?.updatedAt.toISOString() ?? null,
    message: valid.length > 0 ? null : '暂无直播场次数据，请管理员同步直播场次',
  }
}

export async function getApiSyncBasicDashboardStats(): Promise<ApiSyncBasicDashboardStats> {
  const [orders, live] = await Promise.all([
    getOrderBasicDashboardStats(),
    getLiveBasicDashboardStats(),
  ])
  return { orders, live }
}

export function defaultOrderSyncRange(): { startDate: string; endDate: string } {
  const range = resolveDateRange('thisMonth')
  return { startDate: range.startDate, endDate: formatDateKey(new Date()) }
}

export function defaultLiveSyncRange(): { startDate: string; endDate: string } {
  return defaultOrderSyncRange()
}
