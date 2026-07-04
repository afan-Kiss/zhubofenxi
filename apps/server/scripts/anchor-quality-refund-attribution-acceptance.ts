/**
 * 主播品退归属验收
 * 用法: npm run accept:anchor-quality-refund-attribution
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AnalyzedOrderView, AnchorConfig, LiveSession } from '../src/types/analysis'
import { aggregateAnchorLeaderboard } from '../src/services/board-metrics.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import {
  aggregateQualityRefundByAnchor,
  resolveQualityRefundAnchorByOrderTime,
} from '../src/services/quality-refund-anchor-attribution.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function makeView(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: 'o1',
    packageId: 'p1',
    bizOrderId: 'b1',
    displayOrderNo: 'P1',
    officialOrderNo: 'P1',
    matchOrderId: 'm1',
    orderTimeText: '2026-06-01 10:00:00',
    buyerId: 'u1',
    anchorId: 'b1',
    anchorName: '主播B',
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
    afterSaleStatusText: '退款成功',
    isSigned: false,
    isReturned: true,
    isActualSigned: false,
    isReturnRefundOrder: true,
    isQualityReturn: true,
    strictQualityRefund: true,
    returnAmountCent: 5000,
    productRefundAmountCent: 5000,
    buyerProductRefundAmountCent: 5000,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: 5000,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: true,
    isRefundOnly: false,
    isRealProductRefund: true,
    effectiveGmvCent: 5000,
    paymentBaseCent: 5000,
    includedInGmv: true,
    ...partial,
  } as AnalyzedOrderView
}

const testConfig: AnchorConfig = {
  anchors: [
    { id: 'a1', name: '主播A', enabled: true, color: '#e11' },
    { id: 'b1', name: '主播B', enabled: true, color: '#11e' },
  ],
  timeRules: [
    {
      id: 'rule-b-evening',
      name: 'B晚场',
      anchorId: 'b1',
      enabled: true,
      startTime: '18:00',
      endTime: '23:59',
    },
  ],
}

const sessionA: LiveSession = {
  id: 'live-a',
  sourceRowIndex: 1,
  startTime: new Date('2026-06-01T10:00:00'),
  endTime: new Date('2026-06-01T12:00:00'),
  startTimeText: '2026-06-01 10:00:00',
  endTimeText: '2026-06-01 12:00:00',
  anchorId: 'a1',
  anchorName: '主播A',
  durationMinutes: 120,
  errors: [],
  raw: {},
}

function validateUiFiles(issues: string[]) {
  const mobile = fs.readFileSync(
    path.resolve(__dirname, '../../web/src/components/board/MobileAnchorLeaderboardCards.tsx'),
    'utf-8',
  )
  const pc = fs.readFileSync(
    path.resolve(__dirname, '../../web/src/components/board/AnchorLeaderboardPanel.tsx'),
    'utf-8',
  )
  assert(mobile.includes('品退单数'), '移动端主播卡片应展示「品退单数」', issues)
  assert(mobile.includes('品退率'), '移动端主播卡片应展示「品退率」', issues)
  assert(
    mobile.includes('品退按订单下单时间匹配主播开播场次归属'),
    '移动端应展示品退归属提示',
    issues,
  )
  assert(pc.includes('品退单数'), 'PC 主播榜单应展示「品退单数」', issues)
  assert(pc.includes('品退率'), 'PC 主播榜单应展示「品退率」', issues)
  assert(
    fs.existsSync(
      path.resolve(__dirname, '../../web/src/components/board/AnchorQualityRefundDrawer.tsx'),
    ),
    '应存在 AnchorQualityRefundDrawer 组件',
    issues,
  )
}

async function main(): Promise<void> {
  const issues: string[] = []

  const viewInSession = makeView({
    displayOrderNo: 'P-ATTR-A',
    officialOrderNo: 'P-ATTR-A',
    matchOrderId: 'P-ATTR-A',
    orderTimeText: '2026-06-01 11:00:00',
    anchorName: '主播B',
    anchorId: 'b1',
  })
  const attrA = resolveQualityRefundAnchorByOrderTime({
    view: viewInSession,
    liveSessions: [sessionA],
    config: testConfig,
  })
  assert(attrA?.anchorName === '主播A', '下单时间在 A 场次时应计入主播A', issues)
  assert(
    attrA?.paymentAnchorName === '主播B',
    '应保留支付归属主播B供对照',
    issues,
  )

  const viewNoSession = makeView({
    displayOrderNo: 'P-UNASSIGNED',
    officialOrderNo: 'P-UNASSIGNED',
    matchOrderId: 'P-UNASSIGNED',
    orderTimeText: '2026-06-03 08:00:00',
    anchorName: '主播A',
    anchorId: 'a1',
  })
  const attrU = resolveQualityRefundAnchorByOrderTime({
    view: viewNoSession,
    liveSessions: [sessionA],
    config: testConfig,
  })
  assert(attrU?.anchorName === '未归属', '未命中场次应归未归属', issues)
  assert(
    attrU?.unassignedReason === '下单时间未命中直播场次',
    '未命中场次应输出明确原因',
    issues,
  )

  const views = [viewInSession, viewNoSession]
  const boardQuality = calculateBusinessMetrics(views).qualityRefundOrderCount
  const leaderboard = aggregateAnchorLeaderboard(views, undefined, {
    liveSessions: [sessionA],
    config: testConfig,
  })
  const cardsTotal = leaderboard.reduce((s, r) => s + r.qualityReturnCount, 0)
  assert(
    cardsTotal === boardQuality,
    `主播卡片品退合计(${cardsTotal}) 应等于经营总览(${boardQuality})`,
    issues,
  )
  const bucketA = leaderboard.find((r) => r.anchorName === '主播A')
  assert(bucketA?.qualityReturnCount === 1, '主播A 卡片品退应为 1', issues)

  const agg = aggregateQualityRefundByAnchor({ views, liveSessions: [sessionA], config: testConfig })
  assert(agg.unassigned.length >= 1, '诊断应包含未归属品退', issues)

  validateUiFiles(issues)

  console.log('[accept:anchor-quality-refund-attribution] 用例结果:')
  console.log(`  主播A品退归属: ${attrA?.anchorName}`)
  console.log(`  未归属原因: ${attrU?.unassignedReason}`)
  console.log(`  卡片合计=${cardsTotal}, 经营总览=${boardQuality}`)

  if (issues.length) {
    console.error('[accept:anchor-quality-refund-attribution] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[accept:anchor-quality-refund-attribution] PASS')
}

void main().catch((err) => {
  console.error('[accept:anchor-quality-refund-attribution] ERROR', err)
  process.exit(1)
})
