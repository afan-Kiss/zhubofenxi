/**
 * 静态验收：和田雅玉 / 拾玉居 同日同时段排班交叉隔离
 * 2026-07-07 13:37 → 和田雅玉=小红，拾玉居=子杰（不依赖生产库）
 *
 * npm run verify:hetianyayu-morning-schedule-attribution
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import { matchScheduleRow } from '../src/services/anchor-schedule-attribution.service'
import { buildScheduleBounds } from '../src/utils/anchor-schedule-time.util'

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`)
    process.exit(1)
  }
  console.log(`  ✓ ${msg}`)
}

function makeView(
  liveAccountName: string,
  orderTimeText: string,
): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return {
    orderId: `o-${liveAccountName}`,
    packageId: `p-${liveAccountName}`,
    bizOrderId: `b-${liveAccountName}`,
    displayOrderNo: `P-${liveAccountName}`,
    officialOrderNo: `P-${liveAccountName}`,
    matchOrderId: `m-${liveAccountName}`,
    orderTimeText,
    buyerId: 'u1',
    anchorId: '',
    anchorName: '未归属',
    liveAccountName,
    attributionType: 'time_rule',
    gmvCent: 10000,
    productAmountCent: 10000,
    receivableAmountCent: 10000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 10000,
    actualSellerReceiveAmountCent: 10000,
    actualSignedAmountCent: 10000,
    orderStatusText: '已完成',
    afterSaleStatusText: '无售后',
    isSigned: true,
    isReturned: false,
    isActualSigned: true,
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
    afterSaleCategory: '',
    afterSaleStatusLabel: '',
    afterSaleDisplayType: '',
    isSizeMismatch: false,
    reasonText: '',
    effectiveGmvCent: 10000,
    paymentBaseCent: 10000,
    paymentBaseSource: 'test',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: true,
    gmvExcludeReason: null,
    raw: { paymentTime: orderTimeText, payTime: orderTimeText },
  }
}

function main(): void {
  console.log('\n=== 和田雅玉 / 拾玉居 13:37 排班交叉隔离 ===')

  const date = '2026-07-07'
  const payTimeText = '2026-07-07 13:37:00'
  const payMs = Date.parse(`${date}T13:37:00+08:00`)

  // 与 2026-07-01 默认模板一致：09:30–14:00
  const morningBounds = buildScheduleBounds(date, '09:30', '14:00')

  const scheduleRows = [
    {
      id: 'sch-hetian-xiaohong',
      anchorName: '小红',
      shopName: '和田雅玉',
      liveRoomName: '和田雅玉',
      startAt: morningBounds.startAt,
      endAt: morningBounds.endAt,
    },
    {
      id: 'sch-shiyuju-zijie',
      anchorName: '子杰',
      shopName: '拾玉居和田玉',
      liveRoomName: '拾玉居和田玉',
      startAt: morningBounds.startAt,
      endAt: morningBounds.endAt,
    },
  ]

  const hetianView = makeView('和田雅玉', payTimeText)
  const shiyujuView = makeView('拾玉居和田玉', payTimeText)

  const hetianHit = matchScheduleRow(hetianView, payMs, scheduleRows)
  assert(hetianHit != null, '和田雅玉 13:37 应命中排班行')
  assert(hetianHit!.anchorName === '小红', `和田雅玉 13:37 → 小红（实际 ${hetianHit?.anchorName}）`)
  assert(
    hetianHit!.id === 'sch-hetian-xiaohong',
    '和田雅玉应命中本店排班，不串到拾玉居',
  )

  const shiyujuHit = matchScheduleRow(shiyujuView, payMs, scheduleRows)
  assert(shiyujuHit != null, '拾玉居和田玉 13:37 应命中排班行')
  assert(shiyujuHit!.anchorName === '子杰', `拾玉居和田玉 13:37 → 子杰（实际 ${shiyujuHit?.anchorName}）`)
  assert(
    shiyujuHit!.id === 'sch-shiyuju-zijie',
    '拾玉居和田玉应命中本店排班，不串到和田雅玉',
  )

  // 交叉：把对方店铺行单独传入，应不命中
  const hetianOnlyOtherShop = matchScheduleRow(hetianView, payMs, [scheduleRows[1]!])
  assert(hetianOnlyOtherShop == null, '和田雅玉订单不应命中拾玉居和田玉排班行')

  const shiyujuOnlyOtherShop = matchScheduleRow(shiyujuView, payMs, [scheduleRows[0]!])
  assert(shiyujuOnlyOtherShop == null, '拾玉居和田玉订单不应命中和田雅玉排班行')

  console.log('\n全部通过')
}

main()
