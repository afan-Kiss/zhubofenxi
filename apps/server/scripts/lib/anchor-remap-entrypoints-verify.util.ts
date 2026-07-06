/**
 * 主播归属 remap 入口一致性验收（只读，不改库）
 */
import type { AnalyzedOrderView } from '../../src/types/analysis'
import { executeBoardLocalQuery } from '../../src/services/board-local-query.service'
import { buildAnchorDrill } from '../../src/services/board-drill.service'
import {
  filterViewsByAnchorSpec,
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from '../../src/services/board-scoped-views.service'
import { filterViewsForCoreMetrics } from '../../src/services/metrics-exclusion.service'
import { calculateBusinessMetrics } from '../../src/services/business-metrics.service'
import { isValidRevenueOrder } from '../../src/services/valid-revenue-order.service'
import { resolveMetricOrderNo } from '../../src/services/calc-refund-rate.service'
import {
  ANCHOR_DRAWER_NAMES,
  buildRemappedAnchorMap,
  fetchMetricDetailBundle,
} from './metric-detail-attribution-verify.util'

export const REMAP_VERIFY_ANCHORS = [...ANCHOR_DRAWER_NAMES] as const

export const FOCUS_ORDERS = [
  'P798535644148309221',
  'P798524075193091331',
  'P798440490066093751',
  'P798440753968049541',
] as const

const ANCHOR_MUST_INCLUDE: Partial<Record<(typeof REMAP_VERIFY_ANCHORS)[number], string[]>> = {
  小白: ['P798535644148309221'],
  小艺: ['P798524075193091331', 'P798440490066093751'],
}

const ANCHOR_MUST_EXCLUDE: Partial<Record<(typeof REMAP_VERIFY_ANCHORS)[number], string[]>> = {
  子杰: ['P798535644148309221', 'P798524075193091331', 'P798440490066093751'],
}

export function orderKeys(orderNo: string): string[] {
  const bare = orderNo.replace(/^P/, '')
  return [orderNo, bare, `P${bare}`]
}

export function viewMatchesOrderNo(view: AnalyzedOrderView, orderNo: string): boolean {
  const keys = new Set(orderKeys(orderNo))
  return [view.orderId, view.packageId, view.matchOrderId, resolveMetricOrderNo(view)]
    .filter(Boolean)
    .some((k) => keys.has(String(k)))
}

export function findViewByOrderNo(
  views: AnalyzedOrderView[],
  orderNo: string,
): AnalyzedOrderView | undefined {
  return views.find((v) => viewMatchesOrderNo(v, orderNo))
}

function metricNum(v: unknown): number {
  return Number(v ?? 0)
}

function summaryEffectiveGmv(summary: Record<string, unknown>): number {
  return metricNum(summary.effectiveGmv ?? summary.validSalesAmount)
}

function summaryOrderCount(summary: Record<string, unknown>): number {
  return metricNum(summary.orderCount ?? summary.paidOrderCount)
}

export async function verifyLocalQueryAnchorRemap(params: {
  startDate: string
  endDate: string
  anchorName?: string
}): Promise<string[]> {
  const fails: string[] = []
  const label = params.anchorName ? `localQuery/${params.anchorName}` : 'localQuery/store'

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    role: 'super_admin',
    username: 'verify-script',
  })
  const scopedAllViews = filterViewsForCoreMetrics(scoped.views)
  const hasAnchorFilter = Boolean(params.anchorName?.trim())

  const expectedPerformanceViews = await getAnchorPerformanceViews(
    scopedAllViews,
    scoped.rawByMatch,
    undefined,
    hasAnchorFilter ? params.anchorName : undefined,
  )
  const expectedSummary = calculateBusinessMetrics(expectedPerformanceViews)

  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    anchorName: params.anchorName,
    role: 'super_admin',
    username: 'verify-script',
  })

  const perfSummary = local.anchorPerformanceSummary as Record<string, unknown>
  const topSummary = hasAnchorFilter
    ? (local.summary as Record<string, unknown>)
    : (local.summary as Record<string, unknown>)

  if (
    Math.abs(summaryEffectiveGmv(perfSummary) - expectedSummary.validSalesAmount) > 0.02
  ) {
    fails.push(
      `${label}: anchorPerformanceSummary.effectiveGmv=${summaryEffectiveGmv(perfSummary)} expected=${expectedSummary.validSalesAmount}`,
    )
  }
  if (Math.abs(summaryOrderCount(perfSummary) - expectedSummary.orderCount) > 0.01) {
    fails.push(
      `${label}: anchorPerformanceSummary.orderCount=${summaryOrderCount(perfSummary)} expected=${expectedSummary.orderCount}`,
    )
  }

  if (hasAnchorFilter) {
    if (
      Math.abs(summaryEffectiveGmv(topSummary) - expectedSummary.validSalesAmount) > 0.02
    ) {
      fails.push(
        `${label}: summary.effectiveGmv=${summaryEffectiveGmv(topSummary)} expected=${expectedSummary.validSalesAmount}`,
      )
    }
    if (Math.abs(summaryOrderCount(topSummary) - expectedSummary.orderCount) > 0.01) {
      fails.push(
        `${label}: summary.orderCount=${summaryOrderCount(topSummary)} expected=${expectedSummary.orderCount}`,
      )
    }
    if (local.ordersTotal !== expectedPerformanceViews.length) {
      fails.push(
        `${label}: ordersTotal=${local.ordersTotal} expectedViews=${expectedPerformanceViews.length}`,
      )
    }

    const preRemapFiltered = filterViewsByAnchorSpec(scopedAllViews, undefined, params.anchorName)
    const focusWouldDrop = FOCUS_ORDERS.filter((orderNo) => {
      const inPost = Boolean(findViewByOrderNo(expectedPerformanceViews, orderNo))
      const inPre = Boolean(findViewByOrderNo(preRemapFiltered, orderNo))
      return inPost && !inPre
    })
    if (focusWouldDrop.length > 0) {
      for (const orderNo of focusWouldDrop) {
        if (!findViewByOrderNo(expectedPerformanceViews, orderNo)) {
          fails.push(`${label}: remap 后应包含 ${orderNo} 但未找到`)
        }
      }
      const buggyWouldMiss = focusWouldDrop.some(
        (orderNo) => !findViewByOrderNo(preRemapFiltered, orderNo),
      )
      if (
        buggyWouldMiss &&
        Math.abs(summaryEffectiveGmv(topSummary) - expectedSummary.validSalesAmount) > 0.02
      ) {
        fails.push(
          `${label}: 疑似 remap 前主播过滤（focus 订单 remap 前被剔除且 summary 与 remap 后不一致）`,
        )
      }
    }

    for (const orderNo of ANCHOR_MUST_INCLUDE[params.anchorName!] ?? []) {
      if (!findViewByOrderNo(expectedPerformanceViews, orderNo)) {
        fails.push(`${label}: remap 后订单池缺少 ${orderNo}`)
      }
    }
    for (const orderNo of ANCHOR_MUST_EXCLUDE[params.anchorName!] ?? []) {
      if (findViewByOrderNo(expectedPerformanceViews, orderNo)) {
        fails.push(`${label}: remap 后订单池不应包含 ${orderNo}`)
      }
    }
  }

  return fails
}

