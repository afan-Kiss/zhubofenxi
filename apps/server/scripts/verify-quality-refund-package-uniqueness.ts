/**
 * 品退归属：同一 P 单 / packageId 只能落入一个主播桶（静态）
 *
 * npm run verify:quality-refund-package-uniqueness
 */
import type { AnalyzedOrderView, LiveSession } from '../src/types/analysis'
import { aggregateQualityRefundByAnchor } from '../src/services/quality-refund-anchor-attribution.service'

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`)
    process.exit(1)
  }
  console.log(`  ✓ ${msg}`)
}

function makeLiveSession(params: {
  id: string
  anchorName: string
  anchorId: string
  start: string
  end: string
}): LiveSession {
  const startTime = new Date(Date.parse(params.start.replace(' ', 'T') + '+08:00'))
  const endTime = new Date(Date.parse(params.end.replace(' ', 'T') + '+08:00'))
  return {
    id: params.id,
    sourceRowIndex: 1,
    startTime,
    endTime,
    startTimeText: params.start,
    endTimeText: params.end,
    anchorName: params.anchorName,
    anchorId: params.anchorId,
    durationMinutes: Math.round((endTime.getTime() - startTime.getTime()) / 60000),
    errors: [],
    raw: {},
  }
}

function baseView(
  partial: Partial<AnalyzedOrderView> & {
    packageId: string
    displayOrderNo: string
    orderTimeText: string
  },
): AnalyzedOrderView & { raw?: Record<string, unknown> } {
  return {
    orderId: partial.orderId ?? partial.packageId,
    packageId: partial.packageId,
    bizOrderId: partial.bizOrderId ?? partial.packageId,
    displayOrderNo: partial.displayOrderNo,
    officialOrderNo: partial.displayOrderNo,
    matchOrderId: partial.matchOrderId ?? partial.packageId,
    orderTimeText: partial.orderTimeText,
    buyerId: 'buyer-1',
    anchorId: partial.anchorId ?? 'pay-anchor',
    anchorName: partial.anchorName ?? '支付主播甲',
    liveAccountName: partial.liveAccountName ?? '和田雅玉',
    attributionType: 'live_session',
    gmvCent: 9900,
    productAmountCent: 9900,
    receivableAmountCent: 9900,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 9900,
    actualSellerReceiveAmountCent: 9900,
    actualSignedAmountCent: 9900,
    orderStatusText: '已完成',
    afterSaleStatusText: '退款成功',
    isSigned: true,
    isReturned: true,
    isActualSigned: true,
    isQualityReturn: true,
    returnAmountCent: 9900,
    productRefundAmountCent: 9900,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: 9900,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: true,
    isRefundOnly: false,
    isRealProductRefund: true,
    afterSaleCategory: 'quality',
    afterSaleStatusLabel: '退款成功',
    afterSaleDisplayType: '品退',
    isSizeMismatch: false,
    reasonText: '做工粗糙',
    effectiveGmvCent: 9900,
    paymentBaseCent: 9900,
    paymentBaseSource: 'test',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: true,
    gmvExcludeReason: null,
    officialQualityBadCase: true,
    officialQualityReasons: ['做工粗糙'],
    officialQualityMatchStatus: 'matched_order_only',
    qualityMainSource: 'official_bad_case',
    qualitySource: 'official_bad_case',
    raw: {
      createTime: partial.orderTimeText,
      create_time: partial.orderTimeText,
    },
    ...partial,
  }
}

function main(): void {
  console.log('\n=== 品退 P 单 / packageId 跨主播唯一性 ===')

  const liveSessions: LiveSession[] = [
    makeLiveSession({
      id: 'live-a',
      anchorName: '小红',
      anchorId: 'anchor-a',
      start: '2026-07-07 12:00:00',
      end: '2026-07-07 15:00:00',
    }),
  ]

  const sharedPackage = 'PKG-SHARED-001'
  const sharedOrderNo = 'P-SHARED-001'
  const views = [
    baseView({
      packageId: sharedPackage,
      displayOrderNo: sharedOrderNo,
      orderTimeText: '2026-07-07 13:37:00',
      orderId: 'dup-1',
      matchOrderId: 'dup-1',
    }),
    // 同 P 单 / 同 packageId 重复视图，聚合应按 orderNo 去重
    baseView({
      packageId: sharedPackage,
      displayOrderNo: sharedOrderNo,
      orderTimeText: '2026-07-07 13:37:00',
      orderId: 'dup-2',
      matchOrderId: 'dup-2',
    }),
    baseView({
      packageId: 'PKG-OTHER-002',
      displayOrderNo: 'P-OTHER-002',
      orderTimeText: '2026-07-07 13:40:00',
      orderId: 'other-1',
      matchOrderId: 'other-1',
    }),
  ]

  const agg = aggregateQualityRefundByAnchor({ views, liveSessions })

  const orderNoToAnchors = new Map<string, Set<string>>()
  const packageToAnchors = new Map<string, Set<string>>()
  for (const attr of agg.attributions) {
    const orderNo = attr.orderNo
    const pkg = attr.view.packageId?.trim() || orderNo
    const orderSet = orderNoToAnchors.get(orderNo) ?? new Set<string>()
    orderSet.add(attr.anchorName)
    orderNoToAnchors.set(orderNo, orderSet)
    const pkgSet = packageToAnchors.get(pkg) ?? new Set<string>()
    pkgSet.add(attr.anchorName)
    packageToAnchors.set(pkg, pkgSet)
  }

  for (const [orderNo, anchors] of orderNoToAnchors) {
    assert(
      anchors.size === 1,
      `P 单 ${orderNo} 只能归属一个品退主播桶（实际: ${[...anchors].join(',')}）`,
    )
  }
  for (const [pkg, anchors] of packageToAnchors) {
    assert(
      anchors.size === 1,
      `packageId ${pkg} 只能归属一个品退主播桶（实际: ${[...anchors].join(',')}）`,
    )
  }

  const sharedAttrCount = agg.attributions.filter(
    (a) => a.orderNo === sharedOrderNo || a.view.packageId === sharedPackage,
  ).length
  assert(sharedAttrCount === 1, `同 P 单去重后应仅 1 条归属（实际 ${sharedAttrCount}）`)

  const buckets = [...agg.byAnchorKey.values()]
  for (let i = 0; i < buckets.length; i++) {
    for (let j = i + 1; j < buckets.length; j++) {
      const a = new Set(buckets[i]!.orderNos)
      const overlap = buckets[j]!.orderNos.filter((no) => a.has(no))
      assert(
        overlap.length === 0,
        `${buckets[i]!.anchorName} 与 ${buckets[j]!.anchorName} 不应共享 orderNo（${overlap.join(',')}）`,
      )
    }
  }

  console.log('\n全部通过')
}

main()
