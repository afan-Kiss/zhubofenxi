/**
 * 售后缓存失效 / 队列重开 / 空缓存 TTL — 端到端口径验收（纯函数链路 + 场景 A/B/C）
 *
 * npm run verify:after-sales-pending
 * 或: npx tsx apps/server/scripts/after-sales-stale-empty-e2e-acceptance.ts
 */
import assert from 'node:assert/strict'
import {
  isAfterSalesResultPending,
  shouldFetchAfterSalesWorkbench,
} from '../src/services/after-sales-fetch-decision.service'
import {
  isStaleEmptyWorkbenchForOrder,
  orderSignalsCompletedAfterSale,
} from '../src/services/completed-after-sale-status.service'
import {
  isFreightOnlyRefund,
  FREIGHT_REFUND_CENT,
} from '../src/services/business-refund-caliber.service'
import { isReturnsV3FreightOnlyRefund } from '../src/services/returns-v3-record.service'
import { resolveOrderProductRefund } from '../src/services/order-product-refund.service'
import { classifyOrderAfterSale } from '../src/services/after-sale-classification.service'
import {
  isEmptyWorkbenchCacheStale,
  isWorkbenchCacheCurrentlyValid,
  shouldReopenWorkbenchQueueTask,
  WORKBENCH_EMPTY_CACHE_TTL_MS,
} from '../src/services/workbench-cache-validity.service'
import type { AfterSalesWorkbenchRefund } from '../src/services/xhs-after-sales-workbench.service'
import type { NormalizedOrder } from '../src/types/analysis'
import { getActualSignAmountCent } from '../src/services/strict-after-sale-metrics.service'
import { resolveSuccessfulProductRefundCentForSign } from '../src/services/sign-amount-refund.service'

function mockOrder(partial: Partial<NormalizedOrder>): NormalizedOrder {
  return {
    sourceRowIndex: 1,
    orderId: partial.matchOrderId ?? partial.packageId ?? 'x',
    packageId: partial.packageId ?? 'P1',
    bizOrderId: 'x',
    officialOrderNo: partial.officialOrderNo ?? partial.packageId ?? 'P1',
    displayOrderNo: partial.displayOrderNo ?? partial.packageId ?? 'P1',
    matchOrderId: partial.matchOrderId ?? partial.packageId ?? 'P1',
    orderTime: null,
    orderTimeText: '',
    monthKey: '',
    buyerId: 'b',
    gmvCent: partial.gmvCent ?? 0,
    productAmountCent: partial.productAmountCent ?? partial.gmvCent ?? 0,
    receivableAmountCent: partial.receivableAmountCent ?? 0,
    freightCent: partial.freightCent ?? 0,
    platformDiscountCent: 0,
    actualPaidCent: partial.actualPaidCent ?? partial.gmvCent ?? 0,
    actualSellerReceiveAmountCent: partial.actualSellerReceiveAmountCent ?? 0,
    gmvSourceUsed: '',
    amountWarnings: [],
    orderStatusText: partial.orderStatusText ?? '',
    afterSaleStatusText: partial.afterSaleStatusText ?? '',
    reasonText: '',
    isSigned: partial.isSigned ?? false,
    isReturned: partial.isReturned ?? false,
    isQualityReturn: false,
    actualSigned: partial.actualSigned ?? false,
    actualSignedAmountCent: 0,
    errors: [],
    raw: partial.raw ?? {},
  }
}

function mockWb(
  partial: Partial<AfterSalesWorkbenchRefund> & Pick<AfterSalesWorkbenchRefund, 'fetchStatus'>,
): AfterSalesWorkbenchRefund {
  return {
    orderNo: partial.orderNo ?? 'P1',
    packageId: partial.packageId ?? 'P1',
    officialRefundAmountCent: partial.officialRefundAmountCent ?? 0,
    expectedRefundAmountCent: partial.expectedRefundAmountCent ?? 0,
    appliedAmountCent: partial.appliedAmountCent ?? 0,
    appliedShipFeeAmountCent: 0,
    payAmountCent: 0,
    settlementAmountCent: 0,
    refundIncludesFreight: false,
    afterSaleReason: null,
    afterSaleStatus: null,
    successReturnCount: partial.successReturnCount ?? 0,
    returnsIds: partial.returnsIds ?? [],
    fetchStatus: partial.fetchStatus,
    fetchError: partial.fetchError ?? null,
    fetchedAt: partial.fetchedAt ?? new Date(),
    freightRefundAmountCent: partial.freightRefundAmountCent ?? 0,
  }
}

