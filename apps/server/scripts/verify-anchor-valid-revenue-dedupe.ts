/**
 * 有效成交同 P 单去重验收：首条 vs bestValue 是否导致 validSalesAmount 不一致
 *
 * npm run verify:anchor-valid-revenue-dedupe
 * START_DATE=2026-06-01 END_DATE=2026-07-07 npm run verify:anchor-valid-revenue-dedupe
 */
import path from 'node:path'
import { config } from 'dotenv'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { getBoardScopedViewsForRange } from '../src/services/board-scoped-views.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import {
  dedupeViewsByMetricOrderNo,
  resolveMetricOrderNo,
} from '../src/services/calc-refund-rate.service'
import {
  dedupeValidRevenueViewsByOrderNoBestValue,
  explainValidRevenueOrder,
  hasBlockingValidRevenueSignal,
  isValidRevenueOrder,
  resolveValidRevenueRefundAmountCent,
  sumValidRevenueFromViews,
} from '../src/services/valid-revenue-order.service'
import { centToYuan } from '../src/utils/money'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'

config({ path: path.resolve(__dirname, '../.env') })

const START_DATE = process.env.START_DATE?.trim() || '2026-06-01'
const END_DATE = process.env.END_DATE?.trim() || '2026-07-07'

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  console.error(`  ✗ ${msg}`)
}

interface ViewSnapshot {
  matchOrderId: string
  anchorName: string
  includedInGmv: boolean
  effectiveGmvCent: number
  actualSignedAmountCent: number
  orderStatusText: string
  afterSaleStatusText: string
  valid: boolean
  validReason: string
}

function snapshotView(v: AnalyzedOrderView): ViewSnapshot {
  const explain = explainValidRevenueOrder(v)
  return {
    matchOrderId: v.matchOrderId || v.orderId || '—',
    anchorName: v.anchorName?.trim() || '未归属',
    includedInGmv: v.includedInGmv === true,
    effectiveGmvCent: v.effectiveGmvCent ?? 0,
    actualSignedAmountCent: v.actualSignedAmountCent ?? v.actualSignAmountCent ?? 0,
    orderStatusText: String(v.orderStatusText ?? v.orderStatus ?? '—'),
    afterSaleStatusText: String(v.afterSaleStatusText ?? v.afterSaleStatus ?? '—'),
    valid: explain.valid,
    validReason: explain.reason,
  }
}

function validCentForView(v: AnalyzedOrderView): number {
  return isValidRevenueOrder(v) ? v.effectiveGmvCent : 0
}

function groupByOrderNo(views: AnalyzedOrderView[]): Map<string, AnalyzedOrderView[]> {
  const groups = new Map<string, AnalyzedOrderView[]>()
  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    const list = groups.get(no) ?? []
    list.push(v)
    groups.set(no, list)
  }
  return groups
}

/** 构造样例：同 P 单 blocking invalid 不应被 clean valid 覆盖 */
function buildBlockingOverrideFixture(): AnalyzedOrderView[] {
  const base = {
    matchOrderId: 'fixture-blocking-001',
    orderId: 'fixture-blocking-001',
    packageId: 'P799999999999999901',
    includedInGmv: true,
    effectiveGmvCent: 100_00,
    paymentBaseCent: 100_00,
    orderStatusText: '已签收',
    orderTimeText: '2026-06-15 12:00:00',
    anchorName: '验收样例',
  } satisfies Partial<AnalyzedOrderView>

  const cleanValid: AnalyzedOrderView = {
    ...(base as AnalyzedOrderView),
    afterSaleStatusText: '',
    productRefundAmountCent: 0,
    returnAmountCent: 0,
    realAfterSaleAmountCent: 0,
    isReturnRefund: false,
    isReturnRefundOrder: false,
    isRealProductRefund: false,
    isReturned: false,
  }

  const blockingInvalid: AnalyzedOrderView = {
    ...(base as AnalyzedOrderView),
    afterSaleStatusText: '退款成功',
    productRefundAmountCent: 100_00,
    returnAmountCent: 100_00,
    realAfterSaleAmountCent: 100_00,
    isReturnRefund: true,
    isRealProductRefund: true,
  }

  return [cleanValid, blockingInvalid]
}

function verifyBlockingOverrideFixture(): boolean {
  const fixture = buildBlockingOverrideFixture()
  const best = dedupeValidRevenueViewsByOrderNoBestValue(fixture)[0]
  if (!best) {
    fail('blocking 样例未选出视图')
    return false
  }
  if (isValidRevenueOrder(best)) {
    fail('blocking 样例：valid=false blocking 被 valid=true 覆盖')
    return false
  }
  if (!hasBlockingValidRevenueSignal(best)) {
    fail('blocking 样例：选中视图应带 blocking 信号')
    return false
  }
  ok('blocking 样例：同 P 单有退款成功 view 时整单不计入有效成交')
  return true
}

