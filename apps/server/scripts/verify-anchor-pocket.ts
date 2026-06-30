/**
 * 主播实际到账口径验收（纯函数）
 * 用法: npm run verify:anchor-pocket
 */
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  classifyAnchorPocketOrder,
  isBrushOrderPaidCent,
} from '../src/services/anchor-pocket-order.service'
import { LOW_PRICE_BRUSH_THRESHOLD_CENT } from '../src/services/low-price-brush-order.service'
import { dedupeViewsByMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { centToYuan } from '../src/utils/money'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function makeView(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: 'o1',
    packageId: 'p1',
    bizOrderId: 'b1',
    displayOrderNo: 'PTEST001',
    officialOrderNo: 'PTEST001',
    matchOrderId: 'm1',
    orderTimeText: '2026-06-20 10:00:00',
    buyerId: 'u1',
    anchorId: 'a1',
    anchorName: '子杰',
    liveAccountName: 'XY祥钰珠宝',
    attributionType: 'time_rule',
    gmvCent: 5000,
    productAmountCent: 5000,
    receivableAmountCent: 5000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 5000,
    actualSellerReceiveAmountCent: 5000,
    actualSignedAmountCent: 5000,
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
    effectiveGmvCent: 5000,
    paymentBaseCent: 5000,
    paymentBaseSource: 'test',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: true,
    gmvExcludeReason: null,
    isEffectiveSigned: true,
    ...partial,
  }
}

function runUnitTests(): string[] {
  const issues: string[] = []

  assert(isBrushOrderPaidCent(2800), '28元应为刷单', issues)
  assert(!isBrushOrderPaidCent(2900), '29元整不应为刷单', issues)
  assert(!isBrushOrderPaidCent(LOW_PRICE_BRUSH_THRESHOLD_CENT), '阈值边界', issues)

  const brush = classifyAnchorPocketOrder({
    view: makeView({ paymentBaseCent: 2800, includedInGmv: true }),
    shopName: 'XY祥钰珠宝',
    sessionName: '早场',
  })
  assert(brush?.isBrushOrder === true, '刷单单应标记刷单', issues)
  assert((brush?.performanceAmountCent ?? 1) === 0, '刷单不计业绩', issues)
  assert((brush?.actualPocketAmountCent ?? 1) === 0, '刷单不计到账', issues)

  const perf29 = classifyAnchorPocketOrder({
    view: makeView({ paymentBaseCent: 2900 }),
    shopName: 'XY祥钰珠宝',
    sessionName: '早场',
  })
  assert((perf29?.performanceAmountCent ?? 0) === 2900, '29元应进入业绩', issues)

  const refunded = classifyAnchorPocketOrder({
    view: makeView({
      paymentBaseCent: 10000,
      productRefundAmountCent: 3000,
      orderStatusText: '已完成',
      afterSaleStatusText: '退款成功',
    }),
    shopName: 'XY祥钰珠宝',
    sessionName: '早场',
  })
  assert((refunded?.refundFinishedAmountCent ?? 0) === 3000, '应识别已完成退款', issues)
  assert((refunded?.actualPocketAmountCent ?? 0) === 7000, '部分退款只扣部分', issues)

  const fullRefund = classifyAnchorPocketOrder({
    view: makeView({
      paymentBaseCent: 5000,
      productRefundAmountCent: 8000,
      orderStatusText: '已完成',
      afterSaleStatusText: '退款成功',
    }),
    shopName: 'XY祥钰珠宝',
    sessionName: '早场',
  })
  assert((fullRefund?.actualPocketAmountCent ?? -1) === 0, '全额退款到账为0', issues)
  assert((fullRefund?.refundFinishedAmountCent ?? 0) <= 5000, '退款不超过支付金额', issues)

  const processing = classifyAnchorPocketOrder({
    view: makeView({
      paymentBaseCent: 8000,
      orderStatusText: '已完成',
      afterSaleStatusText: '售后处理中',
    }),
    shopName: 'XY祥钰珠宝',
    sessionName: '早场',
  })
  assert((processing?.actualPocketAmountCent ?? 1) === 0, '售后处理中不进到账', issues)
  assert((processing?.refundProcessingAmountCent ?? 0) === 8000, '售后处理中金额', issues)

  const unsigned = classifyAnchorPocketOrder({
    view: makeView({
      paymentBaseCent: 6000,
      orderStatusText: '已发货',
      afterSaleStatusText: '无售后',
    }),
    shopName: 'XY祥钰珠宝',
    sessionName: '早场',
  })
  assert((unsigned?.actualPocketAmountCent ?? 1) === 0, '未签收不进到账', issues)
  assert((unsigned?.pendingReceiveAmountCent ?? 0) === 6000, '未签收待确认金额', issues)

  const closed = classifyAnchorPocketOrder({
    view: makeView({
      paymentBaseCent: 6000,
      orderStatusText: '已关闭',
    }),
    shopName: 'XY祥钰珠宝',
    sessionName: '早场',
  })
  assert((closed?.actualPocketAmountCent ?? 1) === 0, '关闭单不进到账', issues)

  const pocket = classifyAnchorPocketOrder({
    view: makeView({ paymentBaseCent: 5000 }),
    shopName: 'XY祥钰珠宝',
    sessionName: '早场',
  })
  assert((pocket?.actualPocketAmountCent ?? 0) >= 0, '到账不小于0', issues)
  assert((pocket?.actualPocketAmountCent ?? 0) <= 5000, '到账不大于支付金额', issues)

  const dupViews = [
    makeView({ displayOrderNo: 'PDUP1', officialOrderNo: 'PDUP1', paymentBaseCent: 5000 }),
    makeView({ displayOrderNo: 'PDUP1', officialOrderNo: 'PDUP1', paymentBaseCent: 5000 }),
  ]
  const deduped = dedupeViewsByMetricOrderNo(dupViews)
  assert(deduped.length === 1, '同一订单不应重复计算', issues)

  const pendingWarn = classifyAnchorPocketOrder({
    view: makeView({
      paymentBaseCent: 5000,
      afterSaleStatusText: '退款成功',
      buyerProductRefundSource: 'after_sales_workbench_pending',
    }),
    shopName: 'XY祥钰珠宝',
    sessionName: '早场',
  })
  assert(pendingWarn?.afterSalesDataPending === true, '售后缺失应标记 pending', issues)

  return issues
}

