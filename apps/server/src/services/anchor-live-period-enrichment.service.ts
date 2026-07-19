import type { AnchorLiveSessionBrief } from './anchor-live-sessions.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import {
  getAssignedSessionsForAnchor,
  resolveAnchorLiveMatchHint,
  resolveDailyReportLiveSessionAssignments,
  mapOriginalSessionsWithAssignedRange,
  shouldUsePerShopRealLiveSessions,
  type DailyReportLiveSessionAssignments,
} from './daily-report-live-sessions.service'
import { resolveAnchorLiveSessionsForRange } from './anchor-live-sessions.service'
import {
  buildActualLivePeriodText,
  earliestSessionStart,
  resolveAnchorLivePeriodFromSessions,
  type AnchorLivePeriodPayload,
} from '../utils/anchor-attendance-status.util'
import { buildPerSessionLivePeriodText } from './daily-report-live-schedule-match.service'

export function isSingleDayRange(startDate: string, endDate: string): boolean {
  return startDate.trim() === endDate.trim()
}

const EMPTY_LIVE_PERIOD: AnchorLivePeriodPayload = {
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

type MatchSortKey = {
  anchorName: string
  actualStartMs: number | null
  shopName: string
  sessionName: string
}

function compareMatchOrder(a: MatchSortKey, b: MatchSortKey): number {
  const nameCmp = a.anchorName.localeCompare(b.anchorName, 'zh-CN')
  if (nameCmp !== 0) return nameCmp

  const aMs = a.actualStartMs ?? Number.MAX_SAFE_INTEGER
  const bMs = b.actualStartMs ?? Number.MAX_SAFE_INTEGER
  if (aMs !== bMs) return aMs - bMs

  const shopCmp = a.shopName.localeCompare(b.shopName, 'zh-CN')
  if (shopCmp !== 0) return shopCmp

  return a.sessionName.localeCompare(b.sessionName, 'zh-CN')
}

function resolveShopHintFromSessions(_anchorName: string, sessions: AnchorLiveSessionBrief[]): string {
  const actual = earliestSessionStart(sessions)
  return (actual?.session.liveName ?? '').trim()
}

function pickLivePeriodFields(payload: AnchorLivePeriodPayload) {
  return {
    hasSchedule: payload.hasSchedule,
    hasActualStartTime: payload.hasActualStartTime,
    hasActualEndTime: payload.hasActualEndTime,
    scheduledStartAt: payload.scheduledStartAt,
    scheduledEndAt: payload.scheduledEndAt,
    scheduledPeriodText: payload.scheduledPeriodText,
    actualStartAt: payload.actualStartAt,
    actualStartText: payload.actualStartText,
    actualEndAt: payload.actualEndAt,
    actualEndText: payload.actualEndText,
    sessionLabel: payload.sessionLabel,
    shopName: payload.shopName,
    displaySessionLabel: payload.displaySessionLabel,
  }
}

async function resolveLiveSessionsForAnchorRow(params: {
  preset?: string
  startDate: string
  endDate: string
  anchorId: string
  anchorName: string
  liveAssignment?: DailyReportLiveSessionAssignments
}): Promise<AnchorLiveSessionBrief[]> {
  if (shouldUsePerShopRealLiveSessions(params.startDate, params.endDate) && params.liveAssignment) {
    return getAssignedSessionsForAnchor(params.liveAssignment, params.anchorName)
  }
  return resolveAnchorLiveSessionsForRange({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    anchorId: params.anchorId,
    anchorName: params.anchorName,
  })
}

function resolveOriginalLiveSessionsForAnchorRow(params: {
  liveAssignment?: DailyReportLiveSessionAssignments
  anchorName: string
}): AnchorLiveSessionBrief[] {
  if (!params.liveAssignment) return []
  return mapOriginalSessionsWithAssignedRange(params.liveAssignment, params.anchorName)
}

/** 单日主播业绩行：补充归属/实际直播时段 */
export async function enrichAnchorLeaderboardWithLivePeriod(
  rows: Array<Record<string, unknown>>,
  params: { startDate: string; endDate: string; preset?: string },
): Promise<Array<Record<string, unknown>>> {
  if (!isSingleDayRange(params.startDate, params.endDate)) return rows

  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)
  const liveAssignment = shouldUsePerShopRealLiveSessions(params.startDate, params.endDate)
    ? await resolveDailyReportLiveSessionAssignments(params.startDate)
    : undefined

  type WorkItem = {
    index: number
    row: Record<string, unknown>
    anchorName: string
    shopName: string
    sessions: AnchorLiveSessionBrief[]
    actualSessions: AnchorLiveSessionBrief[]
    actualStartMs: number | null
    sessionName: string
  }

  const prefetched: WorkItem[] = await Promise.all(
    rows.map(async (row, index) => {
      const anchorName = String(row.anchorName ?? '').trim()
      const anchorId = String(row.anchorId ?? '').trim()
      if (!anchorName || anchorName === '未归属') {
        return {
          index,
          row,
          anchorName,
          shopName: '',
          sessions: [],
          actualSessions: [],
          actualStartMs: null,
          sessionName: '',
        }
      }

      const sessions = await resolveLiveSessionsForAnchorRow({
        preset: params.preset,
        startDate: params.startDate,
        endDate: params.endDate,
        anchorId,
        anchorName,
        liveAssignment,
      })
      const actualSessions = resolveOriginalLiveSessionsForAnchorRow({
        liveAssignment,
        anchorName,
      })
      const actualForRange = actualSessions.length > 0 ? actualSessions : sessions
      const actual = earliestSessionStart(actualForRange)
      const shopName =
        String(row.shopName ?? '').trim() || resolveShopHintFromSessions(anchorName, sessions)

      return {
        index,
        row,
        anchorName,
        shopName,
        sessions,
        actualSessions: actualForRange,
        actualStartMs: actual?.startMs ?? null,
        sessionName: '',
      }
    }),
  )

  const usedRowIds = new Set<string>()
  const livePeriodByIndex = new Map<number, AnchorLivePeriodPayload>()

  const matchable = prefetched.filter((item) => item.anchorName && item.anchorName !== '未归属')
  const sorted = [...matchable].sort((a, b) =>
    compareMatchOrder(
      {
        anchorName: a.anchorName,
        actualStartMs: a.actualStartMs,
        shopName: a.shopName,
        sessionName: a.sessionName,
      },
      {
        anchorName: b.anchorName,
        actualStartMs: b.actualStartMs,
        shopName: b.shopName,
        sessionName: b.sessionName,
      },
    ),
  )

  for (const item of sorted) {
    livePeriodByIndex.set(
      item.index,
      resolveAnchorLivePeriodFromSessions(
        scheduleTable.rows,
        item.anchorName,
        item.shopName,
        item.actualSessions,
        usedRowIds,
      ),
    )
  }

  // 仅当该主播当天没有「非请假」生效排班时，整卡打休假水印（避免请假+正常班混排误盖业绩卡）
  const workingAnchorNames = new Set<string>()
  for (const r of scheduleTable.rows) {
    if (!r.enabled || r.isOnLeave) continue
    const name = r.anchorName.trim()
    if (name) workingAnchorNames.add(name)
  }
  const leaveByAnchor = new Map<string, { shopName: string; sessionLabel: string }>()
  for (const r of scheduleTable.rows) {
    if (!r.enabled || !r.isOnLeave) continue
    const name = r.anchorName.trim()
    if (!name || workingAnchorNames.has(name) || leaveByAnchor.has(name)) continue
    leaveByAnchor.set(name, {
      shopName: r.shopName.trim() || r.liveRoomName.trim(),
      sessionLabel: `${r.startTime}-${r.endTime}`,
    })
  }

  return rows.map((row, index) => {
    const livePeriod = livePeriodByIndex.get(index)
    const item = prefetched[index]
    const sessions = item?.sessions ?? []
    const actualSessions = item?.actualSessions ?? sessions
    const livePeriodText = buildPerSessionLivePeriodText(sessions)
    const liveTimeRange = buildActualLivePeriodText(actualSessions)
    const anchorName = String(row.anchorName ?? '').trim()
    const leaveInfo = leaveByAnchor.get(anchorName)
    const livePeriodHint = resolveAnchorLiveMatchHint({
      anchorName,
      scheduleRows: scheduleTable.rows,
      assignment: liveAssignment,
    })

    const base = {
      livePeriodText,
      liveTimeRange,
      livePeriodHint:
        livePeriodText && livePeriodText !== '—' ? null : livePeriodHint,
      scheduleTimeRange: livePeriod?.scheduledPeriodText ?? null,
      isOnLeave: Boolean(leaveInfo),
    }

    if (!livePeriod) {
      return {
        ...row,
        ...base,
        ...(leaveInfo
          ? {
              shopName: String(row.shopName ?? '').trim() || leaveInfo.shopName,
              sessionLabel: String(row.sessionLabel ?? '').trim() || leaveInfo.sessionLabel,
            }
          : {}),
      }
    }

    return {
      ...row,
      ...pickLivePeriodFields(livePeriod),
      ...base,
      sessionLabel: livePeriod.displaySessionLabel || row.sessionLabel,
      shopName: livePeriod.shopName || row.shopName,
    }
  })
}

