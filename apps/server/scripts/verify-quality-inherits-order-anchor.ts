/**
 * 品退继承订单唯一归属
 * npm run verify:quality-inherits-order-anchor
 */
import assert from 'node:assert/strict'
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  resolveQualityRefundAnchorByOrderTime,
  aggregateQualityRefundByAnchor,
} from '../src/services/quality-refund-anchor-attribution.service'
import {
  setCanonicalAttributionTestFixtures,
  clearCanonicalAttributionCache,
} from '../src/services/canonical-order-attribution.service'
import { setManualAnchorOverrideCacheForTests } from '../src/services/order-anchor-manual-override.service'

function stubView(
  over: Partial<AnalyzedOrderView> & { raw?: Record<string, unknown> },
): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return {
    orderId: 'o1',
    packageId: 'P1',
    bizOrderId: '',
    displayOrderNo: 'P798954618165469201',
    officialOrderNo: 'P798954618165469201',
    matchOrderId: 'P798954618165469201',
    orderTimeText: '2026-07-07 13:37:04',
    buyerId: 'b',
    anchorId: '',
    anchorName: '未归属',
    attributionType: 'unassigned',
    gmvCent: 31700,
    productAmountCent: 31700,
    receivableAmountCent: 31700,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 31700,
    actualSellerReceiveAmountCent: 31700,
    actualSignedAmountCent: 0,
    orderStatusText: '',
    afterSaleStatusText: '',
    isSigned: false,
    isReturned: false,
    isActualSigned: false,
    isQualityReturn: true,
    officialQualityBadCase: true,
    officialQualityReasons: ['材质/颜色/款式与描述不符'],
    officialQualityMatchStatus: 'matched_order_only',
    includedInGmv: true,
    liveAccountName: '和田雅玉',
    reasonText: '材质/颜色/款式与描述不符',
    ...over,
  } as AnalyzedOrderView & { raw?: Record<string, unknown> }
}

function ms(text: string): number {
  return Date.parse(text.replace(' ', 'T') + '+08:00')
}

async function main(): Promise<void> {
  clearCanonicalAttributionCache()
  setManualAnchorOverrideCacheForTests(new Map())
  setCanonicalAttributionTestFixtures({
    liveSessions: [
      {
        liveId: 'live-xiaohong',
        anchorName: '小红',
        liveAccountName: '和田雅玉',
        startMs: ms('2026-07-07 12:00:00'),
        endMs: ms('2026-07-07 15:00:00'),
      },
      {
        liveId: 'live-zijie',
        anchorName: '子杰',
        liveAccountName: '拾玉居和田玉',
        startMs: ms('2026-07-07 12:00:00'),
        endMs: ms('2026-07-07 15:00:00'),
      },
    ],
  })

  const view = stubView({
    raw: {
      orderedAt: '2026-07-07 13:37:04',
      createTime: '2026-07-07 13:37:04',
      paidAt: '2026-07-07 16:00:00',
    },
  })

  const attr = await resolveQualityRefundAnchorByOrderTime({ view })
  assert.ok(attr)
  assert.equal(attr!.anchorName, '小红', '品退应归小红（下单场次），不得串到子杰')
  assert.equal(attr!.paymentAnchorName, '小红', '品退主播必须等于订单唯一归属主播')
  assert.equal(attr!.attributionType, 'live_session')

  // 同订单多商品品退只计一笔
  const dup = stubView({
    orderId: 'o2',
    packageId: 'P1-item2',
    displayOrderNo: 'P798954618165469201',
    officialOrderNo: 'P798954618165469201',
    matchOrderId: 'P798954618165469201',
    raw: {
      orderedAt: '2026-07-07 13:37:04',
      createTime: '2026-07-07 13:37:04',
    },
  })
  const agg = await aggregateQualityRefundByAnchor({ views: [view, dup] })
  assert.equal(agg.totalQualityRefundCount, 1)
  assert.equal(agg.byAnchorKey.size, 1)
  const bucket = [...agg.byAnchorKey.values()][0]!
  assert.equal(bucket.anchorName, '小红')
  assert.equal(bucket.count, 1)

  setCanonicalAttributionTestFixtures(null)
  setManualAnchorOverrideCacheForTests(null)
  clearCanonicalAttributionCache()
  console.log('PASS: verify:quality-inherits-order-anchor')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
