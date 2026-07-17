/**
 * 线下成交品退硬隔离验收（本地 fixture，不写库、不部署）
 * 运行：npm run verify:offline-deal-quality-isolation
 */
import assert from 'node:assert/strict'
import {
  isOfflineDealView,
  offlineDealToAnalyzedView,
} from '../src/services/offline-deal.service'
import {
  resolveQualityRefundInfo,
  viewCountsAsQualityRefund,
} from '../src/services/quality-refund-resolution.service'
import {
  calculateBusinessMetrics,
  buildBlacklistedBuyerIds,
  isQualityRefundOrder,
  BUSINESS_METRICS_VERSION,
} from '../src/services/business-metrics.service'
import { resolveQualityRefundCrossVerify } from '../src/services/quality-refund-cross-verify.service'
import {
  resolveBuyerAfterSaleType,
  resolveBuyerOrderQualityRefund,
  mapViewToBuyerOrderStandard,
  buyerOrderRowCountsAsRefundOrder,
} from '../src/services/buyer-order-standard.service'
import { mapViewToBoardOrderRow } from '../src/services/order-row-mapper.service'
import { shouldFetchAfterSalesWorkbench, shouldFetchInputFromView } from '../src/services/after-sales-fetch-decision.service'
import { buildLiveAccountOrderQueries } from '../src/utils/live-account-cache-key.util'
import { matchPlatformReturnReason } from '../src/utils/quality-return'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { OFFLINE_GMV_METRICS_VERSION } from '../src/config/offline-gmv.constants'

const failures: string[] = []

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

function check(label: string, fn: () => void): void {
  try {
    fn()
    ok(label)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    failures.push(`${label}: ${msg}`)
    console.log(`✗ FAIL: ${label}: ${msg}`)
  }
}

function makeOfflineDeal(partial: {
  dealKey?: string
  amountCent?: number
  refundCent?: number
  note?: string | null
  anchorName?: string
  customerLabel?: string | null
}): ReturnType<typeof offlineDealToAnalyzedView> {
  const dealAt = new Date('2026-07-14T15:00:00.000+08:00')
  return offlineDealToAnalyzedView({
    id: 'fixture-id',
    dealKey: partial.dealKey ?? 'OFF-20260714-ESOE5V',
    amountCent: partial.amountCent ?? 80000,
    refundCent: partial.refundCent ?? 0,
    dealAt,
    status: 'confirmed',
    anchorId: 'a-yifan',
    anchorName: partial.anchorName ?? '逸凡',
    customerLabel: partial.customerLabel ?? 'zq8366',
    note: partial.note ?? null,
    createdBy: 'ops',
    updatedBy: 'ops',
    updatedAt: dealAt,
  })
}

function onlineWithReason(orderNo: string, reason: string, opts?: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: orderNo,
    packageId: orderNo,
    bizOrderId: orderNo,
    displayOrderNo: orderNo,
    officialOrderNo: orderNo,
    matchOrderId: orderNo,
    orderTimeText: '2026-07-14 12:00:00',
    buyerId: 'b-online',
    anchorId: 'a1',
    anchorName: '飞云',
    liveAccountId: 'live-1',
    attributionType: 'time_rule',
    gmvCent: 10000,
    productAmountCent: 10000,
    receivableAmountCent: 10000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 10000,
    actualSellerReceiveAmountCent: 10000,
    actualSignedAmountCent: 10000,
    orderStatusText: '已签收',
    afterSaleStatusText: '退款成功',
    isSigned: true,
    isReturned: true,
    isActualSigned: true,
    isQualityReturn: false,
    returnAmountCent: 10000,
    productRefundAmountCent: 10000,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: 10000,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: true,
    isRefundOnly: false,
    isRealProductRefund: true,
    reasonText: reason,
    finalAfterSaleReason: reason,
    afterSalesWorkbenchReason: reason,
    paymentBaseCent: 10000,
    paymentBaseSource: 'test',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: false,
    gmvExcludeReason: null,
    dealSource: 'online',
    sourceType: 'order_list',
    successfulRefundAmountCent: 10000,
    ...opts,
  } as AnalyzedOrderView
}

