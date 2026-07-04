import type { EffectiveScheduleRow } from '../services/anchor-daily-schedule.service'
import type { AnchorLiveSessionBrief } from '../services/anchor-live-sessions.service'
import { ANCHOR_NEW_SCHEDULE_START_DATE } from '../config/anchor-schedule.constants'
import { anchorNamesMatch } from './anchor-name-normalize.util'
import { orderLiveRoomMatchesSchedule } from './shop-name-normalize.util'
import { isPayTimeInSchedule } from './anchor-schedule-time.util'
import { formatClockShanghai, parseLiveSessionTimeMs } from './business-timezone'

export interface AnchorLivePeriodStatus {
  hasSchedule: boolean
  hasActualStartTime: boolean
  hasActualEndTime: boolean
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  scheduledPeriodText: string | null
  actualStartAt: string | null
  actualStartText: string | null
  actualEndAt: string | null
  actualEndText: string | null
  sessionLabel: string
  shopName: string
  displaySessionLabel: string
}

export type AnchorLivePeriodPayload = AnchorLivePeriodStatus

/** @deprecated 使用 AnchorLivePeriodStatus */
export type AnchorAttendanceStatus = AnchorLivePeriodStatus

/** @deprecated 使用 AnchorLivePeriodPayload */
export type AnchorAttendanceStatusPayload = AnchorLivePeriodPayload

/** @deprecated */
export type AnchorLateStatusPayload = AnchorLivePeriodPayload

/** @deprecated */
export type AnchorLateStatus = AnchorLivePeriodStatus

const NO_LIVE_PERIOD: AnchorLivePeriodStatus = {
  hasSchedule: false,
  hasActualStartTime: false,
  hasActualEndTime: false,
  scheduledStartAt: null,
  scheduledEndAt: null,
  scheduledPeriodText: null,
  actualStartAt: null,
  actualStartText: null,
  actualEndAt: null,
  actualEndText: null,
  sessionLabel: '',
  shopName: '',
  displaySessionLabel: '',
}

function formatClockFromIso(iso: string): string {
  const ms = parseLiveSessionTimeMs(iso)
  if (ms != null) return formatClockShanghai(new Date(ms))
  const hit = /\d{2}:\d{2}/.exec(iso)
  return hit ? hit[0] : '—'
}

