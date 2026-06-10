import type { AnchorConfig } from '../types/analysis'
import type { UserRole } from '../types/roles'
import { getAnchorConfigSync } from './anchor.service'
import { aggregateAnchorLeaderboard } from './board-metrics.service'
import {
  filterViewsByAnchorSpec,
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from './board-scoped-views.service'
import {
  formatLiveDurationMinutes,
  resolveAnchorLiveSessionsForRange,
  type AnchorLiveSessionBrief,
} from './anchor-live-sessions.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { buildDailyReportAiSuggestions } from './daily-report-ai.service'
import {
  countDailyReportOrders,
  roundMinutes,
  roundYuan,
  safeDivide,
  safeRatioPercent,
} from './daily-report-order.util'

export interface DailyReportAnchorRow {
  anchorName: string
  sessionLabel: string
  livePeriodText: string
  liveDurationText: string
  liveDurationMinutes: number
  shippedAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  avgOrderAmountYuan: number | null
  hourlyAmountYuan: number | null
  dealDensityMinutes: number | null
  amountRatio: number | null
}

export interface DailyReportPayload {
  dateLabel: string
  title: string
  startDate: string
  endDate: string
  summary: {
    totalShippedAmountYuan: number
    totalSoldOrderCount: number
    totalInvalidOrderCount: number
    totalLiveDurationMinutes: number
    overallHourlyAmountYuan: number | null
  }
  anchors: DailyReportAnchorRow[]
  aiSuggestions: string[]
}

function formatDailyReportDateLabel(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim())
  if (!m) return dateKey
  return `${Number(m[2])}.${Number(m[3])}`
}

function resolveSessionLabel(config: AnchorConfig, anchorId: string, anchorName: string): string {
  const rule = config.timeRules.find((r) => r.enabled && r.anchorId === anchorId)
  if (!rule) return '场次'
  const startHour = Number(rule.startTime.split(':')[0] ?? 0)
  if (startHour >= 18) return '晚场'
  if (startHour < 12) return '早场'
  return '日场'
}

function buildLivePeriodText(sessions: AnchorLiveSessionBrief[]): string {
  if (sessions.length === 0) return '—'
  if (sessions.length === 1) {
    const s = sessions[0]!
    return `${s.startTime.slice(11, 16)}~${s.endTime.slice(11, 16)}`
  }
  const first = sessions[0]!
  const last = sessions[sessions.length - 1]!
  return `${first.startTime.slice(11, 16)}~${last.endTime.slice(11, 16)}`
}

function buildAnchorRow(params: {
  config: AnchorConfig
  anchorId: string
  anchorName: string
  shippedAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  sessions: AnchorLiveSessionBrief[]
  totalShippedAmountYuan: number
}): DailyReportAnchorRow {
  const liveDurationMinutes = params.sessions.reduce((sum, s) => sum + s.durationMinutes, 0)
  const liveHours = safeDivide(liveDurationMinutes, 60)
  return {
    anchorName: params.anchorName,
    sessionLabel: resolveSessionLabel(params.config, params.anchorId, params.anchorName),
    livePeriodText: buildLivePeriodText(params.sessions),
    liveDurationText: formatLiveDurationMinutes(liveDurationMinutes),
    liveDurationMinutes,
    shippedAmountYuan: params.shippedAmountYuan,
    soldOrderCount: params.soldOrderCount,
    invalidOrderCount: params.invalidOrderCount,
    avgOrderAmountYuan: roundYuan(
      safeDivide(params.shippedAmountYuan, params.soldOrderCount),
    ),
    hourlyAmountYuan: roundYuan(
      liveHours != null ? safeDivide(params.shippedAmountYuan, liveHours) : null,
    ),
    dealDensityMinutes: roundMinutes(
      safeDivide(liveDurationMinutes, params.soldOrderCount),
    ),
    amountRatio: safeRatioPercent(params.shippedAmountYuan, params.totalShippedAmountYuan),
  }
}

export async function buildDailyReport(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<DailyReportPayload> {
  const scoped = await getBoardScopedViewsForRange(params)
  const config = getAnchorConfigSync()
  const anchorRows: DailyReportAnchorRow[] = []

  for (const anchor of config.anchors.filter((a) => a.enabled)) {
    const anchorScoped = filterViewsByAnchorSpec(scoped.views, anchor.id, anchor.name)
    const performanceViews = getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      anchor.id,
      anchor.name,
    )
    const leaderboard = aggregateAnchorLeaderboard(performanceViews)
    const stats = leaderboard.find(
      (row) => row.anchorId === anchor.id || row.anchorName === anchor.name,
    )
    const shippedAmountYuan = Number(stats?.validSalesAmount ?? 0)

    const anchorWithRaw = attachRawByMatchToViews(anchorScoped, scoped.rawByMatch)
    const { soldOrderCount, invalidOrderCount } = countDailyReportOrders(performanceViews)
    const invalidFromAll = countDailyReportOrders(anchorWithRaw).invalidOrderCount
    const sessions = await resolveAnchorLiveSessionsForRange({
      preset: params.preset,
      startDate: params.startDate,
      endDate: params.endDate,
      anchorId: anchor.id,
      anchorName: anchor.name,
      anchorOrders: performanceViews,
    })

    const hasData =
      shippedAmountYuan > 0 ||
      soldOrderCount > 0 ||
      invalidFromAll > 0 ||
      sessions.length > 0 ||
      performanceViews.length > 0

    if (!hasData) continue

    anchorRows.push(
      buildAnchorRow({
        config,
        anchorId: anchor.id,
        anchorName: anchor.name,
        shippedAmountYuan,
        soldOrderCount,
        invalidOrderCount: invalidFromAll,
        sessions,
        totalShippedAmountYuan: 0,
      }),
    )
  }

  const totalShippedAmountYuan = anchorRows.reduce((sum, row) => sum + row.shippedAmountYuan, 0)
  for (const row of anchorRows) {
    row.amountRatio = safeRatioPercent(row.shippedAmountYuan, totalShippedAmountYuan)
  }

  const totalSoldOrderCount = anchorRows.reduce((sum, row) => sum + row.soldOrderCount, 0)
  const totalInvalidOrderCount = anchorRows.reduce((sum, row) => sum + row.invalidOrderCount, 0)
  const totalLiveDurationMinutes = anchorRows.reduce(
    (sum, row) => sum + row.liveDurationMinutes,
    0,
  )
  const totalLiveHours = safeDivide(totalLiveDurationMinutes, 60)

  const dateLabel = formatDailyReportDateLabel(params.startDate)

  return {
    dateLabel,
    title: `${dateLabel} 主播日报`,
    startDate: params.startDate,
    endDate: params.endDate,
    summary: {
      totalShippedAmountYuan,
      totalSoldOrderCount,
      totalInvalidOrderCount,
      totalLiveDurationMinutes,
      overallHourlyAmountYuan: roundYuan(
        totalLiveHours != null ? safeDivide(totalShippedAmountYuan, totalLiveHours) : null,
      ),
    },
    anchors: anchorRows,
    aiSuggestions: buildDailyReportAiSuggestions(anchorRows),
  }
}
