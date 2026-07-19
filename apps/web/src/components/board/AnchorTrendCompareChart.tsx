import React, { useEffect, useMemo, useState } from 'react'
import { formatAnchorDisplayName } from '../../lib/anchor-display-name'
import { resolveAnchorColor } from '../../lib/anchor-theme'
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
  anchorRowGmv,
  anchorRowPaidCount,
  anchorRowTrend,
  type AnchorLeaderboardRow,
  type AnchorTrendMode,
} from '../../lib/anchor-leaderboard-row'
import {
  buildRelativeIntradayCompareSeries,
  INTRADAY_COMPARE_MAX_BUCKET_INDEX,
  relativeBucketTickLabel,
  relativeBucketTooltipLabel,
} from '../../lib/anchor-intraday-trend.util'

export { INTRADAY_COMPARE_MAX_BUCKET_INDEX }

type CompareMatchedRow = {
  anchorName: string
  color: string
  trend: NonNullable<ReturnType<typeof anchorRowTrend>>
}

function rowAnchorColor(row: AnchorLeaderboardRow): string {
  return resolveAnchorColor({
    id: typeof row.anchorId === 'string' ? row.anchorId : null,
    name: typeof row.anchorName === 'string' ? row.anchorName : null,
    color: typeof row.color === 'string' ? row.color : null,
  })
}

export interface AnchorTrendCompareSeries {
  anchorName: string
  color: string
  dataKey: string
}

interface CompareChartRow {
  label: string
  tickLabel: string
  key: string
  bucketIndex: number
  [dataKey: string]: string | number | null
}

function useCompactChart(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)').matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const sync = () => setCompact(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return compact
}

function computeXTickInterval(len: number, compact: boolean, isIntraday: boolean): number {
  if (len <= 1) return 0
  const targetTicks = compact ? (isIntraday ? 4 : 5) : isIntraday ? 8 : 10
  if (len <= targetTicks) return 0
  return Math.max(1, Math.ceil(len / targetTicks) - 1)
}

function hasPositiveTrendPoint(row: AnchorLeaderboardRow): boolean {
  const trend = anchorRowTrend(row)
  if (!trend?.points?.length) return false
  return trend.points.some((p) => p.value > 0 || p.orderCount > 0)
}

function hasTrendPoints(row: AnchorLeaderboardRow): boolean {
  const trend = anchorRowTrend(row)
  return Boolean(trend?.points?.length)
}

function isValidCompareRow(row: AnchorLeaderboardRow, includeZeroPerformance: boolean): boolean {
  const name = String(row.anchorName ?? '').trim()
  if (!name || name === '未归属') return false
  return includeZeroPerformance ? hasTrendPoints(row) : hasPositiveTrendPoint(row)
}

export function sortCompareCandidates(
  rows: AnchorLeaderboardRow[],
  options?: { includeZeroPerformance?: boolean },
): AnchorLeaderboardRow[] {
  const includeZeroPerformance = options?.includeZeroPerformance ?? false
  return rows
    .filter((row) => isValidCompareRow(row, includeZeroPerformance))
    .sort((a, b) => anchorRowGmv(b) - anchorRowGmv(a))
}

export function defaultCompareAnchorNames(
  rows: AnchorLeaderboardRow[],
  options?: { includeZeroPerformance?: boolean },
): string[] {
  return sortCompareCandidates(rows, options).map((row) => String(row.anchorName).trim())
}

