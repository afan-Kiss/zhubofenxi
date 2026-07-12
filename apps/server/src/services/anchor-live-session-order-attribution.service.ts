import type { AnalyzedOrderView } from '../types/analysis'
import { findAnchorByName } from './anchor-rules.service'
import { getAnchorConfigSync } from './anchor.service'
import { parseViewPayTimeMs } from './anchor-performance-attribution.service'
import {
  resolveDailyReportLiveSessionAssignments,
  type DailyReportLiveSession,
} from './daily-report-live-sessions.service'
import { scheduleDateFromPayMs } from '../utils/anchor-schedule-time.util'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'
import { formatHmFromDate } from '../utils/anchor-schedule-time.util'

export interface LiveSessionOrderAttributionHit {
  anchorId: string
  anchorName: string
  explain: string
  liveId: string
  liveStartMs: number
  liveEndMs: number
}

const assignmentCacheByDate = new Map<
  string,
  Promise<Awaited<ReturnType<typeof resolveDailyReportLiveSessionAssignments>>>
>()

export function clearLiveSessionOrderAttributionCache(): void {
  assignmentCacheByDate.clear()
}

async function loadAssignment(dateKey: string) {
  let pending = assignmentCacheByDate.get(dateKey)
  if (!pending) {
    pending = resolveDailyReportLiveSessionAssignments(dateKey)
    assignmentCacheByDate.set(dateKey, pending)
  }
  return pending
}

function pickLiveAccountFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  for (const k of ['liveAccountName', 'live_account_name', 'nickName', 'liveNick']) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function parseShanghaiDateTimeMs(text: string): number | null {
  const t = text.trim()
  if (!t || t === '—') return null
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(t)
  if (m) {
    const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}+08:00`)
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

export function parseDailyReportLiveSessionBounds(session: DailyReportLiveSession): {
  startMs: number
  endMs: number
} | null {
  const startMs = parseShanghaiDateTimeMs(session.startTime)
  if (startMs == null) return null

  if (!session.endTime || session.endTime === '—') {
    const dateKey = session.startTime.slice(0, 10)
    const endMs = Date.parse(`${dateKey}T23:59:59.999+08:00`)
    return { startMs, endMs }
  }

  let endMs = parseShanghaiDateTimeMs(session.endTime)
  if (endMs == null) return null
  if (endMs < startMs) endMs += 86_400_000
  return { startMs, endMs }
}

function resolveAnchorId(anchorName: string): string {
  const config = getAnchorConfigSync()
  const found = findAnchorByName(config, anchorName)
  return found?.id ?? `extra-${anchorName}`
}

function formatLiveWindowExplain(
  dateKey: string,
  session: DailyReportLiveSession,
  anchorName: string,
  startMs: number,
  endMs: number,
): string {
  const startAt = new Date(startMs)
  const endAt = new Date(endMs)
  const startHm = formatHmFromDate(startAt, dateKey, 'start')
  const endHm = formatHmFromDate(endAt, dateKey, 'end')
  const room = session.liveAccountName?.trim() || session.sourceShopName
  return `命中 ${dateKey} 真实直播时段：${room} ${startHm}–${endHm} → ${anchorName}`
}

function shopHasAssignedLiveSessions(
  assignment: Awaited<ReturnType<typeof resolveDailyReportLiveSessionAssignments>>,
  liveAccountName: string,
): boolean {
  return assignment.assignedSessions.some((session) =>
    orderLiveRoomMatchesSchedule(liveAccountName, session.sourceShopName, session.liveAccountName),
  )
}

/** 支付时间落在当日已归属的真实直播场次内 → 归该场次主播 */
export async function resolveAnchorByLiveSessionPayTime(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  payMs: number,
): Promise<LiveSessionOrderAttributionHit | null> {
  const dateKey = scheduleDateFromPayMs(payMs)
  const assignment = await loadAssignment(dateKey)
  const liveAccountName = (view.liveAccountName ?? '').trim() || pickLiveAccountFromRaw(view.raw)

  if (!liveAccountName.trim()) return null
  if (!shopHasAssignedLiveSessions(assignment, liveAccountName)) return null

  let best: {
    anchorName: string
    session: DailyReportLiveSession
    startMs: number
    endMs: number
    spanMs: number
  } | null = null

  for (const [anchorName, sessions] of assignment.byAnchor.entries()) {
    for (const session of sessions) {
      const bounds = parseDailyReportLiveSessionBounds(session)
      if (!bounds) continue
      if (
        !orderLiveRoomMatchesSchedule(
          liveAccountName,
          session.sourceShopName,
          session.liveAccountName,
        )
      ) {
        continue
      }
      if (payMs < bounds.startMs || payMs >= bounds.endMs) continue

      const spanMs = bounds.endMs - bounds.startMs
      if (
        !best ||
        spanMs < best.spanMs ||
        (spanMs === best.spanMs && bounds.startMs > best.startMs)
      ) {
        best = { anchorName, session, startMs: bounds.startMs, endMs: bounds.endMs, spanMs }
      }
    }
  }

  if (!best) return null

  return {
    anchorId: resolveAnchorId(best.anchorName),
    anchorName: best.anchorName,
    liveId: best.session.liveId,
    liveStartMs: best.startMs,
    liveEndMs: best.endMs,
    explain: formatLiveWindowExplain(
      dateKey,
      best.session,
      best.anchorName,
      best.startMs,
      best.endMs,
    ),
  }
}

export async function shopHasLiveSessionDataForPayTime(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  payMs: number,
): Promise<boolean> {
  const dateKey = scheduleDateFromPayMs(payMs)
  const assignment = await loadAssignment(dateKey)
  const liveAccountName = (view.liveAccountName ?? '').trim() || pickLiveAccountFromRaw(view.raw)
  if (!liveAccountName.trim()) return false
  return shopHasAssignedLiveSessions(assignment, liveAccountName)
}
