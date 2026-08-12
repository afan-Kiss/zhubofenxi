/**
 * 已签收金额（仅交易完成）与「正在路上/待签收完成」（已签收未完成）拆分验收
 * 用法: npx tsx apps/server/scripts/verify-signed-completed-vs-awaiting.ts
 */
import assert from 'node:assert/strict'
import {
  isStatusCompletedFromTexts,
  isStatusCourierSignedOnlyFromTexts,
  isStatusSignedFromTexts,
} from '../src/services/order-sign-status.service'
import {
  ACTUAL_SIGNED_MAX_PRODUCT_REFUND_CENT,
  getActualSignAmountCent,
  isAwaitingSignCompletionView,
  isEffectiveSignedOrder,
  isEffectiveSignedView,
  orderQualifiesForActualSignedAfterSale,
} from '../src/services/strict-after-sale-metrics.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

assert.equal(ACTUAL_SIGNED_MAX_PRODUCT_REFUND_CENT, 2900, 'signed max refund must be ¥29')

assert.equal(isStatusCompletedFromTexts('已完成'), true)
assert.equal(isStatusCompletedFromTexts('交易完成'), true)
assert.equal(isStatusCompletedFromTexts('交易成功'), true)
assert.equal(isStatusCompletedFromTexts('已签收'), false, '已签收 must not count as completed')
assert.equal(isStatusCompletedFromTexts('已收货'), false)
assert.equal(isStatusSignedFromTexts('已签收'), false, 'legacy alias = completed only')

assert.equal(isStatusCourierSignedOnlyFromTexts('已签收'), true)
assert.equal(isStatusCourierSignedOnlyFromTexts('已签收 · 无售后'), true)
assert.equal(isStatusCourierSignedOnlyFromTexts('已收货'), true)
assert.equal(isStatusCourierSignedOnlyFromTexts('已完成'), false)
assert.equal(isStatusCourierSignedOnlyFromTexts('已完成 · 无售后'), false)
assert.equal(isStatusCourierSignedOnlyFromTexts('运输中'), false)
assert.equal(isStatusCourierSignedOnlyFromTexts('已发货'), false)

assert.equal(
  orderQualifiesForActualSignedAfterSale({
    afterSaleRecords: [],
    successfulProductRefundCent: 2900,
  }),
  true,
  '¥29 refund still qualifies',
)
assert.equal(
  orderQualifiesForActualSignedAfterSale({
    afterSaleRecords: [],
    successfulProductRefundCent: 2901,
  }),
  false,
  '¥29.01 refund excluded',
)

const completedAmt = getActualSignAmountCent({
  paymentBaseCent: 10000,
  successfulRefundAmountCent: 0,
  statusSigned: true,
  includedInGmv: true,
})
assert.equal(completedAmt, 10000)

assert.equal(
  isEffectiveSignedOrder({
    includedInGmv: true,
    statusSigned: true,
    actualSignAmountCent: 10000,
    qualifiesAfterSale: true,
  }),
  true,
)

function stubView(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: '1',
    matchOrderId: '1',
    displayOrderNo: 'P1',
    officialOrderNo: 'P1',
    includedInGmv: true,
    paymentBaseCent: 50000,
    productRefundAmountCent: 0,
    freightRefundAmountCent: 0,
    orderStatusText: '已签收',
    afterSaleStatusText: '无售后',
    isEffectiveSigned: false,
    statusSigned: false,
    actualSignAmountCent: 0,
    ...partial,
  } as AnalyzedOrderView
}

assert.equal(isAwaitingSignCompletionView(stubView({})), true, '已签收·无售后 → awaiting')
assert.equal(
  isEffectiveSignedView(
    stubView({
      orderStatusText: '已签收',
      isEffectiveSigned: true,
      statusSigned: true,
      actualSignAmountCent: 50000,
    }),
  ),
  false,
  'stale isEffectiveSigned on 已签收 must not count as signed',
)
assert.equal(
  isAwaitingSignCompletionView(
    stubView({
      orderStatusText: '已完成',
      isEffectiveSigned: true,
      statusSigned: true,
      actualSignAmountCent: 50000,
    }),
  ),
  false,
  '已完成 must not be awaiting',
)
assert.equal(
  isAwaitingSignCompletionView(stubView({ orderStatusText: '运输中' })),
  false,
  '运输中 not awaiting',
)

assert.equal(
  isAwaitingSignCompletionView(
    stubView({
      orderStatusText: '已签收',
      isEffectiveSigned: true, // 旧缓存误标
      statusSigned: true,
      actualSignAmountCent: 50000,
    }),
  ),
  true,
  'stale isEffectiveSigned on 已签收 must still go to awaiting',
)

// 视图文案仍停在「已签收」，但已 attach 的 raw 已是「已完成」→ 进实际签收，不进待签收完成
{
  const staleTextFreshRaw = stubView({
    orderStatusText: '已签收',
    isEffectiveSigned: false,
    statusSigned: false,
    actualSignAmountCent: 50000,
    raw: { statusDesc: '已完成' },
  } as Partial<AnalyzedOrderView>)
  assert.equal(
    isEffectiveSignedView(staleTextFreshRaw),
    true,
    'raw 已完成 overrides stale 已签收 text for signed pool',
  )
  assert.equal(
    isAwaitingSignCompletionView(staleTextFreshRaw),
    false,
    'raw 已完成 must leave awaiting pool',
  )
}

// 仅文案已完成、旧 isEffectiveSigned=false → 也应进实际签收
assert.equal(
  isEffectiveSignedView(
    stubView({
      orderStatusText: '已完成',
      isEffectiveSigned: false,
      statusSigned: false,
      actualSignAmountCent: 50000,
    }),
  ),
  true,
  'completed text must recompute past stale isEffectiveSigned=false',
)

console.log('verify-signed-completed-vs-awaiting OK')
