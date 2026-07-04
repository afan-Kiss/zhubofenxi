import type { EffectiveScheduleRow } from './anchor-daily-schedule.service'
import type { AnchorLiveSessionBrief } from './anchor-live-sessions.service'
import { formatLiveDurationMinutes } from './anchor-live-sessions.service'
import {
  calculateAnchorAttendanceStatus,
  deriveSessionLabelFromSchedule,
  earliestSessionStart,
  formatDisplaySessionLabel,
  pickLatestValidSessionEnd,
  resolveShopNameFromSchedule,
  toAttendanceStatusPayload,
  type AnchorAttendanceStatusPayload,
} from '../utils/anchor-attendance-status.util'
import { anchorNamesMatch } from '../utils/anchor-name-normalize.util'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'
import { formatDateTimeShanghai, parseLiveSessionTimeMs } from '../utils/business-timezone'

export interface LiveSessionScheduleMatchResult {
  session: AnchorLiveSessionBrief
  scheduleRow: EffectiveScheduleRow | null
  overlapMinutes: number
  matchTier: number | null
  matchReason: string
}

export interface LiveSessionScheduleMatchCandidate {
  scheduleRow: EffectiveScheduleRow
  overlapMinutes: number
  shopMatch: boolean
  matchReason: string
}

/** 真实直播与一条排班的交集段（用于主播业绩显示与订单归属） */
export interface LiveSessionScheduleSegment {
  anchorName: string
  scheduleRow: EffectiveScheduleRow
  originalSession: AnchorLiveSessionBrief
  overlapMinutes: number
  clippedStartMs: number
  clippedEndMs: number
  clippedStartTime: string
  clippedEndTime: string
  clippedDurationMinutes: number
  matchReason: string
}

/** @deprecated 使用 LiveSessionScheduleSegment */
export interface LiveSessionScheduleOverlapMatch {
  session: AnchorLiveSessionBrief
  scheduleRow: EffectiveScheduleRow
  overlapMinutes: number
  clippedStartMs: number
  clippedEndMs: number
  clippedStartTime: string
  clippedEndTime: string
  clippedDurationMinutes: number
  matchReason: string
}

/** 单场直播与全部 enabled 排班行的重叠明细（调试用） */
export function listSessionScheduleMatchCandidates(
  session: AnchorLiveSessionBrief,
  scheduleRows: EffectiveScheduleRow[],
): LiveSessionScheduleMatchCandidate[] {
  const liveName = resolveSessionShopLabelForScheduleMatch(session)
  const startMs = parseLiveSessionTimeMs(session.startTime)
  const endMs = resolveSessionEndMs(session)
  if (startMs == null || endMs == null) return []

  const candidates: LiveSessionScheduleMatchCandidate[] = []
  for (const row of scheduleRows) {
    if (!row.enabled) continue
    const scheduleStart = new Date(row.startAt).getTime()
    const scheduleEnd = new Date(row.endAt).getTime()
    const overlap = computeScheduleOverlapMinutes(startMs, endMs, scheduleStart, scheduleEnd)
    const shopMatch = orderLiveRoomMatchesSchedule(liveName, row.shopName, row.liveRoomName)
    candidates.push({
      scheduleRow: row,
      overlapMinutes: overlap,
      shopMatch,
      matchReason:
        overlap > 0 && shopMatch
          ? `店铺(${row.shopName})+时间重叠${overlap}分钟→${row.anchorName}`
          : overlap <= 0
            ? '时间无重叠'
            : '店铺不匹配',
    })
  }
  return candidates.sort((a, b) => b.overlapMinutes - a.overlapMinutes)
}

export interface DailyReportLiveScheduleFields {
  livePeriodText: string
  liveTimeRange: string
  liveStartTime: string | null
  liveEndTime: string | null
  scheduleTimeRange: string | null
  scheduleMatched: boolean
  scheduleMatchReason: string | null
  matchedSessions: AnchorLiveSessionBrief[]
  primaryScheduleRow: EffectiveScheduleRow | null
}

