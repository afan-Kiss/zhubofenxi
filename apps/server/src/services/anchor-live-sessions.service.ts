import type { AnalyzedOrderView } from '../types/analysis'
import type { NormalizedLiveSession } from './xhs-api-sync/xhs-json-normalizer.service'
import { normalizeLiveSessionsFromRaw } from './xhs-api-sync/xhs-json-normalizer.service'
import { normalizeAnchorDrillQuery } from './board-scoped-views.service'
import { viewBelongsToAnchor } from './anchor-attribution.util'
import {
  resolveShopSessionAnchorFromLiveAccount,
  sessionOverlapsXiaoBaiSlot,
  SHOP_SESSION_ANCHOR_CUTOFF_MS,
} from './anchor-performance-attribution.service'
import { findAnchorByName, matchTimeRule } from './anchor-rules.service'
import { getAnchorConfigSync } from './anchor.service'
import { mapLiveNickToKnownAnchor } from '../utils/anchor-label'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { formatClockShanghai, formatDateTimeShanghai } from '../utils/business-timezone'
import {
  aggregateLiveSessionTraffic,
  extractLiveSessionTrafficFromSession,
  type AggregatedLiveSessionTraffic,
  type LiveSessionTrafficMetrics,
} from './live-session-traffic.util'

export interface AnchorLiveSessionBrief extends LiveSessionTrafficMetrics {
  liveId: string
  liveName: string
  startTime: string
  endTime: string
  durationMinutes: number
  durationText: string
}

export function formatLiveDurationMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m <= 0) return '—'
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h > 0 && min > 0) return `${h}小时${min}分`
  if (h > 0) return `${h}小时`
  return `${min}分钟`
}

function formatLiveClock(time: Date | null, fallbackText?: string): string {
  if (time && !Number.isNaN(time.getTime())) {
    return formatClockShanghai(time)
  }
  const text = (fallbackText ?? '').trim()
  const hit = /\d{2}:\d{2}/.exec(text)
  return hit ? hit[0] : '—'
}

function resolveTargetAnchor(opts: {
  anchorId?: string
  anchorName?: string
}): { anchorId: string; anchorName: string } | null {
  const q = normalizeAnchorDrillQuery(opts)
  if (q.anchorName === '未归属') return { anchorId: '', anchorName: '未归属' }
  const config = getAnchorConfigSync()
  if (q.anchorId) {
    const byId = config.anchors.find((a) => a.enabled && a.id === q.anchorId)
    if (byId) return { anchorId: byId.id, anchorName: byId.name }
  }
  if (q.anchorName) {
    const byName = findAnchorByName(config, q.anchorName)
    if (byName?.enabled) return { anchorId: byName.id, anchorName: byName.name }
    return { anchorId: q.anchorId ?? `extra-${q.anchorName}`, anchorName: q.anchorName }
  }
  return null
}

function sessionEndTime(session: NormalizedLiveSession): Date | null {
  if (!session.startTime) return null
  if (session.endTime) {
    if (session.endTime.getTime() < session.startTime.getTime()) {
      return new Date(session.endTime.getTime() + 86400000)
    }
    return session.endTime
  }
  if (session.durationMinutes > 0) {
    return new Date(session.startTime.getTime() + session.durationMinutes * 60_000)
  }
  return null
}

function orderPayTimeMs(v: AnalyzedOrderView): number | null {
  const text = v.orderTimeText?.trim()
  if (!text) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text)
  if (m) {
    const ms = Date.parse(
      `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+08:00`,
    )
    return Number.isFinite(ms) ? ms : null
  }
  const t = Date.parse(text)
  return Number.isFinite(t) ? t : null
}

function pickSessionLiveAccountName(session: NormalizedLiveSession): string {
  return (session.liveAccountName || session.liveName || session.anchorName || '').trim()
}

/** 场次开播时刻命中主播时间段规则（6.13 前与订单 time_rule 归属一致） */
function sessionMatchesTargetTimeRule(
  session: NormalizedLiveSession,
  target: { anchorId: string; anchorName: string },
): boolean {
  if (!session.startTime) return false
  const hit = matchTimeRule(session.startTime, getAnchorConfigSync())
  if (!hit) return false
  if (target.anchorId && hit.anchor.id === target.anchorId) return true
  return hit.anchor.name === target.anchorName
}

function isXiaoBaiLiveSession(session: NormalizedLiveSession): boolean {
  if (!session.startTime) return false
  const startMs = session.startTime.getTime()
  const endMs = sessionEndTime(session)?.getTime() ?? startMs
  return sessionOverlapsXiaoBaiSlot(startMs, endMs)
}

/** 6.13 起：按直播号 + 早晚场固定归属 */
function sessionMatchesShopSessionRule(
  session: NormalizedLiveSession,
  target: { anchorId: string; anchorName: string },
): boolean {
  if (!session.startTime) return false
  if (isXiaoBaiLiveSession(session)) return false
  const resolved = resolveShopSessionAnchorFromLiveAccount(
    pickSessionLiveAccountName(session),
    session.startTime,
  )
  if (!resolved) return false
  if (target.anchorName === resolved.anchorName) return true
  return Boolean(target.anchorId && target.anchorId === resolved.anchorId)
}

