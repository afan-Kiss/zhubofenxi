import type { Anchor, AnchorConfig, TimeRule } from '../types/anchor'
import { getTimeMinutes } from './time'

export function parseTimeString(value: string): { ok: true; minutes: number } | { ok: false; error: string } {
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return { ok: false, error: '时间格式应为 HH:mm' }
  const h = Number(match[1])
  const m = Number(match[2])
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return { ok: false, error: '时间超出有效范围' }
  }
  return { ok: true, minutes: h * 60 + m }
}

export function formatMinutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 将规则转为当日分钟区间（支持跨天） */
export function ruleToMinuteIntervals(startTime: string, endTime: string): [number, number][] {
  const start = parseTimeString(startTime)
  const end = parseTimeString(endTime)
  if (!start.ok || !end.ok) return []
  if (start.minutes <= end.minutes) {
    return [[start.minutes, end.minutes]]
  }
  return [
    [start.minutes, 1439],
    [0, end.minutes],
  ]
}

function intervalsOverlap(a: [number, number][], b: [number, number][]): boolean {
  for (const [as, ae] of a) {
    for (const [bs, be] of b) {
      if (as <= be && bs <= ae) return true
    }
  }
  return false
}

export function findTimeRuleConflicts(rules: TimeRule[]): string | null {
  const enabled = rules.filter((r) => r.enabled)
  for (let i = 0; i < enabled.length; i++) {
    const a = ruleToMinuteIntervals(enabled[i].startTime, enabled[i].endTime)
    for (let j = i + 1; j < enabled.length; j++) {
      const b = ruleToMinuteIntervals(enabled[j].startTime, enabled[j].endTime)
      if (intervalsOverlap(a, b)) {
        return `规则「${enabled[i].name}」与「${enabled[j].name}」时间重叠，请调整后再保存`
      }
    }
  }
  return null
}

export function isMinuteInRule(minutes: number, rule: TimeRule): boolean {
  if (!rule.enabled) return false
  const intervals = ruleToMinuteIntervals(rule.startTime, rule.endTime)
  return intervals.some(([s, e]) => minutes >= s && minutes <= e)
}

export function matchTimeRule(
  date: Date | null,
  config: AnchorConfig,
): { rule: TimeRule; anchor: Anchor } | null {
  if (!date) return null
  const minutes = getTimeMinutes(date)
  for (const rule of config.timeRules) {
    if (!rule.enabled) continue
    if (!isMinuteInRule(minutes, rule)) continue
    const anchor = config.anchors.find((a) => a.id === rule.anchorId && a.enabled)
    if (anchor) return { rule, anchor }
  }
  return null
}

export function findAnchorById(config: AnchorConfig, anchorId: string): Anchor | undefined {
  return config.anchors.find((a) => a.id === anchorId)
}

export function findAnchorByName(config: AnchorConfig, name: string): Anchor | undefined {
  const n = name.trim().toLowerCase()
  return config.anchors.find((a) => a.name.trim().toLowerCase() === n)
}

export function getEnabledAnchors(config: AnchorConfig): Anchor[] {
  return config.anchors.filter((a) => a.enabled)
}

export function removeRulesForAnchor(config: AnchorConfig, anchorId: string): TimeRule[] {
  return config.timeRules.filter((r) => r.anchorId !== anchorId)
}

export function disableRulesForAnchor(config: AnchorConfig, anchorId: string): TimeRule[] {
  return config.timeRules.map((r) =>
    r.anchorId === anchorId ? { ...r, enabled: false } : r,
  )
}
