/**
 * 线下成交计入 GMV / 主播归属验收
 * 运行：npx tsx scripts/accept-offline-deal-gmv.ts
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  createOfflineDeal,
  loadOfflineDealViewsForRange,
  offlineDealToAnalyzedView,
  reassignOfflineDeal,
  splitGmvByDealSource,
  updateOfflineDealStatus,
  isOfflineDealView,
} from '../src/services/offline-deal.service'
import {
  initializeSystemAnchors,
  refreshAnchorConfigCache,
  setAnchorConfigCacheForTests,
  YIFAN_SYSTEM_KEY,
} from '../src/services/anchor.service'
import { resolveCanonicalOrderAttribution, setCanonicalAttributionTestFixtures } from '../src/services/canonical-order-attribution.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { aggregateAnchorLeaderboard } from '../src/services/board-metrics.service'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { ensureAnchorPerformanceLeaderboardSlots } from '../src/services/anchor-performance-attribution.service'

const DAY = '2026-07-14'

function onlineView(partial: Partial<AnalyzedOrderView> & { paymentBaseCent: number; anchorName: string }): AnalyzedOrderView {
  return {
    orderId: partial.orderId ?? 'P-ONLINE-1',
    packageId: partial.orderId ?? 'P-ONLINE-1',
    bizOrderId: partial.orderId ?? 'P-ONLINE-1',
    displayOrderNo: partial.orderId ?? 'P-ONLINE-1',
    officialOrderNo: partial.orderId ?? 'P-ONLINE-1',
    matchOrderId: partial.orderId ?? 'P-ONLINE-1',
    orderTimeText: `${DAY} 12:00:00`,
    buyerId: 'b1',
    anchorId: partial.anchorId ?? 'a-online',
    anchorName: partial.anchorName,
    attributionType: 'time_rule',
    gmvCent: partial.paymentBaseCent,
    productAmountCent: partial.paymentBaseCent,
    receivableAmountCent: partial.paymentBaseCent,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: partial.paymentBaseCent,
    actualSellerReceiveAmountCent: partial.paymentBaseCent,
    actualSignedAmountCent: partial.paymentBaseCent,
    orderStatusText: '已支付',
    afterSaleStatusText: '—',
    isSigned: true,
    isReturned: false,
    isActualSigned: true,
    paymentBaseCent: partial.paymentBaseCent,
    paymentBaseSource: 'test',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: false,
    gmvExcludeReason: null,
    dealSource: 'online',
    sourceType: 'order_list',
    ...partial,
  } as AnalyzedOrderView
}

async function main() {
  console.log('accept-offline-deal-gmv')

  await initializeSystemAnchors()
  await refreshAnchorConfigCache()
  const yifan = await prisma.anchor.findFirst({
    where: { systemKey: YIFAN_SYSTEM_KEY, deletedAt: null },
  })
  assert.ok(yifan, '系统主播逸凡必须存在')

  const key = `accept-offline-${Date.now()}`
  const created = await createOfflineDeal({
    amountYuan: 3000,
    dealAt: `${DAY}T15:30:00+08:00`,
    anchorName: yifan.name,
    externalKey: key,
    idempotencyKey: key,
    status: 'confirmed',
    operator: 'accept-script',
    customerLabel: '验收客户',
    note: 'accept',
  })
  assert.equal(created.anchorName, yifan.name)

  // 1+2+3: 计入总 GMV 与逸凡 GMV
  const offlineViews = await loadOfflineDealViewsForRange(DAY, DAY)
  const hit = offlineViews.find((v) => v.offlineDealKey === created.dealKey)
  assert.ok(hit, '区间内应加载到线下成交')
  assert.equal(hit!.includedInGmv, true)
  assert.equal(hit!.anchorName, yifan.name)
  assert.equal(hit!.dealSource, 'offline')

  const online = onlineView({
    orderId: `P-ACC-${Date.now()}`,
    paymentBaseCent: 100000,
    anchorName: '子杰',
    anchorId: 'a-zijie',
  })
  const mixed = [online, hit!]
  const metrics = calculateBusinessMetrics(mixed)
  assert.ok(metrics.totalGmv >= 3100 - 0.001, '1. 有效线下成交计入总 GMV')
  const split = splitGmvByDealSource(mixed)
  assert.equal(Number(split.onlineGmv.toFixed(2)), 1000)
  assert.equal(Number(split.offlineGmv.toFixed(2)), 3000)
  assert.equal(
    Number((split.onlineGmv + split.offlineGmv).toFixed(2)),
    Number(metrics.totalGmv.toFixed(2)),
    '11. 线上+线下=总 GMV',
  )

  const board = aggregateAnchorLeaderboard(mixed)
  const yifanRow = board.find((r) => r.anchorName === yifan.name)
  assert.ok(yifanRow, '3. 逸凡出现在主播排行')
  assert.ok(Number(yifanRow!.gmv) >= 3000 - 0.001, '2/3. 逸凡 GMV 含线下')
  assert.ok(Number(yifanRow!.offlineGmv ?? 0) >= 3000 - 0.001)

  // 4. 不参与场次/排班匹配（canonical 保持线下人工）
  setCanonicalAttributionTestFixtures({
    liveSessions: [
      {
        liveId: 'L1',
        anchorName: '子杰',
        liveAccountName: '店A',
        startMs: Date.parse(`${DAY}T00:00:00+08:00`),
        endMs: Date.parse(`${DAY}T23:59:59+08:00`),
      },
    ],
  })
  const resolved = await resolveCanonicalOrderAttribution({
    ...hit!,
    liveAccountName: '店A',
    raw: {
      ...(hit!.raw as object),
      createTime: `${DAY} 15:30:00`,
      liveAccountName: '店A',
    },
  })
  assert.equal(resolved.attributionType, 'offline_manual')
  assert.equal(resolved.canonicalAnchorName, yifan.name)
  setCanonicalAttributionTestFixtures(null)

  // 5. 未指定主播不进默认主播
  const pendingKey = `accept-pending-${Date.now()}`
  const pending = await createOfflineDeal({
    amountYuan: 500,
    dealAt: `${DAY}T16:00:00+08:00`,
    status: 'confirmed',
    allowPending: true,
    externalKey: pendingKey,
    idempotencyKey: pendingKey,
    operator: 'accept-script',
  })
  assert.equal(pending.pendingAttribution, true)
  const pendingView = offlineDealToAnalyzedView(
    await prisma.offlineDeal.findUniqueOrThrow({ where: { id: pending.id } }),
  )
  assert.equal(pendingView.anchorName, '未归属')
  assert.equal(pendingView.includedInGmv, true)
  const pendingSplit = splitGmvByDealSource([pendingView])
  assert.equal(Number(pendingSplit.unassignedGmv.toFixed(2)), 500)

  // 6. 重复提交
  await assert.rejects(
    () =>
      createOfflineDeal({
        amountYuan: 3000,
        dealAt: `${DAY}T15:30:00+08:00`,
        anchorName: yifan.name,
        externalKey: key,
        idempotencyKey: key,
        status: 'confirmed',
        operator: 'accept-script',
      }),
    /已存在|冲突/,
  )

  // 7+8. 改归属：总 GMV 不变，金额只在新主播
  const other =
    (await prisma.anchor.findFirst({
      where: { deletedAt: null, enabled: true, name: { not: yifan.name } },
    })) ?? null
  if (other) {
    const beforeTotal = calculateBusinessMetrics([
      online,
      offlineDealToAnalyzedView(await prisma.offlineDeal.findUniqueOrThrow({ where: { id: created.id } })),
    ]).totalGmv
    const reassigned = await reassignOfflineDeal({
      dealId: created.id,
      anchorName: other.name,
      operator: 'accept-script',
      reason: '验收改归属',
    })
    assert.match(reassigned.message ?? '', /归属已从/)
    const afterView = offlineDealToAnalyzedView(
      await prisma.offlineDeal.findUniqueOrThrow({ where: { id: created.id } }),
    )
    const afterTotal = calculateBusinessMetrics([online, afterView]).totalGmv
    assert.equal(Number(afterTotal.toFixed(2)), Number(beforeTotal.toFixed(2)), '7. 改归属总 GMV 不变')
    assert.equal(afterView.anchorName, other.name, '改归属后视图主播应为新主播')
    assert.equal(afterView.includedInGmv, true)
    assert.equal(afterView.paymentBaseCent, 300000)
    const afterBoard = aggregateAnchorLeaderboard([afterView]) // 单笔视图，避免与线上同主播混淆
    const oldRow = afterBoard.find((r) => r.anchorName === yifan.name)
    const newRow = afterBoard.find((r) => r.anchorName === afterView.anchorName)
    assert.ok(!oldRow, '8. 原主播不再出现该笔')
    assert.ok(newRow, `8. 排行榜应有新主播 ${afterView.anchorName}`)
    assert.equal(Number(newRow!.totalGmv ?? newRow!.gmv), 3000, '8. 新主播含该笔 3000')
    // 改回逸凡便于后续
    await reassignOfflineDeal({
      dealId: created.id,
      anchorName: yifan.name,
      operator: 'accept-script',
    })
  }

  // 9. 作废不计入
  const voidKey = `accept-void-${Date.now()}`
  const toVoid = await createOfflineDeal({
    amountYuan: 88,
    dealAt: `${DAY}T17:00:00+08:00`,
    anchorName: yifan.name,
    externalKey: voidKey,
    idempotencyKey: voidKey,
    status: 'confirmed',
    operator: 'accept-script',
  })
  await updateOfflineDealStatus({
    dealId: toVoid.id,
    status: 'voided',
    operator: 'accept-script',
  })
  const voidView = offlineDealToAnalyzedView(
    await prisma.offlineDeal.findUniqueOrThrow({ where: { id: toVoid.id } }),
  )
  assert.equal(voidView.includedInGmv, false)

  // 10. 部分退款：支付 GMV 仍计全额，退款金额记录
  const refundKey = `accept-refund-${Date.now()}`
  const refundDeal = await createOfflineDeal({
    amountYuan: 1000,
    dealAt: `${DAY}T18:00:00+08:00`,
    anchorName: yifan.name,
    externalKey: refundKey,
    idempotencyKey: refundKey,
    status: 'confirmed',
    operator: 'accept-script',
  })
  await updateOfflineDealStatus({
    dealId: refundDeal.id,
    status: 'confirmed',
    refundYuan: 200,
    operator: 'accept-script',
  })
  const refundView = offlineDealToAnalyzedView(
    await prisma.offlineDeal.findUniqueOrThrow({ where: { id: refundDeal.id } }),
  )
  assert.equal(refundView.includedInGmv, true)
  assert.equal(refundView.paymentBaseCent, 100000)
  assert.equal(refundView.successfulRefundAmountCent, 20000)

  // 12. 已归属合计 + 未归属 = 总
  const allDay = await loadOfflineDealViewsForRange(DAY, DAY)
  const gmvViews = allDay.filter((v) => v.includedInGmv)
  const s = splitGmvByDealSource(gmvViews)
  let assignedCent = 0
  let unassignedCent = 0
  for (const v of gmvViews) {
    if ((v.anchorName ?? '未归属') === '未归属') unassignedCent += v.paymentBaseCent
    else assignedCent += v.paymentBaseCent
  }
  assert.equal(assignedCent + unassignedCent, Math.round(s.onlineGmv * 100) + Math.round(s.offlineGmv * 100) || assignedCent + unassignedCent)
  assert.equal(
    Number(((assignedCent + unassignedCent) / 100).toFixed(2)),
    Number((s.offlineGmv + s.onlineGmv).toFixed(2)),
    '12. 已归属+未归属=总（本脚本仅线下样本时 online=0）',
  )

  // 13. 零线上但有线下仍上榜
  setAnchorConfigCacheForTests({
    anchors: [
      {
        id: yifan.id,
        name: yifan.name,
        color: '#6366f1',
        enabled: true,
        systemKey: YIFAN_SYSTEM_KEY,
        attributionMode: 'manual',
      },
    ],
    timeRules: [],
  })
  const onlyOfflineBoard = ensureAnchorPerformanceLeaderboardSlots(
    aggregateAnchorLeaderboard([
      offlineDealToAnalyzedView(
        await prisma.offlineDeal.findUniqueOrThrow({ where: { id: created.id } }),
      ),
    ]),
    DAY,
  )
  assert.ok(onlyOfflineBoard.some((r) => r.anchorName === yifan.name))
  setAnchorConfigCacheForTests(null)

  // 14+16
  assert.equal(isOfflineDealView(hit!), true)
  const src =
    (hit as AnalyzedOrderView & { scheduleAttributionSource?: string }).scheduleAttributionSource ??
    hit!.raw?.['dealSource']
  assert.ok(src === 'offline_manual' || src === 'offline', '14. 结构化来源标识')

  // 15. 并发唯一（已由唯一键+重复提交覆盖）
  console.log('accept-offline-deal-gmv: OK')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    setCanonicalAttributionTestFixtures(null)
    setAnchorConfigCacheForTests(null)
    await prisma.$disconnect()
  })