async function runDbSample(): Promise<void> {
  const { buildAnchorPocketSummary } = await import('../src/services/anchor-pocket-revenue.service')
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 30)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  try {
    const summary = await buildAnchorPocketSummary({
      preset: 'custom',
      startDate: fmt(start),
      endDate: fmt(end),
    })
    console.log('\n[verify:anchor-pocket] 近30天主播实际到账（数据库）')
    console.log('| 主播 | 业绩内金额 | 已退款 | 售后处理中 | 未签收待确认 | 实际到账 |')
    console.log('| --- | ---: | ---: | ---: | ---: | ---: |')
    for (const row of summary.anchors) {
      console.log(
        `| ${row.anchorName} | ${row.performanceAmount} | ${row.refundFinishedAmount} | ${row.refundProcessingAmount} | ${row.pendingReceiveAmount} | ${row.actualPocketAmount} |`,
      )
    }
    if (summary.dataQualityWarnings.length > 0) {
      console.log('\n数据质量提示:')
      for (const w of summary.dataQualityWarnings) {
        console.log(`- [${w.type}] ${w.message}`)
      }
    }
  } catch (err) {
    console.warn(
      '[verify:anchor-pocket] 跳过数据库抽样:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

async function main(): Promise<void> {
  const issues = runUnitTests()
  if (issues.length > 0) {
    console.error('[verify:anchor-pocket] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:anchor-pocket] 单元检查通过')
  await runDbSample()
  console.log('[verify:anchor-pocket] PASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