function liveSessionMatchesAnchor(
  session: NormalizedLiveSession,
  target: { anchorId: string; anchorName: string },
  anchorOrders: AnalyzedOrderView[],
): boolean {
  if (session.errors.length > 0 || !session.startTime) return false
  const startMs = session.startTime.getTime()
  if (startMs >= SHOP_SESSION_ANCHOR_CUTOFF_MS) {
    if (target.anchorName === '小白') {
      return isXiaoBaiLiveSession(session)
    }
    if (isXiaoBaiLiveSession(session)) return false
    return sessionMatchesShopSessionRule(session, target)
  }

  if (liveSessionBelongsToAnchor(session, target)) return true
  if (sessionMatchesTargetTimeRule(session, target)) return true

  const endMs = sessionEndTime(session)?.getTime()
  if (endMs != null) {
    for (const v of anchorOrders) {
      const payMs = orderPayTimeMs(v)
      if (payMs != null && payMs >= startMs && payMs <= endMs) return true
    }
  }
  return false
}

function resolveSessionAnchor(session: NormalizedLiveSession): {
  anchorId: string
  anchorName: string
} {
  const rawName = session.anchorName.trim()
  const mapped = mapLiveNickToKnownAnchor(rawName)
  const lookupName = mapped ?? rawName
  const config = getAnchorConfigSync()
  const found = lookupName ? findAnchorByName(config, lookupName) : undefined
  if (found?.enabled) {
    return { anchorId: found.id, anchorName: found.name }
  }
  return {
    anchorId: lookupName ? `extra-${lookupName}` : '',
    anchorName: lookupName || '未归属',
  }
}

function liveSessionBelongsToAnchor(
  session: NormalizedLiveSession,
  opts: { anchorId?: string; anchorName?: string },
): boolean {
  if (session.errors.length > 0 || !session.startTime) return false
  const anchor = resolveSessionAnchor(session)
  return viewBelongsToAnchor(
    { anchorId: anchor.anchorId, anchorName: anchor.anchorName } as import('../types/analysis').AnalyzedOrderView,
    normalizeAnchorDrillQuery(opts),
  )
}

function dedupeLiveSessions(sessions: NormalizedLiveSession[]): NormalizedLiveSession[] {
  const byKey = new Map<string, NormalizedLiveSession>()
  for (const session of sessions) {
    const startMs = session.startTime?.getTime() ?? 0
    const liveId = session.liveId?.trim() || session.id?.trim()
    const key = liveId ? `id:${liveId}` : `t:${startMs}|${session.durationMinutes}|${session.anchorName}`
    const existing = byKey.get(key)
    if (!existing || session.durationMinutes > existing.durationMinutes) {
      byKey.set(key, session)
    }
  }
  return [...byKey.values()]
}

function toBrief(session: NormalizedLiveSession): AnchorLiveSessionBrief {
  const startTime = session.startTime ? formatDateTimeShanghai(session.startTime) : '—'
  let endTime = session.endTime ? formatDateTimeShanghai(session.endTime) : '—'
  if (session.startTime && session.endTime && session.endTime.getTime() < session.startTime.getTime()) {
    endTime = formatDateTimeShanghai(new Date(session.endTime.getTime() + 86400000))
  }
  return {
    ...extractLiveSessionTrafficFromSession(session),
    liveId: session.liveId || session.id,
    liveName: session.liveName || '—',
    startTime,
    endTime,
    durationMinutes: session.durationMinutes,
    durationText: formatLiveDurationMinutes(session.durationMinutes),
  }
}

export async function resolveAnchorLiveSessionsForRange(params: {
  preset?: string
  startDate: string
  endDate: string
  anchorId?: string
  anchorName?: string
  anchorOrders?: AnalyzedOrderView[]
}): Promise<AnchorLiveSessionBrief[]> {
  const sessions = await resolveAnchorLiveSessionsWithTrafficForRange(params)
  return sessions
}

export async function resolveAnchorLiveSessionsWithTrafficForRange(params: {
  preset?: string
  startDate: string
  endDate: string
  anchorId?: string
  anchorName?: string
  anchorOrders?: AnalyzedOrderView[]
}): Promise<AnchorLiveSessionBrief[]> {
  const target = resolveTargetAnchor(params)
  if (!target) return []

  const range = resolveDateRange(
    (params.preset ?? 'custom') as DateRangePreset,
    params.startDate,
    params.endDate,
  )
  const anchorOrders = params.anchorOrders ?? []
  const all = dedupeLiveSessions(await normalizeLiveSessionsFromRaw())
  const matched = all
    .filter((s) => {
      if (!s.startTime) return false
      const ms = s.startTime.getTime()
      if (ms < range.startTimeMs || ms > range.endTimeMs) return false
      return liveSessionMatchesAnchor(s, target, anchorOrders)
    })
    .sort((a, b) => (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0))
    .map(toBrief)
  return dedupeLiveSessionBriefs(matched)
}