function countEffectiveGmvViews(views: AnalyzedOrderView[]): number {
  return views.filter((v) => isValidRevenueOrder(v)).length
}

export async function verifyAnchorEntrypointPoolConsistency(params: {
  startDate: string
  endDate: string
  anchorName: string
}): Promise<string[]> {
  const fails: string[] = []
  const label = params.anchorName

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    role: 'super_admin',
    username: 'verify-script',
  })
  const scopedAllViews = filterViewsForCoreMetrics(scoped.views)
  const performanceViews = await getAnchorPerformanceViews(
    scopedAllViews,
    scoped.rawByMatch,
    undefined,
    params.anchorName,
  )
  const perfMetrics = calculateBusinessMetrics(performanceViews)
  const expectedEffectiveRows = countEffectiveGmvViews(performanceViews)

  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    anchorName: params.anchorName,
    role: 'super_admin',
    username: 'verify-script',
  })
  const localPerf = local.anchorPerformanceSummary as Record<string, unknown>
  const localTop = local.summary as Record<string, unknown>

  const metricDetail = await fetchMetricDetailBundle({
    metric: 'effectiveGmv',
    startDate: params.startDate,
    endDate: params.endDate,
    anchorName: params.anchorName,
  })

  const drill = await buildAnchorDrill({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    anchorName: params.anchorName,
    page: 1,
    pageSize: 5000,
    role: 'super_admin',
    username: 'verify-script',
  })
  const drillStats = drill.stats as Record<string, unknown> | null

  const localGmv = summaryEffectiveGmv(localTop)
  const perfGmv = summaryEffectiveGmv(localPerf)
  const drawerGmv = metricDetail.summary.valueRaw
  const drawerRows = metricDetail.rows.length
  const drillGmv = metricNum(drillStats?.effectiveGmv ?? drillStats?.validSalesAmount)

  if (Math.abs(localGmv - drawerGmv) > 0.02) {
    fails.push(`${label}: localQuery.summary.effectiveGmv=${localGmv} drawer=${drawerGmv}`)
  }
  if (Math.abs(perfGmv - drawerGmv) > 0.02) {
    fails.push(`${label}: localQuery.anchorPerformanceSummary.effectiveGmv=${perfGmv} drawer=${drawerGmv}`)
  }
  if (drillStats && Math.abs(drillGmv - drawerGmv) > 0.02) {
    fails.push(`${label}: buildAnchorDrill.effectiveGmv=${drillGmv} drawer=${drawerGmv}`)
  }
  if (Math.abs(perfMetrics.validSalesAmount - drawerGmv) > 0.02) {
    fails.push(`${label}: performanceViews.validSalesAmount=${perfMetrics.validSalesAmount} drawer=${drawerGmv}`)
  }

  if (drawerRows !== expectedEffectiveRows) {
    fails.push(
      `${label}: drawer.effectiveGmv rows=${drawerRows} performanceViews有效成交=${expectedEffectiveRows}`,
    )
  }
  if (metricDetail.paginationTotal !== drawerRows) {
    fails.push(`${label}: drawer pagination.total=${metricDetail.paginationTotal} rows=${drawerRows}`)
  }

  return fails
}