function parseClockMinutes(clock: string): number {
  const [h, m] = clock.split(':').map((v) => Number(v))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

function resolveScheduleDateKey(row: EffectiveScheduleRow, dateKey?: string): string {
  if (dateKey?.trim()) return dateKey.trim()
  const fromStartAt = row.startAt?.slice(0, 10)
  if (fromStartAt && /^\d{4}-\d{2}-\d{2}$/.test(fromStartAt)) return fromStartAt
  return ''
}

function usesNewSessionLabelRules(dateKey: string): boolean {
  return dateKey >= ANCHOR_NEW_SCHEDULE_START_DATE
}

/** 从排班备注或开始时间推导场次名；2026-07-01 起 14:00 显示「午场」 */
export function deriveSessionLabelFromSchedule(
  row: EffectiveScheduleRow,
  dateKey?: string,
): string {
  const scheduleDate = resolveScheduleDateKey(row, dateKey)
  const useNewRules = usesNewSessionLabelRules(scheduleDate)

  const note = (row.note ?? '').trim()
  if (note.includes('早场')) return '早场'
  if (note.includes('晚场')) return '晚场'
  if (note.includes('午场')) return useNewRules ? '午场' : '下午场'
  if (note.includes('下午场')) return useNewRules ? '午场' : '下午场'

  const minutes = parseClockMinutes(row.startTime)
  if (minutes >= 18 * 60) return '晚场'
  if (useNewRules) {
    if (minutes >= 14 * 60) return '午场'
    if (minutes >= 8 * 60) return '早场'
  } else {
    if (minutes >= 12 * 60) return '下午场'
    if (minutes >= 8 * 60) return '早场'
  }
  return '场次'
}

export function resolveShopNameFromSchedule(row: EffectiveScheduleRow): string {
  return row.shopName?.trim() || row.liveRoomName?.trim() || ''
}

export function formatDisplaySessionLabel(sessionLabel: string, shopName: string): string {
  const name = sessionLabel.trim()
  const shop = shopName.trim()
  if (!name) return shop
  if (!shop) return name
  if (name.includes('·')) return name
  return `${name}·${shop}`
}

export function formatScheduleActualTimingLine(params: {
  scheduledPeriodText: string | null
  actualStartText: string | null
  actualEndText: string | null
  displaySessionLabel?: string
}): string {
  const schedule = params.scheduledPeriodText?.replace('~', '-') ?? '—'
  const actualStart = params.actualStartText ?? '—'
  const actualEnd = params.actualEndText ?? '—'
  const actual =
    params.actualStartText && params.actualEndText
      ? `${actualStart}-${actualEnd}`
      : params.actualStartText
        ? actualStart
        : '—'
  const timing = `排班 ${schedule}｜实际 ${actual}`
  if (params.displaySessionLabel) {
    return `${params.displaySessionLabel}｜${timing}`
  }
  return timing
}

function filterScheduleRowsForAnchor(
  rows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
  usedRowIds: Set<string>,
): EffectiveScheduleRow[] {
  const candidates = rows.filter(
    (r) =>
      r.enabled &&
      anchorNamesMatch(r.anchorName, anchorName) &&
      !usedRowIds.has(r.rowId),
  )
  const shop = shopName.trim()
  if (!shop) return candidates
  const shopMatched = candidates.filter((r) =>
    orderLiveRoomMatchesSchedule(shop, r.shopName, r.liveRoomName),
  )
  return shopMatched.length > 0 ? shopMatched : candidates
}

/** 按主播 + 直播号 + 时刻匹配生效排班（含 manual / generated / virtual） */
export function matchEffectiveScheduleRow(
  rows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
  timeMs: number | null,
  usedRowIds: Set<string>,
): EffectiveScheduleRow | undefined {
  const candidates = filterScheduleRowsForAnchor(rows, anchorName, shopName, usedRowIds)
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  if (timeMs != null && Number.isFinite(timeMs)) {
    const inWindow = candidates.filter((row) =>
      isPayTimeInSchedule(timeMs, new Date(row.startAt), new Date(row.endAt)),
    )
    if (inWindow.length === 1) return inWindow[0]
    if (inWindow.length > 1) {
      return inWindow.sort(
        (a, b) =>
          Math.abs(timeMs - new Date(a.startAt).getTime()) -
          Math.abs(timeMs - new Date(b.startAt).getTime()),
      )[0]
    }
  }

  const sorted = [...candidates].sort((a, b) => a.startAt.localeCompare(b.startAt))

  if (timeMs == null) {
    return sorted[0]
  }

  const scored = sorted.map((row) => {
    const startMs = new Date(row.startAt).getTime()
    const endMs = new Date(row.endAt).getTime()
    const inWindow =
      timeMs >= startMs - 30 * 60_000 && timeMs <= endMs + 60 * 60_000
    return { row, startMs, inWindow, delta: timeMs - startMs }
  })

  const inWindow = scored.filter((s) => s.inWindow)
  const pool = inWindow.length > 0 ? inWindow : scored

  const beforeActual = pool.filter((s) => s.startMs <= timeMs)
  if (beforeActual.length > 0) {
    return beforeActual.sort((a, b) => b.startMs - a.startMs)[0]!.row
  }

  return pool.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0]!.row
}

/** 直播场次是否与某段生效排班重叠（7/1 起场次归属） */
export function sessionOverlapsEffectiveScheduleRow(
  rows: EffectiveScheduleRow[],
  anchorName: string,
  liveAccountName: string,
  startMs: number,
  endMs: number,
): boolean {
  const liveName = liveAccountName.trim()
  if (!liveName || !Number.isFinite(startMs)) return false
  const effectiveEnd = Number.isFinite(endMs) ? endMs : startMs

  for (const row of rows) {
    if (!row.enabled) continue
    if (!anchorNamesMatch(row.anchorName, anchorName)) continue
    if (!orderLiveRoomMatchesSchedule(liveName, row.shopName, row.liveRoomName)) continue
    const scheduleStart = new Date(row.startAt).getTime()
    const scheduleEnd = new Date(row.endAt).getTime()
    if (isPayTimeInSchedule(startMs, new Date(row.startAt), new Date(row.endAt))) return true
    if (startMs < scheduleStart && effectiveEnd > scheduleStart) return true
  }
  return false
}

