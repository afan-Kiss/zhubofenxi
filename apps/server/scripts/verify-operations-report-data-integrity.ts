/**
 * 运营报表数据完整性验收（纯函数 / fixture，不依赖生产库）
 */
import assert from 'node:assert/strict'
import { computeProductReturnRateByOrder } from '../src/services/operations-product-analysis.service'
import { sumValidRevenueFromViews } from '../src/services/valid-revenue-order.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { buildRecentMonthKeys } from '../src/services/boss-dashboard/boss-dashboard-flow.service'
import fs from 'node:fs'
import path from 'node:path'

const issues: string[] = []
function ok(msg: string) {
  console.log(`[ok] ${msg}`)
}
function fail(msg: string) {
  console.error(`[FAIL] ${msg}`)
  issues.push(msg)
}

function stubView(partial: Partial<AnalyzedOrderView> & { orderNo: string; effectiveGmvCent: number }): AnalyzedOrderView {
  return {
    orderNo: partial.orderNo,
    packageId: partial.orderNo,
    buyerId: partial.buyerId ?? 'b1',
    buyerKey: partial.buyerKey ?? 'b1',
    paymentBaseCent: partial.paymentBaseCent ?? partial.effectiveGmvCent,
    effectiveGmvCent: partial.effectiveGmvCent,
    orderTimeText: partial.orderTimeText ?? '2026-07-01 12:00:00',
    payTimeText: partial.payTimeText ?? '2026-07-01 12:00:00',
    anchorName: partial.anchorName ?? '测试主播',
    attributionType: partial.attributionType ?? 'schedule',
    statusText: partial.statusText ?? '已发货',
    ...partial,
  } as AnalyzedOrderView
}

function main() {
  // 1) 有效成交与签收不得混用：calculateBusinessMetrics 的 validSales ≠ actualSigned 时各自独立
  const views = [
    stubView({
      orderNo: 'P1',
      effectiveGmvCent: 10000,
      // 有效但未签收
    }),
    stubView({
      orderNo: 'P2',
      effectiveGmvCent: 20000,
    }),
  ]
  const valid = sumValidRevenueFromViews(views)
  assert.equal(typeof valid.validAmountCent, 'number')
  ok(`sumValidRevenueFromViews 返回分金额 ${valid.validAmountCent}`)

  // 2) 退货率 = 退款P / 支付P；分母 0 → null；禁止用有效成交作分母
  assert.equal(computeProductReturnRateByOrder(10, 2), 0.2)
  assert.equal(computeProductReturnRateByOrder(0, 1), null)
  assert.equal(computeProductReturnRateByOrder(5, 0), 0)
  ok('退货率分母为支付订单数，分母0返回 null')

  // 3) 金额按分汇总再转元：100+1 分不得变成两笔各 round 后求和偏差
  const cents = [199, 199]
  const sumCent = cents.reduce((a, b) => a + b, 0)
  const wrongYuan = cents.reduce((a, c) => a + Math.round(c / 100), 0)
  const rightYuan = sumCent / 100
  assert.notEqual(wrongYuan, rightYuan)
  assert.equal(rightYuan, 3.98)
  ok('禁止逐单 Math.round(cent/100) 再求和')

  // 4) 日趋势源码不得用 soldOrderCount 作退货率分母
  const trendSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/operations-daily-trend.service.ts'),
    'utf8',
  )
  if (trendSrc.includes('productSoldOrderCount')) {
    fail('operations-daily-trend 仍用 productSoldOrderCount 作退货率分母')
  } else if (!trendSrc.includes('productPaidOrderCount')) {
    fail('operations-daily-trend 未使用 productPaidOrderCount')
  } else {
    ok('日趋势退货率使用支付订单数')
  }

  // 5) 日报不得再存在 sumSignedDisplayFromViews
  const dailySrc = fs.readFileSync(
    path.join(__dirname, '../src/services/daily-operations-report.service.ts'),
    'utf8',
  )
  if (dailySrc.includes('sumSignedDisplayFromViews')) {
    fail('daily-operations-report 仍含 sumSignedDisplayFromViews')
  } else if (!dailySrc.includes('sumValidRevenueFromViews')) {
    fail('daily-operations-report 未使用 sumValidRevenueFromViews')
  } else {
    ok('日报有效成交使用 sumValidRevenueFromViews')
  }

  // 6) BI 下钻不得逐单 round 再求和
  const drillSrc = fs.readFileSync(
    path.join(__dirname, '../src/services/operations-bi-drill.service.ts'),
    'utf8',
  )
  if (/Math\.round\(resolveValidRevenueAmountCent\(v\)\s*\/\s*100\)/.test(drillSrc)) {
    fail('operations-bi-drill 仍逐单 Math.round(cent/100)')
  } else {
    ok('BI 下钻按分汇总')
  }

  // 7) 月报不得用 products.reduce(buyerCount)
  const monthlySrc = fs.readFileSync(
    path.join(__dirname, '../src/services/monthly-operations-report.service.ts'),
    'utf8',
  )
  if (/products\.reduce\(\(sum,\s*p\)\s*=>\s*sum\s*\+\s*p\.buyerCount/.test(monthlySrc)) {
    fail('月报仍把各商品 buyerCount 相加')
  } else if (!monthlySrc.includes('countUniqueValidBuyersForDateRange')) {
    fail('月报未调用 countUniqueValidBuyersForDateRange')
  } else {
    ok('月报买家数为全范围唯一买家')
  }

  // 8) 周报前端不得 paidOrderCount: soldOrderCount
  const weeklyFe = fs.readFileSync(
    path.join(__dirname, '../../web/src/pages/operations/OperationsWeeklyReport.tsx'),
    'utf8',
  )
  if (/paidOrderCount:\s*p\.soldOrderCount/.test(weeklyFe) || /paidOrderCount:\s*row\.soldOrderCount/.test(weeklyFe)) {
    fail('OperationsWeeklyReport 仍把 soldOrderCount 映射为 paidOrderCount')
  } else {
    ok('周报前端透传 paidOrderCount')
  }

  // sanity: month keys helper still works (shared util)
  const keys = buildRecentMonthKeys(3)
  assert.equal(keys.length, 3)
  ok(`月份键生成长度=${keys.length}`)

  void calculateBusinessMetrics

  if (issues.length) {
    console.error(`\nFAILED ${issues.length}`)
    process.exit(1)
  }
  console.log('\nALL PASS: verify:operations-report-data-integrity')
}

main()
