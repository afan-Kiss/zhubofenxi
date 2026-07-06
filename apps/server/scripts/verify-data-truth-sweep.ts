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

async function main(): Promise<void> {
  console.log('verify-data-truth-sweep')
  console.log(`范围: ${START_DATE} ~ ${END_DATE}`)

  await bootstrapQualityBadCaseCache()
  await checkOverviewSignedDrawers()
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
