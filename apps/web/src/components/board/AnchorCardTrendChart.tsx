import React, { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import {
  anchorRowTrend,
  type AnchorCardTrend,
  type AnchorCardTrendPoint,
} from '../../lib/anchor-leaderboard-row'

interface Props {
  trend: AnchorCardTrend | null | undefined
  className?: string
}

function hasTrendData(trend: AnchorCardTrend | null | undefined): boolean {
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
  payload?: ReadonlyArray<{ payload?: AnchorCardTrendPoint }>
  mode: AnchorCardTrend['mode']
  formatMoney: (n: number) => string
  formatCount: (n: number) => string
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null

  if (mode === 'intraday') {
    return (
      <div className="rounded-lg border border-rose-100 bg-white px-3 py-2 text-xs shadow-md">
        <p className="font-medium text-slate-800">{point.label}</p>
        <p className="mt-1 text-slate-600">销售额 {formatMoney(point.value)}</p>
        <p className="text-slate-500">订单数 {formatCount(point.orderCount)}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-rose-100 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-800">日期 {point.date ?? point.label}</p>
      <p className="mt-1 text-slate-600">销售额 {formatMoney(point.value)}</p>
      <p className="text-slate-500">订单数 {formatCount(point.orderCount)}</p>
      {point.scheduleRange ? (
        <p className="mt-1 text-slate-500">排班 {point.scheduleRange.replace(/\n/g, ' / ')}</p>
      ) : null}
      {point.actualRange ? (
        <p className="text-slate-500">实际 {point.actualRange.replace(/\n/g, ' / ')}</p>
      ) : null}
    </div>
  )
}

export const AnchorCardTrendChart: React.FC<Props> = ({ trend, className = '' }) => {
  const { formatMoney, formatCount } = useAmountDisplay()
  const resolved = trend ?? null

  const chartData = useMemo(
    () =>
      (resolved?.points ?? []).map((p) => ({
        ...p,
        chartValue: p.value,
      })),
    [resolved?.points],
  )

  if (!hasTrendData(resolved)) {
    const emptyText =
      resolved?.mode === 'daily' ? '当前范围暂无走势数据' : '暂无走势数据'
    return (
      <div
        className={`flex h-[148px] items-center justify-center rounded-xl border border-dashed border-rose-100/80 bg-rose-50/20 text-[12px] text-slate-400 ${className}`}
      >
        {emptyText}
      </div>
    )
  }

  const mode = resolved!.mode

  return (
    <div className={`h-[148px] w-full ${className}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="anchorTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#fb7185" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
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
            stroke="#e11d48"
            strokeWidth={1.5}
            fill="url(#anchorTrendFill)"
            dot={false}
            activeDot={{ r: 3, fill: '#e11d48', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function readAnchorRowTrend(row: Record<string, unknown>): AnchorCardTrend | null {
  return anchorRowTrend(row)
}
