/**
 * 有效成交订单池口径验收
 * 用法: npm run accept:valid-revenue-order
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import {
  drainValidRevenueUnknownCollector,
  enableValidRevenueUnknownCollector,
  explainValidRevenueOrder,
  isValidRevenueOrder,
  resetValidRevenueUnknownCollector,
  resolveValidRevenueAmountCent,
  sumValidRevenueFromViews,
} from '../src/services/valid-revenue-order.service'
import { isDailyReportSoldOrder } from '../src/services/daily-report-order.util'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function mockView(overrides: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: overrides.orderId ?? 'o1',
    effectiveGmvCent: overrides.effectiveGmvCent ?? 10000,
    includedInGmv: overrides.includedInGmv ?? true,
    paymentBaseCent: overrides.paymentBaseCent ?? 10000,
    orderStatusText: overrides.orderStatusText ?? '已完成',
    afterSaleStatusText: overrides.afterSaleStatusText ?? '',
    productRefundAmountCent: overrides.productRefundAmountCent ?? 0,
    returnAmountCent: overrides.returnAmountCent ?? 0,
    realAfterSaleAmountCent: overrides.realAfterSaleAmountCent ?? 0,
    isFreightRefundOnly: overrides.isFreightRefundOnly ?? false,
    ...overrides,
  } as AnalyzedOrderView
}

function testValidRevenueCases(issues: string[]) {
  assert(
    isValidRevenueOrder(mockView({ orderStatusText: '已完成', afterSaleStatusText: '' })),
    '已完成 + 无售后 => 算',
    issues,
  )
  assert(
    isValidRevenueOrder(mockView({ orderStatusText: '已签收', afterSaleStatusText: '无售后' })),
    '已签收 + 无售后 => 算',
    issues,
  )
  assert(
    isValidRevenueOrder(
      mockView({ orderStatusText: '已完成', afterSaleStatusText: '售后取消' }),
    ),
    '已完成 + 售后取消 => 算',
    issues,
  )
  assert(
    isValidRevenueOrder(
      mockView({ orderStatusText: '已签收', afterSaleStatusText: '买家取消售后' }),
    ),
    '已签收 + 买家取消售后 => 算',
    issues,
  )
  assert(
    !isValidRevenueOrder(
      mockView({
        orderStatusText: '已完成',
        afterSaleStatusText: '售后处理中：待商家收货',
      }),
    ),
    '已完成 + 售后处理中：待商家收货 => 不算',
    issues,
  )
  assert(
    !isValidRevenueOrder(
      mockView({ orderStatusText: '已签收', afterSaleStatusText: '退款成功' }),
    ),
    '已签收 + 退款成功 => 不算',
    issues,
  )
  assert(
    !isValidRevenueOrder(
      mockView({ orderStatusText: '已完成', afterSaleStatusText: '售后完成' }),
    ),
    '已完成 + 售后完成 => 不算',
    issues,
  )
  assert(
    isValidRevenueOrder(
      mockView({
        orderStatusText: '已完成',
        afterSaleStatusText: '售后关闭',
        productRefundAmountCent: 0,
      }),
    ),
    '已完成 + 售后关闭 + 退款金额 0 => 算',
    issues,
  )
  assert(
    !isValidRevenueOrder(
      mockView({
        orderStatusText: '已完成',
        afterSaleStatusText: '售后关闭',
        productRefundAmountCent: 500,
      }),
    ),
    '已完成 + 售后关闭 + 退款金额 > 0 => 不算',
    issues,
  )
  assert(
    !isValidRevenueOrder(
      mockView({ orderStatusText: '已关闭', afterSaleStatusText: '无售后' }),
    ),
    '已关闭 + 无售后 => 不算',
    issues,
  )
}

function testExplainReasons(issues: string[]) {
  const processing = explainValidRevenueOrder(
    mockView({
      orderStatusText: '已完成',
      afterSaleStatusText: '售后处理中：待商家收货',
    }),
  )
  assert(!processing.valid, '售后处理中应不计入', issues)
  assert(
    processing.reason.includes('售后处理中'),
    '售后处理中原因应明确',
    issues,
  )

  const cancel = explainValidRevenueOrder(
    mockView({ orderStatusText: '已签收', afterSaleStatusText: '售后取消' }),
  )
  assert(cancel.valid, '已签收 + 售后取消应计入', issues)
  assert(cancel.reason.includes('取消售后'), '售后取消原因应说明客户取消', issues)

  const closedOk = explainValidRevenueOrder(
    mockView({
      orderStatusText: '已完成',
      afterSaleStatusText: '售后关闭',
      productRefundAmountCent: 0,
    }),
  )
  assert(closedOk.valid, '售后关闭无退款应计入', issues)

  const closedRefund = explainValidRevenueOrder(
    mockView({
      orderStatusText: '已完成',
      afterSaleStatusText: '售后关闭',
      productRefundAmountCent: 100,
    }),
  )
  assert(!closedRefund.valid, '售后关闭有退款应不计入', issues)
  assert(
    closedRefund.reason.includes('售后关闭但存在退款金额'),
    '售后关闭有退款原因应明确',
    issues,
  )

  const unknown = explainValidRevenueOrder(
    mockView({ orderStatusText: '已完成', afterSaleStatusText: '平台介入中', orderId: 'unk1' }),
  )
  assert(!unknown.valid, '未知售后状态应不计入', issues)
  assert(unknown.reason.includes('未知售后状态'), '未知售后状态应返回原因', issues)
  assert(
    isValidRevenueOrder(mockView({ orderStatusText: '已完成', afterSaleStatusText: '平台介入中' })) ===
      unknown.valid,
    'explain 与 isValidRevenueOrder 应一致',
    issues,
  )
}

function testUnknownCollector(issues: string[]) {
  enableValidRevenueUnknownCollector()
  explainValidRevenueOrder(
    mockView({ orderId: 'u1', afterSaleStatusText: '平台介入中' }),
  )
  explainValidRevenueOrder(
    mockView({ orderId: 'u2', afterSaleStatusText: '平台介入中' }),
  )
  const drained = drainValidRevenueUnknownCollector()
  assert(
    drained['平台介入中']?.length === 2,
    '未知售后状态应被收集（最多5条样例）',
    issues,
  )
  resetValidRevenueUnknownCollector()
  const afterReset = drainValidRevenueUnknownCollector()
  assert(Object.keys(afterReset).length === 0, 'reset 后 collector 应关闭', issues)
}

function testSumValidRevenue(issues: string[]) {
  const views = [
    mockView({ orderId: 'a', effectiveGmvCent: 10000 }),
    mockView({
      orderId: 'b',
      effectiveGmvCent: 20000,
      afterSaleStatusText: '退款成功',
    }),
    mockView({
      orderId: 'c',
      effectiveGmvCent: 30000,
      afterSaleStatusText: '售后取消',
    }),
  ]
  const sum = sumValidRevenueFromViews(views)
  assert(sum.soldOrderCount === 2, '有效成交订单数应为 2', issues)
  assert(sum.validAmountYuan === 400, '有效成交金额应为 400 元', issues)
}

function testBoardOverviewMatchesValidRevenuePool(issues: string[]) {
  const views = [
    mockView({ orderId: 'v1', effectiveGmvCent: 15000, orderStatusText: '已完成' }),
    mockView({
      orderId: 'v2',
      effectiveGmvCent: 25000,
      orderStatusText: '已签收',
      afterSaleStatusText: '退款成功',
    }),
    mockView({
      orderId: 'v3',
      effectiveGmvCent: 35000,
      orderStatusText: '已签收',
      afterSaleStatusText: '买家取消售后',
    }),
    mockView({
      orderId: 'v4',
      effectiveGmvCent: 0,
      includedInGmv: false,
      paymentBaseCent: 5000,
      orderStatusText: '已完成',
    }),
  ]
  const metrics = calculateBusinessMetrics(views)
  const pool = sumValidRevenueFromViews(views)
  assert(
    Math.round(metrics.validSalesAmount) === pool.validAmountYuan,
    '经营总览 validSalesAmount 应与有效成交池一致',
    issues,
  )
  assert(
    Math.round(metrics.validSalesAmount) === 500,
    '经营总览有效成交金额应为 150+350=500 元',
    issues,
  )
}

function testDailyReportAlias(issues: string[]) {
  const view = mockView({ orderStatusText: '已完成', afterSaleStatusText: '' })
  assert(isDailyReportSoldOrder(view) === isValidRevenueOrder(view), '日报别名应与统一口径一致', issues)
}

function testAmountCent(issues: string[]) {
  const valid = mockView({ effectiveGmvCent: 12345 })
  const invalid = mockView({ effectiveGmvCent: 12345, afterSaleStatusText: '退款成功' })
  assert(resolveValidRevenueAmountCent(valid) === 12345, '有效单应返回 effectiveGmvCent', issues)
  assert(resolveValidRevenueAmountCent(invalid) === 0, '无效单金额应为 0', issues)
}

function main() {
  const issues: string[] = []
  testValidRevenueCases(issues)
  testExplainReasons(issues)
  testUnknownCollector(issues)
  testSumValidRevenue(issues)
  testBoardOverviewMatchesValidRevenuePool(issues)
  testDailyReportAlias(issues)
  testAmountCent(issues)

  if (issues.length > 0) {
    console.error('[valid-revenue-order-acceptance] FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[valid-revenue-order-acceptance] OK')
}

main()
