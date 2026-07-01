import { ANCHOR_SESSION_DISPLAY_FROM_0613 } from './anchor-performance-attribution.service'
import { getEffectiveScheduleTableForDate } from './anchor-daily-schedule.service'
import { resolveAnchorLiveSessionsForRange } from './anchor-live-sessions.service'
import {
  matchManualSchedule,
  calculateAnchorLateStatus,
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

export async function enrichAnchorLeaderboardWithLateStatus(
  rows: Array<Record<string, unknown>>,
  params: { startDate: string; endDate: string; preset?: string },
): Promise<Array<Record<string, unknown>>> {
  if (!isSingleDayRange(params.startDate, params.endDate)) return rows

  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)
  const usedRowIds = new Set<string>()

  return Promise.all(
    rows.map(async (row) => {
      const anchorName = String(row.anchorName ?? '').trim()
      const anchorId = String(row.anchorId ?? '').trim()
      if (!anchorName || anchorName === '未归属') return row

      const sessions = await resolveAnchorLiveSessionsForRange({
        preset: params.preset,
        startDate: params.startDate,
        endDate: params.endDate,
        anchorId,
        anchorName,
        anchorOrders: [],
      })
      const earliest = sessions.find((s) => s.startTime && s.startTime !== '—')
      const actualStartAt = earliest?.startTime ?? null
      const actualStartMs = actualStartAt ? new Date(actualStartAt).getTime() : null
      const shopName = resolveShopNameForAnchor(anchorName, earliest?.liveName)

      const scheduleRow = matchManualSchedule(
        scheduleTable.rows,
        anchorName,
        shopName,
        Number.isFinite(actualStartMs) ? actualStartMs : null,
        usedRowIds,
      )
      if (scheduleRow) usedRowIds.add(scheduleRow.rowId)

      const late = toLateStatusPayload(
        calculateAnchorLateStatus(
          scheduleRow,
          Number.isFinite(actualStartMs) ? actualStartMs : null,
          actualStartAt,
        ),
      )
      return { ...row, ...late }
    }),
  )
}

export async function enrichPocketRowsWithLateStatus(
  rows: Array<{ anchorName: string; shopName: string; sessionName: string }>,
  params: { startDate: string; endDate: string; preset?: string },
): Promise<Array<AnchorLateStatusPayload & { anchorName: string; shopName: string; sessionName: string }>> {
  if (!isSingleDayRange(params.startDate, params.endDate)) {
    return rows.map((row) => ({
      ...row,
      ...toLateStatusPayload({
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
      }),
    }))
  }

  const scheduleTable = await getEffectiveScheduleTableForDate(params.startDate)
  const usedRowIds = new Set<string>()

  return Promise.all(
    rows.map(async (row) => {
      const sessions = await resolveAnchorLiveSessionsForRange({
        preset: params.preset,
        startDate: params.startDate,
        endDate: params.endDate,
        anchorName: row.anchorName,
        anchorOrders: [],
      })
      const earliest = sessions.find((s) => s.startTime && s.startTime !== '—')
      const actualStartAt = earliest?.startTime ?? null
      const actualStartMs = actualStartAt ? new Date(actualStartAt).getTime() : null
      const shopName = row.shopName?.trim() || resolveShopNameForAnchor(row.anchorName, earliest?.liveName)

      const scheduleRow = matchManualSchedule(
        scheduleTable.rows,
        row.anchorName,
        shopName,
        Number.isFinite(actualStartMs) ? actualStartMs : null,
        usedRowIds,
      )
      if (scheduleRow) usedRowIds.add(scheduleRow.rowId)

      const late = toLateStatusPayload(
        calculateAnchorLateStatus(
          scheduleRow,
          Number.isFinite(actualStartMs) ? actualStartMs : null,
          actualStartAt,
        ),
      )
      return { ...row, ...late }
    }),
  )
}
