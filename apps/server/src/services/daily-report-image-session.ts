/**
 * 日报长图「时间轴 + 场次卡片」展示模型（服务端组装）。
 * 只包含当天有实际直播展示班次的条目；无直播且无业绩的店铺不会出现。
 */
import type { AnchorLiveSessionBrief } from './anchor-live-sessions.service'
import { aggregateAnchorLiveSessionTraffic } from './anchor-live-sessions.service'
import { formatLiveDurationMinutes } from './anchor-live-sessions.service'
import {
  collapseDailyReportDisplaySessions,
  parseBaseLiveId,
  type DailyReportDisplaySessionGroup,
} from './daily-report-session-display.util'
import { formatClockShanghai, parseLiveSessionTimeMs } from '../utils/business-timezone'
import { COVER_CLICK_RATE_PASS_THRESHOLD } from './live-session-traffic.util'

export type DailyReportImageSessionStatus =
  | 'qualified'
  | 'warning'
  | 'unqualified'
  | 'missing'

export interface DailyReportImageSession {
  id: string
  shopName: string
  anchorName: string
  startTime: string
  endTime: string
  /** HH:mm–HH:mm */
  liveTimeRange: string
  liveDurationText: string
  liveDurationMinutes: number
  shipmentAmountYuan: number
  gmvYuan: number
  orderCount: number
  refundAmountYuan: number | null
  coverClickRate: number | null
  stay60sUserCount: number | null
  avgStayDurationSeconds: number | null
  status: DailyReportImageSessionStatus
  color: string | null
  /** 排班请假：卡片展示「休假」水印 */
  isOnLeave?: boolean
  /** 逸凡线下成交：无直播场次，卡片展示线下业绩 */
  isOfflineDeal?: boolean
}

function clockFromIso(iso: string): string {
  const ms = parseLiveSessionTimeMs(iso)
  if (ms != null) return formatClockShanghai(new Date(ms)).slice(0, 5)
  const hit = /\d{2}:\d{2}/.exec(iso)
  return hit ? hit[0]! : '—'
}

function formatLiveTimeRange(startIso: string, endIso: string): string {
  return `${clockFromIso(startIso)}-${clockFromIso(endIso)}`
}

export function resolveDailyReportImageSessionStatus(
  coverClickRate: number | null | undefined,
): DailyReportImageSessionStatus {
  if (coverClickRate == null || !Number.isFinite(coverClickRate)) return 'missing'
  if (coverClickRate >= COVER_CLICK_RATE_PASS_THRESHOLD) return 'qualified'
  if (coverClickRate >= 0.05) return 'warning'
  return 'unqualified'
}

function allocateByDuration(
  total: number,
  groups: DailyReportDisplaySessionGroup[],
): number[] {
  const durations = groups.map((g) => Math.max(0, g.durationMinutes))
  const sum = durations.reduce((a, b) => a + b, 0)
  if (sum <= 0 || groups.length === 0) {
    return groups.map(() => 0)
  }
  if (groups.length === 1) return [total]
  const raw = durations.map((d) => (total * d) / sum)
  const rounded = raw.map((v) => Math.round(v * 100) / 100)
  const drift = Math.round((total - rounded.reduce((a, b) => a + b, 0)) * 100) / 100
  if (drift !== 0 && rounded.length > 0) {
    rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1]! + drift) * 100) / 100
  }
  return rounded
}

function allocateCountByDuration(
  total: number,
  groups: DailyReportDisplaySessionGroup[],
): number[] {
  const durations = groups.map((g) => Math.max(0, g.durationMinutes))
  const sum = durations.reduce((a, b) => a + b, 0)
  if (sum <= 0 || groups.length === 0) return groups.map(() => 0)
  if (groups.length === 1) return [total]
  const raw = durations.map((d) => (total * d) / sum)
  const floored = raw.map((v) => Math.floor(v))
  let remain = total - floored.reduce((a, b) => a + b, 0)
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  for (const item of order) {
    if (remain <= 0) break
    floored[item.i]! += 1
    remain -= 1
  }
  return floored
}