/** 匹配生效排班：同一天多段时，优先选实际开播时刻命中的排班（且未被占用）。 */
export function matchManualSchedule(
  rows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
  actualStartMs: number | null,
  usedRowIds: Set<string>,
): EffectiveScheduleRow | undefined {
  return matchEffectiveScheduleRow(rows, anchorName, shopName, actualStartMs, usedRowIds)
}

function resolveSessionEndMs(session: AnchorLiveSessionBrief): number | null {
  const startMs = parseLiveSessionTimeMs(session.startTime)

  if (session.endTime && session.endTime !== '—') {
    let endMs = parseLiveSessionTimeMs(session.endTime)
    if (endMs == null) return null
    if (startMs != null && endMs < startMs) {
      endMs += 24 * 60 * 60_000
    }
    return endMs
  }

  if (startMs != null && session.durationMinutes > 0) {
    return startMs + session.durationMinutes * 60_000
  }

  return null
}

function resolveSessionEndAt(session: AnchorLiveSessionBrief, endMs: number): string {
  if (session.endTime && session.endTime !== '—') return session.endTime
  return new Date(endMs).toISOString()
}

export function earliestSessionStart(sessions: AnchorLiveSessionBrief[]): {
  startAt: string
  startMs: number
  session: AnchorLiveSessionBrief
} | null {
  const valid = sessions.filter((s) => s.startTime && s.startTime !== '—')
  if (valid.length === 0) return null
  const earliest = valid.reduce((min, s) => (s.startTime < min.startTime ? s : min), valid[0]!)
  const startMs = parseLiveSessionTimeMs(earliest.startTime)
  if (startMs == null) return null
  return { startAt: earliest.startTime, startMs, session: earliest }
}

export function pickEarliestValidSession(
  sessions: AnchorLiveSessionBrief[],
): AnchorLiveSessionBrief | null {
  return earliestSessionStart(sessions)?.session ?? null
}

export function pickLatestValidSessionEnd(sessions: AnchorLiveSessionBrief[]): {
  endAt: string
  endMs: number
  session: AnchorLiveSessionBrief
} | null {
  let best: { endAt: string; endMs: number; session: AnchorLiveSessionBrief } | null = null
  for (const session of sessions) {
    const endMs = resolveSessionEndMs(session)
    if (endMs == null) continue
    const endAt = resolveSessionEndAt(session, endMs)
    if (!best || endMs > best.endMs) {
      best = { endAt, endMs, session }
    }
  }
  return best
}

export function buildActualLivePeriodText(sessions: AnchorLiveSessionBrief[]): string {
  const start = earliestSessionStart(sessions)
  const end = pickLatestValidSessionEnd(sessions)
  if (!start && !end) return '—'
  const startText = start ? formatClockFromIso(start.startAt) : '—'
  const endText = end ? formatClockFromIso(end.endAt) : '—'
  return `${startText}~${endText}`
}

export function calculateAnchorLivePeriodStatus(
  scheduleRow: EffectiveScheduleRow | undefined,
  actualStartMs: number | null,
  actualStartAt: string | null,
  actualEndMs: number | null,
  actualEndAt: string | null,
): AnchorLivePeriodStatus {
  if (!scheduleRow) {
    if (actualStartMs != null && actualStartAt) {
      return {
        ...NO_LIVE_PERIOD,
        hasActualStartTime: true,
        actualStartAt,
        actualStartText: formatClockFromIso(actualStartAt),
      }
    }
    return { ...NO_LIVE_PERIOD }
  }

  const sessionLabel = deriveSessionLabelFromSchedule(
    scheduleRow,
    scheduleRow.startAt?.slice(0, 10),
  )
  const shopName = resolveShopNameFromSchedule(scheduleRow)
  const displaySessionLabel = formatDisplaySessionLabel(sessionLabel, shopName)
  const scheduledStartAt = scheduleRow.startAt
  const scheduledEndAt = scheduleRow.endAt
  const scheduledPeriodText = `${scheduleRow.startTime}~${scheduleRow.endTime}`

  if (actualStartMs == null || !actualStartAt || !Number.isFinite(actualStartMs)) {
    return {
      hasSchedule: true,
      hasActualStartTime: false,
      hasActualEndTime: false,
      scheduledStartAt,
      scheduledEndAt,
      scheduledPeriodText,
      actualStartAt: null,
      actualStartText: null,
      actualEndAt: null,
      actualEndText: null,
      sessionLabel,
      shopName,
      displaySessionLabel,
    }
  }

  const actualStartText = formatClockFromIso(actualStartAt)
  let hasActualEndTime = false
  let actualEndText: string | null = null

  if (actualEndMs != null && actualEndAt) {
    hasActualEndTime = true
    actualEndText = formatClockFromIso(actualEndAt)
  }

  return {
    hasSchedule: true,
    hasActualStartTime: true,
    hasActualEndTime,
    scheduledStartAt,
    scheduledEndAt,
    scheduledPeriodText,
    actualStartAt,
    actualStartText,
    actualEndAt: actualEndAt ?? null,
    actualEndText,
    sessionLabel,
    shopName,
    displaySessionLabel,
  }
}

