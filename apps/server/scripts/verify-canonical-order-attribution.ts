/**
 * 统一订单归属核心验收（含夹具场景）
 * npm run verify:canonical-order-attribution
 */
import assert from 'node:assert/strict'
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  isTimeInHalfOpenRange,
  parseViewOrderCreateTimeMs,
  resolveCanonicalOrderAttribution,
  setCanonicalAttributionTestFixtures,
  clearCanonicalAttributionCache,
} from '../src/services/canonical-order-attribution.service'
import { buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'
import { setManualAnchorOverrideCacheForTests } from '../src/services/order-anchor-manual-override.service'

function stubView(
  over: Partial<AnalyzedOrderView> & { raw?: Record<string, unknown> },
): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return {
    orderId: 'o1',
    packageId: 'pkg1',
    bizOrderId: '',
    displayOrderNo: 'P1',
    officialOrderNo: 'P1',
    matchOrderId: 'P1',
    orderTimeText: '2026-07-11 15:00:00',
    buyerId: 'b',
    anchorId: '',
    anchorName: '未归属',
    attributionType: 'unassigned',
    gmvCent: 10000,
    productAmountCent: 10000,
    receivableAmountCent: 10000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 10000,
    actualSellerReceiveAmountCent: 10000,
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
    liveAccountName: '和田雅玉',
    ...over,
  } as AnalyzedOrderView & { raw?: Record<string, unknown> }
}

function ms(text: string): number {
  return Date.parse(text.replace(' ', 'T') + '+08:00')
}

