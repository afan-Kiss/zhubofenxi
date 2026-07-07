import type { AnchorTrendPoint } from './anchor-leaderboard-row'

export const INTRADAY_BUCKET_MINUTES = 30
export const INTRADAY_BUCKET_MS = INTRADAY_BUCKET_MINUTES * 60_000
/** 单日对比/卡片：单场直播约 6 小时（覆盖 4h+ 晚场） */
export const INTRADAY_COMPARE_MAX_LIVE_MINUTES = 360
export const INTRADAY_COMPARE_MAX_BUCKET_INDEX =
  Math.ceil(INTRADAY_COMPARE_MAX_LIVE_MINUTES / INTRADAY_BUCKET_MINUTES) - 1

export interface RelativeIntradayTrendPoint extends AnchorTrendPoint {
  bucketIndex: number
  relativeLabel: string
  relativeTickLabel: string
  chartValue: number
}

export function relativeBucketLabel(bucketIndex: number): string {
  const start = bucketIndex * INTRADAY_BUCKET_MINUTES
  const end = (bucketIndex + 1) * INTRADAY_BUCKET_MINUTES
  return `${start}-${end}分钟`
}

export function relativeBucketTickLabel(bucketIndex: number, compact = false): string {
  const start = bucketIndex * INTRADAY_BUCKET_MINUTES
  if (compact) return String(start)
  const end = (bucketIndex + 1) * INTRADAY_BUCKET_MINUTES
  return `${start}~${end}`
}

export function relativeBucketTooltipLabel(bucketIndex: number): string {
  return `开播后 ${relativeBucketLabel(bucketIndex)}`
}

/** 将自然时间 intraday 走势转为「开播后第 N 分钟」桶，与开播节奏对比图同源 */
export function buildRelativeIntradayTrendPoints(
  points: AnchorTrendPoint[],
  options?: { compactTicks?: boolean; maxBucketIndex?: number },
): { points: RelativeIntradayTrendPoint[]; maxBucket: number } {
  if (points.length === 0) {
    return { points: [], maxBucket: -1 }
  }

  const maxBucketIndex = options?.maxBucketIndex ?? INTRADAY_COMPARE_MAX_BUCKET_INDEX
  const firstKey = points[0]!.key
  const firstMs = Number(firstKey)
  const useTimestamp = Number.isFinite(firstMs)

  const bucketValues = new Map<number, AnchorTrendPoint>()
  let maxBucketFromRange = -1

  points.forEach((point, index) => {
    let bucketIndex = useTimestamp
      ? Math.max(0, Math.round((Number(point.key) - firstMs) / INTRADAY_BUCKET_MS))
      : index
    if (bucketIndex > maxBucketIndex) {
      bucketIndex = maxBucketIndex
    }

    maxBucketFromRange = Math.max(maxBucketFromRange, bucketIndex)
    const prev = bucketValues.get(bucketIndex)
    if (prev) {
      bucketValues.set(bucketIndex, {
        ...prev,
        value: prev.value + point.value,
        orderCount: prev.orderCount + point.orderCount,
      })
    } else {
      bucketValues.set(bucketIndex, { ...point })
    }
  })

  if (maxBucketFromRange < 0) {
    return { points: [], maxBucket: -1 }
  }

  const compact = options?.compactTicks ?? false
  const relativePoints: RelativeIntradayTrendPoint[] = []
  for (let bucketIndex = 0; bucketIndex <= maxBucketFromRange; bucketIndex++) {
    const source = bucketValues.get(bucketIndex)
    const value = source?.value ?? 0
    const orderCount = source?.orderCount ?? 0
    relativePoints.push({
      key: String(bucketIndex),
      label: relativeBucketTickLabel(bucketIndex, compact),
      bucketIndex,
      relativeLabel: relativeBucketLabel(bucketIndex),
      relativeTickLabel: relativeBucketTickLabel(bucketIndex, compact),
      value,
      orderCount,
      chartValue: value,
      date: source?.date,
      timeRange: source?.timeRange ?? relativeBucketTooltipLabel(bucketIndex),
      scheduleRange: source?.scheduleRange,
      actualRange: source?.actualRange,
    })
  }

  return { points: relativePoints, maxBucket: maxBucketFromRange }
}

export function buildRelativeIntradayCompareSeries(
  matched: Array<{ anchorName: string; trend: { points: AnchorTrendPoint[] } }>,
): {
  series: Array<{ anchorName: string; dataKey: string }>
  chartData: Array<{
    label: string
    tickLabel: string
    bucketIndex: number
    [dataKey: string]: string | number | null
  }>
  maxBucket: number
} {
  type AnchorBuckets = {
    anchorName: string
    bucketValues: Map<number, number>
    maxBucket: number
  }

  const perAnchor: AnchorBuckets[] = []

  for (const item of matched) {
    const { points, maxBucket } = buildRelativeIntradayTrendPoints(item.trend.points)
    if (maxBucket < 0) continue

    const bucketValues = new Map<number, number>()
    for (const point of points) {
      bucketValues.set(point.bucketIndex, point.value)
    }

    perAnchor.push({
      anchorName: item.anchorName,
      bucketValues,
      maxBucket,
    })
  }

  const globalMaxBucket = Math.min(
    INTRADAY_COMPARE_MAX_BUCKET_INDEX,
    perAnchor.reduce((max, item) => Math.max(max, item.maxBucket), 0),
  )

  const series = perAnchor.map((item, index) => ({
    anchorName: item.anchorName,
    dataKey: `anchor_${index}`,
  }))

  const chartData: Array<{
    label: string
    tickLabel: string
    bucketIndex: number
    [dataKey: string]: string | number | null
  }> = []

  for (let bucketIndex = 0; bucketIndex <= globalMaxBucket; bucketIndex++) {
    const row: (typeof chartData)[number] = {
      key: String(bucketIndex),
      label: relativeBucketLabel(bucketIndex),
      tickLabel: relativeBucketTickLabel(bucketIndex, false),
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

  return { series, chartData, maxBucket: globalMaxBucket }
}
