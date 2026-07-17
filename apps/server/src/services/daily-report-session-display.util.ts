/**
 * 日报展示层场次合并：不改变归属/订单用的真实场次列表。
 * 同一排班内断播重开（不同 liveId、间隔≤30分钟）合并为 1 个展示班次。
 */
import type { AnchorLiveSessionBrief } from './anchor-live-sessions.service'
import { formatLiveDurationMinutes } from './anchor-live-sessions.service'
import { parseLiveSessionTimeMs } from '../utils/business-timezone'

/** 断播重开合并：前一段结束到后一段开始的最大间隔（分钟） */
export const DISPLAY_RECONNECT_GAP_MAX_MINUTES = 30

export interface DailyReportDisplaySessionGroup {
  startTime: string
  endTime: string
  /** 各原始有效片段时长之和（不含断播间隙） */
  durationMinutes: number
  sourceSessionCount: number
  liveIds: string[]
  shopKey: string
  scheduleRowId: string | null
  sessions: AnchorLiveSessionBrief[]
}

/** 从 clipped liveId（`orig::seg::rowId::startMs`）解析排班 rowId */
export function parseClippedScheduleRowId(liveId: string): string | null {
  const idx = liveId.indexOf('::seg::')
  if (idx < 0) return null
  const rest = liveId.slice(idx + '::seg::'.length)
  const lastSep = rest.lastIndexOf('::')
  if (lastSep <= 0) return rest.trim() || null
  return rest.slice(0, lastSep).trim() || null
}

export function parseBaseLiveId(liveId: string): string {
  const idx = liveId.indexOf('::seg::')
  return (idx >= 0 ? liveId.slice(0, idx) : liveId).trim()
}

function shopKeyOf(session: AnchorLiveSessionBrief): string {
  const extended = session as AnchorLiveSessionBrief & {
    sourceShopName?: string
    sourceShopCode?: string
  }
  return (
    extended.sourceShopName?.trim() ||
    extended.sourceShopCode?.trim() ||
    session.liveName?.trim() ||
    ''
  )
}

function sessionBounds(session: AnchorLiveSessionBrief): { startMs: number; endMs: number } | null {
  const startMs = parseLiveSessionTimeMs(session.startTime)
  if (startMs == null) return null
  let endMs =
    session.endTime && session.endTime !== '—'
      ? parseLiveSessionTimeMs(session.endTime)
      : null
  if (endMs == null && session.durationMinutes > 0) {
    endMs = startMs + session.durationMinutes * 60_000
  }
  if (endMs == null) return null
  if (endMs < startMs) endMs += 24 * 60 * 60_000
  return { startMs, endMs }
}

function formatClockFromIso(iso: string): string {
  const timePart = iso.slice(11, 19)
  if (timePart.endsWith(':00')) return timePart.slice(0, 5)
  return timePart.length >= 5 ? timePart.slice(0, 5) : timePart
}

function canMergeDisplaySessions(
  a: AnchorLiveSessionBrief,
  b: AnchorLiveSessionBrief,
  gapMaxMinutes: number,
): boolean {
  if (shopKeyOf(a) !== shopKeyOf(b)) return false
  const rowA = parseClippedScheduleRowId(a.liveId)
  const rowB = parseClippedScheduleRowId(b.liveId)
  // 两侧都有排班行 id 时必须相同；都没有时不因「无排班」误合并不同场
  if (rowA || rowB) {
    if (!rowA || !rowB || rowA !== rowB) return false
  } else {
    return false
  }
  const ba = sessionBounds(a)
  const bb = sessionBounds(b)
  if (!ba || !bb) return false
  // 重叠
  if (ba.startMs < bb.endMs && bb.startMs < ba.endMs) return true
  const gapMs =
    ba.endMs <= bb.startMs ? bb.startMs - ba.endMs : ba.startMs - bb.endMs
  return gapMs >= 0 && gapMs <= gapMaxMinutes * 60_000
}

/**
 * 将归属后的真实场次折叠为日报展示班次。
 * 不修改入参数组；返回的 groups[].sessions 仍指向原对象。
 */
export function collapseDailyReportDisplaySessions(
  sessions: AnchorLiveSessionBrief[],
  gapMaxMinutes: number = DISPLAY_RECONNECT_GAP_MAX_MINUTES,
): DailyReportDisplaySessionGroup[] {
  const sorted = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const groups: DailyReportDisplaySessionGroup[] = []

  for (const session of sorted) {
    const last = groups[groups.length - 1]
    if (last && canMergeDisplaySessions(last.sessions[last.sessions.length - 1]!, session, gapMaxMinutes)) {
      last.sessions.push(session)
      last.sourceSessionCount += 1
      last.durationMinutes += Math.max(0, session.durationMinutes)
      last.liveIds.push(parseBaseLiveId(session.liveId))
      // 扩展展示起止
      if (session.startTime.localeCompare(last.startTime) < 0) last.startTime = session.startTime
      if (
        session.endTime &&
        session.endTime !== '—' &&
        (last.endTime === '—' || session.endTime.localeCompare(last.endTime) > 0)
      ) {
        last.endTime = session.endTime
      }
      continue
    }

    groups.push({
      startTime: session.startTime,
      endTime: session.endTime,
      durationMinutes: Math.max(0, session.durationMinutes),
      sourceSessionCount: 1,
      liveIds: [parseBaseLiveId(session.liveId)],
      shopKey: shopKeyOf(session),
      scheduleRowId: parseClippedScheduleRowId(session.liveId),
      sessions: [session],
    })
  }

  return groups
}

/** 日报 liveDurationText：按展示班次计数，断播重开不写「直播 N 场」 */
export function buildLiveSessionDisplaySummary(
  groups: DailyReportDisplaySessionGroup[],
): { liveDurationText: string; platformRecordNote: string | null } {
  if (groups.length === 0) {
    return { liveDurationText: '—', platformRecordNote: null }
  }
  const totalMin = groups.reduce((sum, g) => sum + g.durationMinutes, 0)
  const totalSource = groups.reduce((sum, g) => sum + g.sourceSessionCount, 0)
  const platformRecordNote =
    totalSource > groups.length ? `平台记录${totalSource}段` : null

  if (groups.length === 1) {
    return {
      liveDurationText: formatLiveDurationMinutes(totalMin),
      platformRecordNote,
    }
  }
  return {
    liveDurationText: `直播 ${groups.length} 场 · 合计 ${formatLiveDurationMinutes(totalMin)}`,
    platformRecordNote,
  }
}

/** 展示用直播时段文案（合并后每班次一行） */
export function buildDisplayLivePeriodText(groups: DailyReportDisplaySessionGroup[]): string {
  if (groups.length === 0) return '—'
  const lines = groups
    .filter((g) => g.startTime && g.startTime !== '—')
    .map((g) => {
      const start = formatClockFromIso(g.startTime)
      const end = g.endTime && g.endTime !== '—' ? formatClockFromIso(g.endTime) : '—'
      return `${start}~${end}`
    })
  return lines.length > 0 ? lines.join('\n') : '—'
}

export function isSuspectedReconnectPair(
  a: AnchorLiveSessionBrief,
  b: AnchorLiveSessionBrief,
  gapMaxMinutes: number = DISPLAY_RECONNECT_GAP_MAX_MINUTES,
): boolean {
  if (parseBaseLiveId(a.liveId) === parseBaseLiveId(b.liveId)) return false
  return canMergeDisplaySessions(a, b, gapMaxMinutes)
}