export async function verifyAnchorRemapEntrypoints(params: {
  startDate: string
  endDate: string
}): Promise<{
  fails: string[]
  storeEffectiveGmv: number
  storeEffectiveCount: number
  expectedMap: Map<string, string>
}> {
  const fails: string[] = []

  const expectedMap = await buildRemappedAnchorMap(params)

  fails.push(...(await verifyLocalQueryAnchorRemap(params)))

  for (const anchorName of REMAP_VERIFY_ANCHORS) {
    fails.push(
      ...(await verifyLocalQueryAnchorRemap({
        startDate: params.startDate,
        endDate: params.endDate,
        anchorName,
      })),
    )
    fails.push(
      ...(await verifyAnchorEntrypointPoolConsistency({
        startDate: params.startDate,
        endDate: params.endDate,
        anchorName,
      })),
    )
  }

  const storeDrawer = await fetchMetricDetailBundle({
    metric: 'effectiveGmv',
    startDate: params.startDate,
    endDate: params.endDate,
  })
  const storeEffectiveGmv = storeDrawer.summary.valueRaw
  const storeEffectiveCount = storeDrawer.rows.length

  if (Math.abs(storeEffectiveGmv - 31432) > 0.02) {
    fails.push(`全店 effectiveGmv=${storeEffectiveGmv} 期望 31432`)
  }
  if (storeEffectiveCount !== 16) {
    fails.push(`全店 effectiveGmv 有效成交笔数=${storeEffectiveCount} 期望 16`)
  }

  const localStore = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    role: 'super_admin',
    username: 'verify-script',
  })
  const storeSummary = localStore.summary as Record<string, unknown>
  if (Math.abs(summaryEffectiveGmv(storeSummary) - storeEffectiveGmv) > 0.02) {
    fails.push(
      `全店 localQuery.summary.effectiveGmv=${summaryEffectiveGmv(storeSummary)} drawer=${storeEffectiveGmv}`,
    )
  }

  console.log('\n=== 重点订单 remap 期望 ===')
  for (const orderNo of FOCUS_ORDERS) {
    const expected =
      expectedMap.get(orderNo) ??
      expectedMap.get(orderNo.replace(/^P/, '')) ??
      '—'
    console.log(`  ${orderNo} → ${expected}`)
  }

  return { fails, storeEffectiveGmv, storeEffectiveCount, expectedMap }
}

export async function verifyFocusOrdersInPools(params: {
  startDate: string
  endDate: string
  expectedMap: Map<string, string>
}): Promise<string[]> {
  const fails: string[] = []
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    role: 'super_admin',
    username: 'verify-script',
  })
  const scopedAllViews = filterViewsForCoreMetrics(scoped.views)
  const storeEffective = await fetchMetricDetailBundle({
    metric: 'effectiveGmv',
    startDate: params.startDate,
    endDate: params.endDate,
  })

  for (const orderNo of FOCUS_ORDERS) {
    const expected =
      params.expectedMap.get(orderNo) ??
      params.expectedMap.get(orderNo.replace(/^P/, '')) ??
      '—'
    if (expected === '—' || expected === '未归属') continue

    const perfViews = await getAnchorPerformanceViews(
      scopedAllViews,
      scoped.rawByMatch,
      undefined,
      expected,
    )
    if (!findViewByOrderNo(perfViews, orderNo)) {
      fails.push(`${orderNo} 应在 executeBoardLocalQuery/${expected} remap 后订单池，但未找到`)
    }

    const inStoreEffective = storeEffective.rows.some((r) =>
      orderKeys(orderNo).includes(r.orderNo || r.packageId || ''),
    )
    const drawer = await fetchMetricDetailBundle({
      metric: 'effectiveGmv',
      startDate: params.startDate,
      endDate: params.endDate,
      anchorName: expected,
    })
    const inAnchorDrawer = drawer.rows.some((r) =>
      orderKeys(orderNo).includes(r.orderNo || r.packageId || ''),
    )
    if (inStoreEffective && !inAnchorDrawer) {
      fails.push(`${orderNo} 在全店 effectiveGmv 中，但 ${expected} drawer 缺失`)
    }

    for (const anchorName of REMAP_VERIFY_ANCHORS) {
      if (anchorName === expected) continue
      const otherPerf = await getAnchorPerformanceViews(
        scopedAllViews,
        scoped.rawByMatch,
        undefined,
        anchorName,
      )
      if (findViewByOrderNo(otherPerf, orderNo)) {
        fails.push(`${orderNo} 不应在 executeBoardLocalQuery/${anchorName} remap 后订单池`)
      }
    }
  }

  return fails
}