export function aggregateAnchorLiveSessionTraffic(
  sessions: AnchorLiveSessionBrief[],
): AggregatedLiveSessionTraffic {
  return aggregateLiveSessionTraffic(sessions)
}

export interface LiveRoomNewFollowerRow {
  liveAccountName: string
  newFollowerCount: number
}

const LIVE_ACCOUNT_DISPLAY_ORDER = ['祥钰', '和田雅玉', '拾玉居']

function liveAccountSortIndex(name: string): number {
  const n = name.trim()
  for (let i = 0; i < LIVE_ACCOUNT_DISPLAY_ORDER.length; i++) {
    if (n.includes(LIVE_ACCOUNT_DISPLAY_ORDER[i]!)) return i
  }
  return 999
}

/** 日期范围内按直播号汇总新增粉丝（场次按 liveId 去重） */
export async function sumNewFollowersByLiveAccountForRange(params: {
  preset?: string
  startDate: string
  endDate: string
}): Promise<LiveRoomNewFollowerRow[]> {
  const range = resolveDateRange(
    (params.preset ?? 'custom') as DateRangePreset,
    params.startDate,
    params.endDate,
  )
  const all = dedupeLiveSessions(await normalizeLiveSessionsFromRaw({ range }))
  const byAccount = new Map<string, number>()
  const seen = new Set<string>()

  for (const session of all) {
    if (session.errors.length > 0 || !session.startTime) continue
    const ms = session.startTime.getTime()
    if (ms < range.startTimeMs || ms > range.endTimeMs) continue
    const key = session.liveId?.trim() || session.id
    if (seen.has(key)) continue
    seen.add(key)

    const accountName = pickSessionLiveAccountName(session) || session.liveName?.trim() || '未知直播号'
    const followers = extractLiveSessionTrafficFromSession(session).newFollowerCount
    byAccount.set(accountName, (byAccount.get(accountName) ?? 0) + followers)
  }

  return [...byAccount.entries()]
    .map(([liveAccountName, newFollowerCount]) => ({ liveAccountName, newFollowerCount }))
    .sort((a, b) => {
      const ia = liveAccountSortIndex(a.liveAccountName)
      const ib = liveAccountSortIndex(b.liveAccountName)
      if (ia !== ib) return ia - ib
      return a.liveAccountName.localeCompare(b.liveAccountName, 'zh-CN')
    })
}

/** 日期范围内各直播场次时长去重求和（按 liveId，不重复累计） */
export async function sumUniqueLiveDurationMinutesForRange(params: {
  preset?: string
  startDate: string
  endDate: string
}): Promise<number> {
  const range = resolveDateRange(
    (params.preset ?? 'custom') as DateRangePreset,
    params.startDate,
    params.endDate,
  )
  const all = dedupeLiveSessions(
    await normalizeLiveSessionsFromRaw({ range }),
  )
  const seen = new Set<string>()
  let total = 0
  for (const session of all) {
    if (session.errors.length > 0 || !session.startTime) continue
    const ms = session.startTime.getTime()
    if (ms < range.startTimeMs || ms > range.endTimeMs) continue
    const key = session.liveId?.trim() || session.id
    if (seen.has(key)) continue
    seen.add(key)
    total += Math.max(0, session.durationMinutes)
  }
  return total
}

function dedupeLiveSessionBriefs(sessions: AnchorLiveSessionBrief[]): AnchorLiveSessionBrief[] {
  const byKey = new Map<string, AnchorLiveSessionBrief>()
  for (const session of sessions) {
    const key =
      session.liveId?.trim() ||
      `${session.startTime}|${session.endTime}|${session.durationMinutes}`
    const existing = byKey.get(key)
    if (!existing || session.durationMinutes > existing.durationMinutes) {
      byKey.set(key, session)
    }
  }
  return [...byKey.values()]
}

export function formatAnchorLiveSessionsSummary(sessions: AnchorLiveSessionBrief[]): string {
  if (sessions.length === 0) return ''
  const totalMin = sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
  if (sessions.length === 1) {
    const s = sessions[0]!
    const start = formatLiveClock(null, s.startTime)
    const end = formatLiveClock(null, s.endTime)
    return `直播 1 场 · ${s.durationText} · ${start}~${end}`
  }
  return `直播 ${sessions.length} 场 · 合计 ${formatLiveDurationMinutes(totalMin)}`
}

export function formatAnchorLiveSessionDetailLine(session: AnchorLiveSessionBrief): string {
  const start = formatLiveClock(null, session.startTime)
  const end = formatLiveClock(null, session.endTime)
  return `${start}~${end}（${session.durationText}）`
}
