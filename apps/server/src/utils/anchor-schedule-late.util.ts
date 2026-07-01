import type { EffectiveScheduleRow } from '../services/anchor-daily-schedule.service'
import type { AnchorLiveSessionBrief } from '../services/anchor-live-sessions.service'
import { orderLiveRoomMatchesSchedule } from './shop-name-normalize.util'

export interface AnchorScheduleLateFields {
  scheduledPeriodText: string | null
  actualStartText: string | null
  isLate: boolean
  lateMinutes: number | null
  hasManualSchedule: boolean
}

const EMPTY_LATE: AnchorScheduleLateFields = {
  scheduledPeriodText: null,
  actualStartText: null,
  isLate: false,
  lateMinutes: null,
  hasManualSchedule: false,
}

export function findManualScheduleRowForAnchor(
  rows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
): EffectiveScheduleRow | undefined {
  const manualRows = rows.filter((r) => r.source === 'manual' && r.enabled && r.anchorName === anchorName)
  if (manualRows.length === 0) return undefined

  const shop = shopName.trim()
  if (shop) {
    const matched = manualRows.filter((r) =>
      orderLiveRoomMatchesSchedule(shop, r.shopName, r.liveRoomName),
    )
    if (matched.length > 0) {
      return matched.sort((a, b) => a.startAt.localeCompare(b.startAt))[0]
    }
  }

  if (manualRows.length === 1) return manualRows[0]
  return manualRows.sort((a, b) => a.startAt.localeCompare(b.startAt))[0]
}

function earliestSessionStart(sessions: AnchorLiveSessionBrief[]): AnchorLiveSessionBrief | null {
  if (sessions.length === 0) return null
  return sessions.reduce((min, s) => (s.startTime < min.startTime ? s : min), sessions[0]!)
}

export function resolveAnchorScheduleLateStatus(
  scheduleRow: EffectiveScheduleRow | undefined,
  sessions: AnchorLiveSessionBrief[],
): AnchorScheduleLateFields {
  if (!scheduleRow) return { ...EMPTY_LATE }

  const scheduledPeriodText = `${scheduleRow.startTime}~${scheduleRow.endTime}`
  const scheduledStartMs = new Date(scheduleRow.startAt).getTime()
  const earliest = earliestSessionStart(sessions)

  if (!earliest) {
    return {
      scheduledPeriodText,
      actualStartText: null,
      isLate: false,
      lateMinutes: null,
      hasManualSchedule: true,
    }
  }

  const actualStartMs = new Date(earliest.startTime).getTime()
  const actualStartText = earliest.startTime.slice(11, 16)

  if (actualStartMs > scheduledStartMs) {
    return {
      scheduledPeriodText,
      actualStartText,
      isLate: true,
      lateMinutes: Math.round((actualStartMs - scheduledStartMs) / 60_000),
      hasManualSchedule: true,
    }
  }

  return {
    scheduledPeriodText,
    actualStartText,
    isLate: false,
    lateMinutes: null,
    hasManualSchedule: true,
  }
}

export function attachAnchorScheduleLateFields(
  scheduleRows: EffectiveScheduleRow[],
  anchorName: string,
  shopName: string,
  sessions: AnchorLiveSessionBrief[],
): AnchorScheduleLateFields {
  const scheduleRow = findManualScheduleRowForAnchor(scheduleRows, anchorName, shopName)
  return resolveAnchorScheduleLateStatus(scheduleRow, sessions)
}
