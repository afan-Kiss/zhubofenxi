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
  viewHasAfterSaleStatusSignal,
} from '../src/services/after-sale-status-signal.service'
import { isActualAfterSaleOrder } from '../src/services/operations-after-sale-order.util'
import { explainValidRevenueOrder } from '../src/services/valid-revenue-order.service'
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
  const cardSignedAmount = num(summary.actualSignedAmount)
  const cardSignedCount = num(summary.signedOrderCount ?? summary.actualSignedCount)

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

  const cardReturnCount = num(summary.returnOrderCount ?? summary.refundOrderCount)
  const returnCountBundle = await fetchMetricDetailBundle({
    metric: 'returnCount',
    startDate: START_DATE,
    endDate: END_DATE,
  })
  if (returnCountBundle.summary.matchedOrders === cardReturnCount) {
    ok(
      `returnCount matchedOrders ${returnCountBundle.summary.matchedOrders} === 卡片 refundOrderCount`,
    )
  } else {
    fail(
      `returnCount matchedOrders ${returnCountBundle.summary.matchedOrders} !== 卡片 ${cardReturnCount}`,
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
  const dupesReturnAmount = countDuplicateOrderNos(returnAmountBundle.rows)
  if (dupesReturnAmount.length === 0) ok('returnAmount 抽屉无重复 P 单')
  else fail(`returnAmount 抽屉重复 P 单: ${dupesReturnAmount.slice(0, 5).join(', ')}`)

  for (const metric of SIGNED_METRICS) {
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
    operationsAfterSale.includes('isNoAfterSaleText') &&
    operationsAfterSale.includes('isPositiveAfterSaleText') &&
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
  const negatives = ['暂无售后', '未申请售后', '未发起售后', '售后状态：无']
  for (const text of negatives) {
    if (!isActualAfterSaleOrder(mockAfterSaleView(text))) ok(`运营负例「${text}」不算售后`)
    else fail(`运营负例「${text}」被误判为售后`)
  }
  const positives = ['售后完成未退款', '售后申请未处理', '退款成功', '退货退款']
  for (const text of positives) {
    if (isActualAfterSaleOrder(mockAfterSaleView(text))) ok(`运营正例「${text}」算售后`)
    else fail(`运营正例「${text}」未识别为售后`)
  }
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
  checkOperationsAfterSaleRuntime()
  checkValidRevenueNoAfterSaleRuntime()

  await bootstrapQualityBadCaseCache()
  await checkOverviewSignedDrawers()
  checkAnchorDrillStatic()
  checkMetricDetailUnsignedStatic()
  await checkAnchorDrillRuntime()
  await checkSignRatePaidTabsRuntime()
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
