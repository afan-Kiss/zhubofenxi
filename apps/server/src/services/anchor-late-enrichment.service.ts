import type { AnchorLiveSessionBrief } from './anchor-live-sessions.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { ANCHOR_NEW_SCHEDULE_START_DATE } from '../config/anchor-schedule.constants'
import {
  getAssignedSessionsForAnchor,
  loadAndAssignDailyReportLiveSessions,
} from './daily-report-live-sessions.service'
import { resolveAnchorLiveSessionsForRange } from './anchor-live-sessions.service'
import {
  earliestSessionStart,
  resolveAnchorAttendanceFromSessions,
  toAttendanceStatusPayload,
  type AnchorAttendanceStatusPayload,
} from '../utils/anchor-attendance-status.util'

export function isSingleDayRange(startDate: string, endDate: string): boolean {
  return startDate.trim() === endDate.trim()
}

const EMPTY_ATTENDANCE_PAYLOAD = toAttendanceStatusPayload({
  hasSchedule: false,
  hasActualStartTime: false,
  hasActualEndTime: false,
  isLate: false,
  lateMinutes: 0,
  isEarlyLeave: false,
  earlyLeaveMinutes: 0,
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
  label: '',
  reason: '',
  attendanceLabel: '',
  attendanceReason: '',
})

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

function resolveShopHintFromSessions(anchorName: string, sessions: AnchorLiveSessionBrief[]): string {
  const actual = earliestSessionStart(sessions)
  return (actual?.session.liveName ?? '').trim()
}

function resolveAttendancePayload(
  scheduleRows: Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>['rows'],
  anchorName: string,
  shopName: string,
  sessions: AnchorLiveSessionBrief[],
  usedRowIds: Set<string>,
): AnchorAttendanceStatusPayload {
  return resolveAnchorAttendanceFromSessions(
    scheduleRows,
    anchorName,
    shopName,
    sessions,
    usedRowIds,
  )
}

async function resolveLiveSessionsForAnchorRow(params: {
  preset?: string
  startDate: string
  endDate: string
  anchorId: string
  anchorName: string
  liveAssignment?: Awaited<ReturnType<typeof loadAndAssignDailyReportLiveSessions>>
}): Promise<AnchorLiveSessionBrief[]> {
  if (params.endDate.trim() >= ANCHOR_NEW_SCHEDULE_START_DATE && params.liveAssignment) {
    return getAssignedSessionsForAnchor(params.liveAssignment, params.anchorName)
  }
  return resolveAnchorLiveSessionsForRange({
    preset: params.preset,
    startDate: params.startDate,
    endDate: params.endDate,
    anchorId: params.anchorId,
    anchorName: params.anchorName,
    anchorOrders: [],
  })
}

export async function enrichAnchorLeaderboardWithLateStatus(
  rows: Array<Record<string, unknown>>,
  params: { startDate: string; endDate: string; preset?: string },
): Promise<Array<Record<string, unknown>>> {
  if (!isSingleDayRange(params.startDate, params.endDate)) return rows

  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)
  const liveAssignment =
    params.endDate.trim() >= ANCHOR_NEW_SCHEDULE_START_DATE
      ? await loadAndAssignDailyReportLiveSessions({
          reportDate: params.startDate,
          preset: params.preset,
          startDate: params.startDate,
          endDate: params.endDate,
          scheduleRows: scheduleTable.rows,
        })
      : undefined

  type WorkItem = {
    index: number
    row: Record<string, unknown>
    anchorName: string
    shopName: string
    sessions: AnchorLiveSessionBrief[]
    actualStartMs: number | null
    sessionName: string
  }

  const prefetched: WorkItem[] = await Promise.all(
    rows.map(async (row, index) => {
      const anchorName = String(row.anchorName ?? '').trim()
      const anchorId = String(row.anchorId ?? '').trim()
      if (!anchorName || anchorName === '未归属') {
        return { index, row, anchorName, shopName: '', sessions: [], actualStartMs: null, sessionName: '' }
      }

      const sessions = await resolveLiveSessionsForAnchorRow({
        preset: params.preset,
        startDate: params.startDate,
        endDate: params.endDate,
        anchorId,
        anchorName,
        liveAssignment,
      })
      const actual = earliestSessionStart(sessions)
      const shopName =
        String(row.shopName ?? '').trim() || resolveShopHintFromSessions(anchorName, sessions)

      return {
        index,
        row,
        anchorName,
        shopName,
        sessions,
        actualStartMs: actual?.startMs ?? null,
        sessionName: '',
      }
    }),
  )

  const usedRowIds = new Set<string>()
  const attendanceByIndex = new Map<number, AnchorAttendanceStatusPayload>()

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
    attendanceByIndex.set(
      item.index,
      resolveAttendancePayload(
        scheduleTable.rows,
        item.anchorName,
        item.shopName,
        item.sessions,
        usedRowIds,
      ),
    )
  }

  return rows.map((row, index) => {
    const attendance = attendanceByIndex.get(index)
    if (!attendance) return row
    return {
      ...row,
      ...attendance,
      sessionLabel: attendance.displaySessionLabel || row.sessionLabel,
      shopName: attendance.shopName || row.shopName,
    }
  })
}

export async function enrichPocketRowsWithLateStatus(
  rows: Array<{ anchorName: string; shopName: string; sessionName: string }>,
  params: { startDate: string; endDate: string; preset?: string },
): Promise<
  Array<AnchorAttendanceStatusPayload & { anchorName: string; shopName: string; sessionName: string }>
> {
  if (!isSingleDayRange(params.startDate, params.endDate)) {
    return rows.map((row) => ({ ...row, ...EMPTY_ATTENDANCE_PAYLOAD }))
  }

  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)
  const liveAssignment =
    params.endDate.trim() >= ANCHOR_NEW_SCHEDULE_START_DATE
      ? await loadAndAssignDailyReportLiveSessions({
          reportDate: params.startDate,
          preset: params.preset,
          startDate: params.startDate,
          endDate: params.endDate,
          scheduleRows: scheduleTable.rows,
        })
      : undefined

  type WorkItem = {
    index: number
    row: { anchorName: string; shopName: string; sessionName: string }
    anchorName: string
    shopName: string
    sessions: AnchorLiveSessionBrief[]
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
      const actual = earliestSessionStart(sessions)
      const shopName =
        row.shopName?.trim() || resolveShopHintFromSessions(row.anchorName, sessions)

      return {
        index,
        row,
        anchorName: row.anchorName,
        shopName,
        sessions,
        actualStartMs: actual?.startMs ?? null,
        sessionName: row.sessionName ?? '',
      }
    }),
  )

  const usedRowIds = new Set<string>()
  const attendanceByIndex = new Map<number, AnchorAttendanceStatusPayload>()
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
    attendanceByIndex.set(
      item.index,
      resolveAttendancePayload(
        scheduleTable.rows,
        item.anchorName,
        item.shopName,
        item.sessions,
        usedRowIds,
      ),
    )
  }

  return rows.map((row, index) => {
    const attendance = attendanceByIndex.get(index) ?? EMPTY_ATTENDANCE_PAYLOAD
    const sessionName = attendance.displaySessionLabel || row.sessionName
    return {
      ...row,
      ...attendance,
      shopName: attendance.shopName || row.shopName,
      sessionName,
    }
  })
}
