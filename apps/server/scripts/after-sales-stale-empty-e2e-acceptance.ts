/**
 * 售后缓存失效 / 队列重开 / success TTL / 状态机 — 验收
 * npm run verify:after-sales-pending
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
  buildWorkbenchBusinessFingerprint,
  isEmptyWorkbenchCacheStale,
  isWorkbenchCacheCurrentlyValid,
  isWorkbenchSuccessCacheStale,
  resolvePreferredWorkbenchRefund,
  resolveWorkbenchCacheTtl,
  shouldReopenWorkbenchQueueTask,
  WORKBENCH_EMPTY_CACHE_TTL_MS,
  WORKBENCH_SUCCESS_TTL_IN_PROGRESS_MS,
  WORKBENCH_SUCCESS_TTL_STABLE_MS,
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
    hasFreightOnlyRefund: partial.hasFreightOnlyRefund ?? false,
    buyerUserId: null,
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
  const phase1Order = {
    orderStatusText: '已完成',
    afterSaleStatusText: '无售后',
    isReturned: false,
  }
  assert.equal(isWorkbenchCacheCurrentlyValid(emptyCache, phase1Order, doneAt.getTime() + 60_000), true)
  assert.equal(
    shouldReopenWorkbenchQueueTask({
      queueStatus: 'done',
      cache: emptyCache,
      order: phase1Order,
      now: doneAt.getTime() + 60_000,
    }).reopen,
    false,
  )

  const phase2Order = {
    orderStatusText: '已完成',
    afterSaleStatusText: '售后完成',
    isReturned: true,
  }
  assert.equal(orderSignalsCompletedAfterSale(phase2Order), true)
  assert.equal(isEmptyWorkbenchCacheStale(emptyCache, phase2Order), true)
  assert.equal(
    shouldReopenWorkbenchQueueTask({
      queueStatus: 'done',
      cache: emptyCache,
      order: phase2Order,
    }).reopen,
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
  )

  const successCache = {
    fetchStatus: 'success',
    fetchedAt: new Date(),
    officialRefundAmountCent: 21_800,
    successReturnCount: 1,
    hasReturnRefund: true,
    afterSaleStatus: '售后完成',
  }
  assert.equal(isWorkbenchCacheCurrentlyValid(successCache, phase2Order), true)

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
  assert.ok(resolved.productRefundAmountCent > 0)

  const oldEmpty = {
    fetchStatus: 'empty',
    fetchedAt: new Date(Date.now() - WORKBENCH_EMPTY_CACHE_TTL_MS - 1000),
    officialRefundAmountCent: 0,
    successReturnCount: 0,
  }
  assert.equal(isWorkbenchCacheCurrentlyValid(oldEmpty, phase1Order), false)
  console.log('✓ 场景 A：stale empty 重开 → success 覆盖')
}

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
  assert.equal(productRefund, 0)
  assert.equal(
    getActualSignAmountCent({
      paymentBaseCent: payCent,
      successfulRefundAmountCent: productRefund,
      statusSigned: true,
      includedInGmv: true,
    }),
    payCent,
  )

  const bad = {
    reason_name_zh: '质量问题',
    reason: 700001,
    refund_fee: 500,
    pay_amount: 2618,
    refund_only_delivery_status: 1,
  }
  assert.equal(isReturnsV3FreightOnlyRefund(bad), false)
  console.log('✓ 场景 B：纯运费 + 大额非运费')
}

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
  for (const no of nos) {
    assert.equal(seen.has(no), false)
    seen.add(no)
    assert.equal(
      shouldFetchAfterSalesWorkbench({
        displayOrderNo: no,
        orderStatusText: '已完成',
        afterSaleStatusText: '售后完成',
        isReturned: true,
      }),
      true,
    )
  }
  assert.equal(seen.size, 6)
  console.log('✓ 场景 C：6 笔飞云已完成后退款按 P 去重')
}

/** retry_wait 未到期不得重开；force 可绕过 */
function scenarioRetryWait(): void {
  const future = new Date(Date.now() + 60_000)
  const hold = shouldReopenWorkbenchQueueTask({
    queueStatus: 'retry_wait',
    nextAttemptAt: future,
    order: { orderStatusText: '已完成', afterSaleStatusText: '售后完成', isReturned: true },
  })
  assert.equal(hold.reopen, false, '未到期不得 pending')

  const due = shouldReopenWorkbenchQueueTask({
    queueStatus: 'retry_wait',
    nextAttemptAt: new Date(Date.now() - 1000),
    order: { orderStatusText: '已完成', afterSaleStatusText: '无售后' },
  })
  assert.equal(due.reopen, true)

  const forced = shouldReopenWorkbenchQueueTask({
    queueStatus: 'retry_wait',
    nextAttemptAt: future,
    force: true,
    source: 'admin',
    order: { orderStatusText: '已完成', afterSaleStatusText: '无售后' },
  })
  assert.equal(forced.reopen, true)
  assert.match(forced.reason, /force/)
  console.log('✓ 场景 retry_wait：退避 / force')
}

