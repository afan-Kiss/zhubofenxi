import type { Anchor, AnchorConfig, TimeRule } from '../types/analysis'
import { getTimeMinutes } from '../utils/time'

/** 此日期之前创建的主播视为历史规则，修改时间段时不限制 retroactive */
export const LEGACY_ANCHOR_CUTOFF_MS = Date.parse('2026-06-08T00:00:00+08:00')

export function isLegacyAnchorCreatedAt(createdAt: Date): boolean {
  return createdAt.getTime() < LEGACY_ANCHOR_CUTOFF_MS
}

export function isTimeRuleEffectiveAt(rule: TimeRule, date: Date): boolean {
  if (rule.effectiveFromMs == null) return true
  return date.getTime() >= rule.effectiveFromMs
}

function parseTimeString(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

function ruleToMinuteIntervals(startTime: string, endTime: string): [number, number][] {
  const start = parseTimeString(startTime)
  const end = parseTimeString(endTime)
  if (start === null || end === null) return []
  if (start <= end) return [[start, end]]
  return [
    [start, 1439],
    [0, end],
  ]
}

function isMinuteInRule(minutes: number, rule: TimeRule): boolean {
  if (!rule.enabled) return false
  const intervals = ruleToMinuteIntervals(rule.startTime, rule.endTime)
  return intervals.some(([s, e]) => minutes >= s && minutes < e)
}

export function matchTimeRule(
  date: Date | null,
  config: AnchorConfig,
): { rule: TimeRule; anchor: Anchor } | null {
  if (!date) return null
  const minutes = getTimeMinutes(date)
  for (const rule of config.timeRules) {
    if (!rule.enabled) continue
    if (!isTimeRuleEffectiveAt(rule, date)) continue
    if (!isMinuteInRule(minutes, rule)) continue
    const anchor = config.anchors.find((a) => a.id === rule.anchorId && a.enabled)
    if (anchor) return { rule, anchor }
  }
  return null
}

export function findAnchorByName(config: AnchorConfig, name: string): Anchor | undefined {
  const n = name.trim().toLowerCase()
  return config.anchors.find((a) => a.name.trim().toLowerCase() === n)
}
