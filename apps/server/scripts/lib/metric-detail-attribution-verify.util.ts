/**
 * 经营总览 metric drawer 归属验收工具（只读）
 */
import { buildBoardMetricDetail } from '../../src/services/board-metric-detail.service'
import type { BoardMetricKey } from '../../src/services/board-metric-detail.service'
import { getBoardScopedViewsForRange } from '../../src/services/board-scoped-views.service'
import { attachRawByMatchToViews } from '../../src/services/low-price-brush-order.service'
import { remapViewsWithScheduleOverlay } from '../../src/services/anchor-schedule-attribution.service'
import { filterViewsForCoreMetrics } from '../../src/services/metrics-exclusion.service'
import { resolveMetricOrderNo } from '../../src/services/calc-refund-rate.service'
import type { BoardDrillOrderRow } from '../../src/services/order-row-mapper.service'

/** 经营总览 metric drawer 全量验收指标 */
export const DRAWER_VERIFY_METRICS: BoardMetricKey[] = [
  'effectiveGmv',
  'gmv',
  'orderCount',
  'returnAmount',
  'returnCount',
  'returnRate',
  'qualityReturnCount',
  'signedCount',
  'signRate',
  'freightRefundAmount',
]

export const ANCHOR_DRAWER_NAMES = ['子杰', '小白', '小艺'] as const

export const ANCHOR_MUST_INCLUDE: Partial<Record<(typeof ANCHOR_DRAWER_NAMES)[number], string[]>> = {
  小艺: ['P798524075193091331', 'P798440490066093751'],
}

export const ANCHOR_MUST_EXCLUDE: Partial<Record<(typeof ANCHOR_DRAWER_NAMES)[number], string[]>> = {
  子杰: ['P798535644148309221', 'P798524075193091331', 'P798440490066093751'],
}

type MetricValueMode = 'amount' | 'count' | 'rate'

function metricValueMode(metric: BoardMetricKey): MetricValueMode {
  if (metric === 'returnRate' || metric === 'signRate' || metric === 'qualityReturnRate') {
    return 'rate'
  }
  if (
    metric === 'orderCount' ||
    metric === 'returnCount' ||
    metric === 'qualityReturnCount' ||
    metric === 'signedCount'
  ) {
    return 'count'
  }
  return 'amount'
}

export function sumDrawerRowMetricValue(rows: BoardDrillOrderRow[], metric: BoardMetricKey): number {
  switch (metric) {
    case 'effectiveGmv':
      return rows.reduce((s, r) => s + (r.actualDealAmount ?? 0), 0)
    case 'gmv':
      return rows.reduce((s, r) => s + (r.payAmount ?? 0), 0)
    case 'returnAmount':
      return rows.reduce((s, r) => s + (r.productRefundAmount ?? 0), 0)
    case 'freightRefundAmount':
      return rows.reduce((s, r) => s + (r.freightRefundAmount ?? 0), 0)
    case 'orderCount':
    case 'returnCount':
    case 'qualityReturnCount':
    case 'signedCount':
      return rows.length
    default:
      return 0
  }
}

function registerOrderKey(
  map: Map<string, string>,
  orderNo: string | undefined,
  anchorName: string,
): void {
  if (!orderNo) return
  map.set(orderNo, anchorName)
  if (orderNo.startsWith('P')) map.set(orderNo.slice(1), anchorName)
  else map.set(`P${orderNo}`, anchorName)
}

export async function buildRemappedAnchorMap(params: {
  startDate: string
  endDate: string
}): Promise<Map<string, string>> {
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    role: 'super_admin',
    username: 'verify-script',
  })
  const coreViews = filterViewsForCoreMetrics(scoped.views)
  const remapped = await remapViewsWithScheduleOverlay(
    attachRawByMatchToViews(coreViews, scoped.rawByMatch),
  )
  const map = new Map<string, string>()
  for (const view of remapped) {
    const anchorName = view.anchorName?.trim() || '未归属'
    registerOrderKey(map, resolveMetricOrderNo(view), anchorName)
    registerOrderKey(map, view.packageId, anchorName)
    registerOrderKey(map, view.orderId, anchorName)
    registerOrderKey(map, view.matchOrderId, anchorName)
  }
  return map
}

