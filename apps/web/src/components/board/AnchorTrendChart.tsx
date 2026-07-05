import React, { useId, useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnchorTrend, AnchorTrendPoint } from '../../lib/anchor-leaderboard-row'
import { buildRelativeIntradayTrendPoints } from '../../lib/anchor-intraday-trend.util'

export type { AnchorTrend, AnchorTrendPoint }

export interface AnchorTrendChartProps {
  trend?: AnchorTrend | null
  formatMoney: (value: number) => string
  formatCount?: (value: number) => string
  /** page=交互页；report=日报截图（固定高度、无 tooltip） */
  variant?: 'page' | 'report'
  /** 单日业绩/日报：无成交也按排班展示平线 */
  includeZeroPerformance?: boolean
  className?: string
}

function defaultFormatCount(value: number): string {
  return `${value} 单`
}

function formatShortDayLabel(raw: string): string {
  const trimmed = raw.trim()
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${Number(iso[2])}/${Number(iso[3])}`
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})/)
  if (slash) return `${Number(slash[1])}/${Number(slash[2])}`
  return trimmed.length > 8 ? trimmed.slice(5) : trimmed
}

function pickPeakPoint(points: AnchorTrendPoint[]): AnchorTrendPoint {
  return points.reduce((best, point) => {
    if (point.value > best.value) return point
    if (point.value === best.value && point.orderCount > best.orderCount) return point
    return best
  }, points[0]!)
}

function buildTrendSummary(
  trend: AnchorTrend,
  formatMoney: (value: number) => string,
  formatCount: (value: number) => string,
): { headline: string; peak?: string } {
  const points = trend.points
  const totalPay = points.reduce((sum, point) => sum + point.value, 0)
  const totalOrders = points.reduce((sum, point) => sum + point.orderCount, 0)

  if (totalOrders <= 0 && totalPay <= 0) {
    return { headline: '暂无成交' }
  }

  const peak = pickPeakPoint(points)
  if (trend.mode === 'intraday') {
    const peakLabel = peak.timeRange ?? peak.label
    return {
      headline: `本场支付：${formatMoney(totalPay)} · 出单：${formatCount(totalOrders)}`,
      peak:
        totalOrders > 0
          ? `最高半小时：${peakLabel} ${formatMoney(peak.value)} / ${formatCount(peak.orderCount)}`
          : undefined,
    }
  }

  const peakDay = formatShortDayLabel(peak.date ?? peak.label)
  return {
    headline: `本期支付：${formatMoney(totalPay)} · 出单：${formatCount(totalOrders)}`,
    peak:
      totalOrders > 0
        ? `最高一天：${peakDay} ${formatMoney(peak.value)} / ${formatCount(peak.orderCount)}`
        : undefined,
  }
}

function resolveTrendSubtitle(trend: AnchorTrend): string | undefined {
  if (trend.mode === 'daily' && trend.points.length > 1) {
    return '按订单支付日期统计，不是有效成交走势'
  }
  return trend.subtitle ?? '按订单支付时间统计，不是有效成交走势'
}

function hasTrendData(
  trend: AnchorTrend | null | undefined,
  variant: 'page' | 'report',
  includeZeroPerformance: boolean,
): boolean {
  if (!trend?.points?.length) return false
  if (variant === 'report' || includeZeroPerformance) return true
  return trend.points.some((p) => p.value > 0 || p.orderCount > 0)
}

function TrendTooltip({
  active,
  payload,
  mode,
  formatMoney,
  formatCount,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: AnchorTrendPoint }>
  mode: AnchorTrend['mode']
  formatMoney: (n: number) => string
  formatCount: (n: number) => string
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  if (mode === 'intraday') {
    return (
      <div className="rounded-lg border border-rose-100 bg-white px-3 py-2 text-xs shadow-md">
        <p className="font-medium text-slate-800">{point.timeRange ?? point.label}</p>
        <p className="mt-1 text-slate-600">支付金额 {formatMoney(point.value)}</p>
        <p className="text-slate-500">订单数 {formatCount(point.orderCount)}</p>
        {point.scheduleRange ? (
          <p className="mt-1 text-slate-500">排班 {point.scheduleRange}</p>
        ) : null}
        {point.actualRange ? <p className="text-slate-500">实际 {point.actualRange}</p> : null}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-rose-100 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-800">{point.date ?? point.label}</p>
      <p className="mt-1 text-slate-600">支付金额 {formatMoney(point.value)}</p>
      <p className="text-slate-500">订单数 {formatCount(point.orderCount)}</p>
      <p className="mt-1 text-slate-500">排班 {point.scheduleRange ?? '—'}</p>
      <p className="text-slate-500">实际 {point.actualRange ?? '—'}</p>
    </div>
  )
}

export const AnchorTrendChart: React.FC<AnchorTrendChartProps> = ({
  trend,
  formatMoney,
  formatCount = defaultFormatCount,
  variant = 'page',
  includeZeroPerformance = false,
  className = '',
}) => {
  const gradientId = useId().replace(/:/g, '')
  const resolved = trend ?? null
  const isReport = variant === 'report'
  const showZeroPerformanceTrend = isReport || includeZeroPerformance
  const useRelativeIntraday =
    resolved?.mode === 'intraday' && showZeroPerformanceTrend

  const chartData = useMemo(() => {
    const points = resolved?.points ?? []
    if (points.length === 0) return []
    if (useRelativeIntraday) {
      return buildRelativeIntradayTrendPoints(points, { compactTicks: isReport }).points
    }
    return points.map((p) => ({
      ...p,
      chartValue: p.value,
    }))
  }, [resolved?.points, useRelativeIntraday, isReport])

  const hasPositiveSales = useMemo(
    () => chartData.some((p) => p.value > 0 || p.orderCount > 0),
    [chartData],
  )

  const xInterval = useMemo(() => {
    const len = chartData.length
    if (isReport) {
      if (len <= 8) return 0
      if (len <= 16) return 1
      return Math.ceil(len / 6)
    }
    if (len <= 12) return 0
    if (len <= 24) return 1
    return Math.ceil(len / 10)
  }, [chartData.length, isReport])

  const summary = useMemo(() => {
    if (!resolved?.points?.length) {
      return { headline: '暂无成交' as const, peak: undefined }
    }
    const trendForSummary = useRelativeIntraday
      ? { ...resolved, points: buildRelativeIntradayTrendPoints(resolved.points).points }
      : resolved
    return buildTrendSummary(trendForSummary, formatMoney, formatCount)
  }, [resolved, formatMoney, formatCount, useRelativeIntraday])

  const emptyMinH = isReport ? 'min-h-[100px]' : 'min-h-[120px] md:min-h-[150px]'

  if (!hasTrendData(resolved, variant, includeZeroPerformance)) {
    return (
      <div
        data-anchor-trend-chart="empty"
        className={`flex ${emptyMinH} flex-col items-center justify-center rounded-2xl border border-dashed border-rose-100 bg-white/70 px-3 py-4 ${className}`}
      >
        <p className={`${isReport ? 'text-[12px]' : 'text-[13px]'} text-slate-500`}>暂无走势数据</p>
        <p className="mt-1 text-[11px] text-slate-400">
          {showZeroPerformanceTrend
            ? '请先设置排班或同步直播场次'
            : '有订单后会按开播时间生成走势'}
        </p>
      </div>
    )
  }

  const mode = resolved!.mode
  const title = resolved!.title || '支付金额走势'
  const subtitle = useRelativeIntraday
    ? '按开播后分钟统计，不是有效成交走势'
    : resolveTrendSubtitle(resolved!)
  const chartHeight = isReport ? 'h-[140px]' : 'h-[120px] md:h-[150px]'
  const titleClass = isReport ? 'text-[11px]' : 'text-[12px]'
  const tagClass = isReport ? 'text-[9px] px-1.5 py-0' : 'text-[10px] px-2 py-0.5'
  const tickSize = isReport ? 9 : 10
  const gridStroke = isReport ? '#f1f5f9' : '#f8fafc'
  const chartMargin = isReport
    ? { top: 4, right: 18, left: -10, bottom: 6 }
    : { top: 4, right: 4, left: -18, bottom: 0 }

  return (
    <div
      data-anchor-trend-chart="ready"
      className={`rounded-2xl border border-rose-100 bg-white/80 p-3 shadow-sm shadow-rose-50/40 ${className}`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`${titleClass} font-medium text-slate-700`}>{title}</p>
          {subtitle ? (
            <p className="mt-0.5 text-[10px] leading-snug text-slate-400">{subtitle}</p>
          ) : null}
          <p className="mt-1 text-[11px] leading-snug text-slate-600">{summary.headline}</p>
          {summary.peak ? (
            <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{summary.peak}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {showZeroPerformanceTrend && !hasPositiveSales ? (
            <span
              className={`rounded-full bg-slate-100 font-medium text-slate-500 ${tagClass}`}
            >
              暂无成交
            </span>
          ) : null}
          <span
            className={`rounded-full bg-rose-50 font-medium text-rose-600 ${tagClass}`}
          >
            支付金额
          </span>
        </div>
      </div>
      <div className={`${chartHeight} w-full${isReport ? ' overflow-visible' : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={chartMargin}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={isReport ? 0.12 : 0.14} />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: tickSize, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              interval={xInterval}
              minTickGap={isReport ? 10 : 20}
              padding={isReport ? { left: 10, right: 16 } : undefined}
              height={isReport ? 22 : 30}
            />
            <YAxis hide domain={[0, (max: number) => Math.max(max, 1)]} />
            {!isReport ? (
              <Tooltip
                content={(props) => (
                  <TrendTooltip
                    {...props}
                    mode={mode}
                    formatMoney={formatMoney}
                    formatCount={formatCount}
                  />
                )}
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="chartValue"
              stroke="#f43f5e"
              strokeWidth={isReport ? 1.25 : 1.5}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={isReport ? false : { r: 3.5, fill: '#f43f5e', stroke: '#fff', strokeWidth: 1 }}
              isAnimationActive={!isReport}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
