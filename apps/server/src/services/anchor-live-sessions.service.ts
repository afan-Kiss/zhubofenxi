import type { AnalyzedOrderView } from '../types/analysis'
import type { NormalizedLiveSession } from './xhs-api-sync/xhs-json-normalizer.service'
import { normalizeLiveSessionsFromRaw } from './xhs-api-sync/xhs-json-normalizer.service'
import { normalizeAnchorDrillQuery } from './board-scoped-views.service'
import { viewBelongsToAnchor } from './anchor-attribution.util'
import { findAnchorByName, matchTimeRule } from './anchor-rules.service'
import { getAnchorConfigSync } from './anchor.service'
import { mapLiveNickToKnownAnchor } from '../utils/anchor-label'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'

export interface AnchorLiveSessionBrief {
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

function formatLiveDateTimeUtc(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

function formatLiveClock(time: Date | null, fallbackText?: string): string {
  if (time && !Number.isNaN(time.getTime())) {
    const hh = String(time.getUTCHours()).padStart(2, '0')
    const mm = String(time.getUTCMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
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

/** 场次开播时刻命中主播时间段规则（与订单 time_rule 归属一致） */
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

function liveSessionMatchesAnchor(
  session: NormalizedLiveSession,
  target: { anchorId: string; anchorName: string },
  anchorOrders: AnalyzedOrderView[],
): boolean {
  if (session.errors.length > 0 || !session.startTime) return false
  if (liveSessionBelongsToAnchor(session, target)) return true
  if (sessionMatchesTargetTimeRule(session, target)) return true

  const startMs = session.startTime.getTime()
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
  const startTime = session.startTime ? formatLiveDateTimeUtc(session.startTime) : '—'
  let endTime = session.endTime ? formatLiveDateTimeUtc(session.endTime) : '—'
  if (session.startTime && session.endTime && session.endTime.getTime() < session.startTime.getTime()) {
    endTime = formatLiveDateTimeUtc(new Date(session.endTime.getTime() + 86400000))
  }
  return {
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
