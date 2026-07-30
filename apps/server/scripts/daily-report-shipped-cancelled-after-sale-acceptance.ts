/**
 * npx tsx apps/server/scripts/daily-report-shipped-cancelled-after-sale-acceptance.ts
 * 验收：售后已取消/关闭无退款且已发货 → 计入真实发货
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  hasDailyReportShipLogisticsSignal,
  isDailyReportInvalidOrder,
  isDailyReportShippedOrder,
  sumDailyReportShippedFromViews,
} from '../src/services/daily-report-order.util'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

function baseView(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: partial.orderId ?? 'P_TEST',
    packageId: partial.packageId ?? 'P_TEST',
    includedInGmv: true,
    paymentBaseCent: 599800,
    effectiveGmvCent: 599800,
    orderStatusText: '已发货未签收',
    afterSaleStatusText: '',
    productRefundAmountCent: 0,
    returnAmountCent: 0,
    ...partial,
  } as AnalyzedOrderView
}

// 1) 售后已取消 + 已发货未签收 + 无退款 → 计入
{
  const v = baseView({
    orderId: 'P_CANCELLED_SHIPPED',
    afterSaleStatusText: '售后已取消',
    afterSaleCancelled: true,
    orderStatusText: '已发货未签收',
  })
  assert(hasDailyReportShipLogisticsSignal(v), '用例1 应有物流信号')
  assert(!isDailyReportInvalidOrder(v), '用例1 不应 invalid')
  assert(isDailyReportShippedOrder(v), '用例1 应计入真实发货')
}

// 2) 售后关闭无退款 + 已发货 → 计入
{
  const v = baseView({
    orderId: 'P_CLOSED_NO_REFUND',
    afterSaleStatusText: '售后关闭',
    afterSaleClosedNoRefund: true,
    orderStatusText: '已发货',
    paymentBaseCent: 10000,
  })
  assert(!isDailyReportInvalidOrder(v), '用例2 不应 invalid')
  assert(isDailyReportShippedOrder(v), '用例2 应计入真实发货')
}

// 3) 订单已关闭 + 全额退款 → 不计入
{
  const v = baseView({
    orderId: 'P_CLOSED_REFUNDED',
    orderStatusText: '已关闭',
    afterSaleStatusText: '其他售后',
    productRefundAmountCent: 90800,
    paymentBaseCent: 90800,
  })
  assert(isDailyReportInvalidOrder(v), '用例3 应为 invalid')
  assert(!isDailyReportShippedOrder(v), '用例3 不应计入真实发货')
}

// 4) 售后处理中 → 不计入
{
  const v = baseView({
    orderId: 'P_PROCESSING',
    afterSaleStatusText: '售后处理中',
    orderStatusText: '已发货未签收',
  })
  assert(isDailyReportInvalidOrder(v), '用例4 应为 invalid')
  assert(!isDailyReportShippedOrder(v), '用例4 不应计入真实发货')
}

// 5) 售后已取消但待发货（无物流）→ 不计入（仍算售后相关）
{
  const v = baseView({
    orderId: 'P_CANCELLED_UNSHIPPED',
    afterSaleStatusText: '售后已取消',
    afterSaleCancelled: true,
    orderStatusText: '待发货',
  })
  assert(!hasDailyReportShipLogisticsSignal(v), '用例5 不应有物流信号')
  assert(isDailyReportInvalidOrder(v), '用例5 无物流时仍 invalid')
  assert(!isDailyReportShippedOrder(v), '用例5 不应计入真实发货')
}

// 6) 无售后已发货 → 计入；与取消售后已发货合计
{
  const clean = baseView({
    orderId: 'P_CLEAN',
    packageId: 'P_CLEAN',
    afterSaleStatusText: '无售后',
    orderStatusText: '已发货未签收',
    paymentBaseCent: 50800,
  })
  const cancelled = baseView({
    orderId: 'P_CANCELLED',
    packageId: 'P_CANCELLED',
    afterSaleStatusText: '售后已取消',
    afterSaleCancelled: true,
    orderStatusText: '已发货未签收',
    paymentBaseCent: 599800,
  })
  const sum = sumDailyReportShippedFromViews([clean, cancelled])
  assert(sum.soldOrderCount === 2, `用例6 应 2 单，实际 ${sum.soldOrderCount}`)
  assert(sum.shippedAmountCent === 50800 + 599800, `用例6 金额不对 ${sum.shippedAmountCent}`)
}

console.log('✓ daily-report-shipped-cancelled-after-sale-acceptance')
