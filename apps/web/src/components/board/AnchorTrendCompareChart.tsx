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
  anchorRowTrend,
  type AnchorLeaderboardRow,
  type AnchorTrendMode,
} from '../../lib/anchor-leaderboard-row'

const ANCHOR_COLORS = ['#f43f5e', '#3b82f6', '#22c55e', '#f59e0b'] as const
const MAX_ANCHORS = 4

export interface AnchorTrendCompareSeries {
  anchorName: string
  color: string
  dataKey: string
}

interface CompareChartRow {
  label: string
  key: string
  [dataKey: string]: string | number
}

function isValidAnchorRow(row: AnchorLeaderboardRow): boolean {
  const name = String(row.anchorName ?? '').trim()
  if (!name || name === '未归属') return false
  const trend = anchorRowTrend(row)
  return Boolean(trend?.points?.length)
}

function buildComparePayload(rows: AnchorLeaderboardRow[]): {
  mode: AnchorTrendMode | null
  series: AnchorTrendCompareSeries[]
  chartData: CompareChartRow[]
  skippedModeMismatch: boolean
  hasComparableData: boolean
} {
  const candidates = rows.filter(isValidAnchorRow)
  if (candidates.length === 0) {
    return {
      mode: null,
      series: [],
      chartData: [],
      skippedModeMismatch: false,
      hasComparableData: false,
    }
  }

  const referenceMode = anchorRowTrend(candidates[0]!)!.mode
  const matched: Array<{ anchorName: string; trend: NonNullable<ReturnType<typeof anchorRowTrend>> }> =
    []
  let skippedModeMismatch = false

  for (const row of candidates) {
    const trend = anchorRowTrend(row)
    if (!trend?.points?.length) continue
    if (trend.mode !== referenceMode) {
      skippedModeMismatch = true
      continue
    }
    matched.push({ anchorName: String(row.anchorName).trim(), trend })
    if (matched.length >= MAX_ANCHORS) break
  }

  if (matched.length === 0) {
    return {
      mode: referenceMode,
      series: [],
      chartData: [],
      skippedModeMismatch,
      hasComparableData: false,
    }
  }

  const keyOrder: string[] = []
  const keyLabels = new Map<string, string>()
  for (const item of matched) {
    for (const point of item.trend.points) {
      const k = point.key || point.label
      if (!keyLabels.has(k)) {
        keyOrder.push(k)
        keyLabels.set(k, point.label)
      }
    }
  }

  const series: AnchorTrendCompareSeries[] = matched.map((item, index) => ({
    anchorName: item.anchorName,
    color: ANCHOR_COLORS[index] ?? ANCHOR_COLORS[ANCHOR_COLORS.length - 1]!,
    dataKey: `anchor_${index}`,
  }))

  const chartData: CompareChartRow[] = keyOrder.map((key) => {
    const row: CompareChartRow = {
      key,
      label: keyLabels.get(key) ?? key,
    }
    for (let i = 0; i < matched.length; i++) {
      const item = matched[i]!
      const point = item.trend.points.find((p) => (p.key || p.label) === key)
      row[`anchor_${i}`] = point?.value ?? 0
    }
    return row
  })

  const hasComparableData = chartData.some((row) =>
    series.some((s) => Number(row[s.dataKey] ?? 0) > 0),
  )

  return {
    mode: referenceMode,
    series,
    chartData,
    skippedModeMismatch,
    hasComparableData,
  }
}

function CompareTooltip({
  active,
  payload,
  label,
  series,
  formatMoney,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ dataKey?: string | number; value?: unknown; color?: string }> | undefined
  label?: string | number
  series: AnchorTrendCompareSeries[]
  formatMoney: (n: number) => string
}) {
  if (!active || !payload?.length) return null

  const entries = series
    .map((s) => {
      const hit = payload.find((p) => String(p.dataKey ?? '') === s.dataKey)
      return {
        anchorName: s.anchorName,
        color: s.color,
        value: Number(hit?.value ?? 0),
      }
    })
    .sort((a, b) => b.value - a.value)

  return (
    <div className="rounded-lg border border-rose-100 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-800">{String(label ?? '')}</p>
      <ul className="mt-1.5 space-y-1">
        {entries.map((entry) => (
          <li key={entry.anchorName} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.anchorName}
            </span>
            <span className="font-medium tabular-nums text-slate-800">
              {formatMoney(entry.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface AnchorTrendCompareChartProps {
  rows: AnchorLeaderboardRow[]
  formatMoney: (value: number) => string
  className?: string
}

export const AnchorTrendCompareChart: React.FC<AnchorTrendCompareChartProps> = ({
  rows,
  formatMoney,
  className = '',
}) => {
  const { mode, series, chartData, skippedModeMismatch, hasComparableData } = useMemo(
    () => buildComparePayload(rows),
    [rows],
  )

  const xInterval = useMemo(() => {
    const len = chartData.length
    if (len <= 12) return 0
    if (len <= 24) return 1
    return Math.ceil(len / 10)
  }, [chartData.length])

  if (!hasComparableData || series.length === 0) {
    return (
      <div
        data-anchor-trend-compare="empty"
        className={`flex min-h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-rose-100 bg-white/70 px-3 py-6 md:min-h-[220px] ${className}`}
      >
        <p className="text-[13px] text-slate-500">暂无可对比走势</p>
        <p className="mt-1 text-[11px] text-slate-400">有主播成交后会自动生成对比曲线</p>
      </div>
    )
  }

  const subtitle =
    mode === 'intraday'
      ? '按当前查询范围内的直播时间/排班时间统计'
      : '按当前查询范围内每日销售额统计'

  return (
    <div
      data-anchor-trend-compare="ready"
      className={`rounded-2xl border border-rose-100 bg-white/80 p-3 shadow-sm shadow-rose-50/40 md:p-4 ${className}`}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium text-slate-700 md:text-[14px]">主播销售走势对比</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>
        </div>
        {skippedModeMismatch ? (
          <p className="max-w-[200px] text-right text-[10px] leading-snug text-amber-600">
            部分主播走势口径不同，已自动跳过
          </p>
        ) : null}
      </div>

      <div className="h-[220px] w-full md:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 4, right: 8, left: -12, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              interval={xInterval}
              minTickGap={20}
            />
            <YAxis hide domain={[0, (max: number) => Math.max(max, 1)]} />
            <Tooltip
              content={({ active, payload, label }) => (
                <CompareTooltip
                  active={active}
                  payload={payload}
                  label={label}
                  series={series}
                  formatMoney={formatMoney}
                />
              )}
            />
            <Legend
              verticalAlign="bottom"
              height={28}
              iconType="circle"
              iconSize={8}
              formatter={(value: string) => {
                const hit = series.find((s) => s.dataKey === value)
                return (
                  <span className="text-[11px] text-slate-600">{hit?.anchorName ?? value}</span>
                )
              }}
            />
            {series.map((s) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.dataKey}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3.5, fill: s.color, stroke: '#fff', strokeWidth: 1 }}
                isAnimationActive
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
