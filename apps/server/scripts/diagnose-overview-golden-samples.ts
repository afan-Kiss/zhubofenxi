/**
 * 经营总览黄金样本只读诊断（业务库）。
 * 样本缺失/金额变化时仅提示，不作为发布阻断。
 *
 * npm run diagnose:overview-golden-samples
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import { getBoardScopedViewsForRange } from '../src/services/board-scoped-views.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { explainValidRevenueOrder } from '../src/services/valid-revenue-order.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

config({ path: path.resolve(__dirname, '../.env') })

const DATE_ENV = process.env.DATE?.trim() || '2026-07-03'
const FOCUS_VALID_ORDER = 'P798605049367374181'
const FOCUS_EXCLUDED_ORDER = 'P798618403087295271'
const EXPECTED_VALID_YUAN = 2017

const notes: string[] = []

function note(msg: string): void {
  notes.push(msg)
  console.log(`ℹ ${msg}`)
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

function num(v: unknown): number {
  return Number(v ?? 0)
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
  console.log('[diagnose:overview-golden-samples] 只读诊断，非发布阻断')
  console.log(`DATE=${DATE_ENV}`)
  console.log(`依赖订单: ${FOCUS_VALID_ORDER}（有效）、${FOCUS_EXCLUDED_ORDER}（应排除）`)
  console.log(`期望有效成交额: ¥${EXPECTED_VALID_YUAN}\n`)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE_ENV)) {
    note(`DATE 格式无效: ${DATE_ENV}`)
    process.exit(0)
  }

  const orderCount = await prisma.xhsRawOrder.count({
    where: {
      OR: [
        { paymentTime: { gte: new Date(`${DATE_ENV}T00:00:00.000+08:00`), lte: new Date(`${DATE_ENV}T23:59:59.999+08:00`) } },
        { orderTime: { gte: new Date(`${DATE_ENV}T00:00:00.000+08:00`), lte: new Date(`${DATE_ENV}T23:59:59.999+08:00`) } },
      ],
    },
  })
  if (orderCount === 0) {
    note(`样本不存在：${DATE_ENV} 本地库无支付/下单订单（发布请用 verify:overview-integrity fixture）`)
    process.exit(0)
  }

  await bootstrapQualityBadCaseCache()
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
  const validSalesAmount = num(summary.validSalesAmount ?? summary.effectiveGmv)
  console.log(`validSalesAmount=¥${validSalesAmount} orderCount=${num(summary.orderCount)}`)

  if (Math.abs(validSalesAmount - EXPECTED_VALID_YUAN) > 0.01) {
    note(`样本金额变化：有效成交额期望 ¥${EXPECTED_VALID_YUAN}，实际 ¥${validSalesAmount}`)
  } else {
    ok(`有效成交额仍为 ¥${EXPECTED_VALID_YUAN}`)
  }

  const detail = await buildBoardMetricDetail({
    metric: 'effectiveGmv',
    preset: 'custom',
    startDate: DATE_ENV,
    endDate: DATE_ENV,
    role: 'super_admin',
    username: 'diagnose-script',
    page: 1,
    pageSize: 5000,
  })
  const rows = (detail.rows ?? []) as Array<Record<string, unknown>>
  const rowIds = new Set(rows.map(rowOrderNo).filter(Boolean))

  if (!rowIds.has(FOCUS_VALID_ORDER)) {
    note(`样本不存在或未计入有效成交：${FOCUS_VALID_ORDER}`)
  } else {
    ok(`${FOCUS_VALID_ORDER} 在有效成交明细中`)
  }
  if (rowIds.has(FOCUS_EXCLUDED_ORDER)) {
    note(`样本口径变化：${FOCUS_EXCLUDED_ORDER} 出现在有效成交默认明细（原期望排除）`)
  } else {
    ok(`${FOCUS_EXCLUDED_ORDER} 不在有效成交默认明细中`)
  }

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: DATE_ENV,
    endDate: DATE_ENV,
    role: 'super_admin',
    username: 'diagnose-script',
  })
  const views = filterViewsForCoreMetrics(scoped.views)
  const validView = findViewByOrderNo(views, FOCUS_VALID_ORDER)
  if (validView) {
    console.log(
      `  ${FOCUS_VALID_ORDER} 主播=${validView.anchorName} payCent=${validView.paymentBaseCent}`,
    )
    const ex = explainValidRevenueOrder(validView)
    if (!ex.valid) note(`样本主播/有效成交变化：${FOCUS_VALID_ORDER} explain valid=false (${ex.reason})`)
  }

  console.log(`\n诊断完成，提示 ${notes.length} 条（exit 0）`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
