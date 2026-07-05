/**
 * 主播日报「真实发货」口径核对（单日）
 * 用法: tsx apps/server/scripts/verify-anchor-daily-report-shipped.ts --date=2026-07-04
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildDailyReport } from '../src/services/daily-report.service'
import {
  isDailyReportInvalidOrder,
  isDailyReportShippedOrder,
  listDailyReportShippedOrders,
  sumDailyReportShippedFromViews,
} from '../src/services/daily-report-order.util'
import { getAnchorPerformanceViews, getBoardScopedViewsForRange } from '../src/services/board-scoped-views.service'
import { resolveDailyReportAnchorsForDate } from '../src/services/anchor-performance-attribution.service'
import { getAnchorConfigSync } from '../src/services/anchor.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { addDaysShanghai, formatDateKeyShanghai } from '../src/utils/business-timezone'
import { prisma } from '../src/lib/prisma'

config({ path: path.resolve(__dirname, '../.env') })

function parseDate(): string {
  const arg = process.argv.find((a) => a.startsWith('--date='))
  if (arg) {
    const d = arg.slice('--date='.length).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  }
  return addDaysShanghai(formatDateKeyShanghai(new Date()), -1)
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  console.log(`  ✗ FAIL: ${msg}`)
}

async function main(): Promise<void> {
  const dateKey = parseDate()
  console.log(`[verify-anchor-daily-report-shipped] 日期 ${dateKey}\n`)

  const report = await buildDailyReport({
    preset: 'yesterday',
    startDate: dateKey,
    endDate: dateKey,
  })

  const failures: string[] = []
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const config = getAnchorConfigSync()
  const reportAnchors = resolveDailyReportAnchorsForDate(config, dateKey)

  console.log('=== 日报总览 ===')
  console.log(
    `真实发货 ¥${report.summary.totalShippedAmountYuan} / ${report.summary.totalSoldOrderCount} 单`,
  )
  console.log(`关闭/退货单 ${report.summary.totalInvalidOrderCount} 单`)
  console.log(`汇总真实发货订单 ${report.summary.shippedOrders?.length ?? 0} 笔`)
  for (const line of report.summary.shippedOrders ?? []) {
    console.log(`  ${line.orderNo} ¥${line.amountYuan.toFixed(2)}`)
  }

  console.log('\n=== 各主播 ===')
  for (const row of report.anchors) {
    if (
      row.shippedAmountYuan <= 0 &&
      row.soldOrderCount <= 0 &&
      row.invalidOrderCount <= 0 &&
      (row.shippedOrders?.length ?? 0) === 0
    ) {
      continue
    }
    console.log(
      `\n${row.anchorName}: 真实发货 ¥${row.shippedAmountYuan} / ${row.soldOrderCount} 单 | 关闭/退货 ${row.invalidOrderCount} 单`,
    )
    for (const line of row.shippedOrders ?? []) {
      console.log(`  ✓ ${line.orderNo} ¥${line.amountYuan.toFixed(2)}`)
    }
  }

  console.log('\n=== 口径交叉核对 ===')
  const summaryOrderSum = (report.summary.shippedOrders ?? []).reduce(
    (sum, line) => sum + line.amountYuan,
    0,
  )
  if (Math.abs(summaryOrderSum - report.summary.totalShippedAmountYuan) <= 1) {
    ok(`汇总订单金额合计 ≈ 真实发货总额 (¥${summaryOrderSum.toFixed(2)})`)
  } else {
    fail(
      `汇总订单金额 ¥${summaryOrderSum.toFixed(2)} ≠ 真实发货 ¥${report.summary.totalShippedAmountYuan}`,
    )
    failures.push('summary-amount')
  }

  if ((report.summary.shippedOrders?.length ?? 0) === report.summary.totalSoldOrderCount) {
    ok('汇总订单笔数 = 真实卖出单数')
  } else {
    fail(
      `汇总订单笔数 ${report.summary.shippedOrders?.length ?? 0} ≠ 真实卖出 ${report.summary.totalSoldOrderCount}`,
    )
    failures.push('summary-count')
  }

  for (const anchor of reportAnchors) {
    const views = await getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      anchor.anchorId,
      anchor.anchorName,
    )
    const recalc = sumDailyReportShippedFromViews(views)
    const recalcLines = listDailyReportShippedOrders(views)
    const reportRow = report.anchors.find((r) => r.anchorName === anchor.anchorName)
    if (!reportRow) continue

    if (recalc.shippedAmountYuan !== reportRow.shippedAmountYuan) {
      fail(
        `${anchor.anchorName} 真实发货金额不一致：日报=${reportRow.shippedAmountYuan} 重算=${recalc.shippedAmountYuan}`,
      )
      failures.push(`${anchor.anchorName}-amount`)
    } else if (recalc.soldOrderCount > 0 || reportRow.shippedAmountYuan > 0) {
      ok(`${anchor.anchorName} 真实发货 ¥${reportRow.shippedAmountYuan} / ${reportRow.soldOrderCount} 单`)
    }

    if (recalcLines.length !== (reportRow.shippedOrders?.length ?? 0)) {
      fail(
        `${anchor.anchorName} 订单明细笔数不一致：日报=${reportRow.shippedOrders?.length ?? 0} 重算=${recalcLines.length}`,
      )
      failures.push(`${anchor.anchorName}-lines`)
    }

    for (const v of views) {
      const orderNo = resolveMetricOrderNo(v) || v.orderId
      const inShippedList = (reportRow.shippedOrders ?? []).some((l) => l.orderNo === orderNo)
      if (isDailyReportShippedOrder(v) && !inShippedList && reportRow.shippedOrders) {
        fail(`${anchor.anchorName} 订单 ${orderNo} 应计入真实发货但未出现在明细`)
        failures.push(`${anchor.anchorName}-missing-${orderNo}`)
      }
      if (inShippedList && isDailyReportInvalidOrder(v)) {
        fail(`${anchor.anchorName} 订单 ${orderNo} 为售后/关闭/取消却出现在真实发货明细`)
        failures.push(`${anchor.anchorName}-invalid-${orderNo}`)
      }
    }
  }

  console.log('\n=== 汇总 ===')
  if (failures.length === 0) {
    console.log('verify-anchor-daily-report-shipped OK')
  } else {
    console.log(`verify-anchor-daily-report-shipped FAIL (${failures.length} 项)`)
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