type SessionWithLiveMoney = AnchorLiveSessionBrief & {
  sellerRealIncomeAmtYuan?: number
  refundAmtYuan?: number
  sourceShopName?: string
}

function sumSessionMoney(
  sessions: AnchorLiveSessionBrief[],
  key: 'sellerRealIncomeAmtYuan' | 'refundAmtYuan',
): number | null {
  let sum = 0
  let hasAny = false
  for (const session of sessions) {
    const value = (session as SessionWithLiveMoney)[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      sum += value
      hasAny = true
    }
  }
  return hasAny ? Math.round(sum * 100) / 100 : null
}

function resolveGroupShopName(
  group: DailyReportDisplaySessionGroup,
  fallbackShopName: string,
): string {
  const fromKey = group.shopKey.trim()
  if (fromKey && fromKey !== '—') return fromKey
  for (const session of group.sessions) {
    const fromSession =
      (session as SessionWithLiveMoney).sourceShopName?.trim() || session.liveName?.trim()
    if (fromSession && fromSession !== '—') return fromSession
  }
  return fallbackShopName.trim()
}

/**
 * 图片卡片展示用：用小红书原始开播/下播替换排班裁剪时段。
 * 金额分摊仍按裁剪后时长，避免跨班误摊。
 */
export function resolveImageSessionDisplayBounds(
  group: DailyReportDisplaySessionGroup,
  originalsByBaseLiveId?: Map<string, AnchorLiveSessionBrief>,
): { startTime: string; endTime: string; durationMinutes: number } {
  if (!originalsByBaseLiveId || originalsByBaseLiveId.size === 0) {
    return {
      startTime: group.startTime,
      endTime: group.endTime,
      durationMinutes: group.durationMinutes,
    }
  }

  const seen = new Set<string>()
  const originals: AnchorLiveSessionBrief[] = []
  for (const liveId of group.liveIds) {
    const baseId = parseBaseLiveId(liveId)
    if (!baseId || seen.has(baseId)) continue
    const original = originalsByBaseLiveId.get(baseId)
    if (!original) continue
    seen.add(baseId)
    originals.push(original)
  }
  if (originals.length === 0) {
    return {
      startTime: group.startTime,
      endTime: group.endTime,
      durationMinutes: group.durationMinutes,
    }
  }

  let startTime = originals[0]!.startTime
  let endTime = originals[0]!.endTime
  let durationMinutes = 0
  for (const original of originals) {
    if (original.startTime.localeCompare(startTime) < 0) startTime = original.startTime
    if (
      original.endTime &&
      original.endTime !== '—' &&
      (endTime === '—' || original.endTime.localeCompare(endTime) > 0)
    ) {
      endTime = original.endTime
    }
    durationMinutes += Math.max(0, original.durationMinutes)
  }
  return { startTime, endTime, durationMinutes }
}

function indexOriginalSessionsByBaseLiveId(
  originals: AnchorLiveSessionBrief[] | undefined,
): Map<string, AnchorLiveSessionBrief> | undefined {
  if (!originals || originals.length === 0) return undefined
  const map = new Map<string, AnchorLiveSessionBrief>()
  for (const session of originals) {
    const baseId = parseBaseLiveId(session.liveId)
    if (!baseId || map.has(baseId)) continue
    map.set(baseId, session)
  }
  return map
}