/** @deprecated */
export const enrichAnchorLeaderboardWithLateStatus = enrichAnchorLeaderboardWithLivePeriod

export async function enrichPocketRowsWithLivePeriod(
  rows: Array<{ anchorName: string; shopName: string; sessionName: string }>,
  params: { startDate: string; endDate: string; preset?: string },
): Promise<
  Array<
    AnchorLivePeriodPayload & {
      anchorName: string
      shopName: string
      sessionName: string
    }
  >
> {
  if (!isSingleDayRange(params.startDate, params.endDate)) {
    return rows.map((row) => ({ ...row, ...EMPTY_LIVE_PERIOD }))
  }

  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)
  const liveAssignment = shouldUsePerShopRealLiveSessions(params.startDate, params.endDate)
    ? await resolveDailyReportLiveSessionAssignments(params.startDate)
    : undefined

  type WorkItem = {
    index: number
    row: { anchorName: string; shopName: string; sessionName: string }
    anchorName: string
    shopName: string
    actualSessions: AnchorLiveSessionBrief[]
    actualStartMs: number | null
    sessionName: string
  }

  const prefetched: WorkItem[] = await Promise.all(
    rows.map(async (row, index) => {
      const sessions = await resolveLiveSessionsForAnchorRow({
        preset: params.preset,
        startDate: params.startDate,
        endDate: params.endDate,
        anchorId: '',
        anchorName: row.anchorName,
        liveAssignment,
      })
      const actualSessions = resolveOriginalLiveSessionsForAnchorRow({
        liveAssignment,
        anchorName: row.anchorName,
      })
      const actualForRange = actualSessions.length > 0 ? actualSessions : sessions
      const actual = earliestSessionStart(actualForRange)
      const shopName =
        row.shopName?.trim() || resolveShopHintFromSessions(row.anchorName, sessions)

      return {
        index,
        row,
        anchorName: row.anchorName,
        shopName,
        actualSessions: actualForRange,
        actualStartMs: actual?.startMs ?? null,
        sessionName: row.sessionName ?? '',
      }
    }),
  )

  const usedRowIds = new Set<string>()
  const livePeriodByIndex = new Map<number, AnchorLivePeriodPayload>()
  const sorted = [...prefetched].sort((a, b) =>
    compareMatchOrder(
      {
        anchorName: a.anchorName,
        actualStartMs: a.actualStartMs,
        shopName: a.shopName,
        sessionName: a.sessionName,
      },
      {
        anchorName: b.anchorName,
        actualStartMs: b.actualStartMs,
        shopName: b.shopName,
        sessionName: b.sessionName,
      },
    ),
  )

  for (const item of sorted) {
    livePeriodByIndex.set(
      item.index,
      resolveAnchorLivePeriodFromSessions(
        scheduleTable.rows,
        item.anchorName,
        item.shopName,
        item.actualSessions,
        usedRowIds,
      ),
    )
  }

  return rows.map((row, index) => {
    const livePeriod = livePeriodByIndex.get(index) ?? EMPTY_LIVE_PERIOD
    const sessionName = livePeriod.displaySessionLabel || row.sessionName
    return {
      ...row,
      ...livePeriod,
      shopName: livePeriod.shopName || row.shopName,
      sessionName,
    }
  })
}

/** @deprecated */
export const enrichPocketRowsWithLateStatus = enrichPocketRowsWithLivePeriod
