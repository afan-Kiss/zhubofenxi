/**
 * 售后 pending 状态验收
 * npx tsx apps/server/scripts/after-sales-pending-state-acceptance.ts
 */
import {
  isAfterSalesResultPending,
  shouldFetchAfterSalesWorkbench,
  shouldFetchInputFromNormalizedOrder,
} from '../src/services/after-sales-fetch-decision.service'
import { classifyOrderAfterSale } from '../src/services/after-sale-classification.service'
import { resolveOrderProductRefund } from '../src/services/order-product-refund.service'
import type { AfterSalesWorkbenchRefund } from '../src/services/xhs-after-sales-workbench.service'
import type { NormalizedOrder } from '../src/types/analysis'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

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
    actualPaidCent: partial.actualPaidCent ?? 0,
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

function mockWorkbench(
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
  }
}

function checkCase(params: {
  name: string
  order: NormalizedOrder
  workbench?: AfterSalesWorkbenchRefund | null
  expectShouldFetch: boolean
  expectSource: string
  expectPending: boolean
}): void {
  const input = shouldFetchInputFromNormalizedOrder(params.order)
  const cls = classifyOrderAfterSale(params.order, 0)
  const resolved = resolveOrderProductRefund(params.order, cls, 0, params.workbench ?? undefined, {
    buyerStrict: true,
  })
  const shouldFetch = shouldFetchAfterSalesWorkbench(input)
  const pending = isAfterSalesResultPending(input, params.workbench, resolved.refundAmountSource)

  assert(shouldFetch === params.expectShouldFetch, `${params.name}: shouldFetch 期望 ${params.expectShouldFetch} 实际 ${shouldFetch}`)
  assert(
    resolved.refundAmountSource === params.expectSource,
    `${params.name}: refundSource 期望 ${params.expectSource} 实际 ${resolved.refundAmountSource}`,
  )
  assert(pending === params.expectPending, `${params.name}: pending 期望 ${params.expectPending} 实际 ${pending}`)
  console.log(`✓ ${params.name}`)
}

function run(): void {
  checkCase({
    name: '已完成 + 无售后',
    order: mockOrder({
      displayOrderNo: 'P795328535149344981',
      orderStatusText: '已完成',
      afterSaleStatusText: '无售后',
      isSigned: true,
      actualSigned: true,
    }),
    expectShouldFetch: false,
    expectSource: 'no_after_sale',
    expectPending: false,
  })

  checkCase({
    name: '已签收 + 无售后',
    order: mockOrder({
      displayOrderNo: 'P795260119354344321',
      orderStatusText: '已签收',
      afterSaleStatusText: '无售后',
      isSigned: true,
      actualSigned: true,
    }),
    expectShouldFetch: false,
    expectSource: 'no_after_sale',
    expectPending: false,
  })

  checkCase({
    name: '已关闭 + 售后完成 + cache success + refund_fee=1999',
    order: mockOrder({
      displayOrderNo: 'P794796452198344141',
      orderStatusText: '已关闭',
      afterSaleStatusText: '售后完成',
      isReturned: true,
    }),
    workbench: mockWorkbench({
      orderNo: 'P794796452198344141',
      fetchStatus: 'success',
      officialRefundAmountCent: 199900,
      successReturnCount: 1,
    }),
    expectShouldFetch: true,
    expectSource: 'after_sales_workbench',
    expectPending: false,
  })

  checkCase({
    name: '已关闭 + 售后完成 + no cache',
    order: mockOrder({
      displayOrderNo: 'P794796296777344761',
      orderStatusText: '已关闭',
      afterSaleStatusText: '售后完成',
      isReturned: true,
    }),
    workbench: null,
    expectShouldFetch: true,
    expectSource: 'after_sales_workbench_pending',
    expectPending: true,
  })

  checkCase({
    name: 'shouldFetch=true + cache no_record',
    order: mockOrder({
      displayOrderNo: 'P794000000000000001',
      orderStatusText: '售后关闭',
      afterSaleStatusText: '其他售后',
      isReturned: true,
    }),
    workbench: mockWorkbench({
      orderNo: 'P794000000000000001',
      fetchStatus: 'empty',
    }),
    expectShouldFetch: true,
    expectSource: 'after_sales_workbench_no_record',
    expectPending: false,
  })

  console.log('\n全部 after-sales-pending-state 验收通过')
}

run()