/** 排班店铺匹配：优先用按店加载的 sourceShopName，避免用直播标题误判 */
function resolveSessionShopLabelForScheduleMatch(session: AnchorLiveSessionBrief): string {
  const extended = session as AnchorLiveSessionBrief & { sourceShopName?: string }
  return extended.sourceShopName?.trim() || session.liveName?.trim() || ''
}

function formatClockFromIso(iso: string): string {
  return iso.slice(11, 16)
}

/** 将真实场次时间按行展示（每场一行 start~end） */
export function buildPerSessionLivePeriodText(sessions: AnchorLiveSessionBrief[]): string {
  if (sessions.length === 0) return '—'
  const lines = sessions
    .filter((s) => s.startTime && s.startTime !== '—')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map((s) => {
      const start = formatClockFromIso(s.startTime)
      const end = s.endTime && s.endTime !== '—' ? formatClockFromIso(s.endTime) : '—'
      return `${start}~${end}`
    })
  return lines.length > 0 ? lines.join('\n') : '—'
}

export function buildLiveSessionCountSummary(sessions: AnchorLiveSessionBrief[]): string {
  if (sessions.length === 0) return '—'
  const totalMin = sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
  if (sessions.length === 1) {
    return formatLiveDurationMinutes(totalMin)
  }
  return `直播 ${sessions.length} 场 · 合计 ${formatLiveDurationMinutes(totalMin)}`
}

export function resolveSessionEndMs(session: AnchorLiveSessionBrief): number | null {
  const startMs = parseLiveSessionTimeMs(session.startTime)
  if (session.endTime && session.endTime !== '—') {
    let endMs = parseLiveSessionTimeMs(session.endTime)
    if (endMs == null) return null
    if (startMs != null && endMs < startMs) endMs += 24 * 60 * 60_000
    return endMs
  }
  if (startMs != null && session.durationMinutes > 0) {
    return startMs + session.durationMinutes * 60_000
  }
  return startMs
}

export function computeScheduleOverlapMinutes(
  liveStartMs: number,
  liveEndMs: number,
  scheduleStartMs: number,
  scheduleEndMs: number,
): number {
  const start = Math.max(liveStartMs, scheduleStartMs)
  const end = Math.min(liveEndMs, scheduleEndMs)
  if (end <= start) return 0
  return Math.round((end - start) / 60_000)
}

/** 单场次 → 最佳排班段（按重叠分钟 + 店铺/主播优先级） */
export function matchLiveSessionToBestScheduleRow(
  session: AnchorLiveSessionBrief,
  scheduleRows: EffectiveScheduleRow[],
): LiveSessionScheduleMatchResult {
  const liveName = resolveSessionShopLabelForScheduleMatch(session)
  const startMs = parseLiveSessionTimeMs(session.startTime)
  const endMs = resolveSessionEndMs(session)

  if (startMs == null || endMs == null) {
    return {
      session,
      scheduleRow: null,
      overlapMinutes: 0,
      matchTier: null,
      matchReason: '无有效开播/下播时间',
    }
  }

  let best: {
    row: EffectiveScheduleRow
    overlapMinutes: number
    matchTier: number
    matchReason: string
  } | null = null

  for (const row of scheduleRows) {
    if (!row.enabled) continue
    const scheduleStart = new Date(row.startAt).getTime()
    const scheduleEnd = new Date(row.endAt).getTime()
    const overlap = computeScheduleOverlapMinutes(startMs, endMs, scheduleStart, scheduleEnd)
    if (overlap <= 0) continue

    const shopMatch = orderLiveRoomMatchesSchedule(liveName, row.shopName, row.liveRoomName)
    if (!shopMatch) continue

    const matchTier = 1
    const matchReason = `店铺(${row.shopName})+时间重叠${overlap}分钟→${row.anchorName}`

    const better =
      !best ||
      matchTier < best.matchTier ||
      (matchTier === best.matchTier && overlap > best.overlapMinutes)

    if (better) {
      best = { row, overlapMinutes: overlap, matchTier, matchReason }
    }
  }

  if (!best) {
    return {
      session,
      scheduleRow: null,
      overlapMinutes: 0,
      matchTier: null,
      matchReason: '未匹配排班',
    }
  }

  return {
    session,
    scheduleRow: best.row,
    overlapMinutes: best.overlapMinutes,
    matchTier: best.matchTier,
    matchReason: best.matchReason,
  }
}

