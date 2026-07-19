/**
 * 日报长图展示模型（前端）：场次列表 → 时间轴行 / 卡片。
 * 店铺是否出现完全由 imageSessions 动态决定，不写死四店。
 */
import { resolveAnchorColor } from '../../lib/anchor-theme'
import { scheduleTimeToMinutes } from '../../lib/schedule-time'
import { COVER_CLICK_RATE_PASS_THRESHOLD } from './dailyReportFormatters'

export type DailyReportImageSessionStatus =
  | 'qualified'
  | 'warning'
  | 'unqualified'
  | 'missing'

export interface DailyReportImageSession {
  id: string
  shopName: string
  anchorName: string
  startTime: string
  endTime: string
  liveTimeRange: string
  liveDurationText: string
  liveDurationMinutes: number
  shipmentAmountYuan: number
  gmvYuan: number
  orderCount: number
  refundAmountYuan: number | null
  coverClickRate: number | null
  stay60sUserCount: number | null
  avgStayDurationSeconds: number | null
  status: DailyReportImageSessionStatus
  color: string | null
  /** 排班请假：卡片展示「休假」水印 */
  isOnLeave?: boolean
  /** 逸凡线下成交：无直播场次，卡片展示线下业绩 */
  isOfflineDeal?: boolean
}

export interface DailyReportTimelineBar {
  session: DailyReportImageSession
  startMin: number
  endMin: number
  color: string
}

export interface DailyReportTimelineShopRow {
  shopName: string
  bars: DailyReportTimelineBar[]
}

const STATUS_LABEL: Record<DailyReportImageSessionStatus, string> = {
  qualified: '合格',
  warning: '待关注',
  unqualified: '不合格',
  missing: '数据缺失',
}

export function dailyReportImageStatusLabel(status: DailyReportImageSessionStatus): string {
  return STATUS_LABEL[status]
}

export function resolveDailyReportImageSessionStatus(
  coverClickRate: number | null | undefined,
): DailyReportImageSessionStatus {
  if (coverClickRate == null || !Number.isFinite(coverClickRate)) return 'missing'
  if (coverClickRate >= COVER_CLICK_RATE_PASS_THRESHOLD) return 'qualified'
  if (coverClickRate >= 0.05) return 'warning'
  return 'unqualified'
}

function clockToMinutes(clockOrIso: string): number | null {
  const text = clockOrIso.trim()
  const hm = /^(\d{1,2}):(\d{2})/.exec(text)
  if (hm) {
    const h = Number(hm[1])
    const m = Number(hm[2])
    if (h === 24 && m === 0) return 24 * 60
    return scheduleTimeToMinutes(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }
  // ISO datetime
  const isoHm = /T(\d{2}):(\d{2})/.exec(text)
  if (isoHm) {
    return scheduleTimeToMinutes(`${isoHm[1]}:${isoHm[2]}`)
  }
  return scheduleTimeToMinutes(text.slice(0, 5))
}

function barBounds(session: DailyReportImageSession): { startMin: number; endMin: number } | null {
  // Prefer liveTimeRange "09:30-14:00"
  const range = session.liveTimeRange.trim()
  const parts = range.split(/[-–—]/)
  if (parts.length >= 2) {
    const startMin = clockToMinutes(parts[0]!.trim())
    let endMin = clockToMinutes(parts[1]!.trim())
    if (startMin != null && endMin != null) {
      if (endMin <= startMin) endMin += 24 * 60
      return { startMin, endMin: Math.min(endMin, 24 * 60) }
    }
  }
  const startMin = clockToMinutes(session.startTime)
  let endMin = clockToMinutes(session.endTime)
  if (startMin == null || endMin == null) return null
  if (endMin <= startMin) endMin += 24 * 60
  return { startMin, endMin: Math.min(endMin, 24 * 60) }
}

/** 有实际场次才进入时间轴/卡片；按店铺动态分组，不写死店铺列表 */
export function buildDailyReportTimelineRows(
  sessions: DailyReportImageSession[],
): DailyReportTimelineShopRow[] {
  const byShop = new Map<string, DailyReportTimelineBar[]>()
  for (const session of sessions) {
    const shop = session.shopName.trim()
    if (!shop || shop === '—' || shop === '线下成交') continue
    const bounds = barBounds(session)
    if (!bounds) continue
    const color = resolveAnchorColor({
      name: session.anchorName,
      color: session.color,
    })
    const bar: DailyReportTimelineBar = {
      session,
      startMin: bounds.startMin,
      endMin: bounds.endMin,
      color,
    }
    const list = byShop.get(shop) ?? []
    list.push(bar)
    byShop.set(shop, list)
  }

  const rows: DailyReportTimelineShopRow[] = [...byShop.entries()].map(([shopName, bars]) => ({
    shopName,
    bars: bars.sort((a, b) => a.startMin - b.startMin),
  }))

  // 按首场开播时间排序店铺行，直观看当天节奏
  rows.sort((a, b) => {
    const a0 = a.bars[0]?.startMin ?? 0
    const b0 = b.bars[0]?.startMin ?? 0
    if (a0 !== b0) return a0 - b0
    return a.shopName.localeCompare(b.shopName, 'zh-CN')
  })
  return rows
}

/** 导出用时间轴视口：默认覆盖全天直播；有更早开播则前移起点 */
export function resolveDailyReportTimelineView(rows: DailyReportTimelineShopRow[]): {
  viewStart: number
  viewEnd: number
} {
  let minStart = 8 * 60
  let maxEnd = 24 * 60
  for (const row of rows) {
    for (const bar of row.bars) {
      minStart = Math.min(minStart, Math.floor(bar.startMin / 60) * 60)
      maxEnd = Math.max(maxEnd, Math.ceil(bar.endMin / 60) * 60)
    }
  }
  minStart = Math.max(0, minStart)
  maxEnd = Math.min(24 * 60, Math.max(maxEnd, 18 * 60))
  if (maxEnd <= minStart) {
    return { viewStart: 8 * 60, viewEnd: 24 * 60 }
  }
  return { viewStart: minStart, viewEnd: maxEnd }
}

export function formatMinuteLabel(minute: number): string {
  if (minute >= 24 * 60) return '24:00'
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
