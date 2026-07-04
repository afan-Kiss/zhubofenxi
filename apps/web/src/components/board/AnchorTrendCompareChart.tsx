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
const INTRADAY_BUCKET_MINUTES = 30
const BUCKET_MS = INTRADAY_BUCKET_MINUTES * 60_000

export interface AnchorTrendCompareSeries {
  anchorName: string
  color: string
  dataKey: string
}

interface CompareChartRow {
  label: string
  key: string
  bucketIndex: number
  [dataKey: string]: string | number | null
}

function isValidAnchorRow(row: AnchorLeaderboardRow): boolean {
  const name = String(row.anchorName ?? '').trim()
  if (!name || name === '未归属') return false
  const trend = anchorRowTrend(row)
  return Boolean(trend?.points?.length)
}

function relativeBucketLabel(bucketIndex: number): string {
  const start = bucketIndex * INTRADAY_BUCKET_MINUTES
  const end = (bucketIndex + 1) * INTRADAY_BUCKET_MINUTES
  return `${start}-${end}分钟`
}

function relativeBucketTooltipLabel(bucketIndex: number): string {
  return `开播后 ${relativeBucketLabel(bucketIndex)}`
}

function buildDailyComparePayload(
  matched: Array<{ anchorName: string; trend: NonNullable<ReturnType<typeof anchorRowTrend>> }>,
): { series: AnchorTrendCompareSeries[]; chartData: CompareChartRow[] } {
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

  const chartData: CompareChartRow[] = keyOrder.map((key, bucketIndex) => {
    const row: CompareChartRow = {
      key,
      label: keyLabels.get(key) ?? key,
      bucketIndex,
    }
    for (let i = 0; i < matched.length; i++) {
      const item = matched[i]!
      const point = item.trend.points.find((p) => (p.key || p.label) === key)
      row[`anchor_${i}`] = point?.value ?? 0
    }
    return row
  })

  return { series, chartData }
}

function buildIntradayRelativeComparePayload(
  matched: Array<{ anchorName: string; trend: NonNullable<ReturnType<typeof anchorRowTrend>> }>,
): { series: AnchorTrendCompareSeries[]; chartData: CompareChartRow[] } {
  type AnchorBuckets = {
    anchorName: string
    bucketValues: Map<number, number>
    maxBucket: number
  }

  const perAnchor: AnchorBuckets[] = []

  for (const item of matched) {
    const points = item.trend.points
    if (points.length === 0) continue

    const firstKey = points[0]!.key
    const firstMs = Number(firstKey)
    const useTimestamp = Number.isFinite(firstMs)

    const bucketValues = new Map<number, number>()
    let maxBucket = 0

    points.forEach((point, index) => {
      const bucketIndex = useTimestamp
        ? Math.max(0, Math.round((Number(point.key) - firstMs) / BUCKET_MS))
        : index
      maxBucket = Math.max(maxBucket, bucketIndex)
      bucketValues.set(bucketIndex, (bucketValues.get(bucketIndex) ?? 0) + point.value)
    })

    perAnchor.push({
      anchorName: item.anchorName,
      bucketValues,
      maxBucket,
    })
  }

  const globalMaxBucket = perAnchor.reduce((max, item) => Math.max(max, item.maxBucket), 0)

  const series: AnchorTrendCompareSeries[] = perAnchor.map((item, index) => ({
    anchorName: item.anchorName,
    color: ANCHOR_COLORS[index] ?? ANCHOR_COLORS[ANCHOR_COLORS.length - 1]!,
    dataKey: `anchor_${index}`,
  }))

  const chartData: CompareChartRow[] = []
  for (let bucketIndex = 0; bucketIndex <= globalMaxBucket; bucketIndex++) {
    const row: CompareChartRow = {
      key: String(bucketIndex),
      label: relativeBucketLabel(bucketIndex),
      bucketIndex,
    }
    for (let i = 0; i < perAnchor.length; i++) {
      const item = perAnchor[i]!
      if (bucketIndex > item.maxBucket) {
        row[`anchor_${i}`] = null
      } else {
        row[`anchor_${i}`] = item.bucketValues.get(bucketIndex) ?? 0
      }
    }
    chartData.push(row)
  }

  return { series, chartData }
}