const SEGMENT_LOG_TAG = '[live-session-segment]'

function pickBestSegmentForAnchor(segments: LiveSessionScheduleSegment[]): LiveSessionScheduleSegment {
  return segments.reduce((best, cur) =>
    cur.overlapMinutes > best.overlapMinutes ||
    (cur.overlapMinutes === best.overlapMinutes && cur.clippedStartMs > best.clippedStartMs)
      ? cur
      : best,
  )
}

/** 单场真实直播 → 与各有效排班的交集段；同一主播多条时只保留 overlap 最大的一段 */
export function matchLiveSessionToScheduleSegments(
  session: AnchorLiveSessionBrief,
  scheduleRows: EffectiveScheduleRow[],
): LiveSessionScheduleSegment[] {
  const liveName = resolveSessionShopLabelForScheduleMatch(session)
  const startMs = parseLiveSessionTimeMs(session.startTime)
  const endMs = resolveSessionEndMs(session)
  if (startMs == null || endMs == null) return []

  const rawSegments: LiveSessionScheduleSegment[] = []
  for (const row of scheduleRows) {
    if (!row.enabled) continue
    const scheduleStart = new Date(row.startAt).getTime()
    const scheduleEnd = new Date(row.endAt).getTime()
    const overlap = computeScheduleOverlapMinutes(startMs, endMs, scheduleStart, scheduleEnd)
    if (overlap <= 0) continue

    const shopMatch = orderLiveRoomMatchesSchedule(liveName, row.shopName, row.liveRoomName)
    if (!shopMatch) continue

    const clippedStartMs = Math.max(startMs, scheduleStart)
    const clippedEndMs = Math.min(endMs, scheduleEnd)
    const clippedDurationMinutes = Math.round((clippedEndMs - clippedStartMs) / 60_000)

    rawSegments.push({
      anchorName: row.anchorName,
      scheduleRow: row,
      originalSession: session,
      overlapMinutes: overlap,
      clippedStartMs,
      clippedEndMs,
      clippedStartTime: formatDateTimeShanghai(new Date(clippedStartMs)),
      clippedEndTime: formatDateTimeShanghai(new Date(clippedEndMs)),
      clippedDurationMinutes,
      matchReason: `店铺(${row.shopName})+时间重叠${overlap}分钟→${row.anchorName}`,
    })
  }

  const byAnchor = new Map<string, LiveSessionScheduleSegment[]>()
  for (const seg of rawSegments) {
    const key = seg.anchorName.trim()
    if (!byAnchor.has(key)) byAnchor.set(key, [])
    byAnchor.get(key)!.push(seg)
  }

  const deduped: LiveSessionScheduleSegment[] = []
  for (const [anchorName, segs] of byAnchor) {
    if (segs.length > 1) {
      console.warn(
        SEGMENT_LOG_TAG,
        JSON.stringify({
          reason: 'multiple_schedule_rows_for_anchor_in_one_session',
          anchorName,
          liveId: session.liveId,
          segments: segs.map((s) => ({
            rowId: s.scheduleRow.rowId,
            clipped: `${s.clippedStartTime}~${s.clippedEndTime}`,
            overlapMinutes: s.overlapMinutes,
          })),
        }),
      )
    }
    deduped.push(pickBestSegmentForAnchor(segs))
  }

  return deduped.sort(
    (a, b) =>
      a.clippedStartMs - b.clippedStartMs ||
      b.overlapMinutes - a.overlapMinutes ||
      a.scheduleRow.rowId.localeCompare(b.scheduleRow.rowId),
  )
}

