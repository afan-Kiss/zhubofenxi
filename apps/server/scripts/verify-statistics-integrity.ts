/**
 * 统计准确性只读体检（经营总览 / 运营日报 / GMV 去重 / 直播时长 / 未知售后）
 * 用法: npm run verify:statistics-integrity
 *       DATE=2026-07-03 npm run verify:statistics-integrity
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import {
  buildAndSetBusinessBoardCache,
  getBusinessBoardCache,
} from '../src/services/business-cache.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { resolveBusinessRange } from '../src/utils/business-range'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import {
  enableValidRevenueUnknownCollector,
  drainValidRevenueUnknownCollector,
  explainValidRevenueOrder,
  sumValidRevenueFromViews,
} from '../src/services/valid-revenue-order.service'
import { buildDailyOperationsReport } from '../src/services/daily-operations-report.service'
import { getBoardScopedViewsForRange, getAnchorPerformanceViews } from '../src/services/board-scoped-views.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { loadAndAssignDailyReportLiveSessions } from '../src/services/daily-report-live-sessions.service'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { centToYuan } from '../src/utils/money'

config({ path: path.resolve(__dirname, '../.env') })

const DATE_ENV = process.env.DATE?.trim()
const failures: string[] = []
const warnings: string[] = []

const BASE_RANGES: Array<{
  label: string
  preset: string
  startDate?: string
  endDate?: string
}> = [
  { label: 'yesterday', preset: 'yesterday' },
  { label: 'today', preset: 'today' },
  { label: 'thisMonth', preset: 'thisMonth' },
  { label: 'lastMonth', preset: 'lastMonth' },
]

function buildCheckRanges(): typeof BASE_RANGES {
  const ranges = [...BASE_RANGES]
  if (DATE_ENV && /^\d{4}-\d{2}-\d{2}$/.test(DATE_ENV)) {
    ranges.push({
      label: `custom-${DATE_ENV}`,
      preset: 'custom',
      startDate: DATE_ENV,
      endDate: DATE_ENV,
    })
  }
  return ranges
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function fail(msg: string): void {
  failures.push(msg)
  console.log(`✗ FAIL: ${msg}`)
}

function warn(msg: string): void {
  warnings.push(msg)
  console.log(`⚠ ${msg}`)
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

function num(v: unknown): number {
  return Number(v ?? 0)
}

function diff(a: number, b: number): number {
  return Math.round((a - b) * 100) / 100
}

function countDuplicateMetricOrderNos(views: ReturnType<typeof filterViewsForCoreMetrics>): {
  duplicateOrderNos: string[]
  duplicateViewCount: number
} {
  const byNo = new Map<string, number>()
  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    byNo.set(no, (byNo.get(no) ?? 0) + 1)
  }
  const duplicateOrderNos = [...byNo.entries()].filter(([, c]) => c > 1).map(([no]) => no)
  const duplicateViewCount = [...byNo.values()].reduce((s, c) => s + (c > 1 ? c - 1 : 0), 0)
  return { duplicateOrderNos, duplicateViewCount }
}

async function checkGmvDedupe(params: {
  label: string
  preset: string
  startDate: string
  endDate: string
}): Promise<void> {
  await buildAndSetBusinessBoardCache({
    preset: params.preset,
    startDate: params.startDate,
    endDate: params.endDate,
  })
  const cacheEntry = getBusinessBoardCache(params.preset, params.startDate, params.endDate)
  const views = filterViewsForCoreMetrics(cacheEntry?.views ?? [])
  const { duplicateOrderNos, duplicateViewCount } = countDuplicateMetricOrderNos(views)

  if (duplicateViewCount === 0) {
    ok(`${params.label} 无重复 P 单号视图`)
    return
  }

  console.log(
    `${params.label} 重复 P 单号: ${duplicateOrderNos.length} 个，多余视图 ${duplicateViewCount} 条`,
  )
  if (duplicateOrderNos.length > 0) {
    console.log(`  样例: ${duplicateOrderNos.slice(0, 5).join(', ')}`)
  }

  let undedupedGmvCent = 0
  let undedupedSignedCent = 0
  for (const v of views) {
    if (v.includedInGmv) undedupedGmvCent += v.paymentBaseCent
    if (v.isEffectiveSigned) {
      undedupedSignedCent += v.actualSignAmountCent ?? v.actualSignedAmountCent
    }
  }
  const metrics = calculateBusinessMetrics(views)
  const gmvDiff = diff(centToYuan(undedupedGmvCent), metrics.totalGmv)
  const signedDiff = diff(centToYuan(undedupedSignedCent), metrics.actualSignedAmount)

  console.log(`  totalGmv: metrics=${metrics.totalGmv} undeduped=${centToYuan(undedupedGmvCent)}`)
  console.log(
    `  actualSignedAmount: metrics=${metrics.actualSignedAmount} undeduped=${centToYuan(undedupedSignedCent)}`,
  )

  if (duplicateViewCount > 0 && Math.abs(gmvDiff) > 0.01) {
    fail(`${params.label} GMV 去重前后差异 ${gmvDiff} 元（重复视图 ${duplicateViewCount}）`)
  } else {
    ok(`${params.label} calculateBusinessMetrics GMV 去重正常（diff=${gmvDiff}）`)
  }
  if (duplicateViewCount > 0 && Math.abs(signedDiff) > 0.01) {
    fail(`${params.label} 签收金额去重前后差异 ${signedDiff} 元`)
  } else {
    ok(`${params.label} calculateBusinessMetrics 签收金额去重正常（diff=${signedDiff}）`)
  }
}

async function checkOverviewValidAmount(params: {
  label: string
  preset: string
  startDate: string
  endDate: string
}): Promise<void> {
  const local = await executeBoardLocalQuery({
    preset: params.preset as import('../src/services/board-live-query.service').BoardLiveQueryPreset,
    startDate: params.startDate,
    endDate: params.endDate,
  })
  const localSummary = (local.summary ?? {}) as Record<string, unknown>
  const boardValid = num(localSummary.validSalesAmount ?? localSummary.effectiveGmv)

  await buildAndSetBusinessBoardCache({
    preset: params.preset,
    startDate: params.startDate,
    endDate: params.endDate,
  })
  const cacheEntry = getBusinessBoardCache(params.preset, params.startDate, params.endDate)
  const coreViews = filterViewsForCoreMetrics(cacheEntry?.views ?? [])
  const directValid = sumValidRevenueFromViews(coreViews).validAmountYuan
  const metricsValid = calculateBusinessMetrics(coreViews).validSalesAmount

  const detail = await buildBoardMetricDetail({
    metric: 'effectiveGmv',
    preset: params.preset,
    startDate: params.startDate,
    endDate: params.endDate,
    role: 'super_admin',
    username: 'verify-script',
  })
  const detailValue = num(detail.summary?.valueRaw ?? detail.summary?.value)

  console.log(`  board local-data validSalesAmount: ¥${boardValid}`)
  console.log(`  sumValidRevenueFromViews: ¥${directValid}`)
  console.log(`  calculateBusinessMetrics.validSalesAmount: ¥${metricsValid}`)
  console.log(`  metric-detail effectiveGmv: ¥${detailValue}`)

  const pairs: Array<[string, number, number]> = [
    ['local vs direct', boardValid, directValid],
    ['local vs metrics', boardValid, metricsValid],
    ['local vs detail', boardValid, detailValue],
  ]
  for (const [name, a, b] of pairs) {
    const d = diff(a, b)
    console.log(`  ${name}: diff=${d}`)
    if (Math.abs(d) > 1) {
      fail(`${params.label} ${name} 有效成交差异 ${d} 元 (>1)`)
    }
  }
  if (pairs.every(([, a, b]) => Math.abs(diff(a, b)) <= 1)) {
    ok(`${params.label} 经营总览有效成交口径一致`)
  }
}

async function checkDailyReport(dateKey: string): Promise<void> {
  section(`运营日报 ${dateKey}`)
  const report = await buildDailyOperationsReport({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const performanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const storeWide = sumValidRevenueFromViews(performanceViews)

  const summaryValid = report.summary.validAmountYuan
  const anchorSum = report.anchors.reduce((s, r) => s + r.validAmountCent, 0) / 100
  const boardValid = num(
    (
      await executeBoardLocalQuery({
        preset: 'custom',
        startDate: dateKey,
        endDate: dateKey,
      })
    ).summary?.validSalesAmount,
  )

  console.log(`  日报 summary.validAmountYuan: ¥${summaryValid}`)
  console.log(`  sumValidRevenueFromViews: ¥${storeWide.validAmountYuan}`)
  console.log(`  经营总览 local-data: ¥${boardValid}`)
  console.log(`  主播行合计: ¥${anchorSum.toFixed(2)}`)
  console.log(
    `  未归属有效成交: ${report.summary.unassignedValidOrderCount} 单 / ¥${report.summary.unassignedValidAmountYuan}`,
  )

  if (Math.abs(diff(summaryValid, storeWide.validAmountYuan)) > 0.01) {
    fail(`${dateKey} 日报 summary 与 sumValidRevenueFromViews 不一致`)
  } else {
    ok(`${dateKey} 日报 summary 使用全店有效成交`)
  }

  if (Math.abs(diff(summaryValid, boardValid)) > 1) {
    warn(`${dateKey} 日报 summary 与经营总览差异 ${diff(summaryValid, boardValid)} 元`)
  } else {
    ok(`${dateKey} 日报 summary 与经营总览一致`)
  }

  const expectedAnchorSum = diff(summaryValid, report.summary.unassignedValidAmountYuan)
  if (Math.abs(diff(anchorSum, expectedAnchorSum)) > 1) {
    warn(
      `${dateKey} 主播行合计 ${anchorSum} vs 全店-未归属 ${expectedAnchorSum}（diff=${diff(anchorSum, expectedAnchorSum)}）`,
    )
  }

  const scheduleTable = await getEffectiveScheduleTableForDate(dateKey)
  const liveAssignment = await loadAndAssignDailyReportLiveSessions({
    reportDate: dateKey,
    startDate: dateKey,
    endDate: dateKey,
    scheduleRows: scheduleTable.rows,
  })
  console.log(
    `  直播时长: 全部 ${report.summary.totalLiveDurationMinutes} 分 / 已归属 ${report.summary.assignedLiveDurationMinutes} 分 / 未匹配 ${report.summary.unassignedLiveDurationMinutes} 分`,
  )
  console.log(`  未匹配场次: ${liveAssignment.unassignedLiveSessionCount}`)

  if (report.summary.totalLiveDurationMinutes !== liveAssignment.assignedLiveDurationMinutes + liveAssignment.unassignedLiveDurationMinutes) {
    warn(`${dateKey} 直播总时长 ≠ 已归属 + 未匹配（可能含重叠去重逻辑）`)
  }

  const hourly = report.summary.hourlyAmountYuan
  const expectedHourly =
    report.summary.totalLiveDurationMinutes > 0
      ? Math.round((summaryValid / (report.summary.totalLiveDurationMinutes / 60)) * 100) / 100
      : null
  if (hourly != null && expectedHourly != null && Math.abs(diff(hourly, expectedHourly)) > 0.02) {
    fail(`${dateKey} 每小时成交公式不一致: ${hourly} vs ${expectedHourly}`)
  } else {
    ok(`${dateKey} 每小时成交 = 全店有效成交 ÷ 直播时长`)
  }
}

async function checkUnknownAfterSale(params: {
  label: string
  preset: string
  startDate: string
  endDate: string
}): Promise<number> {
  enableValidRevenueUnknownCollector()
  await buildAndSetBusinessBoardCache({
    preset: params.preset,
    startDate: params.startDate,
    endDate: params.endDate,
  })
  const cacheEntry = getBusinessBoardCache(params.preset, params.startDate, params.endDate)
  const views = filterViewsForCoreMetrics(cacheEntry?.views ?? [])
  for (const v of views) {
    explainValidRevenueOrder(v)
  }
  const drained = drainValidRevenueUnknownCollector()
  let totalSamples = 0
  for (const [status, samples] of Object.entries(drained)) {
    totalSamples += samples.length
    if (samples.length > 0) {
      console.log(`  未知售后「${status}」样例 ${samples.length} 条`)
      for (const s of samples.slice(0, 2)) {
        console.log(`    orderId=${s.orderId} orderStatus=${s.orderStatus}`)
      }
    }
  }
  return totalSamples
}

async function main(): Promise<void> {
  console.log('[verify:statistics-integrity] 只读体检，不改数据库')
  await bootstrapQualityBadCaseCache()

  section('数据基础')
  const orderCount = await prisma.xhsRawOrder.count()
  const liveCount = await prisma.xhsRawLiveSession.count()
  console.log(`XhsRawOrder: ${orderCount}, XhsRawLiveSession: ${liveCount}`)
  if (orderCount <= 0) fail('XhsRawOrder 必须 > 0')

  let unknownTotal = 0
  const ranges = buildCheckRanges()

  for (const r of ranges) {
    const range = resolveBusinessRange(
      r.preset as import('../src/utils/business-range').BusinessRangePreset,
      r.startDate,
      r.endDate,
    )
    section(`范围 ${r.label} (${range.startDate}~${range.endDate})`)

    await checkGmvDedupe({
      label: r.label,
      preset: r.preset,
      startDate: range.startDate,
      endDate: range.endDate,
    })
    await checkOverviewValidAmount({
      label: r.label,
      preset: r.preset,
      startDate: range.startDate,
      endDate: range.endDate,
    })
    unknownTotal += await checkUnknownAfterSale({
      label: r.label,
      preset: r.preset,
      startDate: range.startDate,
      endDate: range.endDate,
    })

    if (range.startDate === range.endDate) {
      await checkDailyReport(range.startDate)
    }
  }

  section('未知售后状态汇总')
  console.log(`采集样例总数: ${unknownTotal}`)
  if (unknownTotal > 1000) {
    fail(`未知售后样例 ${unknownTotal} > 1000，需排查 valid-revenue 规则`)
  } else if (unknownTotal > 100) {
    warn(`未知售后样例 ${unknownTotal} > 100，建议补充售后状态映射`)
  } else {
    ok(`未知售后样例 ${unknownTotal} 在可接受范围`)
  }

  section('汇总')
  console.log(`warnings: ${warnings.length}`)
  console.log(`failures: ${failures.length}`)
  for (const w of warnings) console.log(`  ⚠ ${w}`)
  for (const f of failures) console.log(`  ✗ ${f}`)

  if (failures.length > 0) {
    console.log('\nverify:statistics-integrity FAIL')
    process.exit(1)
  }
  console.log('\nverify:statistics-integrity OK')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
