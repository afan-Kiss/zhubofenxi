import { parseLiveSessionTimeMs } from '../utils/business-timezone'

export interface LiveSessionTimeSpan {
  liveId?: string
  liveName?: string
  startTime: string
  endTime: string
  durationMinutes: number
  sourceShopCode?: string
  sourceShopName?: string
}

/** 同店同日重叠 ≥30 分钟视为同一场（历史重复账号/不同 liveId 变体） */
export const LIVE_SESSION_OVERLAP_DEDUPE_MIN_MINUTES = 30

function resolveSessionEndMs(session: LiveSessionTimeSpan): number | null {
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

function overlapMinutes(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  const start = Math.max(aStart, bStart)
  const end = Math.min(aEnd, bEnd)
  if (end <= start) return 0
  return Math.round((end - start) / 60_000)
}

function resolveSessionShopDayKey(session: LiveSessionTimeSpan): string {
  const shop =
    session.sourceShopCode?.trim() ||
    session.sourceShopName?.trim() ||
    session.liveName?.trim() ||
    'unknown'
  return `${shop}::${session.startTime.slice(0, 10)}`
}

function pickPreferredOverlappingSession<T extends LiveSessionTimeSpan>(a: T, b: T): T {
  if (b.durationMinutes !== a.durationMinutes) {
    return b.durationMinutes > a.durationMinutes ? b : a
  }
  const aLiveId = a.liveId?.trim() ?? ''
  const bLiveId = b.liveId?.trim() ?? ''
  if (aLiveId && !bLiveId) return a
  if (bLiveId && !aLiveId) return b
  return a.startTime.localeCompare(b.startTime) <= 0 ? a : b
}

/** 同店铺、同一天、时间高度重叠的场次合并为一场（保留时长更长者） */
export function dedupeOverlappingLiveSessionsByShopDay<T extends LiveSessionTimeSpan>(
  sessions: T[],
  minOverlapMinutes = LIVE_SESSION_OVERLAP_DEDUPE_MIN_MINUTES,
): T[] {
  const sorted = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const kept: T[] = []

  for (const session of sorted) {
    const startMs = parseLiveSessionTimeMs(session.startTime)
    const endMs = resolveSessionEndMs(session)
    if (startMs == null || endMs == null) {
      kept.push(session)
      continue
    }

    const shopDay = resolveSessionShopDayKey(session)
    let merged = false

    for (let i = 0; i < kept.length; i++) {
      const existing = kept[i]!
      if (resolveSessionShopDayKey(existing) !== shopDay) continue
      const exStart = parseLiveSessionTimeMs(existing.startTime)
      const exEnd = resolveSessionEndMs(existing)
      if (exStart == null || exEnd == null) continue
      if (overlapMinutes(startMs, endMs, exStart, exEnd) < minOverlapMinutes) continue
      kept[i] = pickPreferredOverlappingSession(existing, session)
      merged = true
      break
    }

    if (!merged) kept.push(session)
  }

  return kept.sort((a, b) => a.startTime.localeCompare(b.startTime))
}
