import {
  SCHEDULE_DAY_MINUTES,
  scheduleTimeToMinutes,
} from './schedule-time'

/** 可见跨度（分钟）：全天 / 16h / 12h / 8h / 6h / 4h / 2h */
export const TIMELINE_ZOOM_SPANS = [1440, 960, 720, 480, 360, 240, 120] as const

export type TimelineZoomSpan = (typeof TIMELINE_ZOOM_SPANS)[number]

export const DEFAULT_TIMELINE_VIEW_START = 8 * 60
export const DEFAULT_TIMELINE_ZOOM_INDEX = 1 // 16h → 优先 08:00–24:00

export const TIMELINE_SHOP_ORDER = ['XY祥钰珠宝', '祥钰珠宝', '和田雅玉', '拾玉居和田玉'] as const

export function timelineZoomLabel(span: number): string {
  if (span >= SCHEDULE_DAY_MINUTES) return '全天 24 小时'
  const h = span / 60
  if (Number.isInteger(h)) return `${h} 小时`
  return `${span} 分钟`
}

export function clampTimelineViewStart(viewStart: number, viewSpan: number): number {
  const span = Math.min(SCHEDULE_DAY_MINUTES, Math.max(60, viewSpan))
  const maxStart = Math.max(0, SCHEDULE_DAY_MINUTES - span)
  if (!Number.isFinite(viewStart)) return 0
  return Math.min(maxStart, Math.max(0, Math.round(viewStart)))
}

export function zoomIndexForSpan(span: number): number {
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < TIMELINE_ZOOM_SPANS.length; i++) {
    const diff = Math.abs(TIMELINE_ZOOM_SPANS[i]! - span)
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  }
  return best
}

/** 刻度步长（主刻度 / 辅刻度），单位分钟 */
export function timelineTickSteps(viewSpan: number): { major: number; minor: number | null } {
  if (viewSpan >= 1200) return { major: 120, minor: 60 }
  if (viewSpan >= 720) return { major: 60, minor: 30 }
  if (viewSpan >= 360) return { major: 30, minor: 15 }
  return { major: 15, minor: null }
}

export function buildTimelineTicks(
  viewStart: number,
  viewSpan: number,
): Array<{ minute: number; major: boolean; label: string | null }> {
  const { major, minor } = timelineTickSteps(viewSpan)
  const step = minor ?? major
  const start = Math.floor(viewStart / step) * step
  const end = Math.min(SCHEDULE_DAY_MINUTES, viewStart + viewSpan)
  const ticks: Array<{ minute: number; major: boolean; label: string | null }> = []
  for (let m = start; m <= end; m += step) {
    if (m < viewStart - step) continue
    const isMajor = m % major === 0
    const label =
      isMajor || m === SCHEDULE_DAY_MINUTES
        ? m >= SCHEDULE_DAY_MINUTES
          ? '24:00'
          : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        : null
    ticks.push({ minute: m, major: isMajor || m === SCHEDULE_DAY_MINUTES, label })
  }
  return ticks
}

export function minutesToContentX(minute: number, contentWidth: number): number {
  if (contentWidth <= 0) return 0
  return (clampDayMinute(minute) / SCHEDULE_DAY_MINUTES) * contentWidth
}

export function contentXToMinutes(x: number, contentWidth: number): number {
  if (contentWidth <= 0) return 0
  return clampDayMinute((x / contentWidth) * SCHEDULE_DAY_MINUTES)
}

function clampDayMinute(m: number): number {
  if (!Number.isFinite(m)) return 0
  return Math.min(SCHEDULE_DAY_MINUTES, Math.max(0, m))
}

export interface TimelineRowLike {
  shopName: string
  liveRoomName: string
  startTime: string
  endTime: string
  enabled?: boolean
}

export function resolveTimelineShopKey(row: TimelineRowLike): string {
  return (row.liveRoomName || row.shopName || '').trim() || '未命名直播间'
}

export function collectTimelineShops(rows: TimelineRowLike[], preferredOrder: readonly string[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const shop of preferredOrder) {
    seen.add(shop)
    ordered.push(shop)
  }
  for (const row of rows) {
    const key = resolveTimelineShopKey(row)
    if (!key || seen.has(key)) continue
    seen.add(key)
    ordered.push(key)
  }
  return ordered
}

/** 根据当日排班计算「适应排班」视口；左右各留 padding 分钟 */
export function fitTimelineToRows(
  rows: TimelineRowLike[],
  paddingMin = 45,
): { viewStart: number; zoomIndex: number } | null {
  let minStart = SCHEDULE_DAY_MINUTES
  let maxEnd = 0
  for (const row of rows) {
    if (row.enabled === false) continue
    const s = scheduleTimeToMinutes(row.startTime)
    const e = scheduleTimeToMinutes(row.endTime === '23:59' ? '24:00' : row.endTime)
    if (s == null || e == null || e <= s) continue
    minStart = Math.min(minStart, s)
    maxEnd = Math.max(maxEnd, e)
  }
  if (maxEnd <= minStart || minStart >= SCHEDULE_DAY_MINUTES) return null
  const paddedStart = Math.max(0, minStart - paddingMin)
  const paddedEnd = Math.min(SCHEDULE_DAY_MINUTES, maxEnd + paddingMin)
  const span = Math.max(120, paddedEnd - paddedStart)
  const zoomIndex = zoomIndexForSpan(span)
  const viewSpan = TIMELINE_ZOOM_SPANS[zoomIndex]!
  const viewStart = clampTimelineViewStart(paddedStart, viewSpan)
  return { viewStart, zoomIndex }
}

/** 默认视口：优先 08:00–24:00；若有更早排班则扩展 */
export function resolveDefaultTimelineView(rows: TimelineRowLike[]): {
  viewStart: number
  zoomIndex: number
} {
  let earliest = DEFAULT_TIMELINE_VIEW_START
  for (const row of rows) {
    if (row.enabled === false) continue
    const s = scheduleTimeToMinutes(row.startTime)
    if (s == null) continue
    earliest = Math.min(earliest, s)
  }
  if (earliest < DEFAULT_TIMELINE_VIEW_START) {
    const fit = fitTimelineToRows(rows, 30)
    if (fit) return fit
    return {
      viewStart: clampTimelineViewStart(earliest, TIMELINE_ZOOM_SPANS[DEFAULT_TIMELINE_ZOOM_INDEX]!),
      zoomIndex: DEFAULT_TIMELINE_ZOOM_INDEX,
    }
  }
  return {
    viewStart: DEFAULT_TIMELINE_VIEW_START,
    zoomIndex: DEFAULT_TIMELINE_ZOOM_INDEX,
  }
}