/** blocked 普通入队不重开；Cookie 恢复可重开 */
function scenarioBlocked(): void {
  const hold = shouldReopenWorkbenchQueueTask({
    queueStatus: 'blocked',
    errorType: 'cookie_expired',
    order: { orderStatusText: '已完成', afterSaleStatusText: '售后完成', isReturned: true },
  })
  assert.equal(hold.reopen, false)

  const restored = shouldReopenWorkbenchQueueTask({
    queueStatus: 'blocked',
    errorType: 'cookie_expired',
    externalHealth: { cookieHealthy: true },
    order: { orderStatusText: '已完成', afterSaleStatusText: '售后完成', isReturned: true },
  })
  assert.equal(restored.reopen, true)

  const permanent = shouldReopenWorkbenchQueueTask({
    queueStatus: 'failed',
    errorType: 'permanent_not_found',
    order: { orderStatusText: '已完成', afterSaleStatusText: '无售后' },
  })
  assert.equal(permanent.reopen, false)
  console.log('✓ 场景 blocked / permanent_failed')
}

/** success 追加退款 / TTL / 主表更新 */
function scenarioSuccessStale(): void {
  const now = Date.now()
  const orderDone = {
    orderStatusText: '已完成',
    afterSaleStatusText: '售后完成',
    isReturned: true,
    orderTime: new Date(now - 3 * 24 * 60 * 60 * 1000),
  }
  const fresh = {
    fetchStatus: 'success',
    fetchedAt: new Date(now - 60_000),
    officialRefundAmountCent: 10_000,
    successReturnCount: 1,
    returnsIds: 'A',
    afterSaleStatus: '售后完成',
  }
  assert.equal(isWorkbenchSuccessCacheStale(fresh, orderDone, now).stale, false)

  const inProgress = {
    ...orderDone,
    afterSaleStatusText: '退款中',
  }
  const ttl = resolveWorkbenchCacheTtl(fresh, inProgress, now)
  assert.equal(ttl, WORKBENCH_SUCCESS_TTL_IN_PROGRESS_MS)
  const oldSuccess = {
    ...fresh,
    fetchedAt: new Date(now - WORKBENCH_SUCCESS_TTL_IN_PROGRESS_MS - 1000),
  }
  assert.equal(isWorkbenchSuccessCacheStale(oldSuccess, inProgress, now).stale, true)

  const orderNewer = {
    ...orderDone,
    orderUpdatedAt: new Date(now),
  }
  const fetchedOld = {
    ...fresh,
    fetchedAt: new Date(now - 3600_000),
  }
  assert.equal(isWorkbenchSuccessCacheStale(fetchedOld, orderNewer, now).stale, true)

  // 指纹：returnsIds 增加应变化
  const fp1 = buildWorkbenchBusinessFingerprint({
    fetchStatus: 'success',
    officialRefundAmountCent: 10_000,
    returnsIds: 'A',
    successReturnCount: 1,
  })
  const fp2 = buildWorkbenchBusinessFingerprint({
    fetchStatus: 'success',
    officialRefundAmountCent: 50_000,
    returnsIds: 'A,B',
    successReturnCount: 2,
  })
  assert.notEqual(fp1, fp2)

  // pickPreferred：新金额+新 returnsId 胜
  const oldWb = mockWb({
    fetchStatus: 'success',
    officialRefundAmountCent: 10_000,
    successReturnCount: 1,
    returnsIds: ['A'],
    fetchedAt: new Date(now - 10_000),
  })
  const newWb = mockWb({
    fetchStatus: 'success',
    officialRefundAmountCent: 50_000,
    successReturnCount: 2,
    returnsIds: ['A', 'B'],
    fetchedAt: new Date(now),
  })
  const pref = resolvePreferredWorkbenchRefund({
    current: oldWb,
    incoming: newWb,
    orderContext: orderDone,
  })
  assert.equal(pref.preferred.officialRefundAmountCent, 50_000)
  assert.match(pref.reason, /newer|returnsIds|incoming/i)

  // 分类修正：金额变小也应选新结果
  const wrongProduct = mockWb({
    fetchStatus: 'success',
    officialRefundAmountCent: 50_000,
    hasFreightOnlyRefund: false,
    fetchedAt: new Date(now - 5000),
  })
  const freightFix = mockWb({
    fetchStatus: 'success',
    officialRefundAmountCent: 0,
    freightRefundAmountCent: 1800,
    hasFreightOnlyRefund: true,
    fetchedAt: new Date(now),
  })
  const pref2 = resolvePreferredWorkbenchRefund({
    current: wrongProduct,
    incoming: freightFix,
    orderContext: orderDone,
  })
  assert.equal(pref2.preferred.hasFreightOnlyRefund, true)

  assert.ok(resolveWorkbenchCacheTtl(fresh, orderDone, now) >= WORKBENCH_SUCCESS_TTL_STABLE_MS / 2)
  console.log('✓ 场景 success 复查 / 指纹 / pickPreferred')
}

function main(): void {
  console.log('verify:after-sales-pending\n')
  scenarioA()
  scenarioB()
  scenarioC()
  scenarioRetryWait()
  scenarioBlocked()
  scenarioSuccessStale()
  console.log('\nPASS')
}

main()