/** 场景 A：empty→done→主表售后完成→必须重开→success 覆盖→计入退款单 */
function scenarioA(): void {
  const orderNo = 'P798000000000000001'
  const doneAt = new Date('2026-07-01T10:00:00+08:00')
  const emptyCache = {
    fetchStatus: 'empty',
    fetchedAt: doneAt,
    updatedAt: doneAt,
    officialRefundAmountCent: 0,
    successReturnCount: 0,
  }

  // 1) 首次：已完成无售后 → empty 可信，不必重开
  const phase1Order = {
    orderStatusText: '已完成',
    afterSaleStatusText: '无售后',
    isReturned: false,
  }
  assert.equal(
    isWorkbenchCacheCurrentlyValid(emptyCache, phase1Order, doneAt.getTime() + 60_000),
    true,
    'A1 empty+无售后 应有效',
  )
  assert.equal(
    shouldReopenWorkbenchQueueTask({
      queueStatus: 'done',
      cache: emptyCache,
      order: phase1Order,
      now: doneAt.getTime() + 60_000,
    }),
    false,
    'A1 done+可信 empty 不应重开',
  )

  // 2) 主表变售后完成 → stale empty，必须重开 pending
  const phase2Order = {
    orderStatusText: '已完成',
    afterSaleStatusText: '售后完成',
    isReturned: true,
  }
  assert.equal(orderSignalsCompletedAfterSale(phase2Order), true)
  assert.equal(isEmptyWorkbenchCacheStale(emptyCache, phase2Order), true)
  assert.equal(isWorkbenchCacheCurrentlyValid(emptyCache, phase2Order), false)
  assert.equal(
    shouldReopenWorkbenchQueueTask({
      queueStatus: 'done',
      cache: emptyCache,
      order: phase2Order,
    }),
    true,
    'A2 stale empty 必须从 done 恢复 pending',
  )
  assert.equal(
    isStaleEmptyWorkbenchForOrder(phase2Order, mockWb({ fetchStatus: 'empty' })),
    true,
  )
  assert.equal(
    isAfterSalesResultPending(
      {
        displayOrderNo: orderNo,
        orderStatusText: '已完成',
        afterSaleStatusText: '售后完成',
        isReturned: true,
      },
      mockWb({ fetchStatus: 'empty' }),
      'after_sales_workbench_no_record',
    ),
    true,
    'A2 pending 不得静默按 0',
  )

  // 3) success 覆盖 empty
  const successCache = {
    fetchStatus: 'success',
    fetchedAt: new Date(),
    officialRefundAmountCent: 21_800,
    successReturnCount: 1,
    hasReturnRefund: true,
  }
  assert.equal(isWorkbenchCacheCurrentlyValid(successCache, phase2Order), true)
  assert.equal(
    shouldReopenWorkbenchQueueTask({
      queueStatus: 'done',
      cache: successCache,
      order: phase2Order,
    }),
    false,
    'A3 可信 success 不重开',
  )

  const order = mockOrder({
    packageId: orderNo,
    gmvCent: 21_800,
    orderStatusText: '已完成',
    afterSaleStatusText: '售后完成',
    isReturned: true,
    isSigned: true,
  })
  const cls = classifyOrderAfterSale(order, 0)
  const resolved = resolveOrderProductRefund(
    order,
    cls,
    0,
    mockWb({
      fetchStatus: 'success',
      officialRefundAmountCent: 21_800,
      successReturnCount: 1,
      orderNo,
    }),
    { buyerStrict: true },
  )
  assert.ok(resolved.productRefundAmountCent > 0, 'A3 商品退款应 > 0')
  assert.equal(resolved.refundAmountSource, 'after_sales_workbench')

  // 4) empty TTL：无售后但过期 → 失效
  const oldEmpty = {
    fetchStatus: 'empty',
    fetchedAt: new Date(Date.now() - WORKBENCH_EMPTY_CACHE_TTL_MS - 1000),
    officialRefundAmountCent: 0,
    successReturnCount: 0,
  }
  assert.equal(isWorkbenchCacheCurrentlyValid(oldEmpty, phase1Order), false, 'A4 empty TTL 过期失效')
  assert.equal(
    shouldReopenWorkbenchQueueTask({
      queueStatus: 'failed',
      cache: successCache,
      order: phase1Order,
    }),
    true,
    'A4 failed 应重开',
  )
  assert.equal(
    shouldReopenWorkbenchQueueTask({
      queueStatus: 'retry_wait',
      cache: null,
      order: phase1Order,
    }),
    true,
    'A4 retry_wait 应重开',
  )

  console.log('✓ 场景 A：stale empty 重开 → success 覆盖 → 退款计入')
}