/** @deprecated 使用 matchLiveSessionToScheduleSegments */
export function matchLiveSessionToOverlappingScheduleRows(
  session: AnchorLiveSessionBrief,
  scheduleRows: EffectiveScheduleRow[],
): LiveSessionScheduleOverlapMatch[] {
  return matchLiveSessionToScheduleSegments(session, scheduleRows).map((seg) => ({
    session: seg.originalSession,
    scheduleRow: seg.scheduleRow,
    overlapMinutes: seg.overlapMinutes,
    clippedStartMs: seg.clippedStartMs,
    clippedEndMs: seg.clippedEndMs,
    clippedStartTime: seg.clippedStartTime,
    clippedEndTime: seg.clippedEndTime,
    clippedDurationMinutes: seg.clippedDurationMinutes,
    matchReason: seg.matchReason,
  }))
}

/** 将真实场次裁剪为与排班重叠的时间段（保留扩展字段，liveId 加 segment 后缀防去重） */
export function clipLiveSessionToScheduleOverlap(
  session: AnchorLiveSessionBrief,
  clippedStartMs: number,
  clippedEndMs: number,
  scheduleRowId?: string,
): AnchorLiveSessionBrief {
  const clippedDurationMinutes = Math.max(0, Math.round((clippedEndMs - clippedStartMs) / 60_000))
  const segmentKey = scheduleRowId
    ? `${scheduleRowId}::${clippedStartMs}`
    : String(clippedStartMs)
  return {
    ...session,
    liveId: `${session.liveId}::seg::${segmentKey}`,
    startTime: formatDateTimeShanghai(new Date(clippedStartMs)),
    endTime: formatDateTimeShanghai(new Date(clippedEndMs)),
    durationMinutes: clippedDurationMinutes,
    durationText: formatLiveDurationMinutes(clippedDurationMinutes),
  }
}

export function matchAllLiveSessionsToSchedule(
  sessions: AnchorLiveSessionBrief[],
  scheduleRows: EffectiveScheduleRow[],
): LiveSessionScheduleMatchResult[] {
  return sessions.map((session) => matchLiveSessionToBestScheduleRow(session, scheduleRows))
}

