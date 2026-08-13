/**
 * 跨店归属 / 去重 / View sellerId 透传 / 串店金额防累加 — 完整回归
 */
import assert from 'node:assert/strict'
import { dedupeOrders } from '../src/services/order-deduper.service'
import { dedupeViewsByMetricOrderNo } from '../src/services/calc-refund-rate.service'
import {
  extractSellerIdFromOrderRaw,
  partitionOrdersByShopOwnership,
  preferOrdersBySellerOwnership,
  preferViewsBySellerOwnership,
  resolveOrderShopOwnership,
  shouldDeleteContaminatedOrderRow,
  shouldSkipCrossShopOrderSave,
  type ShopOwnershipStatus,
} from '../src/services/order-shop-ownership.util'
import {
  GOOD_REVIEW_SHOP_KEYS,
  OFFICIAL_SHOP_SELLER_IDS,
  getGoodReviewShopName,
  type GoodReviewShopKey,
} from '../src/config/good-review-shops.constants'
import type { AnalyzedOrderView, NormalizedOrder } from '../src/types/analysis'

function baseOrder(
  partial: Partial<NormalizedOrder> &
    Pick<NormalizedOrder, 'matchOrderId' | 'liveAccountName' | 'raw'>,
): NormalizedOrder {
  return {
    sourceRowIndex: 1,
    orderId: '1',
    packageId: partial.matchOrderId,
    bizOrderId: '1',
    officialOrderNo: partial.matchOrderId,
    displayOrderNo: partial.matchOrderId,
    matchOrderId: partial.matchOrderId,
    orderTime: null,
    orderTimeText: '',
    monthKey: '',
    buyerId: '',
    liveAccountId: partial.liveAccountId,
    liveAccountName: partial.liveAccountName,
    gmvCent: 100,
    productAmountCent: 100,
    receivableAmountCent: 100,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 100,
    actualSellerReceiveAmountCent: 100,
    gmvSourceUsed: 'test',
    amountWarnings: [],
    orderStatusText: '',
    afterSaleStatusText: '',
    reasonText: '',
    isSigned: false,
    isReturned: false,
    isQualityReturn: false,
    actualSigned: false,
    actualSignedAmountCent: 0,
    errors: [],
    raw: partial.raw,
    isPrimaryOrder: true,
    ...partial,
  }
}

function baseView(
  partial: Partial<AnalyzedOrderView> &
    Pick<AnalyzedOrderView, 'displayOrderNo' | 'liveAccountName' | 'sellerId'>,
): AnalyzedOrderView {
  return {
    orderId: partial.displayOrderNo,
    packageId: partial.displayOrderNo,
    bizOrderId: partial.displayOrderNo,
    displayOrderNo: partial.displayOrderNo,
    officialOrderNo: partial.displayOrderNo,
    matchOrderId: partial.displayOrderNo,
    orderTimeText: '',
    buyerId: '',
    anchorId: '',
    anchorName: '未归属',
    liveAccountName: partial.liveAccountName,
    sellerId: partial.sellerId,
    attributionType: 'unassigned',
    gmvCent: 100,
    productAmountCent: 100,
    receivableAmountCent: 100,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 100,
    actualSellerReceiveAmountCent: 100,
    actualSignedAmountCent: 0,
    orderStatusText: '',
    afterSaleStatusText: '',
    isSigned: false,
    isReturned: false,
    isActualSigned: false,
    isQualityReturn: false,
    returnAmountCent: 0,
    productRefundAmountCent: 0,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isRealProductRefund: false,
    afterSaleCategory: 'none',
    afterSaleStatusLabel: '—',
    afterSaleDisplayType: '—',
    isSizeMismatch: false,
    reasonText: '',
    effectiveGmvCent: 100,
    paymentBaseCent: 100,
    paymentBaseSource: 'test',
    includedInGmv: true,
    countsForSigned: false,
    countsForGrossProfit: false,
    gmvExcludeReason: null,
    ...partial,
  }
}

