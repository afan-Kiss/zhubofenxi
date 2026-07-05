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

/** @deprecated use fetchMetricDetailBundle */
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
        metric: '',
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

export async function verifyAnchorMetricDrawer(params: {
  startDate: string
  endDate: string
  metric: BoardMetricKey
  anchorName: string
  mustInclude?: string[]
  mustExclude?: string[]
}): Promise<string[]> {
  const fails: string[] = []
  const bundle = await fetchMetricDetailBundle({
    metric: params.metric,
    startDate: params.startDate,
    endDate: params.endDate,
    anchorName: params.anchorName,
  })
  const { rows, summary, paginationTotal } = bundle

  for (const row of rows) {
    const rowAnchor = row.anchorName?.trim() || '未归属'
    if (rowAnchor !== params.anchorName) {
      fails.push(
        `${params.anchorName} drawer: ${row.orderNo || row.packageId} anchor=${rowAnchor}`,
      )
    }
  }

  if (paginationTotal !== rows.length) {
    fails.push(
      `${params.anchorName} drawer: pagination.total=${paginationTotal} rows=${rows.length}`,
    )
  }

  const rowAmountSum = rows.reduce((sum, r) => sum + (r.actualDealAmount ?? 0), 0)
  if (Math.abs(summary.valueRaw - rowAmountSum) > 0.02) {
    fails.push(
      `${params.anchorName} drawer: valueRaw=${summary.valueRaw} rowSum=${rowAmountSum.toFixed(2)}`,
    )
  }

  for (const orderNo of params.mustInclude ?? []) {
    if (!orderInRows(rows, orderNo)) {
      fails.push(`${params.anchorName} drawer 缺少 ${orderNo}`)
    }
  }
  for (const orderNo of params.mustExclude ?? []) {
    if (orderInRows(rows, orderNo)) {
      fails.push(`${params.anchorName} drawer 不应包含 ${orderNo}`)
    }
  }

  return fails
}

export async function verifyMetricDrawerAttribution(params: {
  startDate: string
  endDate: string
  metrics: BoardMetricKey[]
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
}> {
  const expectedMap = await buildRemappedAnchorMap(params)
  const allMismatches: Array<{
    metric: string
    orderNo: string
    rowAnchor: string
    expectedAnchor: string
    liveAccountName: string
  }> = []
  const anchorFails: string[] = []

  for (const metric of params.metrics) {
    const rows = await fetchMetricDetailRows({
      metric,
      startDate: params.startDate,
      endDate: params.endDate,
    })
    const mismatches = compareDrawerRowsToRemap(rows, expectedMap)
    for (const m of mismatches) {
      allMismatches.push({ ...m, metric })
    }
  }

  if (params.anchorNames?.length) {
    for (const anchorName of params.anchorNames) {
      const mustInclude =
        anchorName === '小白'
          ? ['P798535644148309221']
          : anchorName === '小艺'
            ? ['P798440490066093751']
            : undefined
      const mustExclude =
        anchorName === '子杰'
          ? ['P798535644148309221', 'P798440490066093751']
          : undefined
      const fails = await verifyAnchorMetricDrawer({
        startDate: params.startDate,
        endDate: params.endDate,
        metric: 'effectiveGmv',
        anchorName,
        mustInclude,
        mustExclude,
      })
      anchorFails.push(...fails)
    }
  }

  return { mismatches: allMismatches, anchorFails }
}
