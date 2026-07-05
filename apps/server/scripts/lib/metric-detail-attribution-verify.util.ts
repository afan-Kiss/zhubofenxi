/**
 * 经营总览 metric drawer 归属验收工具（只读）
 */
import { buildBoardMetricDetail } from '../../src/services/board-metric-detail.service'
import type { BoardMetricKey } from '../../src/services/board-metric-detail.service'
import {
  getBoardScopedViewsForRange,
} from '../../src/services/board-scoped-views.service'
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

export async function fetchMetricDetailRows(params: {
  metric: BoardMetricKey
  startDate: string
  endDate: string
}): Promise<BoardDrillOrderRow[]> {
  const allRows: BoardDrillOrderRow[] = []
  let page = 1
  const pageSize = 100
  while (true) {
    const detail = await buildBoardMetricDetail({
      metric: params.metric,
      preset: 'custom',
      startDate: params.startDate,
      endDate: params.endDate,
      page,
      pageSize,
      role: 'super_admin',
      username: 'verify-script',
    })
    allRows.push(...detail.rows)
    if (page >= detail.pagination.totalPages) break
    page++
  }
  return allRows
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

export async function verifyMetricDrawerAttribution(params: {
  startDate: string
  endDate: string
  metrics: BoardMetricKey[]
}): Promise<{
  mismatches: Array<{
    metric: string
    orderNo: string
    rowAnchor: string
    expectedAnchor: string
    liveAccountName: string
  }>
}> {
  const expectedMap = await buildRemappedAnchorMap(params)
  const allMismatches: Array<{
    metric: string
    orderNo: string
    rowAnchor: string
    expectedAnchor: string
    liveAccountName: string
  }> = []

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

  return { mismatches: allMismatches }
}