export async function fetchMetricDetailBundle(params: {
  metric: BoardMetricKey
  startDate: string
  endDate: string
  anchorName?: string
  anchorId?: string
}): Promise<{
  rows: BoardDrillOrderRow[]
  summary: {
    valueRaw: number
    matchedOrders: number
  }
  paginationTotal: number
}> {
  const allRows: BoardDrillOrderRow[] = []
  let summary: { valueRaw: number; matchedOrders: number } | null = null
  let paginationTotal = 0
  let page = 1
  const pageSize = 100
  while (true) {
    const detail = await buildBoardMetricDetail({
      metric: params.metric,
      preset: 'custom',
      startDate: params.startDate,
      endDate: params.endDate,
      anchorName: params.anchorName,
      anchorId: params.anchorId,
      page,
      pageSize,
      role: 'super_admin',
      username: 'verify-script',
    })
    if (!summary) {
      summary = {
        valueRaw: detail.summary.valueRaw,
        matchedOrders: detail.summary.matchedOrders,
      }
      paginationTotal = detail.pagination.total
    }
    allRows.push(...detail.rows)
    if (page >= detail.pagination.totalPages) break
    page++
  }
  return { rows: allRows, summary: summary!, paginationTotal }
}

export async function fetchMetricDetailRows(params: {
  metric: BoardMetricKey
  startDate: string
  endDate: string
  anchorName?: string
}): Promise<BoardDrillOrderRow[]> {
  const bundle = await fetchMetricDetailBundle(params)
  return bundle.rows
}

export function compareDrawerRowsToRemap(
  rows: BoardDrillOrderRow[],
  expectedMap: Map<string, string>,
  metric = '',
): Array<{
  metric: string
  orderNo: string
  rowAnchor: string
  expectedAnchor: string
  liveAccountName: string
}> {
  const mismatches: Array<{
    metric: string
    orderNo: string
    rowAnchor: string
    expectedAnchor: string
    liveAccountName: string
  }> = []
  for (const row of rows) {
    const orderNo = row.orderNo || row.packageId || row.orderId || ''
    const expected =
      expectedMap.get(orderNo) ??
      expectedMap.get(orderNo.replace(/^P/, '')) ??
      expectedMap.get(orderNo.startsWith('P') ? orderNo : `P${orderNo}`)
    if (!expected) continue
    const rowAnchor = row.anchorName?.trim() || '未归属'
    if (rowAnchor !== expected) {
      mismatches.push({
        metric,
        orderNo,
        rowAnchor,
        expectedAnchor: expected,
        liveAccountName: row.liveAccountName ?? '—',
      })
    }
  }
  return mismatches
}

function orderInRows(rows: BoardDrillOrderRow[], orderNo: string): boolean {
  const keys = [orderNo, orderNo.replace(/^P/, '')]
  return rows.some((r) => keys.includes(r.orderNo || r.packageId || ''))
}

function orderInRemapPool(map: Map<string, string>, orderNo: string): boolean {
  return (
    map.has(orderNo) ||
    map.has(orderNo.replace(/^P/, '')) ||
    map.has(orderNo.startsWith('P') ? orderNo : `P${orderNo}`)
  )
}

