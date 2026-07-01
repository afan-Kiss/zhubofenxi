import type { EffectiveScheduleRow } from '../services/anchor-daily-schedule.service'
import type { AnchorLiveSessionBrief } from '../services/anchor-live-sessions.service'
import { anchorNamesMatch } from './anchor-name-normalize.util'
import { orderLiveRoomMatchesSchedule } from './shop-name-normalize.util'

export interface AnchorLateStatus {
  hasSchedule: boolean
  hasActualStartTime: boolean
  isLate: boolean
  lateMinutes: number
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  scheduledPeriodText: string | null
  actualStartAt: string | null
  actualStartText: string | null
  label: string
  reason: string
}

/** API / 前端统一字段（含历史兼容名） */
export type AnchorLateStatusPayload = AnchorLateStatus & {
  hasManualSchedule: boolean
}

const NO_SCHEDULE: AnchorLateStatus = {
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
  reason: '未排班',
}

export function toLateStatusPayload(status: AnchorLateStatus): AnchorLateStatusPayload {
  return {
    ...status,
    hasManualSchedule: status.hasSchedule,
    lateMinutes: status.isLate ? status.lateMinutes : status.lateMinutes,
  }
}

function formatClockFromIso(iso: string): string {
  return iso.slice(11, 16)
}

function filterManualRowsForAnchor(
  rows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
  usedRowIds: Set<string>,
): EffectiveScheduleRow[] {
  const manualRows = rows.filter(
    (r) =>
      r.source === 'manual' &&
      r.enabled &&
      anchorNamesMatch(r.anchorName, anchorName) &&
      !usedRowIds.has(r.rowId),
  )
  const shop = shopName.trim()
  if (!shop) return manualRows
  const shopMatched = manualRows.filter((r) =>
    orderLiveRoomMatchesSchedule(shop, r.shopName, r.liveRoomName),
  )
  return shopMatched.length > 0 ? shopMatched : manualRows
}

/**
 * 匹配手动排班：同一天多段时，优先选实际开播前最近的一段排班（且未被占用）。
 */
export function matchManualSchedule(
  rows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
  actualStartMs: number | null,
  usedRowIds: Set<string>,
): EffectiveScheduleRow | undefined {
  const candidates = filterManualRowsForAnchor(rows, anchorName, shopName, usedRowIds)
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  const sorted = [...candidates].sort((a, b) => a.startAt.localeCompare(b.startAt))

  if (actualStartMs == null) {
    return sorted[0]
  }

  const scored = sorted.map((row) => {
    const startMs = new Date(row.startAt).getTime()
    const endMs = new Date(row.endAt).getTime()
    const inWindow =
      actualStartMs >= startMs - 30 * 60_000 && actualStartMs <= endMs + 60 * 60_000
    return { row, startMs, inWindow, delta: actualStartMs - startMs }
  })

  const inWindow = scored.filter((s) => s.inWindow)
  const pool = inWindow.length > 0 ? inWindow : scored

  const beforeActual = pool.filter((s) => s.startMs <= actualStartMs)
  if (beforeActual.length > 0) {
    return beforeActual.sort((a, b) => b.startMs - a.startMs)[0]!.row
  }

  return pool.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0]!.row
}

export function calculateAnchorLateStatus(
  scheduleRow: EffectiveScheduleRow | undefined,
  actualStartMs: number | null,
  actualStartAt: string | null,
): AnchorLateStatus {
  if (!scheduleRow) {
    if (actualStartMs != null && actualStartAt) {
      return {
        ...NO_SCHEDULE,
        hasActualStartTime: true,
        actualStartAt,
        actualStartText: formatClockFromIso(actualStartAt),
        label: '',
        reason: '未排班',
      }
    }
    return { ...NO_SCHEDULE, label: '未排班' }
  }

  const scheduledStartAt = scheduleRow.startAt
  const scheduledEndAt = scheduleRow.endAt
  const scheduledPeriodText = `${scheduleRow.startTime}~${scheduleRow.endTime}`
  const scheduledStartMs = new Date(scheduledStartAt).getTime()

  if (actualStartMs == null || !actualStartAt) {
    return {
      hasSchedule: true,
      hasActualStartTime: false,
      isLate: false,
      lateMinutes: 0,
      scheduledStartAt,
      scheduledEndAt,
      scheduledPeriodText,
      actualStartAt: null,
      actualStartText: null,
      label: '未读取开播时间',
      reason: '未读取开播时间',
    }
  }

  const actualStartText = formatClockFromIso(actualStartAt)

  if (actualStartMs > scheduledStartMs) {
    const lateMinutes = Math.round((actualStartMs - scheduledStartMs) / 60_000)
    return {
      hasSchedule: true,
      hasActualStartTime: true,
      isLate: true,
      lateMinutes,
      scheduledStartAt,
      scheduledEndAt,
      scheduledPeriodText,
      actualStartAt,
      actualStartText,
      label: `迟播 ${lateMinutes} 分钟`,
      reason: `排班 ${scheduleRow.startTime}，开播 ${actualStartText}`,
    }
  }

  return {
    hasSchedule: true,
    hasActualStartTime: true,
    isLate: false,
    lateMinutes: 0,
    scheduledStartAt,
    scheduledEndAt,
    scheduledPeriodText,
    actualStartAt,
    actualStartText,
    label: '准时开播',
    reason: `排班 ${scheduleRow.startTime}，开播 ${actualStartText}`,
  }
}

function earliestSessionStart(sessions: AnchorLiveSessionBrief[]): {
  startAt: string
  startMs: number
} | null {
  if (sessions.length === 0) return null
  const earliest = sessions.reduce((min, s) => (s.startTime < min.startTime ? s : min), sessions[0]!)
  if (!earliest.startTime || earliest.startTime === '—') return null
  const startMs = new Date(earliest.startTime).getTime()
  if (!Number.isFinite(startMs)) return null
  return { startAt: earliest.startTime, startMs }
}

export function resolveAnchorLateStatusFromSessions(
  scheduleRows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
  sessions: AnchorLiveSessionBrief[],
  usedRowIds?: Set<string>,
): AnchorLateStatusPayload {
  const actual = earliestSessionStart(sessions)
  const scheduleRow = matchManualSchedule(
    scheduleRows,
    anchorName,
    shopName,
    actual?.startMs ?? null,
    usedRowIds ?? new Set(),
  )
  if (scheduleRow && usedRowIds) usedRowIds.add(scheduleRow.rowId)
  return toLateStatusPayload(
    calculateAnchorLateStatus(scheduleRow, actual?.startMs ?? null, actual?.startAt ?? null),
  )
}

/** @deprecated 使用 resolveAnchorLateStatusFromSessions */
export function attachAnchorScheduleLateFields(
  scheduleRows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
  sessions: AnchorLiveSessionBrief[],
  usedRowIds?: Set<string>,
): AnchorLateStatusPayload {
  return resolveAnchorLateStatusFromSessions(
    scheduleRows,
    anchorName,
    shopName,
    sessions,
    usedRowIds,
  )
}
