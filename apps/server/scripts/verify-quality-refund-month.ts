/**
 * 品退月度诊断验收：官方品退已匹配但关键指标为 0 时，数据健康必须能解释原因。
 */
import { readText, repoPath, fail, pass } from './acceptance/_shared'
import { buildQualityRefundMonthDiagnostic } from '../src/services/quality-refund-month-diagnostic.service'
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
    orderTimeText: partial.orderTimeText ?? '2026-06-15',
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
    liveAccountId: 'shop1',
    ...partial,
  } as AnalyzedOrderView
}

function main(): void {
  const issues: string[] = []

  const auditSrc = readText(
    repoPath('apps/server/src/services/data-accuracy-audit.service.ts'),
  )
  assert(
    auditSrc.includes('buildQualityRefundMonthDiagnostic'),
    '数据健康必须接入 buildQualityRefundMonthDiagnostic',
    issues,
  )
  assert(
    auditSrc.includes('quality_refund_diagnostic'),
    '数据健康必须包含 quality_refund_diagnostic 核对项',
    issues,
  )
  assert(
    auditSrc.includes('officialRawCount'),
    '品退诊断必须展示官方品退原始数量',
    issues,
  )

  const diag = buildQualityRefundMonthDiagnostic({
    views: [mockView({ orderId: 'P-TEST-001' })],
    startDate: '2026-06-01',
    endDate: '2026-06-30',
  })
  assert(
    typeof diag.officialRawCount === 'number' &&
      typeof diag.matchedOrderCount === 'number' &&
      typeof diag.unmatchedOrderCount === 'number' &&
      typeof diag.periodQualityRefundOrderCount === 'number',
    '品退月度诊断必须返回官方/匹配/未匹配/本期计入数量',
    issues,
  )
  assert(Array.isArray(diag.excludeSamples), '品退诊断必须包含未计入原因样本', issues)
  assert(diag.note.length > 0, '品退诊断必须包含说明文案', issues)

  if (issues.length > 0) {
    fail('品退月度诊断验收失败', issues)
  }
  pass('品退月度诊断验收通过')
}

main()
