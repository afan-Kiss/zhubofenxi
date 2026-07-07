import { getTimeMinutes } from '../utils/time'

/** 2026-06-18 起：14:30–18:00（不含 18:00） */
export const XIAOBAI_ANCHOR_CUTOFF_MS = Date.parse('2026-06-18T00:00:00+08:00')
export const XIAOBAI_SLOT_START_MINUTES = 14 * 60 + 30
export const XIAOBAI_SLOT_END_MINUTES = 18 * 60

export function isInXiaoBaiOrderSlot(date: Date): boolean {
  const minutes = getTimeMinutes(date)
  return minutes >= XIAOBAI_SLOT_START_MINUTES && minutes < XIAOBAI_SLOT_END_MINUTES
}

export function isXiaoBaiAttributionActive(payMs: number): boolean {
  return Number.isFinite(payMs) && payMs >= XIAOBAI_ANCHOR_CUTOFF_MS && isInXiaoBaiOrderSlot(new Date(payMs))
}