async function loadViews(): Promise<AnalyzedOrderView[]> {
  try {
    const scoped = await getBoardScopedViewsForRange({
      preset: 'custom',
      startDate: START_DATE,
      endDate: END_DATE,
      role: 'super_admin',
      username: 'verify-script',
    })
    return filterViewsForCoreMetrics(scoped.views)
  } catch {
    const bundle = await buildRawAnalyzeBundleAll()
    if (!bundle) return []
    const { prepareAnalysisArtifactsFromRaw } = await import('../src/services/business-analysis.service')
    const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
    return filterViewsForCoreMetrics(artifacts.views).filter((v) => {
      const pay = v.paymentTime ?? v.payTime
      if (!pay) return true
      const d = String(pay).slice(0, 10)
      return d >= START_DATE && d <= END_DATE
    })
  }
}

async function main(): Promise<void> {
  console.log('verify-anchor-valid-revenue-dedupe')
  console.log(`范围: ${START_DATE} ~ ${END_DATE}`)

  if (!verifyBlockingOverrideFixture()) {
    process.exit(1)
  }

  const views = await loadViews()
  if (views.length === 0) {
    console.log('⚠ 当前范围无视图，跳过生产扫描（blocking 样例已通过）')
    console.log('\nPASS（预防性修复，生产 0 组同 P 多 view 待复验）')
    process.exit(0)
  }

  const groups = groupByOrderNo(views)
  const multiGroups = [...groups.entries()].filter(([, list]) => list.length > 1)
  console.log(`订单视图 ${views.length} 条，同 P 单多 view ${multiGroups.length} 组`)

  const firstDedupeTotal = sumValidRevenueFromViews(views)
  let bestTotalCent = 0
  let bestCount = 0
  for (const v of dedupeValidRevenueViewsByOrderNoBestValue(views)) {
    if (!isValidRevenueOrder(v)) continue
    bestTotalCent += v.effectiveGmvCent
    bestCount += 1
  }
  const bestTotalYuan = centToYuan(bestTotalCent)

  console.log(
    `\n全量合计: 首条去重 ¥${firstDedupeTotal.validAmountYuan.toFixed(2)} (${firstDedupeTotal.soldOrderCount} 单)`,
  )
  console.log(`         bestValidRevenue ¥${bestTotalYuan.toFixed(2)} (${bestCount} 单)`)

  const mismatches: Array<{
    orderNo: string
    firstCent: number
    bestCent: number
    first: ViewSnapshot
    best: ViewSnapshot
    all: ViewSnapshot[]
  }> = []

  for (const [orderNo, list] of multiGroups) {
    const firstView = dedupeViewsByMetricOrderNo(list)[0]
    const bestView = dedupeValidRevenueViewsByOrderNoBestValue(list)[0]
    if (!firstView || !bestView) continue

    const hasAnyBlocking = list.some(hasBlockingValidRevenueSignal)
    const hasAnyValid = list.some(isValidRevenueOrder)
    if (hasAnyBlocking && hasAnyValid && isValidRevenueOrder(bestView)) {
      fail(`${orderNo}: 存在 blocking view 但 best 仍为 valid=true`)
      mismatches.push({
        orderNo,
        firstCent: validCentForView(firstView),
        bestCent: validCentForView(bestView),
        first: snapshotView(firstView),
        best: snapshotView(bestView),
        all: list.map(snapshotView),
      })
      continue
    }

    const firstCent = validCentForView(firstView)
    const bestCent = validCentForView(bestView)
    if (firstCent !== bestCent) {
      mismatches.push({
        orderNo,
        firstCent,
        bestCent,
        first: snapshotView(firstView),
        best: snapshotView(bestView),
        all: list.map(snapshotView),
      })
    }
  }

  if (mismatches.length > 0) {
    fail(`发现 ${mismatches.length} 个同 P 单首条/bestValidRevenue 有效成交不一致`)
    for (const m of mismatches.slice(0, 20)) {
      console.log(`\n--- 订单 ${m.orderNo} ---`)
      console.log(`  首条 validCent=${m.firstCent} bestCent=${m.bestCent}`)
      console.log(`  首条: ${JSON.stringify(m.first)}`)
      console.log(`  最优: ${JSON.stringify(m.best)}`)
      if (m.all.length > 2) {
        console.log(`  全部 ${m.all.length} 条 view:`)
        for (const row of m.all) console.log(`    ${JSON.stringify(row)}`)
      }
    }
    if (mismatches.length > 20) {
      console.log(`\n… 另有 ${mismatches.length - 20} 组未展开`)
    }
    process.exit(1)
  }

  if (Math.abs(firstDedupeTotal.validAmountYuan - bestTotalYuan) > 0.02) {
    fail(
      `全量 validSalesAmount 首条 ${firstDedupeTotal.validAmountYuan.toFixed(2)} ≠ bestValue ${bestTotalYuan.toFixed(2)}`,
    )
    process.exit(1)
  }

  ok(`同 P 单 ${multiGroups.length} 组多 view，首条与 bestValidRevenue 有效成交无差异`)
  if (multiGroups.length === 0) {
    ok('当前生产 0 组同 P 多 view，本次为预防性修复，金额不应变化')
  }
  ok(
    `全量 validSalesAmount 一致: ¥${firstDedupeTotal.validAmountYuan.toFixed(2)} (${firstDedupeTotal.soldOrderCount} 单)`,
  )
  console.log('\nPASS')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
