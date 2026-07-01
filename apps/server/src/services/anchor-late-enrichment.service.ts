import type { AnchorLiveSessionBrief } from './anchor-live-sessions.service'
import { ANCHOR_SESSION_DISPLAY_FROM_0613 } from './anchor-performance-attribution.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { resolveAnchorLiveSessionsForRange } from './anchor-live-sessions.service'
import {
  matchManualSchedule,
  calculateAnchorLateStatus,
  earliestSessionStart,
  toLateStatusPayload,
  type AnchorLateStatusPayload,
} from '../utils/anchor-schedule-late.util'

function resolveShopNameForAnchor(anchorName: string, liveName?: string | null): string {
  const fixed = ANCHOR_SESSION_DISPLAY_FROM_0613[anchorName]
  if (fixed?.shopName) return fixed.shopName
  return (liveName ?? '').trim()
}

export function isSingleDayRange(startDate: string, endDate: string): boolean {
  return startDate.trim() === endDate.trim()
}

const EMPTY_LATE_PAYLOAD = toLateStatusPayload({
  hasSchedule: false,
  hasActualStartTime: false,
  isLate: false,
  lateMinutes: 0,
  scheduledStartAt: null,
  scheduledEndAt: null,
  scheduledPeriodText: null,
  actualStartAt: null,
  actualStartText: null,
  label: '',
  reason: '',
})

type LateMatchSortKey = {
  anchorName: string
  actualStartMs: number | null
  shopName: string
  sessionName: string
}

function compareLateMatchOrder(a: LateMatchSortKey, b: LateMatchSortKey): number {
  const nameCmp = a.anchorName.localeCompare(b.anchorName, 'zh-CN')
  if (nameCmp !== 0) return nameCmp

  const aMs = a.actualStartMs ?? Number.MAX_SAFE_INTEGER
  const bMs = b.actualStartMs ?? Number.MAX_SAFE_INTEGER
  if (aMs !== bMs) return aMs - bMs

  const shopCmp = a.shopName.localeCompare(b.shopName, 'zh-CN')
  if (shopCmp !== 0) return shopCmp

  return a.sessionName.localeCompare(b.sessionName, 'zh-CN')
}

function resolveLatePayload(
  scheduleRows: Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>['rows'],
  anchorName: string,
  shopName: string,
  sessions: AnchorLiveSessionBrief[],
  usedRowIds: Set<string>,
): AnchorLateStatusPayload {
  const actual = earliestSessionStart(sessions)
  const scheduleRow = matchManualSchedule(
    scheduleRows,
    anchorName,
    shopName,
    actual?.startMs ?? null,
    usedRowIds,
  )
  if (scheduleRow) usedRowIds.add(scheduleRow.rowId)
  return toLateStatusPayload(
    calculateAnchorLateStatus(scheduleRow, actual?.startMs ?? null, actual?.startAt ?? null),
  )
}

export async function enrichAnchorLeaderboardWithLateStatus(
  rows: Array<Record<string, unknown>>,
  params: { startDate: string; endDate: string; preset?: string },
): Promise<Array<Record<string, unknown>>> {
  if (!isSingleDayRange(params.startDate, params.endDate)) return rows

  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)

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

      const sessions = await resolveAnchorLiveSessionsForRange({
        preset: params.preset,
        startDate: params.startDate,
        endDate: params.endDate,
        anchorId,
        anchorName,
        anchorOrders: [],
      })
      const actual = earliestSessionStart(sessions)
      const shopName = resolveShopNameForAnchor(anchorName, actual?.session.liveName)

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
  const lateByIndex = new Map<number, AnchorLateStatusPayload>()

  const matchable = prefetched.filter((item) => item.anchorName && item.anchorName !== '未归属')
  const sorted = [...matchable].sort((a, b) =>
    compareLateMatchOrder({
      anchorName: a.anchorName,
      actualStartMs: a.actualStartMs,
      shopName: a.shopName,
      sessionName: a.sessionName,
    }, {
      anchorName: b.anchorName,
      actualStartMs: b.actualStartMs,
      shopName: b.shopName,
      sessionName: b.sessionName,
    }),
  )

  for (const item of sorted) {
    lateByIndex.set(
      item.index,
      resolveLatePayload(scheduleTable.rows, item.anchorName, item.shopName, item.sessions, usedRowIds),
    )
  }

  return rows.map((row, index) => {
    const late = lateByIndex.get(index)
    return late ? { ...row, ...late } : row
  })
}

export async function enrichPocketRowsWithLateStatus(
  rows: Array<{ anchorName: string; shopName: string; sessionName: string }>,
  params: { startDate: string; endDate: string; preset?: string },
): Promise<Array<AnchorLateStatusPayload & { anchorName: string; shopName: string; sessionName: string }>> {
  if (!isSingleDayRange(params.startDate, params.endDate)) {
    return rows.map((row) => ({ ...row, ...EMPTY_LATE_PAYLOAD }))
  }

  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)

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
      const sessions = await resolveAnchorLiveSessionsForRange({
        preset: params.preset,
        startDate: params.startDate,
        endDate: params.endDate,
        anchorName: row.anchorName,
        anchorOrders: [],
      })
      const actual = earliestSessionStart(sessions)
      const shopName =
        row.shopName?.trim() || resolveShopNameForAnchor(row.anchorName, actual?.session.liveName)

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
  const lateByIndex = new Map<number, AnchorLateStatusPayload>()
  const sorted = [...prefetched].sort((a, b) =>
    compareLateMatchOrder({
      anchorName: a.anchorName,
      actualStartMs: a.actualStartMs,
      shopName: a.shopName,
      sessionName: a.sessionName,
    }, {
      anchorName: b.anchorName,
      actualStartMs: b.actualStartMs,
      shopName: b.shopName,
      sessionName: b.sessionName,
    }),
  )

  for (const item of sorted) {
    lateByIndex.set(
      item.index,
      resolveLatePayload(scheduleTable.rows, item.anchorName, item.shopName, item.sessions, usedRowIds),
    )
  }

  return rows.map((row, index) => {
    const late = lateByIndex.get(index) ?? EMPTY_LATE_PAYLOAD
    return { ...row, ...late }
  })
}
