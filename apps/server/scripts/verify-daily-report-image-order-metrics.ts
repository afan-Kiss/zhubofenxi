/**
 * 日报图片：发货/退货/总订单/退款字段 + 文案口径
 * npx tsx apps/server/scripts/verify-daily-report-image-order-metrics.ts
 */
import assert from 'node:assert/strict'
import {
  buildDailyReportImageSessionsForAnchor,
  buildEmptyLeaveImageSession,
} from '../src/services/daily-report-image-session'
import {
  sumDailyReportRefundFromViews,
  sumDailyReportReturnFromViews,
} from '../src/services/daily-report-order.util'
import type { AnchorLiveSessionBrief } from '../src/services/anchor-live-sessions.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

function brief(
  partial: Partial<AnchorLiveSessionBrief> & Pick<AnchorLiveSessionBrief, 'liveId'>,
): AnchorLiveSessionBrief {
  return {
    liveId: partial.liveId,
    liveName: partial.liveName ?? '拾玉居和田玉',
    startTime: partial.startTime ?? '2026-07-18 09:00:00',
    endTime: partial.endTime ?? '2026-07-18 14:00:00',
    durationMinutes: partial.durationMinutes ?? 300,
    durationText: partial.durationText ?? '5小时',
    coverClickRate: partial.coverClickRate ?? 0.04,
    stay60sUserCount: partial.stay60sUserCount ?? 10,
    avgViewDurationSeconds: partial.avgViewDurationSeconds ?? 40,
    ...(partial as object),
  } as AnchorLiveSessionBrief
}

function view(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: partial.orderId ?? 'o1',
    packageId: partial.packageId ?? null,
    paymentBaseCent: partial.paymentBaseCent ?? 0,
    includedInGmv: partial.includedInGmv ?? true,
    orderStatusText: partial.orderStatusText ?? '已支付',
    productRefundAmountCent: partial.productRefundAmountCent ?? 0,
    ...partial,
  } as AnalyzedOrderView
}

async function main() {
  const cards = buildDailyReportImageSessionsForAnchor({
    anchorName: '小白',
    shopName: '拾玉居和田玉',
    sessions: [
      brief({
        liveId: 'live-1',
        sourceShopName: '拾玉居和田玉',
      } as AnchorLiveSessionBrief & { sourceShopName: string }),
    ],
    shippedAmountYuan: 1000,
    soldOrderCount: 8,
    gmvYuan: 1200,
    returnOrderCount: 2,
    returnAmountYuan: 200,
    totalOrderCount: 10,
    refundAmountYuan: 150,
    refundOrderCount: 1,
  })
  assert.equal(cards.length, 1)
  const card = cards[0]!
  assert.equal(card.shipmentOrderCount, 8)
  assert.equal(card.shipmentAmountYuan, 1000)
  assert.equal(card.returnOrderCount, 2)
  assert.equal(card.returnAmountYuan, 200)
  assert.equal(card.totalOrderCount, 10)
  assert.equal(card.orderCount, 10)
  assert.equal(card.refundOrderCount, 1)
  assert.equal(card.refundAmountYuan, 150)
  assert.equal(card.status, 'unqualified')
  console.log('  ✓ image session carries shipment/return/total/refund metrics')

  const leave = buildEmptyLeaveImageSession({
    id: 'leave::x',
    shopName: '拾玉居和田玉',
    anchorName: '小白',
    startTime: '09:00',
    endTime: '14:00',
    color: null,
  })
  assert.equal(leave.isOnLeave, true)
  assert.equal(leave.totalOrderCount, 0)
  assert.equal(leave.refundOrderCount, 0)
  console.log('  ✓ leave card has zero order metrics')

  const returnStats = sumDailyReportReturnFromViews([
    view({
      orderId: 'a',
      packageId: 'a',
      paymentBaseCent: 10000,
      orderStatusText: '已关闭',
    }),
    view({
      orderId: 'b',
      packageId: 'b',
      paymentBaseCent: 20000,
      orderStatusText: '已支付',
    }),
  ])
  assert.equal(returnStats.returnOrderCount, 1)
  assert.equal(returnStats.returnAmountYuan, 100)
  console.log('  ✓ return aggregation counts closed/after-sale orders')

  const refundStats = sumDailyReportRefundFromViews([
    view({
      orderId: 'c',
      packageId: 'c',
      paymentBaseCent: 30000,
      productRefundAmountCent: 5000,
    }),
    view({
      orderId: 'd',
      packageId: 'd',
      paymentBaseCent: 10000,
      productRefundAmountCent: 0,
    }),
  ])
  assert.equal(refundStats.refundOrderCount, 1)
  assert.equal(refundStats.refundAmountYuan, 50)
  console.log('  ✓ refund aggregation uses successful refund amount')

  console.log('verify-daily-report-image-order-metrics: OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
