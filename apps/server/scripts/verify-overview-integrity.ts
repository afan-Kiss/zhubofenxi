/**
 * 经营总览有效成交额抽屉严谨性验收
 * 用法: DATE=2026-07-03 npm run verify:overview-integrity
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import { explainValidRevenueOrder } from '../src/services/valid-revenue-order.service'
import { getBoardScopedViewsForRange } from '../src/services/board-scoped-views.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

config({ path: path.resolve(__dirname, '../.env') })

const DATE_ENV = process.env.DATE?.trim() || '2026-07-03'
const FOCUS_VALID_ORDER = 'P798605049367374181'
const FOCUS_EXCLUDED_ORDER = 'P798618403087295271'

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

function diffYuan(a: number, b: number): number {
  return Math.round((a - b) * 100) / 100
}

function rowOrderNo(row: Record<string, unknown>): string {
  return String(row.orderNo ?? row.packageId ?? '').trim()
}

function findViewByOrderNo(
  views: AnalyzedOrderView[],
  orderNo: string,
): AnalyzedOrderView | undefined {
  return dedupeViewsByMetricOrderNo(views).find(
    (v) => (resolveMetricOrderNo(v) || v.orderId) === orderNo,
  )
}

async function main(): Promise<void> {
  console.log('[verify:overview-integrity] 只读体检，不改数据库')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE_ENV)) {
    fail(`DATE 格式无效: ${DATE_ENV}`)
    process.exit(1)
  }

  await bootstrapQualityBadCaseCache()

  section(`经营总览 summary ${DATE_ENV}`)
  await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate: DATE_ENV,
    endDate: DATE_ENV,
  })
  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: DATE_ENV,
    endDate: DATE_ENV,
  })
  const summary = (local.summary ?? {}) as Record<string, unknown>

  const totalGmv = num(summary.totalGmv ?? summary.gmv)
  const validSalesAmount = num(summary.validSalesAmount ?? summary.effectiveGmv)
  const orderCount = num(summary.orderCount ?? summary.paidOrderCount)
  const returnRate = summary.returnRate ?? summary.refundRate ?? '—'
  const qualityReturnCount = num(summary.qualityReturnCount)

  console.log(`  totalGmv: ¥${totalGmv}`)
  console.log(`  validSalesAmount: ¥${validSalesAmount}`)
  console.log(`  orderCount: ${orderCount}`)
  console.log(`  returnRate: ${returnRate}`)
  console.log(`  qualityReturnCount: ${qualityReturnCount}`)

  if (Math.abs(diffYuan(validSalesAmount, 2017)) > 0.01) {
    fail(`有效成交额应为 ¥2017，实际 ¥${validSalesAmount}`)
  } else {
    ok(`有效成交额 ¥${validSalesAmount}`)
  }

  section(`有效成交额抽屉 ${DATE_ENV}`)
  const detail = await buildBoardMetricDetail({
    metric: 'effectiveGmv',
    preset: 'custom',
    startDate: DATE_ENV,
    endDate: DATE_ENV,
    role: 'super_admin',
    username: 'verify-script',
    page: 1,
    pageSize: 5000,
  })

  const detailValid = num(detail.summary?.valueRaw ?? detail.summary?.value)
  const matchedOrders = num(detail.summary?.matchedOrders)
  const rows = (detail.rows ?? []) as Array<Record<string, unknown>>

  console.log(`  detail.valueRaw: ¥${detailValid}`)
  console.log(`  detail.matchedOrders: ${matchedOrders}`)
  console.log(`  detail.rows: ${rows.length}`)

  if (Math.abs(diffYuan(detailValid, validSalesAmount)) > 0.01) {
    fail(`detail.valueRaw ¥${detailValid} ≠ overview.validSalesAmount ¥${validSalesAmount}`)
  } else {
    ok('detail.valueRaw 与 overview.validSalesAmount 一致')
  }

  if (matchedOrders !== 1) {
    fail(`有效成交订单数应为 1，实际 ${matchedOrders}`)
  } else {
    ok('有效成交订单数 = 1')
  }

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: DATE_ENV,
    endDate: DATE_ENV,
    role: 'super_admin',
    username: 'verify-script',
  })
  const views = filterViewsForCoreMetrics(scoped.views)

  for (const row of rows) {
    const orderNo = rowOrderNo(row)
    const view = findViewByOrderNo(views, orderNo)
    if (!view) {
      fail(`抽屉行 ${orderNo} 在 scoped views 中找不到`)
      continue
    }
    const ex = explainValidRevenueOrder(view)
    if (!ex.valid) {
      fail(`抽屉含无效成交订单 ${orderNo}`)
      console.log(
        `    payTime=${row.orderTime ?? view.orderTimeText} live=${view.liveAccountName}` +
          ` anchor=${view.anchorName} status=${view.orderStatusText}` +
          ` afterSale=${view.afterSaleStatusText ?? view.afterSaleStatusLabel}` +
          ` payCent=${view.paymentBaseCent} effCent=${view.effectiveGmvCent} reason=${ex.reason}`,
      )
    }
  }

  if (rows.length > 0 && failures.filter((f) => f.includes('无效成交')).length === 0) {
    ok('抽屉 rows 均为有效成交订单')
  }

  const rowIds = new Set(rows.map(rowOrderNo).filter(Boolean))
  if (rowIds.has(FOCUS_VALID_ORDER)) {
    ok(`${FOCUS_VALID_ORDER} 在有效成交额明细中`)
  } else {
    fail(`${FOCUS_VALID_ORDER} 不在有效成交额明细中`)
  }

  if (rowIds.has(FOCUS_EXCLUDED_ORDER)) {
    fail(`${FOCUS_EXCLUDED_ORDER} 不应出现在有效成交额默认明细中`)
  } else {
    ok(`${FOCUS_EXCLUDED_ORDER} 不在有效成交额默认明细中`)
  }

  const excludedView = findViewByOrderNo(views, FOCUS_EXCLUDED_ORDER)
  if (excludedView) {
    const ex = explainValidRevenueOrder(excludedView)
    if (!ex.valid) {
      ok(`${FOCUS_EXCLUDED_ORDER} explainValidRevenueOrder valid=false (${ex.reason})`)
    } else {
      fail(`${FOCUS_EXCLUDED_ORDER} 应无效成交，但 explain 返回 valid=true`)
    }
  } else {
    warn(`${FOCUS_EXCLUDED_ORDER} 不在本期 scoped views（本地库可能未同步到该日）`)
  }

  section('汇总')
  console.log(`warnings: ${warnings.length}`)
  console.log(`failures: ${failures.length}`)
  for (const w of warnings) console.log(`  ⚠ ${w}`)
  for (const f of failures) console.log(`  ✗ ${f}`)

  if (failures.length > 0) {
    console.log('\nverify:overview-integrity FAIL')
    process.exit(1)
  }
  console.log('\nverify:overview-integrity OK')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
