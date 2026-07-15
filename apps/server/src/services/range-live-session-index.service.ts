/**
 * Wave4 P1: 范围直播场次/排班一次加载，供主播走势复用
 * 语义对齐 resolveAnchorLiveSessionsForRange（按日 assignment.byAnchor）
 */
import type { AnchorLiveSessionBrief } from './anchor-live-sessions.service'
import {
  mapOriginalSessionsWithAssignedRange,
  resolveDailyReportLiveSessionAssignments,
} from './daily-report-live-sessions.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'
import { anchorNamesMatch } from '../utils/anchor-name-normalize.util'
import { logInfo } from '../utils/server-log'

export interface RangeLiveSessionIndex {
  startDate: string
  endDate: string
  days: string[]
  /** dateKey → anchorName → sessions（已裁剪归属时段） */
  sessionsByDateAndAnchor: Map<string, Map<string, AnchorLiveSessionBrief[]>>
  scheduleByDate: Map<string, Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>>
  loadDurationMs: number
}

export async function loadRangeLiveSessionIndex(params: {
  startDate: string
  endDate: string
}): Promise<RangeLiveSessionIndex> {
  const t0 = Date.now()
  const days = eachDayInShanghaiRange(params.startDate, params.endDate)
  const sessionsByDateAndAnchor = new Map<string, Map<string, AnchorLiveSessionBrief[]>>()

  const concurrency = Math.min(8, Math.max(1, days.length))
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < days.length) {
      const day = days[cursor++]!
      const assignment = await resolveDailyReportLiveSessionAssignments(day)
      const byAnchor = new Map<string, AnchorLiveSessionBrief[]>()
      for (const [anchorName] of assignment.byAnchor) {
        const sessions = mapOriginalSessionsWithAssignedRange(assignment, anchorName)
        byAnchor.set(anchorName, sessions)
      }
      sessionsByDateAndAnchor.set(day, byAnchor)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const scheduleEntries = await Promise.all(
    days.map(async (day) => {
      const table = await getEffectiveScheduleTableForDate(day)
      return [day, table] as const
    }),
  )
  const scheduleByDate = new Map(scheduleEntries)
  const loadDurationMs = Date.now() - t0
  logInfo(
    '直播场次索引',
    `range=${params.startDate}~${params.endDate} days=${days.length} ${loadDurationMs}ms`,
  )
  return {
    startDate: params.startDate,
    endDate: params.endDate,
    days,
    sessionsByDateAndAnchor,
    scheduleByDate,
    loadDurationMs,
  }
}

export function sessionsForAnchorFromIndex(
  index: RangeLiveSessionIndex,
  anchorName: string,
  _anchorId?: string,
): AnchorLiveSessionBrief[] {
  const name = anchorName.trim()
  if (!name) return []
  const out: AnchorLiveSessionBrief[] = []
  const seen = new Set<string>()
  for (const day of index.days) {
    const byAnchor = index.sessionsByDateAndAnchor.get(day)
    if (!byAnchor) continue
    for (const [k, list] of byAnchor) {
      if (!anchorNamesMatch(k, name)) continue
      for (const s of list) {
        const id = `${s.liveId}|${s.startTime}`
        if (seen.has(id)) continue
        seen.add(id)
        out.push(s)
      }
    }
  }
  return out
}