function buildDailyComparePayload(
  matched: CompareMatchedRow[],
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
    color: item.color,
    dataKey: `anchor_${index}`,
  }))

  const chartData: CompareChartRow[] = keyOrder.map((key, bucketIndex) => {
    const label = keyLabels.get(key) ?? key
    const row: CompareChartRow = {
      key,
      label,
      tickLabel: label.length > 5 ? label.slice(5) : label,
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

export function buildIntradayRelativeComparePayload(
  matched: CompareMatchedRow[],
): { series: AnchorTrendCompareSeries[]; chartData: CompareChartRow[] } {
  const { series: rawSeries, chartData: rawChartData } = buildRelativeIntradayCompareSeries(matched)

  const series: AnchorTrendCompareSeries[] = rawSeries.map((item, index) => ({
    anchorName: item.anchorName,
    color: matched[index]?.color ?? resolveAnchorColor({ name: item.anchorName }),
    dataKey: item.dataKey,
  }))

  const chartData: CompareChartRow[] = rawChartData.map((row) => ({
    ...row,
    key: String(row.bucketIndex),
  }))

  return { series, chartData }
}

function buildComparePayload(
  rows: AnchorLeaderboardRow[],
  selectedNames: string[],
  includeZeroPerformance = false,
): {
  mode: AnchorTrendMode | null
  series: AnchorTrendCompareSeries[]
  chartData: CompareChartRow[]
  skippedModeMismatch: boolean
  hasComparableData: boolean
  isRelativeIntraday: boolean
} {
  const sortedCandidates = sortCompareCandidates(rows, { includeZeroPerformance })
  if (sortedCandidates.length === 0) {
    return {
      mode: null,
      series: [],
      chartData: [],
      skippedModeMismatch: false,
      hasComparableData: false,
      isRelativeIntraday: false,
    }
  }

  const selectedSet = new Set(selectedNames)
  const candidates = sortedCandidates.filter((row) =>
    selectedSet.has(String(row.anchorName).trim()),
  )

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
  const matched: CompareMatchedRow[] = []
  let skippedModeMismatch = false

  for (const row of candidates) {
    const trend = anchorRowTrend(row)
    if (!trend?.points?.length) continue
    if (trend.mode !== referenceMode) {
      skippedModeMismatch = true
      continue
    }
    matched.push({
      anchorName: String(row.anchorName).trim(),
      color: rowAnchorColor(row),
      trend,
    })
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

  const hasComparableData = series.length > 0 && chartData.length > 0

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
              {formatAnchorDisplayName(entry.anchorName)}
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
  formatCount?: (value: number) => string
  className?: string
  /** page=交互页；report=日报长图（无筛选、无动画） */
  variant?: 'page' | 'report'
  /** 单日业绩：无成交主播也参与对比 */
  includeZeroPerformance?: boolean
}

export const AnchorTrendCompareChart: React.FC<AnchorTrendCompareChartProps> = ({
  rows,
  formatMoney,
  formatCount = (value) => `${value} 单`,
  className = '',
  variant = 'page',
  includeZeroPerformance: includeZeroPerformanceProp,
}) => {
  const isReport = variant === 'report'
  const includeZeroPerformance = includeZeroPerformanceProp ?? isReport
  const compact = useCompactChart() || isReport
  const sortedCandidates = useMemo(
    () => sortCompareCandidates(rows, { includeZeroPerformance }),
    [rows, includeZeroPerformance],
  )
  const defaultSelectedKey = useMemo(
    () => defaultCompareAnchorNames(rows, { includeZeroPerformance }).join('|'),
    [rows, includeZeroPerformance],
  )
  const [selectedNames, setSelectedNames] = useState<string[]>(() =>
    defaultCompareAnchorNames(rows, { includeZeroPerformance }),
  )

  useEffect(() => {
    setSelectedNames(defaultCompareAnchorNames(rows, { includeZeroPerformance }))
  }, [defaultSelectedKey, rows, includeZeroPerformance])

  const { series, chartData, skippedModeMismatch, hasComparableData, isRelativeIntraday } =
    useMemo(
      () => buildComparePayload(rows, selectedNames, includeZeroPerformance),
      [rows, selectedNames, includeZeroPerformance],
    )

  const chartDataWithTicks = useMemo(
    () =>
      isRelativeIntraday && compact
        ? chartData.map((row) => ({
            ...row,
            tickLabel: relativeBucketTickLabel(row.bucketIndex, true),
          }))
        : chartData,
    [chartData, compact, isRelativeIntraday],
  )

  const xInterval = useMemo(
    () => computeXTickInterval(chartData.length, compact, isRelativeIntraday),
    [chartData.length, compact, isRelativeIntraday],
  )

  const toggleAnchor = (name: string) => {
    setSelectedNames((prev) => {
      if (prev.includes(name)) {
        if (prev.length <= 1) return prev
        return prev.filter((item) => item !== name)
      }
      return [...prev, name]
    })
  }

  if (!hasComparableData || series.length === 0) {
    return (
      <div
        data-anchor-trend-compare="empty"
        className={`flex ${isReport ? 'min-h-[120px]' : 'min-h-[140px] md:min-h-[160px]'} flex-col items-center justify-center rounded-2xl border border-dashed border-rose-100 bg-white/70 px-3 py-4 ${className}`}
      >
        <p className="text-[13px] text-slate-500">暂无可对比走势</p>
        {!isReport ? (
          <p className="mt-1 text-[11px] text-slate-400">
            {includeZeroPerformance
              ? '请先设置排班或同步直播场次后再查看对比'
              : '有主播成交后会自动生成对比曲线'}
          </p>
        ) : null}
      </div>
    )
  }

  const title = isRelativeIntraday ? '主播开播后支付金额节奏对比' : '主播每日支付金额走势对比'
  const subtitle = isRelativeIntraday
    ? isReport
        ? '按开播后分钟对齐，单场最多 360 分钟'
        : compact
          ? '按开播后分钟对齐，单场最多 360 分钟'
          : '按「开播后第几分钟」对齐（单场约 6 小时），不按自然时间'
    : '按日期对比每日支付金额，不是已签收金额'

  const xAxisKey = compact ? 'tickLabel' : 'label'
  const chartHeightClass = isReport ? 'h-[188px]' : compact ? 'h-[160px]' : 'h-[160px] md:h-[180px]'
  const chartMargin = isReport
    ? { top: 4, right: 20, left: -10, bottom: 6 }
    : {
        top: 4,
        right: compact ? 4 : 8,
        left: compact ? -18 : -12,
        bottom: compact ? 2 : 0,
      }
  const xAxisAngle = isReport ? 0 : compact ? -35 : 0
  const xAxisTextAnchor = isReport ? 'middle' : compact ? 'end' : 'middle'
  const xAxisHeight = isReport ? 24 : compact ? 48 : 30

  return (
    <div
      data-anchor-trend-compare="ready"
      className={`rounded-2xl border border-rose-100 bg-white/80 ${isReport ? 'p-3' : 'p-3 shadow-sm shadow-rose-50/40 md:p-4'} ${className}`}
    >
      <div className={`mb-2 flex flex-wrap items-start justify-between gap-2 ${isReport ? '' : ''}`}>
        <div>
          <p className={`${isReport ? 'text-[13px]' : 'text-[13px] md:text-[14px]'} font-medium text-slate-700`}>
            {title}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p>
          {!isReport ? (
            <p className="mt-0.5 text-[10px] text-slate-400">
              {includeZeroPerformance
                ? '单日展示全部固定主播，无成交显示平线；可手动隐藏不想看的主播'
                : '默认展示全部有走势的主播，可手动隐藏不想看的主播'}
            </p>
          ) : null}
        </div>
        {!isReport && skippedModeMismatch ? (
          <p className="max-w-[200px] text-right text-[10px] leading-snug text-amber-600">
            部分主播走势口径不同，已自动跳过
          </p>
        ) : null}
      </div>

      {!isReport && sortedCandidates.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {sortedCandidates.map((row) => {
            const name = String(row.anchorName).trim()
            const checked = selectedNames.includes(name)
            const dotColor = checked ? rowAnchorColor(row) : '#cbd5e1'
            return (
              <label
                key={name}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
                  checked
                    ? 'border-rose-200 bg-rose-50 text-rose-800'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => toggleAnchor(name)}
                />
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: dotColor }}
                />
                <span className="font-medium">{name}</span>
                <span className="tabular-nums text-slate-500">
                  {formatMoney(anchorRowGmv(row))} / {formatCount(anchorRowPaidCount(row))}
                </span>
              </label>
            )
          })}
        </div>
      ) : null}

      <div className={`w-full ${chartHeightClass}${isReport ? ' overflow-visible' : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartDataWithTicks}
            margin={chartMargin}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" vertical={false} />
            <XAxis
              dataKey={xAxisKey}
              tick={{ fontSize: compact ? 9 : 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              interval={xInterval}
              minTickGap={isReport ? 10 : compact ? 8 : 20}
              angle={xAxisAngle}
              textAnchor={xAxisTextAnchor}
              height={xAxisHeight}
              padding={isReport ? { left: 10, right: 18 } : undefined}
            />
            <YAxis hide domain={[0, (max: number) => Math.max(max, 1)]} />
            <Tooltip
              content={({ active, payload, label }) => {
                const bucketIndex =
                  typeof payload?.[0]?.payload?.bucketIndex === 'number'
                    ? payload[0]!.payload.bucketIndex
                    : chartDataWithTicks.find((r) => r.label === label || r.tickLabel === label)
                        ?.bucketIndex
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
              height={compact ? 36 : 28}
              wrapperStyle={compact ? { fontSize: 10, lineHeight: '14px' } : undefined}
              iconType="circle"
              iconSize={8}
              formatter={(value: string) => {
                const hit = series.find((s) => s.dataKey === value)
                return (
                  <span className="text-[11px] text-slate-600">
                    {formatAnchorDisplayName(hit?.anchorName ?? value)}
                  </span>
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
                strokeWidth={isReport ? 2.5 : 2}
                dot={false}
                connectNulls={isReport}
                activeDot={isReport ? false : { r: 3.5, fill: s.color, stroke: '#fff', strokeWidth: 1 }}
                isAnimationActive={!isReport}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
