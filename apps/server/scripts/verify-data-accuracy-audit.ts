#!/usr/bin/env tsx
import {
  dataAccuracyCheckStatus,
  duplicateSamplesFromRawViewsForTest,
  resolveBadBuyerAuditSampleLimit,
  resolveBuyerAuditSampleLimit,
  resolveRawVsNormalizedCheck,
} from '../src/services/data-accuracy-audit.service'
import { buildBlockingIssueSummary } from '../src/services/data-accuracy-audit-diff.util'
import { scanXhsSyncFrequencyReport } from '../src/services/xhs-sync-frequency-scan.util'
import { MONTHLY_CLOSE_REPORT_SCHEMA_VERSION } from '../src/utils/report-build-meta'
import type { DataAccuracyCheck } from '../src/services/monthly-close-auto.types'
import type { AnalyzedOrderView } from '../src/types/analysis'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function mockView(partial: Partial<AnalyzedOrderView> & { orderId: string }): AnalyzedOrderView {
  return {
    orderId: partial.orderId,
    packageId: partial.packageId ?? partial.orderId,
    bizOrderId: partial.orderId,
    displayOrderNo: partial.displayOrderNo ?? partial.orderId,
    officialOrderNo: partial.officialOrderNo ?? partial.orderId,
    matchOrderId: partial.matchOrderId ?? partial.packageId ?? partial.orderId,
    orderTimeText: '2026-01-01',
    buyerId: 'b1',
    anchorId: 'a1',
    anchorName: '主播',
    attributionType: 'order_anchor_field',
    gmvCent: 100,
    productAmountCent: 100,
    receivableAmountCent: 100,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 100,
    actualSellerReceiveAmountCent: 100,
    actualSignedAmountCent: 0,
    orderStatusText: '已完成',
    afterSaleStatusText: '',
    isSigned: false,
    isReturned: false,
    isActualSigned: false,
    isQualityReturn: false,
    returnAmountCent: 0,
    productRefundAmountCent: 0,
    buyerProductRefundAmountCent: 0,
    includedInGmv: true,
    paymentBaseCent: 100,
    effectiveGmvCent: 100,
    ...partial,
  } as AnalyzedOrderView
}

async function main() {
  const issues: string[] = []

  assert(dataAccuracyCheckStatus(0, 0) === 'pass', '完全一致应 pass', issues)
  assert(dataAccuracyCheckStatus(1, 0) === 'danger', '差 1 分应 danger', issues)
  assert(dataAccuracyCheckStatus(0, 1) === 'danger', '差 1 单应 danger', issues)

  const dupViews = [
    mockView({ orderId: 'P001', displayOrderNo: 'P001', packageId: 'pkg1', matchOrderId: 'm1' }),
    mockView({ orderId: 'P001', displayOrderNo: 'P001', packageId: 'pkg1', matchOrderId: 'm1' }),
  ]
  const dup = duplicateSamplesFromRawViewsForTest(dupViews)
  assert(dup.duplicateGroupCount > 0, '重复订单必须能被查出来', issues)
  assert(dup.samples.some((s) => s.count > 1), '重复样本 count 应 > 1', issues)

  const uniqueViews = [mockView({ orderId: 'P002' }), mockView({ orderId: 'P003' })]
  const noDup = duplicateSamplesFromRawViewsForTest(uniqueViews)
  assert(noDup.duplicateGroupCount === 0, '无重复时不应报 duplicate', issues)

  assert(resolveRawVsNormalizedCheck(0, 0).status === 'pass', '双零应 pass', issues)
  assert(resolveRawVsNormalizedCheck(100, 0).status === 'danger', '有 raw 无 normalized 应 danger', issues)
  assert(resolveRawVsNormalizedCheck(10, 12).status === 'danger', 'normalized 多于 raw 应 danger', issues)
  assert(resolveRawVsNormalizedCheck(100, 95).status === 'warning', 'raw 略多不应无脑 danger', issues)
  assert(
    resolveRawVsNormalizedCheck(100, 95).excludeFromTotals === true,
    'raw_vs_normalized 不应计入 orderDiffTotal',
    issues,
  )
  assert(resolveRawVsNormalizedCheck(100, 100).status === 'pass', '相等应 pass', issues)

  assert(resolveBuyerAuditSampleLimit(true, 100) === 100, 'fullScan 买家榜应全量', issues)
  assert(resolveBuyerAuditSampleLimit(false, 100) === 20, '非 fullScan 买家榜应抽样20', issues)
  assert(resolveBadBuyerAuditSampleLimit(true, 50) === 50, 'fullScan 垃圾客户榜应全量', issues)
  assert(resolveBadBuyerAuditSampleLimit(false, 50) === 10, '非 fullScan 垃圾客户榜应抽样10', issues)

  const blockingSummary = buildBlockingIssueSummary([
    {
      key: 'board_vs_daily_sum',
      title: '经营总览 vs 运营日报逐日求和',
      status: 'danger',
      category: 'blocking',
      diffCent: 20,
      note: 'test',
    },
    {
      key: 'raw_vs_normalized',
      title: 'raw vs normalized',
      status: 'warning',
      category: 'info',
      note: '不应进入 blocking',
    },
  ] as DataAccuracyCheck[])
  assert(blockingSummary.length === 1, 'blockingIssues 应只含 blocking danger', issues)
  assert(blockingSummary[0]!.includes('经营总览和运营日报'), 'blocking 应含金额差异文案', issues)

  const payTimeFindings = scanXhsSyncFrequencyReport().filter((f) =>
    f.file.includes('order-pay-time-prefilter-diagnostic'),
  )
  assert(payTimeFindings.length > 0, '应扫描到 pay-time diagnostic 文件', issues)
  assert(
    payTimeFindings.every((f) => f.risk !== 'high'),
    '本地 DB while(true) 不应标 high',
    issues,
  )
  assert(
    payTimeFindings.some((f) => f.reason.includes('本地数据库分页扫描')),
    '本地 DB 扫描应有说明文案',
    issues,
  )

  assert(MONTHLY_CLOSE_REPORT_SCHEMA_VERSION === 2, '报告 schema 版本应为 2', issues)

  if (issues.length > 0) {
    console.error('[verify:data-accuracy-audit] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:data-accuracy-audit] PASS')
}

void main()
