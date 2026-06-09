import React from 'react'
import { PieChart, Pie, Cell, Tooltip, TooltipProps } from 'recharts'

interface DonutDatum {
  name: string
  value: number
  display: string
}

interface DonutChartProps {
  title: string
  totalLabel: string
  totalValue: string
  data: DonutDatum[]
  colors: string[]
}

const CHART_SIZE = 120
const INNER_R = 38
const OUTER_R = 52

const CustomTooltip: React.FC<TooltipProps<number, string>> = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const item = payload[0]
  const datum = item.payload as DonutDatum

  return (
    <div className="rounded-xl border border-slate-100 bg-white/95 px-2.5 py-1.5 text-[10px] shadow-md">
      <div className="font-medium text-slate-900">{datum.name}</div>
      <div className="text-slate-500">
        {datum.display} · {item.percent?.toFixed(1)}%
      </div>
    </div>
  )
}

export const DonutChart: React.FC<DonutChartProps> = ({
  title,
  totalLabel,
  totalValue,
  data,
  colors,
}) => {
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-white/70 bg-[var(--color-card)] px-3 py-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
      <div className="shrink-0 text-[11px] font-medium text-slate-500">{title}</div>

      <div className="flex min-h-0 flex-1 items-center gap-2">
        <div
          className="relative shrink-0"
          style={{ width: CHART_SIZE, height: CHART_SIZE }}
        >
          <PieChart width={CHART_SIZE} height={CHART_SIZE}>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx={CHART_SIZE / 2}
              cy={CHART_SIZE / 2}
              innerRadius={INNER_R}
              outerRadius={OUTER_R}
              strokeWidth={2}
              paddingAngle={2}
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex max-w-[72px] flex-col items-center text-center">
              <span className="text-[9px] leading-tight text-slate-400">{totalLabel}</span>
              <span className="text-[11px] font-semibold leading-tight text-slate-900">
                {totalValue}
              </span>
            </div>
          </div>
        </div>

        <ul className="min-w-0 flex-1 space-y-1.5">
          {data.map((datum, index) => {
            const pct = total > 0 ? ((datum.value / total) * 100).toFixed(1) : '0'
            return (
              <li key={datum.name} className="flex items-center gap-1.5 text-[10px]">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: colors[index % colors.length] }}
                />
                <span className="shrink-0 font-medium text-slate-700">{datum.name}</span>
                <span className="truncate text-slate-500">
                  {datum.display}
                  <span className="ml-0.5 text-slate-400">({pct}%)</span>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