function buildComparePayload(rows: AnchorLeaderboardRow[]): {
  mode: AnchorTrendMode | null
  series: AnchorTrendCompareSeries[]
  chartData: CompareChartRow[]
  skippedModeMismatch: boolean
  hasComparableData: boolean
  isRelativeIntraday: boolean
} {
  const candidates = rows.filter(isValidAnchorRow)
  if (candidates.length === 0) {
    return {
      mode: null,
      series: [],
      chartData: [],
      skippedModeMismatch: false,
      hasComparableData: false,
      isRelativeIntraday: false,
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
      isRelativeIntraday: false,
    }
  }

  const isRelativeIntraday = referenceMode === 'intraday'
  const { series, chartData } = isRelativeIntraday
    ? buildIntradayRelativeComparePayload(matched)
    : buildDailyComparePayload(matched)

  const hasComparableData = chartData.some((row) =>
    series.some((s) => {
      const v = row[s.dataKey]
      return v != null && Number(v) > 0
    }),
  )

  return {
    mode: referenceMode,
    series,
    chartData,
    skippedModeMismatch,
    hasComparableData,
    isRelativeIntraday,
  }
}

function CompareTooltip({
  active,
  payload,
  label,
  series,
  formatMoney,
  isRelativeIntraday,
  bucketIndex,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ dataKey?: string | number; value?: unknown; color?: string }> | undefined
  label?: string | number
  series: AnchorTrendCompareSeries[]
  formatMoney: (n: number) => string
  isRelativeIntraday: boolean
  bucketIndex?: number
}) {
  if (!active || !payload?.length) return null

  const title =
    isRelativeIntraday && bucketIndex != null
      ? relativeBucketTooltipLabel(bucketIndex)
      : String(label ?? '')

  const entries = series.map((s) => {
    const hit = payload.find((p) => String(p.dataKey ?? '') === s.dataKey)
    const raw = hit?.value
    const isNull = raw == null || raw === ''
    return {
      anchorName: s.anchorName,
      color: s.color,
      isNull,
      value: isNull ? null : Number(raw),
    }
  })

  return (
    <div className="rounded-lg border border-rose-100 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-slate-800">{title}</p>
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
              {entry.isNull ? '未到该时长' : formatMoney(entry.value ?? 0)}
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
  const { series, chartData, skippedModeMismatch, hasComparableData, isRelativeIntraday } =
    useMemo(() => buildComparePayload(rows), [rows])

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

  const title = isRelativeIntraday ? '主播开播后成交节奏对比' : '主播每日销售走势对比'
  const subtitle = isRelativeIntraday
    ? '按「开播后第几分钟」对齐，不按自然时间'
    : '按日期对比每日销售额'

  return (
    <div
      data-anchor-trend-compare="ready"
      className={`rounded-2xl border border-rose-100 bg-white/80 p-3 shadow-sm shadow-rose-50/40 md:p-4 ${className}`}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium text-slate-700 md:text-[14px]">{title}</p>
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
              content={({ active, payload, label }) => {
                const bucketIndex =
                  typeof payload?.[0]?.payload?.bucketIndex === 'number'
                    ? payload[0]!.payload.bucketIndex
                    : chartData.find((r) => r.label === label)?.bucketIndex
                return (
                  <CompareTooltip
                    active={active}
                    payload={payload}
                    label={label}
                    series={series}
                    formatMoney={formatMoney}
                    isRelativeIntraday={isRelativeIntraday}
                    bucketIndex={bucketIndex}
                  />
                )
              }}
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
                connectNulls={false}
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
