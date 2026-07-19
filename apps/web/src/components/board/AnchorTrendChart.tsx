import React, { useMemo } from 'react'
import {
  Bar,
  BarChart,
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
  /** 主播主题色；缺省回退玫瑰红 */
  color?: string
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
  color,
  className = '',
}) => {
  const strokeColor = color?.trim() || '#f43f5e'
  const resolved = trend ?? null
  const isReport = variant === 'report'
  const showZeroPerformanceTrend = isReport || includeZeroPerformance
  // 日报单卡：保留服务端 HH:mm 自然时间走势，避免相对分钟桶压扁晚场成交
  const useRelativeIntraday =
    resolved?.mode === 'intraday' && showZeroPerformanceTrend && !isReport

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

  const emptyMinH = isReport ? 'min-h-[100px]' : 'min-h-[96px] sm:min-h-[110px]'

  if (!hasTrendData(resolved, variant, includeZeroPerformance)) {
    return (
      <div
        data-anchor-trend-chart="empty"
        className={`flex ${emptyMinH} flex-col items-center justify-center rounded-xl border border-dashed border-rose-100 bg-white/70 px-2 py-3 ${className}`}
      >
        <p className={`${isReport ? 'text-[12px]' : 'text-[11px] sm:text-[12px]'} text-slate-500`}>暂无走势数据</p>
        <p className="mt-1 text-[10px] text-slate-400 sm:text-[11px]">
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
  const chartHeight = isReport ? 'h-[140px]' : 'h-[96px] sm:h-[110px]'
  const titleClass = isReport ? 'text-[11px]' : 'text-[11px] sm:text-[12px]'
  const tagClass = isReport ? 'text-[9px] px-1.5 py-0' : 'text-[9px] px-1.5 py-0 sm:text-[10px] sm:px-2 sm:py-0.5'
  const tickSize = isReport ? 9 : 9
  const gridStroke = isReport ? '#f1f5f9' : '#f8fafc'
  const chartMargin = isReport
    ? { top: 4, right: 18, left: -10, bottom: 6 }
    : { top: 2, right: 2, left: -20, bottom: 0 }

  return (
    <div
      data-anchor-trend-chart="ready"
      className={`rounded-xl border border-rose-100 bg-white/80 p-2 shadow-sm shadow-rose-50/40 sm:rounded-2xl sm:p-3 ${className}`}
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
          <BarChart data={chartData} margin={chartMargin} barCategoryGap="28%">
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
            <Bar
              dataKey="chartValue"
              fill={strokeColor}
              radius={[3, 3, 0, 0]}
              maxBarSize={isReport ? 16 : 18}
              isAnimationActive={!isReport}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
