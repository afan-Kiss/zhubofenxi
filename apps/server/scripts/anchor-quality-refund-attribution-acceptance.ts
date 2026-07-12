/**
 * 主播品退归属验收（canonical：品退 = 订单唯一归属）
 * 用法: npm run accept:anchor-quality-refund-attribution
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { aggregateAnchorLeaderboard } from '../src/services/board-metrics.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import {
  aggregateQualityRefundByAnchor,
  resolveQualityRefundAnchorByOrderTime,
} from '../src/services/quality-refund-anchor-attribution.service'
import {
  setCanonicalAttributionTestFixtures,
  clearCanonicalAttributionCache,
} from '../src/services/canonical-order-attribution.service'
import { setManualAnchorOverrideCacheForTests } from '../src/services/order-anchor-manual-override.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function makeView(partial: Partial<AnalyzedOrderView> & { raw?: Record<string, unknown> }): AnalyzedOrderView & {
  raw?: Record<string, unknown>
} {
  return {
    orderId: 'o1',
    packageId: 'p1',
    bizOrderId: 'b1',
    displayOrderNo: 'P1',
    officialOrderNo: 'P1',
    matchOrderId: 'm1',
    orderTimeText: '2026-06-01 11:00:00',
    buyerId: 'u1',
    anchorId: '',
    anchorName: '未归属',
    attributionType: 'unassigned',
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
    officialQualityBadCase: true,
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
    liveAccountName: '测试直播间A',
    ...partial,
  } as AnalyzedOrderView & { raw?: Record<string, unknown> }
}

function ms(text: string): number {
  return Date.parse(text.replace(' ', 'T') + '+08:00')
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
  assert(pc.includes('品退单数'), 'PC 主播榜单应展示「品退单数」', issues)
  assert(
    pc.includes('品退接口用于确认哪些订单发生品退') ||
      pc.includes('统一归到该订单主播'),
    'PC 应展示统一归属口径说明',
    issues,
  )
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
  clearCanonicalAttributionCache()
  setManualAnchorOverrideCacheForTests(new Map())
  setCanonicalAttributionTestFixtures({
    liveSessions: [
      {
        liveId: 'live-a',
        anchorName: '主播A',
        liveAccountName: '测试直播间A',
        startMs: ms('2026-06-01 10:00:00'),
        endMs: ms('2026-06-01 12:00:00'),
      },
    ],
  })

  const viewInSession = makeView({
    displayOrderNo: 'P-ATTR-A',
    officialOrderNo: 'P-ATTR-A',
    matchOrderId: 'P-ATTR-A',
    orderTimeText: '2026-06-01 11:00:00',
    raw: {
      orderedAt: '2026-06-01 11:00:00',
      createTime: '2026-06-01 11:00:00',
      paidAt: '2026-06-01 19:00:00',
    },
  })
  const attrA = await resolveQualityRefundAnchorByOrderTime({ view: viewInSession })
  assert(attrA?.anchorName === '主播A', '下单时间在 A 场次时应计入主播A', issues)
  assert(
    attrA?.paymentAnchorName === '主播A',
    '品退主播必须等于订单唯一归属主播',
    issues,
  )

  const viewNoSession = makeView({
    displayOrderNo: 'P-UNASSIGNED',
    officialOrderNo: 'P-UNASSIGNED',
    matchOrderId: 'P-UNASSIGNED',
    orderTimeText: '2026-06-03 08:00:00',
    raw: {
      orderedAt: '2026-06-03 08:00:00',
      createTime: '2026-06-03 08:00:00',
    },
  })
  const attrU = await resolveQualityRefundAnchorByOrderTime({ view: viewNoSession })
  assert(attrU?.anchorName === '未归属', '未命中场次应归未归属', issues)

  // 榜单用已 remap 的视图（模拟 canonical）
  const remappedViews = [
    { ...viewInSession, anchorId: 'a1', anchorName: '主播A' },
    { ...viewNoSession, anchorId: '', anchorName: '未归属' },
  ]
  const boardQuality = calculateBusinessMetrics(remappedViews).qualityRefundOrderCount
  const leaderboard = aggregateAnchorLeaderboard(remappedViews)
  const cardsTotal = leaderboard.reduce((s, r) => s + r.qualityReturnCount, 0)
  assert(
    cardsTotal === boardQuality,
    `主播卡片品退合计(${cardsTotal}) 应等于经营总览(${boardQuality})`,
    issues,
  )
  const bucketA = leaderboard.find((r) => r.anchorName === '主播A')
  assert(bucketA?.qualityReturnCount === 1, '主播A 卡片品退应为 1', issues)

  const agg = await aggregateQualityRefundByAnchor({ views: [viewInSession, viewNoSession] })
  assert(agg.unassigned.length >= 1, '诊断应包含未归属品退', issues)

  validateUiFiles(issues)

  setCanonicalAttributionTestFixtures(null)
  setManualAnchorOverrideCacheForTests(null)
  clearCanonicalAttributionCache()

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