function main() {
  const sellerHt = OFFICIAL_SHOP_SELLER_IDS.hetianyayu
  const sellerXy = OFFICIAL_SHOP_SELLER_IDS.xiangyu
  const pkg = 'P802152618028347671'

  // --- extract ---
  assert.equal(extractSellerIdFromOrderRaw({ sellerId: sellerHt }), sellerHt)
  assert.equal(extractSellerIdFromOrderRaw({ baseInfo: { seller_id: sellerXy } }), sellerXy)

  // --- Test 1: View sellerId 透传，假店排第一仍选真店 ---
  const viewsWrongFirst = [
    baseView({
      displayOrderNo: pkg,
      liveAccountName: '祥钰珠宝',
      sellerId: sellerHt,
      gmvCent: 361800,
    }),
    baseView({
      displayOrderNo: pkg,
      liveAccountName: '和田雅玉',
      sellerId: sellerHt,
      gmvCent: 361800,
    }),
  ]
  const preferredViews = preferViewsBySellerOwnership(viewsWrongFirst)
  assert.equal(preferredViews[0]!.liveAccountName, '和田雅玉')
  const dedupedViews = dedupeViewsByMetricOrderNo(viewsWrongFirst)
  assert.equal(dedupedViews.length, 1)
  assert.equal(dedupedViews[0]!.liveAccountName, '和田雅玉')
  assert.equal(dedupedViews[0]!.sellerId, sellerHt)

  // --- Test 2: 跨店不同 SKU 不得金额相加 ---
  const crossSku = [
    baseOrder({
      sourceRowIndex: 1,
      matchOrderId: pkg,
      liveAccountId: 'ht',
      liveAccountName: '和田雅玉',
      raw: { sellerId: sellerHt, skuId: 'SKU-A' },
      gmvCent: 361800,
    }),
    baseOrder({
      sourceRowIndex: 2,
      matchOrderId: pkg,
      liveAccountId: 'xy',
      liveAccountName: '祥钰珠宝',
      raw: { sellerId: sellerHt, skuId: 'SKU-B' },
      gmvCent: 100000,
    }),
  ]
  const dedupedCross = dedupeOrders(crossSku)
  assert.equal(dedupedCross.uniqueOrders.length, 1)
  assert.equal(dedupedCross.uniqueOrders[0]!.liveAccountName, '和田雅玉')
  assert.equal(dedupedCross.uniqueOrders[0]!.gmvCent, 361800)
  assert.ok(dedupedCross.abnormalOrders.length >= 1)
  assert.ok(dedupedCross.abnormalOrders.some((o) => o.errors.some((e) => e.includes('跨店污染'))))

  // --- Test 3: 同店正常多 SKU 仍可合并 ---
  const sameShopMultiSku = [
    baseOrder({
      sourceRowIndex: 1,
      matchOrderId: 'P_MULTI',
      liveAccountName: '和田雅玉',
      raw: { sellerId: sellerHt, skuId: 'SKU-A' },
      gmvCent: 200000,
    }),
    baseOrder({
      sourceRowIndex: 2,
      matchOrderId: 'P_MULTI',
      liveAccountName: '和田雅玉',
      raw: { sellerId: sellerHt, skuId: 'SKU-B' },
      gmvCent: 161800,
    }),
  ]
  const mergedMulti = dedupeOrders(sameShopMultiSku)
  assert.equal(mergedMulti.uniqueOrders.length, 1)
  assert.equal(mergedMulti.uniqueOrders[0]!.gmvCent, 361800)

  // --- Test 4: 同 SKU 重复不累加 ---
  const sameSkuDup = [
    baseOrder({
      sourceRowIndex: 1,
      matchOrderId: 'P_DUP',
      liveAccountName: '和田雅玉',
      raw: { sellerId: sellerHt, skuId: 'SKU-A' },
      gmvCent: 361800,
    }),
    baseOrder({
      sourceRowIndex: 2,
      matchOrderId: 'P_DUP',
      liveAccountName: '和田雅玉',
      raw: { sellerId: sellerHt, skuId: 'SKU-A' },
      gmvCent: 361800,
    }),
  ]
  const dedupedSameSku = dedupeOrders(sameSkuDup)
  assert.equal(dedupedSameSku.uniqueOrders.length, 1)
  assert.equal(dedupedSameSku.uniqueOrders[0]!.gmvCent, 361800)

  // --- Test 5: 全部 MISMATCH 不得进祥钰 GMV ---
  const allMismatch = [
    baseOrder({
      sourceRowIndex: 1,
      matchOrderId: pkg,
      liveAccountName: '祥钰珠宝',
      raw: { sellerId: sellerHt, skuId: 'SKU-A' },
      gmvCent: 361800,
    }),
  ]
  const allMismatchResult = dedupeOrders(allMismatch)
  assert.equal(allMismatchResult.uniqueOrders.length, 0)
  assert.equal(allMismatchResult.abnormalOrders.length, 1)
  assert.equal(allMismatchResult.summary.totalGmvCent, 0)

  // --- Test 6: UNKNOWN 兼容保存 + 状态 ---
  const unknown = resolveOrderShopOwnership({
    sellerId: '',
    liveAccountName: '祥钰珠宝',
  })
  assert.equal(unknown.status, 'unknown_seller')
  assert.equal(unknown.skipSave, false)
  const unknownSkip = shouldSkipCrossShopOrderSave({
    syncShopKey: 'xiangyu',
    sellerId: 'unknown-seller-xyz',
  })
  assert.equal(unknownSkip.skipSave, false)
  assert.equal(unknownSkip.status, 'unknown_seller')

  // --- Test 7: cleanup 覆盖 packageId=null + orderId 有值 ---
  assert.equal(
    shouldDeleteContaminatedOrderRow({
      sellerId: sellerHt,
      liveAccountName: '祥钰珠宝',
      platformName: 'xiangyu',
      raw: { orderId: '80215261802834767', sellerId: sellerHt },
    }),
    true,
  )
  assert.equal(
    shouldDeleteContaminatedOrderRow({
      sellerId: '',
      liveAccountName: '祥钰珠宝',
      platformName: 'xiangyu',
      raw: { orderId: '80215261802834767' },
    }),
    false,
    'UNKNOWN seller 不得自动删除',
  )
  assert.equal(
    shouldDeleteContaminatedOrderRow({
      sellerId: sellerXy,
      liveAccountName: '祥钰珠宝',
      platformName: 'xiangyu',
    }),
    false,
    'MATCH 不删',
  )

  // MATCH + 同店 UNKNOWN 多 SKU 仍可合并；异店 UNKNOWN 不并入
  const matchPlusUnknown = [
    baseOrder({
      sourceRowIndex: 1,
      matchOrderId: 'P_UNK',
      liveAccountName: '和田雅玉',
      raw: { sellerId: sellerHt, skuId: 'SKU-A' },
      gmvCent: 200000,
    }),
    baseOrder({
      sourceRowIndex: 2,
      matchOrderId: 'P_UNK',
      liveAccountName: '和田雅玉',
      raw: { skuId: 'SKU-B' },
      gmvCent: 161800,
    }),
    baseOrder({
      sourceRowIndex: 3,
      matchOrderId: 'P_UNK',
      liveAccountName: '祥钰珠宝',
      raw: { skuId: 'SKU-C' },
      gmvCent: 99900,
    }),
  ]
  const unkPart = partitionOrdersByShopOwnership(matchPlusUnknown)
  assert.equal(unkPart.mergeable.length, 2)
  assert.equal(
    unkPart.mergeable.every((o) => o.liveAccountName === '和田雅玉'),
    true,
  )
  const unkDeduped = dedupeOrders(matchPlusUnknown)
  assert.equal(unkDeduped.uniqueOrders.length, 1)
  assert.equal(unkDeduped.uniqueOrders[0]!.gmvCent, 361800)

  // --- Test 8: 四店矩阵拦截 ---
  const pairs: Array<[GoodReviewShopKey, GoodReviewShopKey]> = [
    ['shiyuju', 'hetianyayu'],
    ['hetianyayu', 'xiangyu'],
    ['xiangyu', 'xyxiangyu'],
    ['xyxiangyu', 'shiyuju'],
  ]
  for (const [owner, sync] of pairs) {
    const v = shouldSkipCrossShopOrderSave({
      syncShopKey: sync,
      sellerId: OFFICIAL_SHOP_SELLER_IDS[owner],
    })
    assert.equal(v.skipSave, true, `${owner}->${sync}`)
    assert.equal(v.status, 'mismatch')
    assert.equal(v.ownerShopKey, owner)
  }
  for (const key of GOOD_REVIEW_SHOP_KEYS) {
    const v = shouldSkipCrossShopOrderSave({
      syncShopKey: key,
      sellerId: OFFICIAL_SHOP_SELLER_IDS[key],
    })
    assert.equal(v.skipSave, false, `match ${key}`)
    assert.equal(v.status, 'match')
  }

  // partition: MATCH 存在时 MISMATCH 进 contaminated
  const part = partitionOrdersByShopOwnership(crossSku)
  assert.equal(part.hasMatch, true)
  assert.equal(part.mergeable.length, 1)
  assert.equal(part.contaminated.length, 1)
  assert.equal(part.mergeable[0]!.liveAccountName, '和田雅玉')

  // preferOrders 兼容：只返回 mergeable
  const preferred = preferOrdersBySellerOwnership(crossSku)
  assert.equal(preferred.length, 1)
  assert.equal(preferred[0]!.liveAccountName, '和田雅玉')

  // 状态枚举完整性
  const statuses: ShopOwnershipStatus[] = [
    'match',
    'mismatch',
    'unknown_seller',
    'unknown_sync_shop',
  ]
  assert.equal(statuses.length, 4)
  assert.ok(getGoodReviewShopName('hetianyayu').includes('和田'))

  console.log('verify-order-cross-shop-ownership: OK (8 suites)')
}

main()