export async function verifyAnchorMetricDrawer(params: {
  startDate: string
  endDate: string
  metric: BoardMetricKey
  anchorName: string
  mustInclude?: string[]
  mustExclude?: string[]
  remappedAnchorMap?: Map<string, string>
}): Promise<string[]> {
  const fails: string[] = []
  const bundle = await fetchMetricDetailBundle({
    metric: params.metric,
    startDate: params.startDate,
    endDate: params.endDate,
    anchorName: params.anchorName,
  })
  const { rows, summary, paginationTotal } = bundle
  const label = `${params.anchorName}/${params.metric}`

  for (const row of rows) {
    const rowAnchor = row.anchorName?.trim() || '未归属'
    if (rowAnchor !== params.anchorName) {
      fails.push(`${label}: ${row.orderNo || row.packageId} anchor=${rowAnchor}`)
    }
  }

  if (paginationTotal !== rows.length) {
    fails.push(`${label}: pagination.total=${paginationTotal} rows=${rows.length}`)
  }

  const mode = metricValueMode(params.metric)
  if (mode === 'amount') {
    const rowSum = sumDrawerRowMetricValue(rows, params.metric)
    if (Math.abs(summary.valueRaw - rowSum) > 0.02) {
      fails.push(`${label}: valueRaw=${summary.valueRaw} rowSum=${rowSum.toFixed(2)}`)
    }
  } else if (mode === 'count') {
    if (Math.abs(summary.valueRaw - rows.length) > 0.01) {
      fails.push(`${label}: valueRaw=${summary.valueRaw} rowCount=${rows.length}`)
    }
  }

  for (const orderNo of params.mustInclude ?? []) {
    if (!orderInRows(rows, orderNo)) {
      if (params.remappedAnchorMap && !orderInRemapPool(params.remappedAnchorMap, orderNo)) {
        continue
      }
      fails.push(`${label} 缺少 ${orderNo}`)
    }
  }
  for (const orderNo of params.mustExclude ?? []) {
    if (orderInRows(rows, orderNo)) {
      fails.push(`${label} 不应包含 ${orderNo}`)
    }
  }

  return fails
}

export async function verifyMetricDrawerAttribution(params: {
  startDate: string
  endDate: string
  metrics?: BoardMetricKey[]
  anchorNames?: string[]
}): Promise<{
  mismatches: Array<{
    metric: string
    orderNo: string
    rowAnchor: string
    expectedAnchor: string
    liveAccountName: string
  }>
  anchorFails: string[]
  storeSummary: Array<{ metric: string; valueRaw: number; rows: number }>
}> {
  const metrics = params.metrics ?? DRAWER_VERIFY_METRICS
  const expectedMap = await buildRemappedAnchorMap(params)
  const allMismatches: Array<{
    metric: string
    orderNo: string
    rowAnchor: string
    expectedAnchor: string
    liveAccountName: string
  }> = []
  const anchorFails: string[] = []
  const storeSummary: Array<{ metric: string; valueRaw: number; rows: number }> = []

  for (const metric of metrics) {
    const bundle = await fetchMetricDetailBundle({
      metric,
      startDate: params.startDate,
      endDate: params.endDate,
    })
    storeSummary.push({
      metric,
      valueRaw: bundle.summary.valueRaw,
      rows: bundle.rows.length,
    })
    const mismatches = compareDrawerRowsToRemap(bundle.rows, expectedMap, metric)
    allMismatches.push(...mismatches)
  }

  const anchorNames = params.anchorNames ?? [...ANCHOR_DRAWER_NAMES]
  for (const anchorName of anchorNames) {
    for (const metric of metrics) {
      const mustInclude =
        metric === 'effectiveGmv' ? ANCHOR_MUST_INCLUDE[anchorName as keyof typeof ANCHOR_MUST_INCLUDE] : undefined
      const mustExclude =
        metric === 'effectiveGmv' ? ANCHOR_MUST_EXCLUDE[anchorName as keyof typeof ANCHOR_MUST_EXCLUDE] : undefined
      const fails = await verifyAnchorMetricDrawer({
        startDate: params.startDate,
        endDate: params.endDate,
        metric,
        anchorName,
        mustInclude,
        mustExclude,
        remappedAnchorMap: expectedMap,
      })
      anchorFails.push(...fails)
    }
  }

  return { mismatches: allMismatches, anchorFails, storeSummary }
}
