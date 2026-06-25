/**
 * 运营报表验收（纯函数）
 * 用法: npx tsx apps/server/scripts/operations-report-acceptance.ts
 */
import { resolvePriceBandLabel } from '../src/config/operations-price-band.config'
import { resolveProductRole } from '../src/config/operations-product-role.config'
import {
  normalizeAfterSalesReason,
  aggregateAfterSalesReasons,
} from '../src/services/after-sales-reason-normalize.service'
import {
  sanitizeDailyReportRawOrderRow,
  shouldIncludeRawPlatformJson,
} from '../src/services/operations-report-privacy.util'
import { eachDayInShanghaiRange } from '../src/utils/each-day-shanghai'
import { extractLiveSessionTraffic } from '../src/services/live-session-traffic.util'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function testPriceBands(issues: string[]) {
  assert(resolvePriceBandLabel(399) === '≤399', '399 应落在 ≤399', issues)
  assert(resolvePriceBandLabel(400) === '400~599', '400 应落在 400~599', issues)
  assert(resolvePriceBandLabel(1999) === '1600~1999', '1999 应落在 1600~1999', issues)
  assert(resolvePriceBandLabel(2000) === '1999+', '2000 应落在 1999+', issues)
}

function testProductRole(issues: string[]) {
  assert(
    resolveProductRole({ soldCount: 10, returnRate: 0.05 }) === 'hot_sale',
    '高销量低退货应为爆款',
    issues,
  )
  assert(
    resolveProductRole({ soldCount: 3, returnRate: 0.4, manualRole: '潜力款' }) === 'potential',
    '人工角色应优先',
    issues,
  )
  assert(
    resolveProductRole({ soldCount: 0, returnRate: null }) === 'slow_moving',
    '零销量应为滞销',
    issues,
  )
}

function testAfterSalesReason(issues: string[]) {
  const size = normalizeAfterSalesReason('圈口偏大不合适')
  assert(size.category === 'size_mismatch', '圈口问题应归尺寸不符', issues)
  const aggregated = aggregateAfterSalesReasons([
    { rawReason: '质量问题', refundAmountCent: 10000, orderKey: 'P1' },
    { rawReason: '瑕疵', refundAmountCent: 5000, orderKey: 'P2' },
  ])
  assert(aggregated.length >= 1, '应聚合售后原因', issues)
}

function testPrivacy(issues: string[]) {
  const sanitized = sanitizeDailyReportRawOrderRow({
    orderId: '1',
    packageId: '1',
    bizOrderId: '1',
    matchOrderId: '1',
    orderTime: '',
    payTime: '',
    shipTime: '',
    finishTime: '',
    closeTime: '',
    productName: '测试',
    skuName: '',
    quantity: 1,
    orderAmount: 100,
    payAmount: 100,
    shippedAmount: 100,
    refundAmount: 0,
    freightRefundAmount: 0,
    shippingFee: 0,
    platformDiscount: 0,
    sellerReceiveAmount: 100,
    signedAmount: 100,
    actualSignedAmount: 100,
    orderStatus: '',
    afterSaleStatus: '',
    refundStatus: '',
    afterSaleCategory: '',
    afterSaleReason: '',
    finalAfterSaleReason: '',
    anchorName: '',
    anchorId: '',
    attributionType: '',
    matchedRuleName: '',
    matchedLiveSession: '',
    matchedLiveStartTime: '',
    matchedLiveEndTime: '',
    liveAccountId: '',
    liveAccountName: '',
    shopName: '',
    buyerId: '',
    buyerNickname: '张三',
    buyerDisplayName: '张三',
    receiverName: '李四',
    receiverPhone: '13812345678',
    receiverAddress: '上海市浦东新区123号502室',
    isLowPriceOrder: false,
    isClosed: false,
    isAfterSaleCompleted: false,
    isRefunded: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isFreightRefundOnly: false,
    isSigned: true,
    isActualSigned: true,
    isQualityReturn: false,
    strictQualityRefund: false,
    officialQualityBadCase: false,
    includedInGmv: true,
    gmvExcludeReason: '',
    paymentBaseSource: '',
    rawSource: '',
    platformRawJson: '{"secret":true}',
  })
  assert(sanitized.platformRawJson === '', '默认应清空 platformRawJson', issues)
  assert(sanitized.receiverPhone.includes('****'), '手机应脱敏', issues)
  assert(
    !shouldIncludeRawPlatformJson({ role: 'admin', confirmRaw: true }),
    '非 super_admin 不应返回 raw',
    issues,
  )
  assert(
    shouldIncludeRawPlatformJson({ role: 'super_admin', confirmRaw: true }),
    'super_admin + confirmRaw 可返回 raw',
    issues,
  )
}

function testEachDay(issues: string[]) {
  const days = eachDayInShanghaiRange('2026-06-16', '2026-06-18')
  assert(days.length === 3, '应含 3 天', issues)
  assert(days[0] === '2026-06-16' && days[2] === '2026-06-18', '逐日范围正确', issues)
}

function testTrafficNullable(issues: string[]) {
  const missing = extractLiveSessionTraffic({})
  assert(missing.dealUserCount === null, '缺失成交人数应为 null', issues)
  assert(missing.dataQuality.missingFields.includes('dealUserCount'), '应记录缺失字段', issues)
  const zero = extractLiveSessionTraffic({ dealUserNum: 0 })
  assert(zero.dealUserCount === 0, '官方返回 0 应保留 0', issues)
}

function main() {
  const issues: string[] = []
  testPriceBands(issues)
  testProductRole(issues)
  testAfterSalesReason(issues)
  testPrivacy(issues)
  testEachDay(issues)
  testTrafficNullable(issues)

  if (issues.length > 0) {
    console.error('[operations-report-acceptance] FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[operations-report-acceptance] OK')
}

main()