/** 场景 B：飞云 P798289463456351071 纯运费 18 元 */
function scenarioB(): void {
  const orderNo = 'P798289463456351071'
  const payCent = 261_800
  const freightRaw = {
    delivery_package_id: orderNo,
    reason_name_zh: '退运费',
    reason: 700004,
    refund_fee: 18,
    applied_amount: 18,
    applied_ship_fee_amount: 18,
    pay_amount: 2618,
    refund_status_name: '退款成功',
    status_name: '已完成',
    refund_only_delivery_status: 1,
    refunded: true,
  }
  assert.equal(isFreightOnlyRefund(freightRaw, FREIGHT_REFUND_CENT), true)
  assert.equal(isReturnsV3FreightOnlyRefund(freightRaw), true)

  const productRefund = resolveSuccessfulProductRefundCentForSign({
    afterSaleRecords: [freightRaw],
    boardRefundAmountCent: FREIGHT_REFUND_CENT,
    paymentBaseCent: payCent,
    orderRaw: freightRaw,
  })
  assert.equal(productRefund, 0, 'B 商品退款应为 0')
  const signed = getActualSignAmountCent({
    paymentBaseCent: payCent,
    successfulRefundAmountCent: productRefund,
    statusSigned: true,
    includedInGmv: true,
  })
  assert.equal(signed, payCent, 'B 签收金额=2618')

  // 大额 + 非运费原因 + 仅有 delivery_status → 不得判纯运费
  const bad = {
    reason_name_zh: '质量问题',
    reason: 700001,
    refund_fee: 500,
    pay_amount: 2618,
    refund_only_delivery_status: 1,
  }
  assert.equal(isReturnsV3FreightOnlyRefund(bad), false, 'B 大额非运费不得靠 delivery_status 判运费')

  console.log('✓ 场景 B：纯运费计入签收、不计商品退款单')
}

/** 场景 C：飞云多笔已完成后退款成功，按 P 单去重计入退款 */
function scenarioC(): void {
  const nos = [
    'P796048312483322131',
    'P796209806595129821',
    'P796814642942245041',
    'P796826876568353271',
    'P796908691840291551',
    'P797247974106383401',
  ]
  const seen = new Set<string>()
  let refundOrderCount = 0
  for (const no of nos) {
    assert.equal(seen.has(no), false, `C 不得重复订单 ${no}`)
    seen.add(no)
    const order = mockOrder({
      packageId: no,
      gmvCent: 50_000,
      orderStatusText: '已完成',
      afterSaleStatusText: '售后完成',
      isReturned: true,
      isSigned: true,
    })
    // 订单状态仍显示已完成，仍要查售后
    assert.equal(
      shouldFetchAfterSalesWorkbench({
        displayOrderNo: no,
        orderStatusText: '已完成',
        afterSaleStatusText: '售后完成',
        isReturned: true,
      }),
      true,
      `C ${no} 不得因已完成跳过售后`,
    )
    const wb = mockWb({
      orderNo: no,
      fetchStatus: 'success',
      officialRefundAmountCent: 12_000,
      successReturnCount: 1,
    })
    // 同一订单两条售后 raw → 仍只计 1 单退款
    const cls = classifyOrderAfterSale(order, 0)
    const r1 = resolveOrderProductRefund(order, cls, 0, wb, { buyerStrict: true })
    const r2 = resolveOrderProductRefund(order, cls, 0, wb, { buyerStrict: true })
    assert.equal(r1.productRefundAmountCent, r2.productRefundAmountCent)
    assert.ok(r1.productRefundAmountCent > 0, `C ${no} 应计入商品退款`)
    refundOrderCount += 1
  }
  assert.equal(refundOrderCount, 6)
  assert.equal(seen.size, 6)
  console.log('✓ 场景 C：6 笔飞云已完成后退款按 P 单去重计入')
}

function main(): void {
  console.log('verify:after-sales-pending / stale-empty e2e\n')
  scenarioA()
  scenarioB()
  scenarioC()
  console.log('\nPASS')
}

main()
