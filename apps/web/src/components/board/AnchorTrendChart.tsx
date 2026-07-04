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
  className?: string
}

function defaultFormatCount(value: number): string {
  return `${value} 单`
}

function hasTrendData(trend: AnchorTrend | null | undefined): boolean {
  if (!trend?.points?.length) return false
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
  className = '',
}) => {
  const gradientId = useId().replace(/:/g, '')
  const resolved = trend ?? null

  const chartData = useMemo(
    () =>
      (resolved?.points ?? []).map((p) => ({
        ...p,
        chartValue: p.value,
      })),
    [resolved?.points],
  )

  const xInterval = useMemo(() => {
    const len = chartData.length
    if (len <= 12) return 0
    if (len <= 24) return 1
    return Math.ceil(len / 10)
  }, [chartData.length])

  if (!hasTrendData(resolved)) {
    return (
      <div
        className={`flex min-h-[120px] flex-col items-center justify-center rounded-2xl border border-dashed border-rose-100 bg-white/70 px-3 py-4 md:min-h-[150px] ${className}`}
      >
        <p className="text-[13px] text-slate-500">暂无走势数据</p>
        <p className="mt-1 text-[11px] text-slate-400">有订单后会按开播时间生成走势</p>
      </div>
    )
  }

  const mode = resolved!.mode
  const title = resolved!.title || (mode === 'intraday' ? '直播时段走势' : '每日销售走势')

  return (
    <div
      className={`rounded-2xl border border-rose-100 bg-white/80 p-3 shadow-sm shadow-rose-50/40 ${className}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-slate-700">{title}</p>
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600">
          销售额
        </span>
      </div>
      <div className="h-[120px] w-full md:h-[150px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.14} />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              interval={xInterval}
              minTickGap={20}
            />
            <YAxis hide domain={[0, 'auto']} />
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
            <Area
              type="monotone"
              dataKey="chartValue"
              stroke="#f43f5e"
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 3.5, fill: '#f43f5e', stroke: '#fff', strokeWidth: 1 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
