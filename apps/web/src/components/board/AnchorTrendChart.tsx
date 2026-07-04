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

export type { AnchorTrend, AnchorTrendPoint }

export interface AnchorTrendChartProps {
  trend?: AnchorTrend | null
  formatMoney: (value: number) => string
  formatCount?: (value: number) => string
  /** page=交互页；report=日报截图（固定高度、无 tooltip） */
  variant?: 'page' | 'report'
  className?: string
}

function defaultFormatCount(value: number): string {
  return `${value} 单`
}

function hasTrendData(
  trend: AnchorTrend | null | undefined,
  variant: 'page' | 'report',
): boolean {
  if (!trend?.points?.length) return false
  if (variant === 'report') return true
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
        <p className="mt-1 text-slate-600">销售额 {formatMoney(point.value)}</p>
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
      <p className="mt-1 text-slate-600">销售额 {formatMoney(point.value)}</p>
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
  className = '',
}) => {
  const gradientId = useId().replace(/:/g, '')
  const resolved = trend ?? null
  const isReport = variant === 'report'

  const chartData = useMemo(
    () =>
      (resolved?.points ?? []).map((p) => ({
        ...p,
        chartValue: p.value,
      })),
    [resolved?.points],
  )

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

  const emptyMinH = isReport ? 'min-h-[100px]' : 'min-h-[120px] md:min-h-[150px]'

  if (!hasTrendData(resolved, variant)) {
    return (
      <div
        data-anchor-trend-chart="empty"
        className={`flex ${emptyMinH} flex-col items-center justify-center rounded-2xl border border-dashed border-rose-100 bg-white/70 px-3 py-4 ${className}`}
      >
        <p className={`${isReport ? 'text-[12px]' : 'text-[13px]'} text-slate-500`}>暂无走势数据</p>
        <p className="mt-1 text-[11px] text-slate-400">有订单后会按开播时间生成走势</p>
      </div>
    )
  }

  const mode = resolved!.mode
  const title = resolved!.title || (mode === 'intraday' ? '当日时段走势' : '每日销售走势')
  const chartHeight = isReport ? 'h-[132px]' : 'h-[120px] md:h-[150px]'
  const titleClass = isReport ? 'text-[11px]' : 'text-[12px]'
  const tagClass = isReport ? 'text-[9px] px-1.5 py-0' : 'text-[10px] px-2 py-0.5'
  const tickSize = isReport ? 9 : 10
  const gridStroke = isReport ? '#f1f5f9' : '#f8fafc'

  return (
    <div
      data-anchor-trend-chart="ready"
      className={`rounded-2xl border border-rose-100 bg-white/80 p-3 shadow-sm shadow-rose-50/40 ${className}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className={`${titleClass} font-medium text-slate-700`}>{title}</p>
        <div className="flex items-center gap-1.5">
          {isReport && !hasPositiveSales ? (
            <span
              className={`rounded-full bg-slate-100 font-medium text-slate-500 ${tagClass}`}
            >
              暂无成交
            </span>
          ) : null}
          <span
            className={`rounded-full bg-rose-50 font-medium text-rose-600 ${tagClass}`}
          >
            销售额
          </span>
        </div>
      </div>
      <div className={`${chartHeight} w-full`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={isReport ? { top: 2, right: 2, left: -16, bottom: 0 } : { top: 4, right: 4, left: -18, bottom: 0 }}
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
              minTickGap={isReport ? 14 : 20}
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
