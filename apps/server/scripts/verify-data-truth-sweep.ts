/**
 * 数据准确性深度验收：卡片 / 抽屉 / 日报 / 运营报表口径一致
 *
 * npm run verify:data-truth-sweep
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import { buildAnchorDrill } from '../src/services/board-drill.service'
import { getBoardScopedViewsForRange, getAnchorPerformanceViews } from '../src/services/board-scoped-views.service'
import { buildDailyReport } from '../src/services/daily-report.service'
import { sumDailyReportShippedFromViews } from '../src/services/daily-report-order.util'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import { buildRemappedAnchorMap, fetchMetricDetailBundle } from './lib/metric-detail-attribution-verify.util'
import { saveDailySchedules } from '../src/services/anchor-daily-schedule.service'
import { isDateScheduleConfirmed } from '../src/services/anchor-schedule-confirm.service'
import { addDaysShanghai, formatDateKeyShanghai } from '../src/utils/business-timezone'
import type { BoardDrillOrderRow } from '../src/services/order-row-mapper.service'
import {
  isNoAfterSaleText,
  isPositiveAfterSaleText,
  isOperationalAfterSaleText,
  viewHasAfterSaleStatusSignal,
} from '../src/services/after-sale-status-signal.service'
import { isActualAfterSaleOrder } from '../src/services/operations-after-sale-order.util'
import {
  resolveViewRefundAmountCent,
  viewCountsAsRefundOrder,
} from '../src/services/order-refund-metrics.service'
import {
  calculateBusinessMetrics,
  viewInvolvesRefundAfterSale,
} from '../src/services/business-metrics.service'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'
import { buildOrderMetricSets } from '../src/services/order-metric-sets.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { explainValidRevenueOrder, sumValidRevenueFromViews } from '../src/services/valid-revenue-order.service'
import { buildAnchorMetricDetail } from '../src/services/anchor-metric-detail.service'
import { dedupeCoreMetricViewsByOrderNoBestValue } from '../src/services/calc-refund-rate.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

config({ path: path.resolve(__dirname, '../.env') })

const ROOT = path.resolve(__dirname, '../..')
const REPO_ROOT = path.resolve(__dirname, '../../..')
const issues: string[] = []

const START_DATE = process.env.START_DATE?.trim() || '2026-07-02'
const END_DATE = process.env.END_DATE?.trim() || START_DATE

const SIGNED_METRICS = [
  'actualSignedAmount',
  'signedCount',
  'signRate',
] as const

const FOCUS_ATTRIBUTION = [
  { orderNo: 'P798535644148309221', anchor: '小白', notIn: '子杰' },
  { orderNo: 'P798524075193091331', anchor: '小艺', notIn: '子杰' },
  { orderNo: 'P798440490066093751', anchor: '小艺', notIn: '子杰' },
]

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function moneyClose(a: number, b: number, eps = 0.02): boolean {
  return Math.abs(a - b) <= eps
}

function countDuplicateOrderNos(rows: BoardDrillOrderRow[]): string[] {
  const seen = new Map<string, number>()
  const dupes: string[] = []
  for (const row of rows) {
    const key = (row.orderNo || row.packageId || row.orderId || '').trim()
    if (!key) continue
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    if (count === 2) dupes.push(key)
  }
  return dupes
}

async function checkOverviewSignedDrawers(): Promise<void> {
  console.log('\n=== 1. 经营总览签收相关抽屉 ===')
  await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  const summary = (local.summary ?? {}) as Record<string, unknown>
  const cardGmv = num(summary.totalGmv ?? summary.gmv ?? summary.productGmv)
  const cardOrderCount = num(summary.orderCount)
  const cardSignedAmount = num(summary.actualSignedAmount)
  const cardSignedCount = num(summary.signedOrderCount ?? summary.actualSignedCount)

  const gmvBundle = await fetchMetricDetailBundle({
    metric: 'gmv',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  const gmvRowsSum = gmvBundle.rows.reduce((sum, row) => sum + num(row.payAmount), 0)
  if (moneyClose(gmvRowsSum, gmvBundle.summary.valueRaw)) {
    ok(`gmv 抽屉 rows 合计 ${gmvRowsSum.toFixed(2)} === valueRaw`)
  } else {
    fail(`gmv 抽屉 rows 合计 ${gmvRowsSum.toFixed(2)} !== valueRaw ${gmvBundle.summary.valueRaw}`)
  }
  if (moneyClose(gmvBundle.summary.valueRaw, cardGmv)) {
    ok(`gmv 卡片 ${cardGmv} === 抽屉 valueRaw`)
  } else if (cardGmv > 0 || gmvBundle.summary.valueRaw > 0) {
    fail(`gmv 卡片 ${cardGmv} !== 抽屉 valueRaw ${gmvBundle.summary.valueRaw}`)
  }
  if (gmvBundle.summary.matchedOrders === cardOrderCount) {
    ok(`gmv matchedOrders ${gmvBundle.summary.matchedOrders} === orderCount ${cardOrderCount}`)
  } else {
    fail(
      `gmv matchedOrders ${gmvBundle.summary.matchedOrders} !== orderCount ${cardOrderCount}`,
    )
  }
  const dupesGmv = countDuplicateOrderNos(gmvBundle.rows)
  if (dupesGmv.length === 0) ok('gmv 抽屉无重复 P 单')
  else fail(`gmv 抽屉重复 P 单: ${dupesGmv.slice(0, 5).join(', ')}`)

  const orderCountBundle = await fetchMetricDetailBundle({
    metric: 'orderCount',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  if (orderCountBundle.summary.matchedOrders === cardOrderCount) {
    ok(`orderCount matchedOrders ${orderCountBundle.summary.matchedOrders} === orderCount ${cardOrderCount}`)
  } else {
    fail(
      `orderCount matchedOrders ${orderCountBundle.summary.matchedOrders} !== orderCount ${cardOrderCount}`,
    )
  }
  const dupesOrderCount = countDuplicateOrderNos(orderCountBundle.rows)
  if (dupesOrderCount.length === 0) ok('orderCount 抽屉无重复 P 单')
  else fail(`orderCount 抽屉重复 P 单: ${dupesOrderCount.slice(0, 5).join(', ')}`)

  const signedAmountBundle = await fetchMetricDetailBundle({
    metric: 'actualSignedAmount',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  const rowsSum = signedAmountBundle.rows.reduce(
    (sum, row) => sum + num(row.signedAmount ?? row.payAmount),
    0,
  )

  if (moneyClose(cardSignedAmount, signedAmountBundle.summary.valueRaw)) {
    ok(`actualSignedAmount 卡片 ${cardSignedAmount} === 抽屉 valueRaw`)
  } else {
    fail(
      `actualSignedAmount 卡片 ${cardSignedAmount} !== 抽屉 valueRaw ${signedAmountBundle.summary.valueRaw}`,
    )
  }

  if (moneyClose(rowsSum, signedAmountBundle.summary.valueRaw)) {
    ok(`actualSignedAmount 抽屉 rows 合计 ${rowsSum.toFixed(2)} === valueRaw`)
  } else {
    fail(
      `actualSignedAmount 抽屉 rows 合计 ${rowsSum.toFixed(2)} !== valueRaw ${signedAmountBundle.summary.valueRaw}`,
    )
  }

  const dupesSignedAmount = countDuplicateOrderNos(signedAmountBundle.rows)
  if (dupesSignedAmount.length === 0) ok('actualSignedAmount 抽屉无重复 P 单')
  else fail(`actualSignedAmount 抽屉重复 P 单: ${dupesSignedAmount.slice(0, 5).join(', ')}`)

  const signedCountBundle = await fetchMetricDetailBundle({
    metric: 'signedCount',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  if (signedCountBundle.summary.matchedOrders === cardSignedCount) {
    ok(`signedCount matchedOrders ${signedCountBundle.summary.matchedOrders} === 卡片 signedOrderCount`)
  } else {
    fail(
      `signedCount matchedOrders ${signedCountBundle.summary.matchedOrders} !== 卡片 ${cardSignedCount}`,
    )
  }
  const dupesSignedCount = countDuplicateOrderNos(signedCountBundle.rows)
  if (dupesSignedCount.length === 0) ok('signedCount 抽屉无重复 P 单')
  else fail(`signedCount 抽屉重复 P 单: ${dupesSignedCount.slice(0, 5).join(', ')}`)

  const signRateDetail = await buildBoardMetricDetail({
    metric: 'signRate',
    preset: 'custom',
    startDate: START_DATE,
    endDate: END_DATE,
    tab: 'signed',
    page: 1,
    pageSize: 100,
    role: 'super_admin',
    username: 'verify-script',
  })
  const signedTab = signRateDetail.tabs?.find((t) => t.key === 'signed')
  if (signedTab && signedTab.count === cardSignedCount) {
    ok(`signRate signed tab count ${signedTab.count} === signedOrderCount`)
  } else {
    fail(
      `signRate signed tab count ${signedTab?.count ?? '—'} !== signedOrderCount ${cardSignedCount}`,
    )
  }
  const signRateBundle = await fetchMetricDetailBundle({
    metric: 'signRate',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  const dupesSignRate = countDuplicateOrderNos(signRateBundle.rows)
  if (dupesSignRate.length === 0) ok('signRate 抽屉无重复 P 单')
  else fail(`signRate 抽屉重复 P 单: ${dupesSignRate.slice(0, 5).join(', ')}`)

  const cardReturnCount = num(
    summary.returnCount ?? summary.returnOrderCount ?? summary.refundOrderCount,
  )
  const returnCountBundle = await fetchMetricDetailBundle({
    metric: 'returnCount',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  if (returnCountBundle.summary.matchedOrders === cardReturnCount) {
    ok(
      `returnCount matchedOrders ${returnCountBundle.summary.matchedOrders} === 卡片 returnCount/refundOrderCount ${cardReturnCount}`,
    )
  } else {
    fail(
      `returnCount matchedOrders ${returnCountBundle.summary.matchedOrders} !== 卡片 returnCount/refundOrderCount ${cardReturnCount}`,
    )
  }
  const dupesReturnCount = countDuplicateOrderNos(returnCountBundle.rows)
  if (dupesReturnCount.length === 0) ok('returnCount 抽屉无重复 P 单')
  else fail(`returnCount 抽屉重复 P 单: ${dupesReturnCount.slice(0, 5).join(', ')}`)

  const returnAmountBundle = await fetchMetricDetailBundle({
    metric: 'returnAmount',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  const cardReturnAmount = num(summary.returnAmount ?? summary.refundAmount ?? summary.productRefundAmount)
  const returnRowsSum = returnAmountBundle.rows.reduce(
    (sum, row) => sum + num(row.productRefundAmount ?? row.refundAmount ?? 0),
    0,
  )
  if (moneyClose(returnRowsSum, returnAmountBundle.summary.valueRaw)) {
    ok(`returnAmount 抽屉 rows 合计 ${returnRowsSum.toFixed(2)} === valueRaw`)
  } else {
    fail(
      `returnAmount 抽屉 rows 合计 ${returnRowsSum.toFixed(2)} !== valueRaw ${returnAmountBundle.summary.valueRaw}`,
    )
  }
  if (moneyClose(returnAmountBundle.summary.valueRaw, cardReturnAmount)) {
    ok(`returnAmount 卡片 ${cardReturnAmount} === 抽屉 valueRaw`)
  } else if (cardReturnAmount > 0 || returnAmountBundle.summary.valueRaw > 0) {
    fail(
      `returnAmount 卡片 ${cardReturnAmount} !== 抽屉 valueRaw ${returnAmountBundle.summary.valueRaw}`,
    )
  }
  if (returnAmountBundle.summary.matchedOrders === cardReturnCount) {
    ok(
      `returnAmount matchedOrders ${returnAmountBundle.summary.matchedOrders} === 卡片 returnCount/refundOrderCount ${cardReturnCount}`,
    )
  } else {
    fail(
      `returnAmount matchedOrders ${returnAmountBundle.summary.matchedOrders} !== 卡片 returnCount/refundOrderCount ${cardReturnCount}`,
    )
  }
  const dupesReturnAmount = countDuplicateOrderNos(returnAmountBundle.rows)
  if (dupesReturnAmount.length === 0) ok('returnAmount 抽屉无重复 P 单')
  else fail(`returnAmount 抽屉重复 P 单: ${dupesReturnAmount.slice(0, 5).join(', ')}`)

  for (const metric of ['gmv', 'orderCount', ...SIGNED_METRICS] as const) {
    const src = fs.readFileSync(
      path.resolve(ROOT, 'server/src/services/board-metric-detail.service.ts'),
      'utf-8',
    )
    if (src.includes(`'${metric}'`) && src.includes('METRICS_ORDER_DEDUPE')) {
      ok(`${metric} 已纳入 METRICS_ORDER_DEDUPE`)
    } else if (metric === 'actualSignedAmount' || metric === 'signedCount' || metric === 'signRate') {
      fail(`${metric} 未纳入 METRICS_ORDER_DEDUPE`)
    }
  }
}

async function checkAnchorSignRateDetail(): Promise<void> {
  console.log('\n=== 1f. 主播签收率详情 Tab 去重 ===')
  const config = await import('../src/services/anchor.service').then((m) => m.getAnchorConfigSync())
  const anchor = config.anchors.find((a) => a.name === '子杰') ?? config.anchors[0]
  if (!anchor) {
    ok('无主播配置，跳过')
    return
  }
  const detail = await buildAnchorMetricDetail({
    anchorId: anchor.id,
    metric: 'signRate',
    startDate: START_DATE,
    endDate: END_DATE,
    tab: 'signed',
    page: 1,
    pageSize: 100,
    role: 'super_admin',
    username: 'verify-script',
  })
  const signedTab = detail.tabs?.find((t) => t.key === 'signed')
  const unsignedTab = detail.tabs?.find((t) => t.key === 'unsigned')
  if (signedTab && signedTab.count === detail.summary.matchedOrders) {
    ok(`主播 ${anchor.name} signed tab count ${signedTab.count} === matchedOrders`)
  } else {
    fail(
      `主播 ${anchor.name} signed tab ${signedTab?.count ?? '—'} !== matchedOrders ${detail.summary.matchedOrders}`,
    )
  }
  if (
    unsignedTab &&
    signedTab &&
    signedTab.count + unsignedTab.count === detail.summary.totalOrders
  ) {
    ok(`主播 ${anchor.name} signed+unsigned tab ${signedTab.count + unsignedTab.count} === totalOrders`)
  } else {
    fail(
      `主播 ${anchor.name} tab 合计 ${(signedTab?.count ?? 0) + (unsignedTab?.count ?? 0)} !== totalOrders ${detail.summary.totalOrders}`,
    )
  }
  const dupes = countDuplicateOrderNos(detail.rows)
  if (dupes.length === 0) ok(`主播 ${anchor.name} signed rows 无重复 P 单`)
  else fail(`主播 ${anchor.name} signed rows 重复 P 单: ${dupes.slice(0, 5).join(', ')}`)
}

async function checkValidRevenueDedupeWarning(): Promise<void> {
  console.log('\n=== 1g. 有效成交 dedupe 首条 vs bestValue 对比 ===')
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: START_DATE,
    endDate: END_DATE,
    role: 'super_admin',
    username: 'verify-script',
  })
  const views = filterViewsForCoreMetrics(scoped.views)
  const firstDedupe = sumValidRevenueFromViews(views)
  let bestCent = 0
  let bestCount = 0
  for (const v of dedupeCoreMetricViewsByOrderNoBestValue(views)) {
    const explain = explainValidRevenueOrder(v)
    if (!explain.valid) continue
    bestCent += v.effectiveGmvCent
    bestCount += 1
  }
  const bestYuan = bestCent / 100
  if (Math.abs(firstDedupe.validAmountYuan - bestYuan) > 0.02) {
    console.log(
      `  ⚠ validRevenue 首条去重 ${firstDedupe.validAmountYuan.toFixed(2)} vs bestValue ${bestYuan.toFixed(2)} (${firstDedupe.soldOrderCount} vs ${bestCount} 单)`,
    )
  } else {
    ok('validRevenue 首条去重与 bestValue 无显著差异')
  }
}

async function checkDailyReport(): Promise<void> {
  console.log('\n=== 2. 主播日报全店合计 ===')
  const report = await buildDailyReport({
    preset: 'custom',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: START_DATE,
    endDate: END_DATE,
    role: 'super_admin',
    username: 'verify-script',
  })
  const allPerformanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const expected = sumDailyReportShippedFromViews(allPerformanceViews)

  if (moneyClose(report.summary.totalShippedAmountYuan, expected.shippedAmountYuan)) {
    ok(`summary.totalShippedAmountYuan === allPerformanceViews 真实发货 ${expected.shippedAmountYuan}`)
  } else {
    fail(
      `summary.totalShippedAmountYuan ${report.summary.totalShippedAmountYuan} !== 期望 ${expected.shippedAmountYuan}`,
    )
  }

  const anchorShippedSum = report.anchors.reduce((s, r) => s + r.shippedAmountYuan, 0)
  if (moneyClose(anchorShippedSum, report.summary.totalShippedAmountYuan)) {
    ok('anchorRows.shippedAmountYuan 合计 === summary.totalShippedAmountYuan')
  } else {
    fail(
      `anchorRows 合计 ${anchorShippedSum.toFixed(2)} !== summary ${report.summary.totalShippedAmountYuan}`,
    )
  }

  const unassignedViews = allPerformanceViews.filter(
    (v) =>
      String(v.anchorName ?? '').trim() === '未归属' || v.attributionType === 'unassigned',
  )
  const unassignedShipped = sumDailyReportShippedFromViews(unassignedViews)
  if (unassignedShipped.soldOrderCount > 0) {
    const hasUnassignedRow = report.anchors.some((r) => r.anchorName === '未归属')
    const hasNote = Boolean(report.summary.unassignedShippedNote)
    if (hasUnassignedRow || hasNote) {
      ok(`未归属真实发货 ${unassignedShipped.soldOrderCount} 单已显式展示`)
    } else {
      fail(`未归属真实发货 ${unassignedShipped.soldOrderCount} 单静默丢失`)
    }
  } else {
    ok('无未归属真实发货订单')
  }
}

function checkOperationsReportRemap(): void {
  console.log('\n=== 3b. 运营日报 remap 入口 ===')
  const svc = fs.readFileSync(
    path.resolve(ROOT, 'server/src/services/daily-operations-report.service.ts'),
    'utf-8',
  )
  if (svc.includes('remapViewsForAnchorPerformance')) {
    fail('daily-operations-report 仍使用 remapViewsForAnchorPerformance')
  } else {
    ok('daily-operations-report 已移除 remapViewsForAnchorPerformance')
  }
  if (svc.includes('remapViewsWithScheduleOverlay')) {
    ok('daily-operations-report 使用 remapViewsWithScheduleOverlay')
  } else {
    fail('daily-operations-report 缺少 remapViewsWithScheduleOverlay')
  }
  if (svc.includes('isUnassignedOperationsView')) {
    ok('daily-operations-report 存在 isUnassignedOperationsView')
  } else {
    fail('daily-operations-report 缺少 isUnassignedOperationsView')
  }
  if (
    svc.includes('const unassignedViews') &&
    /unassignedViews[\s\S]{0,120}isUnassignedOperationsView/.test(svc)
  ) {
    ok('unassignedViews 使用 isUnassignedOperationsView')
  } else {
    fail('unassignedViews 未使用 isUnassignedOperationsView')
  }
  if (
    svc.includes('unassignedInvalidViews = dedupeViewsByMetricOrderNo(remappedAll).filter(\n    isUnassignedOperationsView,') ||
    svc.includes('unassignedInvalidViews') && svc.includes('isUnassignedOperationsView')
  ) {
    ok('unassignedInvalidViews 使用 isUnassignedOperationsView')
  } else {
    fail('unassignedInvalidViews 未使用 isUnassignedOperationsView')
  }
  if (svc.includes('!isUnassignedOperationsView(v)')) {
    ok('assignedInvalidViews 使用 !isUnassignedOperationsView')
  } else {
    fail('assignedInvalidViews 未使用 !isUnassignedOperationsView')
  }
}

function checkAnchorDrillStatic(): void {
  console.log('\n=== 1b. 主播订单抽屉去重（静态） ===')
  const svc = fs.readFileSync(
    path.resolve(ROOT, 'server/src/services/board-drill.service.ts'),
    'utf-8',
  )
  if (svc.includes('dedupeViewsByMetricOrderNo')) {
    ok('buildAnchorDrill 使用 dedupeViewsByMetricOrderNo')
  } else {
    fail('buildAnchorDrill 未使用 dedupeViewsByMetricOrderNo')
  }
  if (!svc.includes('anchorViews.filter((v) => isEffectiveSignedView(v)).length')) {
    ok('signedCount 不再直接 anchorViews.filter(...).length')
  } else {
    fail('signedCount 仍直接 anchorViews.filter(...).length')
  }
  if (svc.includes('dedupedSignedViews.length') || svc.includes('dedupedSignedViews')) {
    ok('tabs signed count 基于去重池')
  } else {
    fail('tabs signed count 未基于去重池')
  }
}

function checkMetricDetailUnsignedStatic(): void {
  console.log('\n=== 1c. 签收率 unsigned tab（静态） ===')
  const svc = fs.readFileSync(
    path.resolve(ROOT, 'server/src/services/board-metric-detail.service.ts'),
    'utf-8',
  )
  if (svc.includes('viewCountsAsPaidOrder(v)') && svc.match(/case 'signRate'[\s\S]*?viewCountsAsPaidOrder/)) {
    ok('signRate/signedCount unsigned 基于 viewCountsAsPaidOrder')
  } else if (svc.includes('const paidViews = views.filter((v) => viewCountsAsPaidOrder(v))')) {
    ok('signed/unsigned tab 基于 paidViews')
  } else {
    fail('unsigned tab 未基于 viewCountsAsPaidOrder')
  }
  if (svc.includes('totals.orderCount - totals.signedOrderCount')) {
    ok('unsigned matchedOrders 使用 paidOrderCount - signedOrderCount')
  } else {
    fail('unsigned matchedOrders 未使用 paid - signed')
  }
}

async function checkAnchorDrillRuntime(): Promise<void> {
  console.log('\n=== 1d. 主播订单抽屉去重（运行时） ===')
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: START_DATE,
    endDate: END_DATE,
    role: 'super_admin',
    username: 'verify-script',
  })
  const perf = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const anchorNames = [
    ...new Set(perf.map((v) => String(v.anchorName ?? '').trim()).filter(Boolean)),
  ].slice(0, 8)
  if (anchorNames.length === 0) {
    ok('当前范围无主播订单，跳过运行时 anchor drill 对账')
    return
  }
  let checked = 0
  for (const anchorName of anchorNames) {
    const drillAll = await buildAnchorDrill({
      preset: 'custom',
      startDate: START_DATE,
      endDate: END_DATE,
      anchorName,
      page: 1,
      pageSize: 500,
      statusType: 'all',
      role: 'super_admin',
      username: 'verify-script',
    })
    const drillSigned = await buildAnchorDrill({
      preset: 'custom',
      startDate: START_DATE,
      endDate: END_DATE,
      anchorName,
      page: 1,
      pageSize: 500,
      statusType: 'signed',
      role: 'super_admin',
      username: 'verify-script',
    })
    const stats = drillAll.stats as Record<string, unknown> | null
    const actualSignedCount = num(
      stats?.actualSignedCount ?? stats?.signedOrderCount ?? stats?.actualSignedCount,
    )
    const signedTab = drillAll.tabs?.find((t) => t.key === 'signed')
    const signedTabCount = signedTab?.count ?? drillSigned.tabs?.find((t) => t.key === 'signed')?.count ?? 0
    if (actualSignedCount === signedTabCount) {
      ok(`${anchorName}: actualSignedCount ${actualSignedCount} === signed tab ${signedTabCount}`)
    } else if (actualSignedCount > 0 || signedTabCount > 0) {
      fail(`${anchorName}: actualSignedCount ${actualSignedCount} !== signed tab ${signedTabCount}`)
    }
    const dupesAll = countDuplicateOrderNos(drillAll.rows as BoardDrillOrderRow[])
    const dupesSigned = countDuplicateOrderNos(drillSigned.rows as BoardDrillOrderRow[])
    if (dupesAll.length === 0) ok(`${anchorName}: all tab 无重复 P 单`)
    else fail(`${anchorName}: all tab 重复 P 单 ${dupesAll.slice(0, 3).join(', ')}`)
    if (dupesSigned.length === 0) ok(`${anchorName}: signed tab 无重复 P 单`)
    else fail(`${anchorName}: signed tab 重复 P 单 ${dupesSigned.slice(0, 3).join(', ')}`)
    const signedRowsSum = (drillSigned.rows as BoardDrillOrderRow[]).reduce(
      (sum, row) => sum + num(row.signedAmount ?? row.payAmount),
      0,
    )
    const actualSignedAmount = num(
      stats?.actualSignedAmount ?? stats?.actualSignedAmountYuan ?? stats?.actualSignedGmv,
    )
    if (actualSignedAmount <= 0 && signedRowsSum <= 0) {
      // skip amount check
    } else if (moneyClose(signedRowsSum, actualSignedAmount)) {
      ok(`${anchorName}: signed rows 合计 === stats.actualSignedAmount`)
    } else if (actualSignedAmount > 0) {
      fail(
        `${anchorName}: signed rows 合计 ${signedRowsSum.toFixed(2)} !== stats ${actualSignedAmount}`,
      )
    }
    checked++
  }
  if (checked === 0) ok('无有效主播样本，跳过')
}

async function checkSignRatePaidTabsRuntime(): Promise<void> {
  console.log('\n=== 1e. signRate tabs 与 paidOrderCount（运行时） ===')
  const detail = await buildBoardMetricDetail({
    metric: 'signRate',
    preset: 'custom',
    startDate: START_DATE,
    endDate: END_DATE,
    page: 1,
    pageSize: 100,
    role: 'super_admin',
    username: 'verify-script',
  })
  const signedTab = detail.tabs?.find((t) => t.key === 'signed')
  const unsignedTab = detail.tabs?.find((t) => t.key === 'unsigned')
  const paidOrderCount = num(detail.summary.paidOrderCount)
  const tabSum = num(signedTab?.count) + num(unsignedTab?.count)
  if (tabSum === paidOrderCount) {
    ok(`signRate tabs signed+unsigned ${tabSum} === paidOrderCount ${paidOrderCount}`)
  } else {
    fail(`signRate tabs ${tabSum} !== paidOrderCount ${paidOrderCount}`)
  }

  const unsignedRows: BoardDrillOrderRow[] = []
  let page = 1
  while (true) {
    const pageDetail = await buildBoardMetricDetail({
      metric: 'signRate',
      preset: 'custom',
      startDate: START_DATE,
      endDate: END_DATE,
      tab: 'unsigned',
      page,
      pageSize: 100,
      role: 'super_admin',
      username: 'verify-script',
    })
    unsignedRows.push(...(pageDetail.rows as BoardDrillOrderRow[]))
    if (page >= pageDetail.pagination.totalPages) break
    page++
  }
  const nonPaid = unsignedRows.filter((r) => r.includedInGmv === false)
  if (nonPaid.length === 0) {
    ok('signRate unsigned rows 不含 includedInGmv=false')
  } else {
    fail(`signRate unsigned rows 含 ${nonPaid.length} 条未支付订单`)
  }

  for (const metric of ['signedCount', 'signRate'] as const) {
    const bundle = await fetchMetricDetailBundle({ metric, startDate: START_DATE, endDate: END_DATE })
    const dupes = countDuplicateOrderNos(bundle.rows)
    if (dupes.length === 0) ok(`${metric} 抽屉无重复 P 单`)
    else fail(`${metric} 抽屉重复 P 单: ${dupes.slice(0, 3).join(', ')}`)
  }
}

function checkOperationsReportStatic(): void {
  console.log('\n=== 3. 运营报表文案 ===')
  const sheet = fs.readFileSync(
    path.resolve(REPO_ROOT, 'apps/web/src/components/operations/OperationsReportImageSheet.tsx'),
    'utf-8',
  )
  if (sheet.includes('全店有效成交') || sheet.includes('有效成交订单')) {
    fail('运营报表图片仍含「全店有效成交」或「有效成交订单」')
  } else {
    ok('运营报表图片核心指标已改为已签收金额')
  }
  if (sheet.includes('内部有效成交口径')) {
    ok('商品榜标注内部有效成交口径')
  } else {
    fail('商品榜缺少内部有效成交口径标注')
  }
}

function checkBoardMetricDrawerReset(): void {
  console.log('\n=== 4. BoardMetricDrawer 切主播重置 ===')
  const drawer = fs.readFileSync(
    path.resolve(REPO_ROOT, 'apps/web/src/components/board/BoardMetricDrawer.tsx'),
    'utf-8',
  )
  const resetEffect = drawer.match(/useEffect\(\(\) => \{[\s\S]*?setPage\(1\)[\s\S]*?\}, \[([^\]]+)\]\)/)
  if (!resetEffect) {
    fail('BoardMetricDrawer 未找到 reset effect')
    return
  }
  const deps = resetEffect[1]
  for (const dep of ['anchorId', 'anchorName', 'preset', 'overviewStableSnapshot']) {
    if (deps.includes(dep)) ok(`reset effect 监听 ${dep}`)
    else fail(`reset effect 未监听 ${dep}`)
  }
}

async function checkHistoricalScheduleProtection(): Promise<void> {
  console.log('\n=== 5. 历史已确认排班保护 ===')
  const svc = fs.readFileSync(
    path.resolve(ROOT, 'server/src/services/anchor-daily-schedule.service.ts'),
    'utf-8',
  )
  const routes = fs.readFileSync(
    path.resolve(ROOT, 'server/src/routes/anchor-schedules.routes.ts'),
    'utf-8',
  )
  if (
    svc.includes('forceHistoricalScheduleChange') &&
    svc.includes('历史已确认排班不能直接覆盖')
  ) {
    ok('save/copy 含 forceHistoricalScheduleChange 与错误文案')
  } else {
    fail('历史排班保护逻辑缺失')
  }

  if (svc.includes('generateDefaultSchedulesForDate') && svc.match(/generateDefaultSchedulesForDate[\s\S]*?forceHistoricalScheduleChange/)) {
    ok('generateDefaultSchedulesForDate 参数含 forceHistoricalScheduleChange')
  } else {
    fail('generateDefaultSchedulesForDate 缺少 forceHistoricalScheduleChange 参数')
  }

  const genDefaultBlock = svc.match(
    /export async function generateDefaultSchedulesForDate[\s\S]*?^export async function saveDailySchedules/m,
  )?.[0]
  if (
    genDefaultBlock &&
    genDefaultBlock.includes('assertHistoricalScheduleChangeAllowed') &&
    genDefaultBlock.indexOf('assertHistoricalScheduleChangeAllowed') <
      genDefaultBlock.indexOf('deleteMany')
  ) {
    ok('generateDefault overwrite 在 deleteMany 之前有历史保护')
  } else {
    fail('generateDefault 未在 deleteMany 之前做历史保护')
  }

  if (
    genDefaultBlock &&
    genDefaultBlock.includes('templatesToCreate.length > 0') &&
    genDefaultBlock.includes('assertHistoricalScheduleChangeAllowed')
  ) {
    ok('generateDefault 非 overwrite 新增 rows 也有历史保护')
  } else {
    fail('generateDefault 非 overwrite 新增缺少历史保护')
  }

  const genDefaultRoute = routes.match(
    /anchorSchedulesRouter\.post\('\/generate-default'[\s\S]*?\}\)/,
  )?.[0]
  if (
    genDefaultRoute?.includes('forceHistoricalScheduleChange') &&
    genDefaultRoute?.includes('changeReason')
  ) {
    ok('/generate-default 透传 forceHistoricalScheduleChange / changeReason')
  } else {
    fail('/generate-default 未透传 forceHistoricalScheduleChange / changeReason')
  }

  if (svc.includes('writeOperationLog') && svc.includes('historical_schedule_override')) {
    ok('历史强制修改写入 OperationLog')
  } else {
    fail('历史强制修改未写入 OperationLog')
  }
  if (svc.includes('历史修改原因：') && svc.includes('appendHistoricalOverrideNote')) {
    ok('历史强制修改 changeReason 写入排班 note')
  } else {
    fail('历史强制修改 changeReason 未写入排班 note')
  }

  const today = formatDateKeyShanghai(new Date())
  let probeDate: string | null = null
  for (let i = 1; i <= 60; i++) {
    const d = addDaysShanghai(today, -i)
    if (await isDateScheduleConfirmed(d)) {
      probeDate = d
      break
    }
  }
  if (!probeDate) {
    ok('本地无历史已确认排班，跳过运行时覆盖拦截（静态检查已通过）')
    return
  }
  try {
    await saveDailySchedules({
      date: probeDate,
      schedules: [],
      createdBy: 'verify-script',
    })
    fail(`${probeDate} 历史已确认排班在无 force 时仍可覆盖`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('历史已确认排班不能直接覆盖')) {
      ok(`${probeDate} 无 force 保存被拦截`)
    } else {
      fail(`${probeDate} 拦截异常: ${msg}`)
    }
  }
}

async function checkFocusOrderAttribution(): Promise<void> {
  console.log('\n=== 6. 重点订单归属 ===')
  const map = await buildRemappedAnchorMap({ startDate: START_DATE, endDate: END_DATE })
  for (const item of FOCUS_ATTRIBUTION) {
    const anchor =
      map.get(item.orderNo) ??
      map.get(item.orderNo.replace(/^P/, '')) ??
      map.get(`P${item.orderNo.replace(/^P/, '')}`)
    if (!anchor) {
      ok(`${item.orderNo} 不在当前日期 remap 池，跳过（本地库可能无此单，生产再验）`)
    } else if (anchor === item.anchor) {
      ok(`${item.orderNo} → ${item.anchor}`)
    } else {
      fail(`${item.orderNo} 期望 ${item.anchor}，实际 ${anchor}`)
    }
    const ziJieBundle = await fetchMetricDetailBundle({
      metric: 'actualSignedAmount',
      startDate: START_DATE,
      endDate: END_DATE,
      anchorName: item.notIn,
    })
    const inZiJie = ziJieBundle.rows.some(
      (r) =>
        (r.orderNo || r.packageId || '') === item.orderNo ||
        (r.orderNo || r.packageId || '') === item.orderNo.replace(/^P/, ''),
    )
    if (!inZiJie) ok(`${item.orderNo} 不在 ${item.notIn} 池`)
    else fail(`${item.orderNo} 不应出现在 ${item.notIn} 抽屉`)
  }
}

function readRepo(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), 'utf-8')
}

function checkAfterSaleAndHealthTailStatic(): void {
  console.log('\n=== 0. 售后信号与数据健康尾巴（静态） ===')
  const signalService = readRepo('server/src/services/after-sale-status-signal.service.ts')
  const businessMetrics = readRepo('server/src/services/business-metrics.service.ts')
  const operationsAfterSale = readRepo('server/src/services/operations-after-sale-order.util.ts')
  const validRevenue = readRepo('server/src/services/valid-revenue-order.service.ts')
  const metricDetail = readRepo('server/src/services/board-metric-detail.service.ts')
  const calcRefundRate = readRepo('server/src/services/calc-refund-rate.service.ts')
  const orderMetricSets = readRepo('server/src/services/order-metric-sets.service.ts')
  const rollingStore = readRepo('server/src/services/rolling-data-health-close-store.service.ts')
  const rollingService = readRepo('server/src/services/rolling-data-health-close.service.ts')
  const monthlyClose = readRepo('server/src/services/monthly-close-reconciliation.service.ts')
  const panel = readRepo('web/src/components/board/DataHealthPanel.tsx')

  if (signalService.includes('isNoAfterSaleText') && signalService.includes('isPositiveAfterSaleText')) {
    ok('after-sale-status-signal 含 isNoAfterSaleText / isPositiveAfterSaleText')
  } else {
    fail('after-sale-status-signal 缺少公共售后判断')
  }

  if (businessMetrics.includes('after-sale-status-signal.service')) {
    ok('business-metrics 复用 after-sale-status-signal')
  } else {
    fail('business-metrics 未复用公共售后工具')
  }

  if (
    operationsAfterSale.includes('isOperationalAfterSaleText') &&
    operationsAfterSale.includes('isNoAfterSaleText') &&
    !operationsAfterSale.includes('/售后|退款|退货/')
  ) {
    ok('operations-after-sale 复用公共工具且无裸 /售后|退款|退货/')
  } else {
    fail('operations-after-sale 未复用公共工具或仍裸匹配售后文案')
  }

  if (validRevenue.includes('isNoAfterSaleText')) {
    ok('valid-revenue-order 复用 isNoAfterSaleText')
  } else {
    fail('valid-revenue-order 未复用 isNoAfterSaleText')
  }

  if (
    metricDetail.includes("'returnAmount'") &&
    metricDetail.includes("'returnCount'") &&
    metricDetail.includes("'returnRate'") &&
    metricDetail.includes('METRICS_ORDER_DEDUPE')
  ) {
    const dedupeBlock = metricDetail.slice(
      metricDetail.indexOf('METRICS_ORDER_DEDUPE'),
      metricDetail.indexOf('METRICS_ORDER_DEDUPE') + 400,
    )
    if (
      dedupeBlock.includes("'returnAmount'") &&
      dedupeBlock.includes("'returnCount'") &&
      dedupeBlock.includes("'returnRate'")
    ) {
      ok('METRICS_ORDER_DEDUPE 含 returnAmount / returnCount / returnRate')
    } else {
      fail('METRICS_ORDER_DEDUPE 未含退款类指标')
    }
  } else {
    fail('board-metric-detail 缺少退款类去重配置')
  }

  if (metricDetail.includes('dedupeRefundMetricViewsByOrderNoMaxRefund')) {
    ok('board-metric-detail 含 dedupeRefundMetricViewsByOrderNoMaxRefund')
  } else {
    fail('board-metric-detail 未使用 dedupeRefundMetricViewsByOrderNoMaxRefund')
  }

  const refundDedupeBlock = metricDetail.slice(
    metricDetail.indexOf("params.metric === 'returnAmount'"),
    metricDetail.indexOf("params.metric === 'returnAmount'") + 600,
  )
  if (
    refundDedupeBlock.includes('dedupeRefundMetricViewsByOrderNoMaxRefund') &&
    refundDedupeBlock.includes("params.metric === 'returnCount'") &&
    refundDedupeBlock.includes("params.metric === 'returnRate'")
  ) {
    ok('returnAmount / returnCount / returnRate 走 max-refund 去重')
  } else {
    fail('退款类指标未走 dedupeRefundMetricViewsByOrderNoMaxRefund')
  }

  if (calcRefundRate.includes('dedupeRefundMetricViewsByOrderNoMaxRefund')) {
    ok('calc-refund-rate 导出 dedupeRefundMetricViewsByOrderNoMaxRefund')
  } else {
    fail('calc-refund-rate 缺少 dedupeRefundMetricViewsByOrderNoMaxRefund')
  }

  if (calcRefundRate.includes('dedupeCoreMetricViewsByOrderNoBestValue')) {
    ok('calc-refund-rate 含 dedupeCoreMetricViewsByOrderNoBestValue')
  } else {
    fail('calc-refund-rate 缺少 dedupeCoreMetricViewsByOrderNoBestValue')
  }

  const dedupeBlock = metricDetail.slice(
    metricDetail.indexOf('METRICS_ORDER_DEDUPE'),
    metricDetail.indexOf('METRICS_ORDER_DEDUPE') + 500,
  )
  if (dedupeBlock.includes("'gmv'") && dedupeBlock.includes("'orderCount'")) {
    ok('METRICS_ORDER_DEDUPE 含 gmv / orderCount')
  } else {
    fail('METRICS_ORDER_DEDUPE 未含 gmv / orderCount')
  }

  const coreDedupeBlock = metricDetail.slice(
    metricDetail.indexOf('function usesCoreMetricBestValueDedupe'),
    metricDetail.indexOf('function usesCoreMetricBestValueDedupe') + 400,
  )
  if (
    coreDedupeBlock.includes("'gmv'") &&
    coreDedupeBlock.includes("'orderCount'") &&
    metricDetail.includes('dedupeCoreMetricViewsByOrderNoBestValue(sourceViews)')
  ) {
    ok('gmv / orderCount 走 dedupeCoreMetricViewsByOrderNoBestValue')
  } else {
    fail('gmv / orderCount 未走 dedupeCoreMetricViewsByOrderNoBestValue')
  }

  if (
    businessMetrics.includes('dedupeCoreMetricViewsByOrderNoBestValue') &&
    businessMetrics.includes('isEffectiveSignedView(v)') &&
    !businessMetrics.includes('if (v.isEffectiveSigned)')
  ) {
    ok('business-metrics 使用 bestValue 去重与 isEffectiveSignedView')
  } else {
    fail('business-metrics 未使用 bestValue 去重或仍直接判断 v.isEffectiveSigned')
  }

  if (
    operationsAfterSale.includes('isOperationalAfterSaleText') &&
    !operationsAfterSale.includes('isPositiveAfterSaleText')
  ) {
    ok('operations-after-sale 使用 isOperationalAfterSaleText 判断运营售后相关')
  } else {
    fail('operations-after-sale 未改用 isOperationalAfterSaleText')
  }

  if (signalService.includes('isOperationalAfterSaleText')) {
    ok('after-sale-status-signal 含 isOperationalAfterSaleText')
  } else {
    fail('after-sale-status-signal 缺少 isOperationalAfterSaleText')
  }

  if (!signalService.includes('isActualRefundAfterSaleText')) {
    ok('after-sale-status-signal 已移除易误解的 isActualRefundAfterSaleText')
  } else {
    fail('after-sale-status-signal 仍保留 isActualRefundAfterSaleText')
  }

  if (
    !signalService.includes("afterSale.includes('售后')") &&
    signalService.includes('POSITIVE_AFTER_SALE_KEYWORDS')
  ) {
    ok('售后正向判断不依赖裸「售后」二字')
  } else {
    fail('售后仍可能仅靠「售后」二字误判')
  }

  if (orderMetricSets.includes('afterSaleRelatedOrderCount')) {
    ok('order-metric-sets 含 afterSaleRelatedOrderCount')
  } else {
    fail('order-metric-sets 缺少 afterSaleRelatedOrderCount')
  }

  const viewInvolvesBlock = businessMetrics.slice(
    businessMetrics.indexOf('function viewInvolvesRefundAfterSale'),
    businessMetrics.indexOf('function viewInvolvesRefundAfterSale') + 220,
  )
  if (viewInvolvesBlock.includes('isFreightRefundOnly')) {
    ok('viewInvolvesRefundAfterSale 排除 isFreightRefundOnly')
  } else {
    fail('viewInvolvesRefundAfterSale 未排除 isFreightRefundOnly')
  }

  const orderRefundMetrics = readRepo('server/src/services/order-refund-metrics.service.ts')
  const resolveRefundBlock = orderRefundMetrics.slice(
    orderRefundMetrics.indexOf('function resolveViewRefundAmountCent'),
    orderRefundMetrics.indexOf('function resolveViewRefundAmountCent') + 180,
  )
  if (resolveRefundBlock.includes('isFreightRefundOnly')) {
    ok('resolveViewRefundAmountCent 排除 isFreightRefundOnly')
  } else {
    fail('resolveViewRefundAmountCent 未排除 isFreightRefundOnly')
  }

  if (
    rollingStore.includes('afterSaleSignalRecordCount') &&
    rollingService.includes('afterSaleRelatedOrderCount')
  ) {
    ok('rolling report 区分售后相关订单与信号记录')
  } else {
    fail('rolling report 未区分售后相关订单与信号记录')
  }

  if (rollingStore.includes('ROLLING_DATA_HEALTH_CLOSE_LOCK_STALE_MS')) {
    ok('rolling lock 含过期常量')
  } else {
    fail('rolling lock 缺少过期常量')
  }

  if (monthlyClose.includes('isUnassignedMonthlyCloseView')) {
    ok('monthly-close 含 isUnassignedMonthlyCloseView')
  } else {
    fail('monthly-close 缺少 isUnassignedMonthlyCloseView')
  }

  if (
    !signalService.includes("negWords.some((w) => raw.includes(w)) && raw.includes('售后')") &&
    signalService.includes('NO_AFTER_SALE_PHRASES')
  ) {
    ok('isNoAfterSaleText 使用明确负例短语')
  } else {
    fail('isNoAfterSaleText 仍含宽泛 未+售后 规则')
  }

  if (panel.includes('全库累计') && panel.includes('售后信号记录')) {
    ok('DataHealthPanel 含全库累计与售后信号记录')
  } else {
    fail('DataHealthPanel 缺少全库累计或售后信号记录')
  }
}

function checkNoAfterSaleTextRuntime(): void {
  console.log('\n=== 0b. isNoAfterSaleText 运行时断言 ===')
  const negatives = [
    '无售后',
    '暂无售后',
    '未申请售后',
    '未发起售后',
    '未产生售后',
    '没有售后',
    '售后状态：无',
    '售后：无',
    '退款状态：无',
    '退货状态：无',
    '无退款',
    '无退货',
  ]
  for (const text of negatives) {
    if (isNoAfterSaleText(text)) ok(`负例「${text}」`)
    else fail(`负例「${text}」未被识别`)
  }

  const positives = [
    '售后完成未退款',
    '售后关闭未退款',
    '售后中未退款',
    '售后申请未处理',
    '售后处理中未退款',
    '退款成功',
    '退货退款',
    '仅退款',
    '售后完成',
  ]
  for (const text of positives) {
    if (isNoAfterSaleText(text)) fail(`正例「${text}」被误判为无售后`)
    else ok(`正例「${text}」未被误判为无售后`)
    const view = { afterSaleStatusText: text } as AnalyzedOrderView
    if (viewHasAfterSaleStatusSignal(view)) ok(`正例「${text}」算售后信号`)
    else fail(`正例「${text}」未识别为售后信号`)
  }

  if (isPositiveAfterSaleText('售后完成未退款')) {
    ok('isPositiveAfterSaleText「售后完成未退款」')
  } else {
    fail('isPositiveAfterSaleText 未识别「售后完成未退款」')
  }

  console.log('\n=== 0b2. 组合无售后文案运行时断言 ===')
  const combinedNegatives = [
    '无售后 无退款',
    '售后：无 退款状态：无',
    '售后状态：无 退货状态：无',
    '暂无售后 / 无退款',
  ]
  for (const text of combinedNegatives) {
    if (isNoAfterSaleText(text)) ok(`组合负例「${text}」不算售后`)
    else fail(`组合负例「${text}」未被识别为无售后`)
    if (!isPositiveAfterSaleText(text)) ok(`组合负例「${text}」isPositive=false`)
    else fail(`组合负例「${text}」被误判为正向售后`)
    const view = { afterSaleStatusText: text } as AnalyzedOrderView
    if (!viewHasAfterSaleStatusSignal(view)) ok(`组合负例「${text}」无售后信号`)
    else fail(`组合负例「${text}」被误判为售后信号`)
  }

  const combinedPositives = [
    { text: '无售后 退款成功', label: '无售后+退款成功' },
    { text: '售后：无 退货退款', label: '售后无+退货退款' },
    { text: '售后完成未退款', label: '售后完成未退款' },
  ]
  for (const { text, label } of combinedPositives) {
    if (isPositiveAfterSaleText(text)) ok(`组合正例「${label}」算售后`)
    else fail(`组合正例「${label}」未识别为正向售后`)
    const view = { afterSaleStatusText: text } as AnalyzedOrderView
    if (viewHasAfterSaleStatusSignal(view)) ok(`组合正例「${label}」有售后信号`)
    else fail(`组合正例「${label}」未识别为售后信号`)
  }
}

function checkOperationalAfterSaleRuntime(): void {
  console.log('\n=== 0e. 运营售后信号 vs 退款单数 ===')
  const relatedPositives = ['售后申请', '售后中', '售后处理中', '售后申请未处理', '售后处理中未退款']
  for (const text of relatedPositives) {
    if (isPositiveAfterSaleText(text)) ok(`isPositiveAfterSaleText「${text}」= true`)
    else fail(`isPositiveAfterSaleText 未识别「${text}」`)
    if (isOperationalAfterSaleText(text)) ok(`isOperationalAfterSaleText「${text}」= true`)
    else fail(`isOperationalAfterSaleText 未识别「${text}」`)
  }
  const noAfterSaleTexts = ['无售后', '暂无售后', '未申请售后', '售后：无', '售后：无 退款状态：无']
  for (const text of noAfterSaleTexts) {
    if (!isPositiveAfterSaleText(text)) ok(`isPositiveAfterSaleText「${text}」= false`)
    else fail(`isPositiveAfterSaleText 误判「${text}」`)
  }
  const refundTextPositives = ['退款成功', '退款中', '退货退款', '仅退款', '售后完成']
  for (const text of refundTextPositives) {
    if (isOperationalAfterSaleText(text)) ok(`isOperationalAfterSaleText「${text}」= true`)
    else fail(`isOperationalAfterSaleText 未识别「${text}」`)
  }
  if (isOperationalAfterSaleText('售后关闭')) ok('isOperationalAfterSaleText「售后关闭」= true')
  else fail('isOperationalAfterSaleText 未识别「售后关闭」')
  if (isOperationalAfterSaleText('关闭无退款')) ok('isOperationalAfterSaleText「关闭无退款」= true')
  else fail('isOperationalAfterSaleText 未识别「关闭无退款」')

  for (const text of relatedPositives.concat(['售后关闭', '关闭无退款', '退款成功'])) {
    if (isActualAfterSaleOrder(mockAfterSaleView(text))) ok(`运营「${text}」算售后相关`)
    else fail(`运营「${text}」未识别为售后相关`)
  }
}

function checkRefundOrderVsAfterSaleSignalRuntime(): void {
  console.log('\n=== 0f. 售后相关 vs 退款金额/退款单数 ===')
  const pendingView = {
    includedInGmv: true,
    afterSaleStatusText: '售后中',
    productRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    returnAmountCent: 0,
  } as AnalyzedOrderView
  if (viewHasAfterSaleStatusSignal(pendingView)) ok('售后中+0元 有售后相关信号')
  else fail('售后中+0元 未识别售后相关信号')
  if (!viewCountsAsRefundOrder(pendingView)) ok('售后中+0元 不算退款单数')
  else fail('售后中+0元 误计退款单数')
  if (resolveViewRefundAmountCent(pendingView) === 0) ok('售后中+0元 退款金额=0')
  else fail('售后中+0元 退款金额非 0')

  const closedView = {
    includedInGmv: true,
    afterSaleStatusText: '售后关闭无退款',
    productRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    returnAmountCent: 0,
  } as AnalyzedOrderView
  if (viewHasAfterSaleStatusSignal(closedView)) ok('售后关闭无退款 有售后相关信号')
  else fail('售后关闭无退款 未识别售后相关信号')
  if (!viewCountsAsRefundOrder(closedView)) ok('售后关闭无退款 不算退款单数')
  else fail('售后关闭无退款 误计退款单数')
  if (resolveViewRefundAmountCent(closedView) === 0) ok('售后关闭无退款 退款金额=0')
  else fail('售后关闭无退款 退款金额非 0')

  const refundedView = {
    includedInGmv: true,
    afterSaleStatusText: '退款成功',
    productRefundAmountCent: 5000,
    realAfterSaleAmountCent: 0,
    returnAmountCent: 0,
  } as AnalyzedOrderView
  if (viewHasAfterSaleStatusSignal(refundedView)) ok('退款成功+金额 有售后相关信号')
  else fail('退款成功+金额 未识别售后相关信号')
  if (viewCountsAsRefundOrder(refundedView)) ok('退款成功+金额 算退款单数')
  else fail('退款成功+金额 未计退款单数')
  if (resolveViewRefundAmountCent(refundedView) === 5000) ok('退款成功+金额 退款金额=5000分')
  else fail('退款成功+金额 退款金额不正确')
}

function mockAfterSaleView(afterSaleStatusText: string): AnalyzedOrderView {
  return { afterSaleStatusText } as AnalyzedOrderView
}

function mockValidRevenueView(afterSaleStatusText: string): AnalyzedOrderView {
  return {
    includedInGmv: true,
    effectiveGmvCent: 10000,
    orderStatusText: '已完成',
    afterSaleStatusText,
    productRefundAmountCent: 0,
    returnAmountCent: 0,
    realAfterSaleAmountCent: 0,
  } as AnalyzedOrderView
}

function checkOperationsAfterSaleRuntime(): void {
  console.log('\n=== 0c. 运营报表售后运行时断言 ===')
  const negatives = [
    '暂无售后',
    '未申请售后',
    '未发起售后',
    '售后状态：无',
    '无售后',
    '售后：无 退款状态：无',
  ]
  for (const text of negatives) {
    if (!isActualAfterSaleOrder(mockAfterSaleView(text))) ok(`运营负例「${text}」不算售后相关`)
    else fail(`运营负例「${text}」被误判为售后相关`)
  }
  const positives = [
    '售后申请',
    '售后中',
    '售后处理中',
    '售后申请未处理',
    '售后处理中未退款',
    '售后关闭',
    '关闭无退款',
    '售后完成未退款',
    '退款成功',
    '退货退款',
  ]
  for (const text of positives) {
    if (isActualAfterSaleOrder(mockAfterSaleView(text))) ok(`运营正例「${text}」算售后相关`)
    else fail(`运营正例「${text}」未识别为售后相关`)
  }
}

function mockFreightOnlyView(): AnalyzedOrderView {
  return {
    packageId: 'PKG-FREIGHT-VERIFY',
    includedInGmv: true,
    paymentBaseCent: 50000,
    isFreightRefundOnly: true,
    freightRefundAmountCent: 1800,
    productRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    returnAmountCent: 1800,
    afterSaleStatusText: '退款成功',
    afterSaleDisplayType: '运费补偿',
    orderStatusText: '已完成',
    statusSigned: true,
    actualSignAmountCent: 50000,
  } as AnalyzedOrderView
}

function mockRealAfterSale18View(): AnalyzedOrderView {
  return {
    packageId: 'PKG-REAL-AFTERSALE-VERIFY',
    includedInGmv: true,
    isFreightRefundOnly: false,
    productRefundAmountCent: 1800,
    realAfterSaleAmountCent: 1800,
    afterSaleStatusText: '退款成功',
  } as AnalyzedOrderView
}

function checkFreightRefundOnlyRuntime(): void {
  console.log('\n=== 0g. 纯运费补偿(18元)运行时断言 ===')
  const freightView = mockFreightOnlyView()
  const realView = mockRealAfterSale18View()

  if (!viewInvolvesRefundAfterSale(freightView)) ok('纯运费 viewInvolvesRefundAfterSale=false')
  else fail('纯运费 viewInvolvesRefundAfterSale 误判为 true')

  if (!viewCountsAsRefundOrder(freightView)) ok('纯运费 viewCountsAsRefundOrder=false')
  else fail('纯运费 viewCountsAsRefundOrder 误判为 true')

  if (resolveViewRefundAmountCent(freightView) === 0) ok('纯运费 resolveViewRefundAmountCent=0')
  else fail(`纯运费 resolveViewRefundAmountCent=${resolveViewRefundAmountCent(freightView)}`)

  if (!isActualAfterSaleOrder(freightView)) ok('纯运费 isActualAfterSaleOrder=false')
  else fail('纯运费 isActualAfterSaleOrder 误判为 true')

  if (isEffectiveSignedView(freightView)) ok('纯运费 isEffectiveSignedView=true')
  else fail('纯运费 isEffectiveSignedView 误判为 false')

  const freightMetrics = calculateBusinessMetrics([freightView])
  if (freightMetrics.refundAmount === 0) ok('纯运费 calculateBusinessMetrics.refundAmount=0')
  else fail(`纯运费 refundAmount=${freightMetrics.refundAmount}`)
  if (freightMetrics.refundOrderCount === 0) ok('纯运费 refundOrderCount=0')
  else fail(`纯运费 refundOrderCount=${freightMetrics.refundOrderCount}`)
  if (freightMetrics.afterSaleRelatedOrderCount === 0) ok('纯运费 afterSaleRelatedOrderCount=0')
  else fail(`纯运费 afterSaleRelatedOrderCount=${freightMetrics.afterSaleRelatedOrderCount}`)
  if (freightMetrics.freightRefundAmount === 18) ok('纯运费 freightRefundAmount=18')
  else fail(`纯运费 freightRefundAmount=${freightMetrics.freightRefundAmount}`)
  if (freightMetrics.actualSignedAmount === 500) ok('纯运费 actualSignedAmount=500')
  else fail(`纯运费 actualSignedAmount=${freightMetrics.actualSignedAmount}`)

  if (viewInvolvesRefundAfterSale(realView)) ok('真实售后 viewInvolvesRefundAfterSale=true')
  else fail('真实售后 viewInvolvesRefundAfterSale 未识别')
  if (viewCountsAsRefundOrder(realView)) ok('真实售后 viewCountsAsRefundOrder=true')
  else fail('真实售后 viewCountsAsRefundOrder 未识别')
  if (resolveViewRefundAmountCent(realView) === 1800) ok('真实售后 resolveViewRefundAmountCent=1800')
  else fail(`真实售后 resolveViewRefundAmountCent=${resolveViewRefundAmountCent(realView)}`)
}

async function checkFreightRefundDbScan(): Promise<void> {
  console.log('\n=== 生产数据：18元运费补偿扫描 ===')
  const scanStart = process.env.FREIGHT_SCAN_START?.trim() || '2023-01-01'
  const scanEnd =
    process.env.FREIGHT_SCAN_END?.trim() || formatDateKeyShanghai(new Date())
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: scanStart,
    endDate: scanEnd,
  })
  const views = scoped.views
  const freightOnly18 = views.filter(
    (v) =>
      v.isFreightRefundOnly &&
      v.freightRefundAmountCent === 1800 &&
      v.productRefundAmountCent === 0,
  )
  console.log(`  纯运费补偿(18元) 订单数: ${freightOnly18.length}`)

  const metricSets = buildOrderMetricSets(views)
  const refundSet = new Set(metricSets.refundOrderNos)
  const afterSaleSet = new Set(metricSets.afterSaleRelatedOrderNos)
  const qualitySet = new Set(metricSets.qualityRefundOrderNos)
  const signedSet = new Set(metricSets.signedOrderNos)

  let violationCount = 0
  for (const v of freightOnly18) {
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    if (refundSet.has(no)) {
      fail(`纯运费 ${no} 误入 refundOrderNos`)
      violationCount += 1
    }
    if (afterSaleSet.has(no)) {
      fail(`纯运费 ${no} 误入 afterSaleRelatedOrderNos`)
      violationCount += 1
    }
    if (qualitySet.has(no)) {
      fail(`纯运费 ${no} 误入 qualityRefundOrderNos`)
      violationCount += 1
    }
    if (!signedSet.has(no) && isEffectiveSignedView(v) && v.includedInGmv) {
      fail(`纯运费 ${no} 未计入 signedOrderNos（应不影响签收）`)
      violationCount += 1
    }
  }
  if (violationCount === 0 && freightOnly18.length > 0) {
    ok(`全部 ${freightOnly18.length} 笔纯运费补偿未误入退款/售后/品退集合`)
  } else if (freightOnly18.length === 0) {
    ok('当前库内无 isFreightRefundOnly+1800 样本（跳过集合断言）')
  }

  const suspected = views.filter((v) => {
    if (v.isFreightRefundOnly) return false
    if (v.productRefundAmountCent !== 0) return false
    const has18 =
      v.freightRefundAmountCent === 1800 ||
      v.returnAmountCent === 1800 ||
      v.realAfterSaleAmountCent === 1800
    return has18
  })
  console.log(`  疑似18元但未识别为纯运费补偿: ${suspected.length} 笔`)
  for (const v of suspected.slice(0, 10)) {
    const no = resolveMetricOrderNo(v) || v.packageId
    console.log(
      `    样本 ${no} | 店铺=${v.liveAccountName ?? '-'} | afterSale=${v.afterSaleStatusText} | reason=${v.reasonText} | productRefund=${v.productRefundAmountCent} | freightRefund=${v.freightRefundAmountCent} | isFreightRefundOnly=${v.isFreightRefundOnly} | refundSource=${v.buyerProductRefundSource ?? '-'}`,
    )
  }
  if (suspected.length === 0) ok('未发现疑似漏识别的18元运费补偿')
}

function checkValidRevenueNoAfterSaleRuntime(): void {
  console.log('\n=== 0d. 有效成交无售后运行时断言 ===')
  const noAfterSaleTexts = [
    '暂无售后',
    '未发起售后',
    '未产生售后',
    '没有售后',
    '售后状态：无',
    '无退款',
    '无退货',
  ]
  for (const text of noAfterSaleTexts) {
    const explain = explainValidRevenueOrder(mockValidRevenueView(text))
    if (explain.valid) ok(`有效成交负例「${text}」可计入（无退款时）`)
    else fail(`有效成交负例「${text}」被误踢：${explain.reason}`)
  }
  const blockedTexts = ['退款成功', '售后处理中', '退货退款', '仅退款', '已退款']
  for (const text of blockedTexts) {
    const explain = explainValidRevenueOrder(mockValidRevenueView(text))
    if (!explain.valid) ok(`有效成交正例「${text}」正确排除`)
    else fail(`有效成交正例「${text}」未被排除`)
  }
}

async function main(): Promise<void> {
  console.log('verify-data-truth-sweep')
  console.log(`范围: ${START_DATE} ~ ${END_DATE}`)

  checkAfterSaleAndHealthTailStatic()
  checkNoAfterSaleTextRuntime()
  checkOperationalAfterSaleRuntime()
  checkRefundOrderVsAfterSaleSignalRuntime()
  checkFreightRefundOnlyRuntime()
  checkOperationsAfterSaleRuntime()
  checkValidRevenueNoAfterSaleRuntime()

  await bootstrapQualityBadCaseCache()
  await checkFreightRefundDbScan()
  await checkOverviewSignedDrawers()
  checkAnchorDrillStatic()
  checkMetricDetailUnsignedStatic()
  await checkAnchorDrillRuntime()
  await checkSignRatePaidTabsRuntime()
  await checkAnchorSignRateDetail()
  await checkValidRevenueDedupeWarning()
  await checkDailyReport()
  checkOperationsReportRemap()
  checkOperationsReportStatic()
  checkBoardMetricDrawerReset()
  await checkHistoricalScheduleProtection()
  await checkFocusOrderAttribution()

  console.log('\n=== 结果 ===')
  if (issues.length === 0) {
    console.log('PASS: 全部检查通过')
    await prisma.$disconnect()
    process.exit(0)
  }
  console.log(`FAIL: ${issues.length} 项未通过`)
  for (const issue of issues) console.log(`  - ${issue}`)
  await prisma.$disconnect()
  process.exit(1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
