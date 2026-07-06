/**
 * 主播业绩 + 主播日报 口径总体验收（只读，不改库）
 *
 * npm run verify:anchor-performance-daily-report-integrity
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache, loadAllQualityBadCases } from '../src/services/quality-badcase-store.service'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import {
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from '../src/services/board-scoped-views.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import {
  buildAnchorDrill,
  buildAnchorQualityRefundDrill,
} from '../src/services/board-drill.service'
import { buildDailyReport } from '../src/services/daily-report.service'
import {
  countDailyReportOrders,
  isDailyReportInvalidOrder,
  isDailyReportShippedOrder,
  listDailyReportShippedOrders,
  roundMoneyYuan,
} from '../src/services/daily-report-order.util'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { isValidRevenueOrder } from '../src/services/valid-revenue-order.service'
import { isLowPriceBrushOrderView } from '../src/services/low-price-brush-order.service'
import { resolveDailyReportAnchorsForDate } from '../src/services/anchor-performance-attribution.service'
import { getAnchorConfigSync } from '../src/services/anchor.service'

config({ path: path.resolve(__dirname, '../.env') })

const AUDIT_DATES = ['2026-07-04', '2026-07-03', '2026-06-01'] as const
const TARGET_QUALITY_ORDER = 'P795876371867202831'
const TARGET_AFTER_SALE = 'R6720283133492612'
const TARGET_QUALITY_ANCHOR = '飞云'

const FIXED_20260704_SHIPPED: Record<string, number> = {
  子杰: 3,
  小艺: 2,
  飞云: 3,
  小红: 0,
}
const FIXED_20260704_INVALID: Record<string, number> = {
  小红: 2,
}
const FIXED_20260704_TOTAL_SHIPPED = 8

const failures: string[] = []
const warnings: string[] = []

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

function amountClose(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol
}

function countEq(a: unknown, b: unknown): boolean {
  return Math.round(num(a)) === Math.round(num(b))
}

function rowMetric(row: Record<string, unknown>) {
  return {
    anchorName: String(row.anchorName ?? ''),
    gmv: num(row.totalGmv ?? row.gmv),
    valid: num(row.validSalesAmount ?? row.effectiveGmv),
    paidCount: num(row.orderCount ?? row.paidOrderCount),
    refundCount: num(row.returnCount ?? row.refundOrderCount),
    refundAmount: num(row.returnAmount ?? row.refundAmount),
    qualityCount: num(row.qualityReturnCount),
    signedCount: num(row.signedOrderCount ?? row.actualSignedCount),
  }
}

function checkDailyReportImageSheetStatic(): void {
  section('日报图片静态检查 DailyReportImageSheet')
  const filePath = path.resolve(
    __dirname,
    '../../web/src/components/board/DailyReportImageSheet.tsx',
  )
  const text = fs.readFileSync(filePath, 'utf-8')
  const required = [
    '真实发货订单',
    '已剔除售后/关闭/取消',
    'productTitle',
    'amountYuan',
    '本场关闭/退货单',
    '不计入真实发货',
  ]
  for (const token of required) {
    if (!text.includes(token)) fail(`DailyReportImageSheet 缺少文案/字段: ${token}`)
    else ok(`含 ${token}`)
  }
  if (text.includes('font-mono') && text.includes('order.orderNo')) {
    fail('DailyReportImageSheet 不应在图片中展示订单号')
  } else {
    ok('日报图片展示商品标题而非订单号')
  }
  if (text.includes('qualityReturnRate')) {
    fail('DailyReportImageSheet 不应展示品退率')
  } else {
    ok('日报图片未展示品退率')
  }
}

function checkAnchorPerformanceSignedAmountLabel(): void {
  section('主播业绩页已签收金额文案')
  const files = [
    '../../web/src/pages/board/AnchorPerformanceTab.tsx',
    '../../web/src/components/board/AnchorLeaderboardPanel.tsx',
    '../../web/src/components/board/MobileAnchorLeaderboardCards.tsx',
  ]
  for (const rel of files) {
    const text = fs.readFileSync(path.resolve(__dirname, rel), 'utf-8')
    if (text.includes('有效成交额')) {
      fail(`${rel} 仍展示「有效成交额」，应改为「已签收金额」`)
    } else if (!text.includes('已签收金额')) {
      fail(`${rel} 缺少「已签收金额」展示`)
    } else {
      ok(`${path.basename(rel)} 已使用已签收金额`)
    }
  }
}

function checkAnchorPerformanceNoQualityReturnRate(): void {
  section('主播业绩页不展示品退率')
  const files = [
    '../../web/src/pages/board/AnchorPerformanceTab.tsx',
    '../../web/src/components/board/AnchorLeaderboardPanel.tsx',
    '../../web/src/components/board/MobileAnchorLeaderboardCards.tsx',
  ]
  for (const rel of files) {
    const text = fs.readFileSync(path.resolve(__dirname, rel), 'utf-8')
    if (/qualityReturnRate/.test(text)) {
      fail(`${rel} 含 qualityReturnRate 展示`)
    } else {
      ok(`${path.basename(rel)} 未展示品退率`)
    }
  }
}

async function auditInvalidPoolConsistency(dateKey: string): Promise<void> {
  section(`${dateKey} 关闭/退货单 vs 真实发货基础池`)
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const config = getAnchorConfigSync()
  const anchors = resolveDailyReportAnchorsForDate(config, dateKey)

  for (const anchor of anchors) {
    const performanceViews = await getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      anchor.anchorId,
      anchor.anchorName,
    )
    const { invalidOrderCount } = countDailyReportOrders(performanceViews)
    const shippedLines = listDailyReportShippedOrders(performanceViews, anchor.anchorName)

    const invalidOrders: string[] = []
    const brushInInvalid: string[] = []
    const unpaidInInvalid: string[] = []

    for (const v of dedupeViewsByMetricOrderNo(performanceViews)) {
      const orderNo = resolveMetricOrderNo(v) || v.orderId
      if (!resolveMetricOrderNo(v) && v.paymentBaseCent <= 0) continue
      if (!isDailyReportInvalidOrder(v)) continue
      invalidOrders.push(orderNo)
      if (isLowPriceBrushOrderView(v)) brushInInvalid.push(orderNo)
      if (!v.includedInGmv || v.paymentBaseCent <= 0) unpaidInInvalid.push(orderNo)
    }

    if (brushInInvalid.length > 0) {
      fail(`${anchor.anchorName} 关闭/退货池含低价刷单: ${brushInInvalid.join(', ')}`)
    }
    if (unpaidInInvalid.length > 0) {
      warn(`${anchor.anchorName} 关闭/退货池含未支付单: ${unpaidInInvalid.join(', ')}`)
    }

    const overlap = shippedLines.filter((l) => invalidOrders.includes(l.orderNo))
    if (overlap.length > 0) {
      fail(`${anchor.anchorName} 真实发货与关闭/退货重叠: ${overlap.map((o) => o.orderNo).join(', ')}`)
    } else if (invalidOrders.length > 0 || shippedLines.length > 0) {
      ok(`${anchor.anchorName} 真实发货 ${shippedLines.length} 单 / 关闭退货 ${invalidOrderCount} 单，池互斥`)
    }
  }
  ok('关闭/退货单与真实发货均基于 performanceViews（已剔低价刷单）')
}

async function auditAnchorPerformance(dateKey: string): Promise<void> {
  section(`${dateKey} 主播业绩汇总`)
  await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })

  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
    role: 'super_admin',
    username: 'verify-script',
  })
  const apSummary = (local.anchorPerformanceSummary ?? {}) as Record<string, unknown>
  const leaderboard = (local.anchorLeaderboard ?? []) as Array<Record<string, unknown>>
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const performanceViews = await getAnchorPerformanceViews(
    scoped.views,
    scoped.rawByMatch,
  )

  let sumGmv = 0
  let sumCount = 0
  let sumValid = 0
  let sumValidCount = 0
  let brushInPerformance = 0

  for (const v of dedupeViewsByMetricOrderNo(performanceViews)) {
    if (isLowPriceBrushOrderView(v)) brushInPerformance++
  }
  if (brushInPerformance > 0) fail(`performanceViews 含 ${brushInPerformance} 条低价刷单`)

  for (const row of leaderboard) {
    const m = rowMetric(row)
    sumGmv += m.gmv
    sumCount += m.paidCount
    sumValid += m.valid
    sumValidCount += m.signedCount
  }

  const apGmv = num(apSummary.totalGmv ?? apSummary.gmv)
  const apCount = num(apSummary.orderCount ?? apSummary.paidOrderCount)
  const apValid = num(apSummary.validSalesAmount ?? apSummary.effectiveGmv)

  if (amountClose(apGmv, sumGmv)) ok(`支付金额合计 = anchorPerformanceSummary (${apGmv})`)
  else fail(`支付金额 summary ${apGmv} vs 行合计 ${sumGmv}`)

  if (countEq(apCount, sumCount)) ok(`支付单数合计 = anchorPerformanceSummary (${apCount})`)
  else fail(`支付单数 summary ${apCount} vs 行合计 ${sumCount}`)

  if (amountClose(apValid, sumValid)) ok(`有效成交额合计 = anchorPerformanceSummary (${apValid})`)
  else fail(`有效成交 summary ${apValid} vs 行合计 ${sumValid}`)

  const manualValidCount = dedupeViewsByMetricOrderNo(performanceViews).filter((v) =>
    isValidRevenueOrder(v),
  ).length
  if (countEq(sumValidCount, manualValidCount) || countEq(num(apSummary.signedOrderCount), manualValidCount)) {
    ok(`有效成交单数 ≈ 手工重算 (${manualValidCount})`)
  } else {
    warn(
      `有效成交单数: 行合计 ${sumValidCount} / summary ${num(apSummary.signedOrderCount)} / 手工 ${manualValidCount}`,
    )
  }

  const unassigned = leaderboard.find((r) => String(r.anchorName) === '未归属')
  if (unassigned) ok(`未归属行存在: ${num(unassigned.orderCount)} 单`)
  else warn('未归属行缺失（可能当日无未归属订单）')

  section(`${dateKey} 主播行 vs 订单抽屉`)
  for (const row of leaderboard) {
    const m = rowMetric(row)
    if (m.anchorName === '未归属' && m.paidCount === 0) continue

    const drillAll = await buildAnchorDrill({
      preset: 'custom',
      startDate: dateKey,
      endDate: dateKey,
      anchorId: String(row.anchorId ?? ''),
      anchorName: m.anchorName,
      statusType: 'all',
      page: 1,
      pageSize: 5000,
      role: 'super_admin',
      username: 'verify-script',
    })
    const stats = (drillAll.stats ?? {}) as Record<string, unknown>
    const drillTotal = num(drillAll.total ?? drillAll.items?.length)

    if (!countEq(m.paidCount, stats.orderCount ?? stats.paidOrderCount)) {
      fail(`${m.anchorName} 支付单数 ${m.paidCount} vs 抽屉 stats ${num(stats.orderCount)}`)
    }
    if (!amountClose(m.gmv, num(stats.totalGmv ?? stats.gmv))) {
      fail(`${m.anchorName} 支付金额 ${m.gmv} vs 抽屉 ${num(stats.totalGmv)}`)
    }
    if (!amountClose(m.valid, num(stats.validSalesAmount ?? stats.effectiveGmv))) {
      fail(`${m.anchorName} 有效成交 ${m.valid} vs 抽屉 ${num(stats.validSalesAmount)}`)
    }
    if (!countEq(m.qualityCount, stats.qualityReturnCount)) {
      fail(`${m.anchorName} 品退 ${m.qualityCount} vs 抽屉 ${num(stats.qualityReturnCount)}`)
    }

    const qrDrill = await buildAnchorQualityRefundDrill({
      preset: 'custom',
      startDate: dateKey,
      endDate: dateKey,
      anchorName: m.anchorName,
      page: 1,
      pageSize: 500,
      role: 'super_admin',
      username: 'verify-script',
    })
    const qrTotal = qrDrill.pagination?.total ?? qrDrill.rows?.length ?? 0
    if (!countEq(m.qualityCount, qrTotal)) {
      fail(`${m.anchorName} 品退单数 ${m.qualityCount} vs 品退抽屉 ${qrTotal}`)
    }

    if (countEq(m.paidCount, drillTotal) || countEq(m.paidCount, stats.orderCount)) {
      ok(`${m.anchorName} 行 vs 抽屉对齐 (${m.paidCount} 单)`)
    }
  }
}

async function auditDailyReport(dateKey: string): Promise<void> {
  section(`${dateKey} 主播日报真实发货`)
  const report = await buildDailyReport({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })

  const summaryLines = report.summary.shippedOrders ?? []
  const summarySum = roundMoneyYuan(summaryLines.reduce((s, l) => s + l.amountYuan, 0))

  if (amountClose(summarySum, report.summary.totalShippedAmountYuan)) {
    ok(`明细合计 ¥${summarySum.toFixed(2)} = 总览真实发货 ¥${report.summary.totalShippedAmountYuan.toFixed(2)}`)
  } else {
    fail(
      `明细合计 ¥${summarySum.toFixed(2)} ≠ 总览 ¥${report.summary.totalShippedAmountYuan.toFixed(2)}`,
    )
  }

  if (countEq(summaryLines.length, report.summary.totalSoldOrderCount)) {
    ok(`明细笔数 ${summaryLines.length} = 真实卖出 ${report.summary.totalSoldOrderCount}`)
  } else {
    fail(`明细笔数 ${summaryLines.length} ≠ 真实卖出 ${report.summary.totalSoldOrderCount}`)
  }

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const config = getAnchorConfigSync()
  const anchors = resolveDailyReportAnchorsForDate(config, dateKey)

  for (const anchor of anchors) {
    const views = await getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      anchor.anchorId,
      anchor.anchorName,
    )
    const reportRow = report.anchors.find((r) => r.anchorName === anchor.anchorName)
    if (!reportRow) continue

    for (const v of views) {
      const orderNo = resolveMetricOrderNo(v) || v.orderId
      const inList = (reportRow.shippedOrders ?? []).some((l) => l.orderNo === orderNo)
      if (isDailyReportShippedOrder(v) && !inList && reportRow.shippedOrders) {
        fail(`${anchor.anchorName} 应计入真实发货但未列出: ${orderNo}`)
      }
      if (inList && (isDailyReportInvalidOrder(v) || isLowPriceBrushOrderView(v))) {
        fail(`${anchor.anchorName} 不应计入真实发货: ${orderNo}`)
      }
    }

    const lineSum = roundMoneyYuan(
      (reportRow.shippedOrders ?? []).reduce((s, l) => s + l.amountYuan, 0),
    )
    if (!amountClose(lineSum, reportRow.shippedAmountYuan)) {
      fail(
        `${anchor.anchorName} 明细合计 ¥${lineSum} ≠ 真实发货 ¥${reportRow.shippedAmountYuan}`,
      )
    }
  }

  if (dateKey === '2026-07-04') {
    section('2026-07-04 固定验收')
    if (report.summary.totalSoldOrderCount === 0) {
      warn('本地库无 2026-07-04 支付订单，跳过固定单数验收（请在生产环境复验）')
    } else {
      let totalShipped = 0
      for (const [name, expected] of Object.entries(FIXED_20260704_SHIPPED)) {
        const row = report.anchors.find((r) => r.anchorName === name)
        const actual = row?.soldOrderCount ?? 0
        totalShipped += actual
        if (countEq(actual, expected)) ok(`${name} 真实发货 ${actual} 单`)
        else fail(`${name} 真实发货应为 ${expected} 单，实际 ${actual}`)
      }
      for (const [name, expected] of Object.entries(FIXED_20260704_INVALID)) {
        const row = report.anchors.find((r) => r.anchorName === name)
        const actual = row?.invalidOrderCount ?? 0
        if (countEq(actual, expected)) ok(`${name} 关闭/退货 ${actual} 单`)
        else fail(`${name} 关闭/退货应为 ${expected} 单，实际 ${actual}`)
      }
      if (countEq(report.summary.totalSoldOrderCount, FIXED_20260704_TOTAL_SHIPPED)) {
        ok(`全店真实发货 ${FIXED_20260704_TOTAL_SHIPPED} 单`)
      } else {
        fail(
          `全店真实发货应为 ${FIXED_20260704_TOTAL_SHIPPED}，实际 ${report.summary.totalSoldOrderCount}`,
        )
      }
    }
  }
}

async function auditQualityRefundGoldenOrder(): Promise<void> {
  section('品退黄金单 P795876371867202831')
  await bootstrapQualityBadCaseCache()

  const officialCase = (await loadAllQualityBadCases()).find(
    (c) => c.packageId === TARGET_QUALITY_ORDER || c.matchedOrderNo === TARGET_QUALITY_ORDER,
  )
  if (!officialCase) {
    fail(`官方品退 QualityBadCase 未命中 ${TARGET_QUALITY_ORDER}`)
  } else {
    ok(`官方品退存在 matchStatus=${officialCase.matchStatus}`)
  }

  const workbench = await prisma.xhsAfterSalesWorkbenchCache.findFirst({
    where: { orderNo: TARGET_QUALITY_ORDER },
  })
  if (workbench) {
    ok(`售后工作台缓存存在`)
  } else {
    warn('售后工作台缓存未找到，继续用品退抽屉核对')
  }

  const qrDrill = await buildAnchorQualityRefundDrill({
    preset: 'custom',
    startDate: '2026-06-01',
    endDate: '2026-06-01',
    anchorName: TARGET_QUALITY_ANCHOR,
    page: 1,
    pageSize: 500,
    role: 'super_admin',
    username: 'verify-script',
  })
  const qrRows = qrDrill.rows ?? []
  const qrTotal = qrDrill.pagination?.total ?? qrRows.length
  const hit = qrRows.find(
    (item) =>
      String(item.orderNo ?? '').includes(TARGET_QUALITY_ORDER) ||
      String(item.afterSaleOrderNo ?? '').includes(TARGET_AFTER_SALE),
  )
  if (!hit && qrTotal === 0) {
    warn(`${TARGET_QUALITY_ORDER} 品退抽屉为空（可能下单日不在 2026-06-01 范围）`)
  } else if (!hit) {
    fail(`${TARGET_QUALITY_ORDER} 未出现在 ${TARGET_QUALITY_ANCHOR} 品退抽屉 (${qrTotal} 条)`)
  } else {
    ok(`${TARGET_QUALITY_ORDER} 仍计入 ${TARGET_QUALITY_ANCHOR} 品退`)
    const afterSaleText = JSON.stringify(hit)
    if (afterSaleText.includes(TARGET_AFTER_SALE)) {
      ok(`售后单号 ${TARGET_AFTER_SALE} 可展示`)
    } else {
      warn(`品退抽屉 JSON 未直接含 ${TARGET_AFTER_SALE}，请人工核对`)
    }
    if (
      hit.officialQualityReasonText ||
      hit.afterSaleReasonText ||
      hit.afterSaleFinalReasonText ||
      hit.qianfanDetailAvailable
    ) {
      ok('品退抽屉含原因/详情字段')
    } else {
      warn('品退抽屉详情字段较少')
    }
  }
}

async function printDbCounts(): Promise<void> {
  section('数据库数量')
  const counts = {
    XhsRawOrder: await prisma.xhsRawOrder.count(),
    XhsRawLiveSession: await prisma.xhsRawLiveSession.count(),
    QualityBadCase: await prisma.qualityBadCase.count(),
    XhsAfterSalesWorkbenchCache: await prisma.xhsAfterSalesWorkbenchCache.count(),
    PlatformCredential: await prisma.platformCredential.count(),
    User: await prisma.user.count(),
  }
  for (const [k, v] of Object.entries(counts)) {
    console.log(`${k}: ${v}`)
  }
}

async function main(): Promise<void> {
  console.log('[verify-anchor-performance-daily-report-integrity] 开始\n')
  checkDailyReportImageSheetStatic()
  checkAnchorPerformanceSignedAmountLabel()
  checkAnchorPerformanceNoQualityReturnRate()
  await printDbCounts()
  await auditQualityRefundGoldenOrder()

  for (const dateKey of AUDIT_DATES) {
    await auditInvalidPoolConsistency(dateKey)
    await auditAnchorPerformance(dateKey)
    await auditDailyReport(dateKey)
  }

  section('汇总')
  if (warnings.length > 0) {
    console.log(`警告 ${warnings.length} 条`)
    for (const w of warnings) console.log(`  ⚠ ${w}`)
  }
  if (failures.length === 0) {
    console.log('verify-anchor-performance-daily-report-integrity OK')
  } else {
    console.log(`verify-anchor-performance-daily-report-integrity FAIL (${failures.length} 项)`)
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exit(1)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