/** 将某主播的展示班次展开为日报图片场次（发货/单数按时长分摊；GMV/退款优先用场次原始值） */
export function buildDailyReportImageSessionsForAnchor(params: {
  anchorName: string
  shopName: string
  color?: string | null
  /** 排班裁剪后的归属场次：用于断播合并与金额分摊 */
  sessions: AnchorLiveSessionBrief[]
  /** 平台原始开播场次：用于卡片直播时段 / 时长文案 */
  originalSessions?: AnchorLiveSessionBrief[]
  shippedAmountYuan: number
  soldOrderCount: number
  gmvYuan: number
  refundAmountYuan?: number | null
}): DailyReportImageSession[] {
  const fallbackShopName = params.shopName.trim()
  const anchorName = params.anchorName.trim()
  if (!anchorName || anchorName === '未归属') return []
  if (params.sessions.length === 0) return []

  const groups = collapseDailyReportDisplaySessions(params.sessions)
  if (groups.length === 0) return []
  const originalsByBaseLiveId = indexOriginalSessionsByBaseLiveId(params.originalSessions)

  const shippedParts = allocateByDuration(params.shippedAmountYuan, groups)
  const gmvFallbackParts = allocateByDuration(params.gmvYuan, groups)
  const orderParts = allocateCountByDuration(params.soldOrderCount, groups)
  const refundFallbackTotal =
    params.refundAmountYuan != null && Number.isFinite(params.refundAmountYuan)
      ? params.refundAmountYuan
      : null
  const refundFallbackParts =
    refundFallbackTotal != null
      ? allocateByDuration(refundFallbackTotal, groups)
      : groups.map(() => null)

  return groups
    .map((group, idx) => {
      const shopName = resolveGroupShopName(group, fallbackShopName)
      if (!shopName || shopName === '—' || shopName === '线下成交') return null

      const traffic = aggregateAnchorLiveSessionTraffic(group.sessions)
      const coverClickRate = traffic.coverClickRate
      const liveGmv = sumSessionMoney(group.sessions, 'sellerRealIncomeAmtYuan')
      const liveRefund = sumSessionMoney(group.sessions, 'refundAmtYuan')
      const display = resolveImageSessionDisplayBounds(group, originalsByBaseLiveId)
      const startTime = display.startTime
      const endTime = display.endTime
      return {
        id: `${anchorName}::${shopName}::${startTime}::${endTime}::${idx}`,
        shopName,
        anchorName,
        startTime,
        endTime,
        liveTimeRange: formatLiveTimeRange(startTime, endTime),
        liveDurationText: formatLiveDurationMinutes(display.durationMinutes),
        liveDurationMinutes: display.durationMinutes,
        shipmentAmountYuan: shippedParts[idx] ?? 0,
        gmvYuan: liveGmv ?? gmvFallbackParts[idx] ?? 0,
        orderCount: orderParts[idx] ?? 0,
        refundAmountYuan: liveRefund ?? refundFallbackParts[idx] ?? null,
        coverClickRate,
        stay60sUserCount: traffic.stay60sUserCount,
        avgStayDurationSeconds: traffic.avgViewDurationSeconds,
        status: resolveDailyReportImageSessionStatus(coverClickRate),
        color: params.color ?? null,
      }
    })
    .filter((row): row is DailyReportImageSession => row != null)
}

/** 逸凡线下成交：写入日报长图卡片（无直播时段，突出 GMV / 笔数） */
export function buildDailyReportOfflineImageSession(params: {
  anchorName: string
  color?: string | null
  gmvYuan: number
  dealCount: number
  reportDate: string
}): DailyReportImageSession | null {
  const anchorName = params.anchorName.trim()
  const gmvYuan = Number.isFinite(params.gmvYuan) ? Math.round(params.gmvYuan * 100) / 100 : 0
  const dealCount = Math.max(0, Math.floor(params.dealCount || 0))
  if (!anchorName || (gmvYuan <= 0 && dealCount <= 0)) return null
  const dateKey = params.reportDate.trim() || 'offline'
  return {
    id: `offline::${anchorName}::${dateKey}`,
    shopName: '线下成交',
    anchorName,
    startTime: dateKey,
    endTime: dateKey,
    liveTimeRange: '线下成交',
    liveDurationText: '—',
    liveDurationMinutes: 0,
    shipmentAmountYuan: 0,
    gmvYuan,
    orderCount: dealCount,
    refundAmountYuan: null,
    coverClickRate: null,
    stay60sUserCount: null,
    avgStayDurationSeconds: null,
    status: 'missing',
    color: params.color ?? null,
    isOfflineDeal: true,
  }
}