/** 日报：某主播行 — 真实场次时间 + 排班归属（allSessions 已为该主播归属后的场次） */
export function buildDailyReportLiveScheduleFields(params: {
  anchorName: string
  allSessions: AnchorLiveSessionBrief[]
  scheduleRows: EffectiveScheduleRow[]
  usedScheduleRowIds?: Set<string>
}): DailyReportLiveScheduleFields & { scheduleAttendance: AnchorAttendanceStatusPayload } {
  const matchedSessions = [...params.allSessions].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  )

  const matchResults = matchedSessions.map((session) =>
    matchLiveSessionToBestScheduleRow(session, params.scheduleRows),
  )
  const anchorMatches = matchResults.filter(
    (m) => m.scheduleRow && anchorNamesMatch(m.scheduleRow.anchorName, params.anchorName),
  )

  const actualStart = earliestSessionStart(matchedSessions)
  const actualEnd = pickLatestValidSessionEnd(matchedSessions)
  const start = actualStart?.startAt ?? null
  const end = actualEnd?.endAt ?? null

  let primaryScheduleRow: EffectiveScheduleRow | null = null
  let scheduleMatchReason: string | null = null
  if (anchorMatches.length > 0) {
    const best = anchorMatches.reduce((a, b) =>
      b.overlapMinutes > a.overlapMinutes ? b : a,
    )
    primaryScheduleRow = best.scheduleRow
    scheduleMatchReason = best.matchReason
    params.usedScheduleRowIds?.add(best.scheduleRow!.rowId)
  } else if (matchedSessions.length === 0) {
    const anchorScheduleRows = params.scheduleRows.filter(
      (row) => row.enabled && anchorNamesMatch(row.anchorName, params.anchorName),
    )
    if (anchorScheduleRows.length > 0) {
      primaryScheduleRow = [...anchorScheduleRows].sort((a, b) =>
        a.startTime.localeCompare(b.startTime),
      )[0]!
      scheduleMatchReason = '当日生效排班（无真实直播场次）'
    }
  }

  const scheduleTimeRange = primaryScheduleRow
    ? `${primaryScheduleRow.startTime}–${primaryScheduleRow.endTime}`
    : null

  const scheduleAttendance = (() => {
    if (primaryScheduleRow && actualStart) {
      return toAttendanceStatusPayload(
        calculateAnchorAttendanceStatus(
          primaryScheduleRow,
          actualStart.startMs,
          actualStart.startAt,
          actualEnd?.endMs ?? null,
          actualEnd?.endAt ?? null,
        ),
      )
    }
    if (actualStart) {
      return toAttendanceStatusPayload(
        calculateAnchorAttendanceStatus(
          undefined,
          actualStart.startMs,
          actualStart.startAt,
          actualEnd?.endMs ?? null,
          actualEnd?.endAt ?? null,
        ),
      )
    }
    if (primaryScheduleRow) {
      return toAttendanceStatusPayload(
        calculateAnchorAttendanceStatus(primaryScheduleRow, null, null, null, null),
      )
    }
    return toAttendanceStatusPayload(
      calculateAnchorAttendanceStatus(undefined, null, null, null, null),
    )
  })()

  const sessionLabel = primaryScheduleRow
    ? formatDisplaySessionLabel(
        deriveSessionLabelFromSchedule(
          primaryScheduleRow,
          primaryScheduleRow.startAt?.slice(0, 10),
        ),
        resolveShopNameFromSchedule(primaryScheduleRow),
      )
    : ''

  const hasRealSessions = matchedSessions.length > 0
  const livePeriodText = hasRealSessions ? buildPerSessionLivePeriodText(matchedSessions) : '—'
  const liveTimeRange = hasRealSessions ? livePeriodText.replace(/~/g, '–') : '未读取到直播场次'

  return {
    livePeriodText,
    liveTimeRange,
    liveStartTime: hasRealSessions ? start : null,
    liveEndTime: hasRealSessions ? end : null,
    scheduleTimeRange,
    scheduleMatched: Boolean(primaryScheduleRow),
    scheduleMatchReason,
    matchedSessions,
    primaryScheduleRow,
    scheduleAttendance: {
      ...scheduleAttendance,
      hasManualSchedule: scheduleAttendance.hasSchedule,
      displaySessionLabel: sessionLabel || scheduleAttendance.displaySessionLabel,
      sessionLabel: sessionLabel || scheduleAttendance.sessionLabel,
      shopName: primaryScheduleRow
        ? resolveShopNameFromSchedule(primaryScheduleRow)
        : scheduleAttendance.shopName,
    },
  }
}

/** 边界用例：13:50–14:20 应匹配重叠更大的排班段 */
export function pickBestScheduleRowByOverlapForTest(
  liveStartMs: number,
  liveEndMs: number,
  liveName: string,
  scheduleRows: EffectiveScheduleRow[],
): EffectiveScheduleRow | null {
  const session: AnchorLiveSessionBrief = {
    liveId: 'test',
    liveName,
    startTime: new Date(liveStartMs).toISOString(),
    endTime: new Date(liveEndMs).toISOString(),
    durationMinutes: Math.round((liveEndMs - liveStartMs) / 60_000),
    durationText: 'test',
    viewSessionCount: null,
    joinUserCount: null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: null,
    dealUserCount: null,
  }
  return matchLiveSessionToBestScheduleRow(session, scheduleRows).scheduleRow
}