async function main(): Promise<void> {
  clearCanonicalAttributionCache()
  setCanonicalAttributionTestFixtures(null)
  setManualAnchorOverrideCacheForTests(new Map())

  const date = '2026-07-11'
  const morning = buildScheduleBounds(date, '09:30', '14:00')
  const afternoon = buildScheduleBounds(date, '14:00', '18:30')
  const at1400 = ms(`${date} 14:00:00`)
  const at1359 = ms(`${date} 13:59:59`)
  assert.equal(
    isTimeInHalfOpenRange(at1400, morning.startAt.getTime(), morning.endAt.getTime()),
    false,
  )
  assert.equal(
    isTimeInHalfOpenRange(at1400, afternoon.startAt.getTime(), afternoon.endAt.getTime()),
    true,
  )
  assert.equal(
    isTimeInHalfOpenRange(at1359, morning.startAt.getTime(), morning.endAt.getTime()),
    true,
  )

  const create = parseViewOrderCreateTimeMs(
    stubView({
      orderTimeText: '2026-07-11 15:00:00',
      raw: {
        orderedAt: '2026-07-11 10:30:00',
        paidAt: '2026-07-11 15:00:00',
        createTime: '2026-07-11 10:30:00',
      },
    }),
  )
  assert.ok(create.ms != null)
  assert.equal(
    new Date(create.ms!).toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    '10:30',
  )

  setCanonicalAttributionTestFixtures({
    liveSessions: [
      {
        liveId: 'live-zijie',
        anchorName: '子杰',
        liveAccountName: '拾玉居和田玉',
        startMs: ms('2026-07-11 09:30:00'),
        endMs: ms('2026-07-11 14:00:00'),
      },
      {
        liveId: 'live-xiaobai',
        anchorName: '小白',
        liveAccountName: '和田雅玉',
        startMs: ms('2026-07-11 09:30:00'),
        endMs: ms('2026-07-11 14:00:00'),
      },
      {
        liveId: 'live-xiaohong',
        anchorName: '小红',
        liveAccountName: '和田雅玉',
        startMs: ms('2026-07-11 14:00:00'),
        endMs: ms('2026-07-11 18:30:00'),
      },
      {
        liveId: 'live-xiaoyi',
        anchorName: '小艺',
        liveAccountName: 'XY祥钰珠宝',
        startMs: ms('2026-07-11 14:00:00'),
        endMs: ms('2026-07-11 18:30:00'),
      },
    ],
  })

  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: '和田雅玉',
        raw: {
          orderedAt: '2026-07-11 10:30:00',
          paidAt: '2026-07-11 15:10:00',
          createTime: '2026-07-11 10:30:00',
        },
      }),
    )
    assert.equal(r.canonicalAnchorName, '小白')
    assert.equal(r.attributionType, 'live_session')
  }

  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: '和田雅玉',
        raw: {
          orderedAt: '2026-07-11 15:00:00',
          paidAt: '2026-07-11 16:00:00',
          createTime: '2026-07-11 15:00:00',
        },
      }),
    )
    assert.equal(r.canonicalAnchorName, '小红')
  }

  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: '和田雅玉',
        raw: { orderedAt: '2026-07-11 10:30:00', createTime: '2026-07-11 10:30:00' },
      }),
    )
    assert.equal(r.canonicalAnchorName, '小白')
    assert.notEqual(r.canonicalAnchorName, '子杰')
  }

  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: '和田雅玉',
        raw: { orderedAt: '2026-07-11 14:00:00', createTime: '2026-07-11 14:00:00' },
      }),
    )
    assert.equal(r.canonicalAnchorName, '小红')
  }

  {
    const a = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: '拾玉居和田玉',
        raw: { orderedAt: '2026-07-11 11:00:00', createTime: '2026-07-11 11:00:00' },
      }),
    )
    assert.equal(a.canonicalAnchorName, '子杰')
    const b = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: 'XY祥钰珠宝',
        raw: { orderedAt: '2026-07-11 15:00:00', createTime: '2026-07-11 15:00:00' },
      }),
    )
    assert.equal(b.canonicalAnchorName, '小艺')
  }

  setManualAnchorOverrideCacheForTests(
    new Map([['P-MANUAL', { anchorId: 'a-xiaoyi', anchorName: '小艺' }]]),
  )
  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        displayOrderNo: 'P-MANUAL',
        officialOrderNo: 'P-MANUAL',
        matchOrderId: 'P-MANUAL',
        liveAccountName: '和田雅玉',
        raw: { orderedAt: '2026-07-11 10:30:00', createTime: '2026-07-11 10:30:00' },
      }),
    )
    assert.equal(r.canonicalAnchorName, '小艺')
    assert.equal(r.attributionType, 'manual_override')
  }
  setManualAnchorOverrideCacheForTests(new Map())
  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        displayOrderNo: 'P-MANUAL',
        officialOrderNo: 'P-MANUAL',
        matchOrderId: 'P-MANUAL',
        liveAccountName: '和田雅玉',
        raw: { orderedAt: '2026-07-11 10:30:00', createTime: '2026-07-11 10:30:00' },
      }),
    )
    assert.equal(r.canonicalAnchorName, '小白')
    assert.equal(r.attributionType, 'live_session')
  }

  setCanonicalAttributionTestFixtures({
    liveSessions: [],
    confirmedSchedules: [
      {
        id: 'sch-ok',
        anchorName: '小白',
        shopName: '和田雅玉',
        liveRoomName: '和田雅玉',
        startAt: new Date(ms('2026-07-11 09:30:00')),
        endAt: new Date(ms('2026-07-11 14:00:00')),
        confirmed: true,
      },
      {
        id: 'sch-no',
        anchorName: '小红',
        shopName: '和田雅玉',
        liveRoomName: '和田雅玉',
        startAt: new Date(ms('2026-07-11 14:00:00')),
        endAt: new Date(ms('2026-07-11 18:30:00')),
        confirmed: false,
      },
    ],
  })
  {
    const morningHit = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: '和田雅玉',
        raw: { orderedAt: '2026-07-11 10:00:00', createTime: '2026-07-11 10:00:00' },
      }),
    )
    assert.equal(morningHit.canonicalAnchorName, '小白')
    assert.equal(morningHit.attributionType, 'confirmed_schedule')
    const afternoonMiss = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: '和田雅玉',
        raw: { orderedAt: '2026-07-11 15:00:00', createTime: '2026-07-11 15:00:00' },
      }),
    )
    assert.equal(afternoonMiss.canonicalAnchorName, '未归属')
    assert.equal(afternoonMiss.attributionType, 'unassigned')
  }

  setCanonicalAttributionTestFixtures({
    liveSessions: [
      {
        liveId: 'c1',
        anchorName: '小白',
        liveAccountName: '和田雅玉',
        startMs: ms('2026-07-11 10:00:00'),
        endMs: ms('2026-07-11 12:00:00'),
      },
      {
        liveId: 'c2',
        anchorName: '小红',
        liveAccountName: '和田雅玉',
        startMs: ms('2026-07-11 10:00:00'),
        endMs: ms('2026-07-11 12:00:00'),
      },
    ],
  })
  {
    const r = await resolveCanonicalOrderAttribution(
      stubView({
        liveAccountName: '和田雅玉',
        raw: { orderedAt: '2026-07-11 11:00:00', createTime: '2026-07-11 11:00:00' },
      }),
    )
    assert.equal(r.attributionType, 'conflict')
    assert.equal(r.canonicalAnchorName, '未归属')
  }

  setCanonicalAttributionTestFixtures(null)
  setManualAnchorOverrideCacheForTests(null)
  clearCanonicalAttributionCache()
  console.log('PASS: verify:canonical-order-attribution')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
