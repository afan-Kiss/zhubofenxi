import React, { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BOSS_CHART_LEGEND_STYLE,
  bossLineChartMargin,
  bossScoreYAxisWidth,
  useBossChartCompact,
} from './boss-chart-layout'

interface SeriesPoint {
  date: string
  score: number | null
}

interface Props {
  quality: SeriesPoint[]
  logistics: SeriesPoint[]
  service: SeriesPoint[]
  height?: number
}

const SERIES_META = [
  { key: 'quality' as const, name: '品质分', color: '#e11d48' },
  { key: 'logistics' as const, name: '物流分', color: '#0284c7' },
  { key: 'service' as const, name: '服务分', color: '#16a34a' },
]

function countValidPoints(rows: Array<Record<string, string | number | null>>) {
  return rows.filter((row) =>
    SERIES_META.some((s) => row[s.key] != null && Number.isFinite(Number(row[s.key]))),
  ).length
}

export const BossScoreTrendChart: React.FC<Props> = ({
  quality,
  logistics,
  service,
  height = 200,
}) => {
  const compact = useBossChartCompact()
  const data = useMemo(() => {
    const dates = new Set<string>()
    for (const row of [...quality, ...logistics, ...service]) dates.add(row.date)
    return [...dates]
      .sort()
      .map((date) => ({
        date: date.slice(5),
        fullDate: date,
        quality: quality.find((q) => q.date === date)?.score ?? null,
        logistics: logistics.find((q) => q.date === date)?.score ?? null,
        service: service.find((q) => q.date === date)?.score ?? null,
      }))
  }, [quality, logistics, service])

  const validDates = useMemo(() => countValidPoints(data), [data])

  if (data.length === 0 || validDates === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
        暂无体验分趋势
      </div>
    )
  }

  if (validDates <= 2) {
    const latest = data[data.length - 1]
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        {SERIES_META.map((s) => {
          const value = latest?.[s.key]
          return (
            <div
              key={s.key}
              className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5"
            >
              <div className="text-xs text-slate-500">{s.name}</div>
              <div className="mt-0.5 text-lg font-semibold text-slate-900">
                {value == null ? '—' : value}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {validDates === 1 ? '仅 1 个有效数据点，暂不绘制趋势图' : `${latest?.fullDate ?? ''}`}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 overflow-hidden">
      <div className="w-full min-w-0" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={bossLineChartMargin(compact)}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: compact ? 9 : 10 }}
              tickMargin={4}
              axisLine={false}
              tickLine={false}
              padding={{ left: 0, right: 0 }}
              interval="preserveStartEnd"
              minTickGap={compact ? 6 : 10}
            />
            <YAxis
              domain={[0, 5]}
              tick={{ fontSize: 10 }}
              width={bossScoreYAxisWidth(compact)}
              tickCount={5}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip wrapperStyle={{ zIndex: 20, maxWidth: compact ? 200 : undefined }} />
            <Legend
              verticalAlign="top"
              align="right"
              iconSize={8}
              wrapperStyle={BOSS_CHART_LEGEND_STYLE}
            />
            {SERIES_META.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
