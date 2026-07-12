/**
 * 2026-07-11 真实排班归属专项（夹具）
 * npm run verify:20260711-real-schedule
 */
import assert from 'node:assert/strict'
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  resolveCanonicalOrderAttribution,
  setCanonicalAttributionTestFixtures,
  clearCanonicalAttributionCache,
} from '../src/services/canonical-order-attribution.service'
import { setManualAnchorOverrideCacheForTests } from '../src/services/order-anchor-manual-override.service'

function stubView(
  over: Partial<AnalyzedOrderView> & { raw?: Record<string, unknown> },
): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return {
    orderId: 'o',
    packageId: 'p',
    bizOrderId: '',
    displayOrderNo: 'P',
    officialOrderNo: 'P',
    matchOrderId: 'P',
    orderTimeText: '',
    buyerId: 'b',
    anchorId: '',
    anchorName: '未归属',
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
        liveId: 'zijie',
        anchorName: '子杰',
        liveAccountName: '拾玉居和田玉',
        startMs: ms('2026-07-11 09:30:00'),
        endMs: ms('2026-07-11 14:00:00'),
      },
      {
        liveId: 'xiaobai',
        anchorName: '小白',
        liveAccountName: '和田雅玉',
        startMs: ms('2026-07-11 09:30:00'),
        endMs: ms('2026-07-11 14:00:00'),
      },
      {
        liveId: 'xiaohong',
        anchorName: '小红',
        liveAccountName: '和田雅玉',
        startMs: ms('2026-07-11 14:00:00'),
        endMs: ms('2026-07-11 18:30:00'),
      },
      {
        liveId: 'xiaoyi',
        anchorName: '小艺',
        liveAccountName: 'XY祥钰珠宝',
        startMs: ms('2026-07-11 14:00:00'),
        endMs: ms('2026-07-11 18:30:00'),
      },
    ],
  })

  const cases: Array<{ shop: string; create: string; pay: string; expect: string }> = [
    { shop: '和田雅玉', create: '2026-07-11 09:30:00', pay: '2026-07-11 15:00:00', expect: '小白' },
    { shop: '和田雅玉', create: '2026-07-11 13:59:59', pay: '2026-07-11 16:00:00', expect: '小白' },
    { shop: '和田雅玉', create: '2026-07-11 14:00:00', pay: '2026-07-11 14:00:01', expect: '小红' },
    { shop: '和田雅玉', create: '2026-07-11 18:29:59', pay: '2026-07-11 19:00:00', expect: '小红' },
    { shop: '拾玉居和田玉', create: '2026-07-11 10:00:00', pay: '2026-07-11 15:00:00', expect: '子杰' },
    { shop: 'XY祥钰珠宝', create: '2026-07-11 14:00:00', pay: '2026-07-11 20:00:00', expect: '小艺' },
  ]

  for (const c of cases) {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: c.shop,
        raw: { orderedAt: c.create, createTime: c.create, paidAt: c.pay },
      }),
    )
    assert.equal(
      r.canonicalAnchorName,
      c.expect,
      `${c.shop} 下单 ${c.create} 应付 ${c.pay} → 期望 ${c.expect} 实际 ${r.canonicalAnchorName}`,
    )
  }

  setCanonicalAttributionTestFixtures(null)
  setManualAnchorOverrideCacheForTests(null)
  clearCanonicalAttributionCache()
  console.log('PASS: verify:20260711-real-schedule')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