function main(): void {
  console.log('verify:offline-deal-quality-isolation\n')
  console.log(`BUSINESS_METRICS_VERSION=${BUSINESS_METRICS_VERSION}`)
  console.log(`OFFLINE_GMV_METRICS_VERSION=${OFFLINE_GMV_METRICS_VERSION}\n`)

  // —— 线下成交基础 1-10 ——
  const cases: Array<{ label: string; note: string | null }> = [
    { label: '1. 无退款无备注', note: null },
    { label: '2. 备注买断', note: '买断' },
    { label: '3. 备注断货', note: '断货' },
    { label: '4. 备注垄断', note: '垄断' },
    { label: '5. 备注诊断', note: '诊断' },
    { label: '6. 备注商品断裂仍非品退', note: '商品断裂' },
    { label: '7. 备注质量问题仍非品退', note: '质量问题' },
    { label: '8. 备注做工粗糙仍非品退', note: '做工粗糙' },
    { label: '8b. 备注商品破损仍非品退', note: '商品破损' },
  ]
  for (const c of cases) {
    check(c.label, () => {
      const v = makeOfflineDeal({ note: c.note })
      assert.equal(isOfflineDealView(v), true)
      assert.equal(v.reasonText, '')
      assert.equal(v.afterSalesWorkbenchReason, '')
      assert.equal(v.finalAfterSaleReason, '')
      assert.equal(v.isQualityReturn, false)
      assert.equal(viewCountsAsQualityRefund(v), false)
      assert.equal(isQualityRefundOrder(v), false)
      assert.equal(resolveBuyerOrderQualityRefund(v).isQualityRefund, false)
      const qi = resolveQualityRefundInfo({ view: v })
      assert.equal(qi.isQualityRefund, false)
      assert.equal(qi.qualityVerifyStatus, 'none')
      assert.equal(qi.suspectedQualityRefund, false)
      assert.equal(qi.verifyDisplayLabel, '—')
      assert.equal(resolveQualityRefundCrossVerify({ view: v }).isQualityRefund, false)
    })
  }

  check('9. OFF-* 不发起平台售后查询', () => {
    const v = makeOfflineDeal({ note: '买断' })
    const input = shouldFetchInputFromView(v)
    assert.equal(shouldFetchAfterSalesWorkbench(input), false)
    const queries = buildLiveAccountOrderQueries([
      {
        displayOrderNo: v.displayOrderNo,
        officialOrderNo: v.officialOrderNo,
        liveAccountId: v.liveAccountId,
        dealSource: v.dealSource,
        sourceType: v.sourceType,
        offlineDealKey: v.offlineDealKey,
        raw: v.raw as Record<string, unknown>,
      },
    ])
    assert.equal(queries.length, 0)
  })

  check('10. 线下不进入官方品退匹配（apply 短路后仍非品退）', () => {
    const v = makeOfflineDeal({ note: '质量问题' })
    const withFakeOfficial = {
      ...v,
      officialQualityBadCase: true,
      officialQualityMatchStatus: 'matched_order_only' as const,
      officialQualityReasons: ['质量问题'],
    }
    assert.equal(viewCountsAsQualityRefund(withFakeOfficial), false)
  })

  // —— 线下退款 11-16 ——
  check('11-16. 线下退款金额正确且不计入品退/退货退款/仅退款', () => {
    const v = makeOfflineDeal({ refundCent: 10000, note: '买断退款' })
    assert.equal(v.productRefundAmountCent, 10000)
    assert.equal(v.successfulRefundAmountCent, 10000)
    assert.equal(resolveBuyerAfterSaleType(v), 'offline_refund')
    assert.equal(viewCountsAsQualityRefund(v), false)
    assert.equal(v.isReturnRefund, false)
    assert.equal(v.isRefundOnly, false)
    const qi = resolveQualityRefundInfo({ view: v })
    assert.equal(qi.suspectedQualityRefund, false)
    assert.equal(qi.verifyDisplayLabel, '—')
    assert.equal(qi.afterSaleOrderNo, '')
    const row = mapViewToBuyerOrderStandard(v)
    assert.equal(row.afterSaleType, 'offline_refund')
    assert.equal(row.afterSaleTypeLabel, '线下退款')
    assert.equal(row.isQualityRefund, false)
    assert.notEqual(row.afterSaleType, 'return_refund')
    assert.notEqual(row.afterSaleType, 'refund_only')
    // 线下退款可计入退款金额口径，但不算平台退货退款/仅退款
    assert.equal(buyerOrderRowCountsAsRefundOrder(row), true)
  })

  // —— 线上回归 17-24 ——
  const onlineHits = [
    { label: '17. 线上商品断裂', reason: '商品断裂' },
    { label: '18. 线上珠串断了', reason: '珠串断了' },
    { label: '19. 线上商品开裂', reason: '商品开裂' },
    { label: '23. 线上质量问题', reason: '质量问题' },
  ]
  for (const c of onlineHits) {
    check(c.label, () => {
      assert.equal(matchPlatformReturnReason(c.reason).isQualityReturn, true)
      const v = onlineWithReason(`P-TEST-${c.label}`, c.reason)
      assert.equal(viewCountsAsQualityRefund(v), true)
    })
  }

  for (const c of [
    { label: '20. 线上买断非品退', reason: '买断' },
    { label: '21. 线上断货非品退', reason: '断货' },
    { label: '22. 线上尺寸不合适非品退', reason: '尺寸不合适' },
    { label: '22b. 线上直播断开非品退', reason: '直播断开' },
  ]) {
    check(c.label, () => {
      assert.equal(matchPlatformReturnReason(c.reason).isQualityReturn, false)
      const v = onlineWithReason(`P-TEST-${c.label}`, c.reason)
      assert.equal(viewCountsAsQualityRefund(v), false)
    })
  }

  check('24. 官方品退命中线上订单仍计入', () => {
    const v = onlineWithReason('P-OFFICIAL-1', '多拍/拍错/不想要', {
      isReturned: false,
      isReturnRefund: false,
      productRefundAmountCent: 0,
      successfulRefundAmountCent: 0,
      reasonText: '',
      finalAfterSaleReason: '',
      afterSalesWorkbenchReason: '',
      officialQualityBadCase: true,
      officialQualityMatchStatus: 'matched_order_only',
      officialQualityReasons: ['做工粗糙/有瑕疵'],
    })
    assert.equal(viewCountsAsQualityRefund(v), true)
  })

  // —— 指标回归 25-32 ——
  check('25. OFF-20260714-ESOE5V 同结构指标', () => {
    const v = makeOfflineDeal({
      dealKey: 'OFF-20260714-ESOE5V',
      amountCent: 80000,
      refundCent: 0,
      note: 'zq8366线下成交买断',
      anchorName: '逸凡',
    })
    const metrics = calculateBusinessMetrics([v])
    assert.equal(Number(metrics.totalGmv.toFixed(2)), 800)
    assert.equal(Number(metrics.actualSignedAmount.toFixed(2)), 800)
    assert.equal(Number(metrics.refundAmount.toFixed(2)), 0)
    assert.equal(metrics.refundOrderCount, 0)
    assert.equal(metrics.qualityRefundOrderCount, 0)
    assert.equal(metrics.returnOrderCount, 0)
    assert.equal(metrics.refundOnlyOrderCount, 0)
  })

  check('26-28. 主播/全局品退与黑名单不含该线下成交', () => {
    const v = makeOfflineDeal({
      dealKey: 'OFF-20260714-ESOE5V',
      amountCent: 80000,
      note: 'zq8366线下成交买断',
      customerLabel: 'zq8366',
    })
    const metrics = calculateBusinessMetrics([v])
    assert.equal(metrics.qualityRefundOrderCount, 0)
    const bl = buildBlacklistedBuyerIds([v])
    assert.equal(bl.size, 0)
  })

  check('29. 日报品退口径：viewCountsAsQualityRefund 为 false（线下过滤）', () => {
    const v = makeOfflineDeal({ note: 'zq8366线下成交买断' })
    assert.equal(viewCountsAsQualityRefund(v), false)
  })

  check('30-32. 行映射非品退、无品退归属主播、备注可展示', () => {
    const v = makeOfflineDeal({
      dealKey: 'OFF-20260714-ESOE5V',
      note: 'zq8366线下成交买断',
    })
    const row = mapViewToBoardOrderRow(v)
    assert.equal(row.isQualityReturn, false)
    assert.equal(row.qualityVerifyStatus, 'none')
    assert.equal(row.qualityVerifyDisplayLabel, '—')
    assert.equal(row.qualitySource, undefined)
    assert.equal(row.qualitySourceLabel, undefined)
    assert.equal(row.qualityReasonText, undefined)
    assert.equal(row.qualityAttributionAnchorName, null)
    assert.equal(row.offlineDealNote, 'zq8366线下成交买断')
    assert.equal(row.dealSource, 'offline')
    assert.equal(v.offlineDealNote, 'zq8366线下成交买断')
    // 模拟前端：仅 isQualityReturn 时展示品退归属
    assert.equal(row.isQualityReturn === true, false)
    // 线下不得用 OFF 号换千帆详情
    const no = String(row.orderNo || '')
    assert.ok(/^OFF-/i.test(no))
    assert.equal(/^OFF-/i.test(no) && !/^P/i.test(no), true)
  })

  check('manual_override  alone 不是线下成交', () => {
    const v = onlineWithReason('P-MANUAL-1', '质量问题', {
      scheduleAttributionSource: 'manual_override',
    })
    assert.equal(isOfflineDealView(v), false)
    assert.equal(viewCountsAsQualityRefund(v), true)
  })

  if (failures.length) {
    console.error(`\nFAIL ${failures.length} case(s)`)
    process.exit(1)
  }
  console.log('\nALL PASS')
}

main()