/** @deprecated 使用 calculateAnchorLivePeriodStatus */
export const calculateAnchorAttendanceStatus = calculateAnchorLivePeriodStatus

/** @deprecated 使用 calculateAnchorLivePeriodStatus */
export const calculateAnchorLateStatus = calculateAnchorLivePeriodStatus

export function toLivePeriodPayload(status: AnchorLivePeriodStatus): AnchorLivePeriodPayload {
  return status
}

/** @deprecated 使用 toLivePeriodPayload */
export const toAttendanceStatusPayload = toLivePeriodPayload

/** @deprecated */
export const toLateStatusPayload = toLivePeriodPayload

export function resolveAnchorLivePeriodFromSessions(
  scheduleRows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
  sessions: AnchorLiveSessionBrief[],
  usedRowIds?: Set<string>,
): AnchorLivePeriodPayload {
  const actualStart = earliestSessionStart(sessions)
  const actualEnd = pickLatestValidSessionEnd(sessions)
  const scheduleRow = matchManualSchedule(
    scheduleRows,
    anchorName,
    shopName,
    actualStart?.startMs ?? null,
    usedRowIds ?? new Set(),
  )
  if (scheduleRow && usedRowIds) usedRowIds.add(scheduleRow.rowId)
  return calculateAnchorLivePeriodStatus(
    scheduleRow,
    actualStart?.startMs ?? null,
    actualStart?.startAt ?? null,
    actualEnd?.endMs ?? null,
    actualEnd?.endAt ?? null,
  )
}

/** @deprecated 使用 resolveAnchorLivePeriodFromSessions */
export const resolveAnchorAttendanceFromSessions = resolveAnchorLivePeriodFromSessions

/** @deprecated */
export const resolveAnchorLateStatusFromSessions = resolveAnchorLivePeriodFromSessions

/** @deprecated */
export function attachAnchorScheduleLateFields(
  scheduleRows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
  sessions: AnchorLiveSessionBrief[],
  usedRowIds?: Set<string>,
): AnchorLivePeriodPayload {
  return resolveAnchorLivePeriodFromSessions(
    scheduleRows,
    anchorName,
    shopName,
    sessions,
    usedRowIds,
  )
}

export function resolveFallbackSessionDisplay(params: {
  fallbackSessionLabel?: string
  fallbackShopName?: string
  timeRuleSessionLabel?: string
  dateKey?: string
}): { sessionLabel: string; shopName: string; displaySessionLabel: string } {
  const shopName = params.fallbackShopName?.trim() ?? ''
  let sessionLabel = params.fallbackSessionLabel?.trim() ?? ''
  if (!sessionLabel && params.timeRuleSessionLabel) {
    sessionLabel = params.timeRuleSessionLabel
  }
  if (!sessionLabel) sessionLabel = '场次'
  const useNewRules = usesNewSessionLabelRules(params.dateKey?.trim() ?? '')
  if (!useNewRules && sessionLabel.includes('午场')) {
    sessionLabel = sessionLabel.replace(/午场/g, '下午场')
  }
  const displaySessionLabel = formatDisplaySessionLabel(sessionLabel.split('·')[0] ?? sessionLabel, shopName)
  return { sessionLabel, shopName, displaySessionLabel }
}
