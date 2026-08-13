/**
 * 验收：跨店同 P 去重优先 sellerId 归属店；串店入库应跳过。
 */
import assert from 'node:assert/strict'
import { dedupeOrders } from '../src/services/order-deduper.service'
import {
  extractSellerIdFromOrderRaw,
  preferOrdersBySellerOwnership,
  shouldSkipCrossShopOrderSave,
} from '../src/services/order-shop-ownership.util'
import { OFFICIAL_SHOP_SELLER_IDS } from '../src/config/good-review-shops.constants'
import type { NormalizedOrder } from '../src/types/analysis'

function baseOrder(partial: Partial<NormalizedOrder> & Pick<NormalizedOrder, 'matchOrderId' | 'liveAccountName' | 'raw'>): NormalizedOrder {
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

function main() {
  const sellerHt = OFFICIAL_SHOP_SELLER_IDS.hetianyayu
  const sellerXy = OFFICIAL_SHOP_SELLER_IDS.xiangyu

  assert.equal(extractSellerIdFromOrderRaw({ sellerId: sellerHt }), sellerHt)
  assert.equal(
    extractSellerIdFromOrderRaw({ baseInfo: { seller_id: sellerXy } }),
    sellerXy,
  )

  const skip = shouldSkipCrossShopOrderSave({
    syncShopKey: 'xiangyu',
    sellerId: sellerHt,
  })
  assert.equal(skip.skip, true)
  assert.equal(skip.ownerShopKey, 'hetianyayu')

  const keep = shouldSkipCrossShopOrderSave({
    syncShopKey: 'hetianyayu',
    sellerId: sellerHt,
  })
  assert.equal(keep.skip, false)

  const allowUnknown = shouldSkipCrossShopOrderSave({
    syncShopKey: 'xiangyu',
    sellerId: 'unknown-seller',
  })
  assert.equal(allowUnknown.skip, false)

  const pkg = 'P802152618028347671'
  const wrongFirst = [
    baseOrder({
      sourceRowIndex: 1,
      matchOrderId: pkg,
      liveAccountId: 'xy',
      liveAccountName: '祥钰珠宝',
      raw: { sellerId: sellerHt },
      gmvCent: 361800,
    }),
    baseOrder({
      sourceRowIndex: 2,
      matchOrderId: pkg,
      liveAccountId: 'ht',
      liveAccountName: '和田雅玉',
      raw: { sellerId: sellerHt },
      gmvCent: 361800,
    }),
  ]
  const preferred = preferOrdersBySellerOwnership(wrongFirst)
  assert.equal(preferred[0]!.liveAccountName, '和田雅玉')

  const deduped = dedupeOrders(wrongFirst)
  assert.equal(deduped.uniqueOrders.length, 1)
  assert.equal(deduped.uniqueOrders[0]!.liveAccountName, '和田雅玉')
  assert.equal(deduped.uniqueOrders[0]!.gmvCent, 361800)

  console.log('verify-order-cross-shop-ownership: OK')
}

main()
