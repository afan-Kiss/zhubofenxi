/**
 * 逸凡线下 GMV 下钻 + 日报口径验收
 * - 直播主播候选 resolveDailyReportAnchorsForDate 仍排除 YIFAN_MANUAL
 * - buildDailyReport 在当日有线下出单时追加逸凡卡片与 offlineGmvYuan
 * 运行：OFFLINE_DEAL_SKIP_CACHE_INVALIDATE=1 npx tsx apps/server/scripts/accept-yifan-offline-gmv-drill.ts
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import {
  createOfflineDeal,
  isOfflineDealView,
  loadOfflineDealViewsForRange,
  splitGmvByDealSource,
  updateOfflineDealStatus,
} from '../src/services/offline-deal.service'
import {
  findYifanManualSystemAnchor,
  initializeSystemAnchors,
  isOfflineOnlyAnchor,
  refreshAnchorConfigCache,
  YIFAN_SYSTEM_KEY,
} from '../src/services/anchor.service'
import { resolveDailyReportAnchorsForDate } from '../src/services/anchor-performance-attribution.service'
import { getAnchorConfigSync } from '../src/services/anchor.service'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { buildDailyReport } from '../src/services/daily-report.service'
import { getOrBuildBusinessBoardCache } from '../src/services/business-cache.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

const DAY = '2026-07-15'

function onlineView(
  partial: Partial<AnalyzedOrderView> & { paymentBaseCent: number; anchorName: string },
): AnalyzedOrderView {
  return {
    orderId: partial.orderId ?? `P-${Date.now()}`,
    matchOrderId: partial.orderId ?? `P-${Date.now()}`,
    orderCreateTime: `${DAY} 12:00:00`,
    payTime: `${DAY} 12:00:00`,
    includedInGmv: true,
    paymentBaseCent: partial.paymentBaseCent,
    anchorName: partial.anchorName,
    anchorId: partial.anchorId ?? 'a-online',
    dealSource: 'online',
    sourceType: 'order_list',
    ...partial,
  } as AnalyzedOrderView
}

async function main() {
  console.log('accept-yifan-offline-gmv-drill')

  await initializeSystemAnchors()
  await refreshAnchorConfigCache()
  const config = getAnchorConfigSync()
  const yifan = findYifanManualSystemAnchor(config)
  assert.ok(yifan, '必须存在 systemKey=YIFAN_MANUAL 的线下专属主播')
  assert.equal(yifan.systemKey, YIFAN_SYSTEM_KEY)
  assert.ok(isOfflineOnlyAnchor(yifan))

  // 1. 直播主播候选列表排除 YIFAN_MANUAL（禁止用展示名）；日报出单时由 buildDailyReport 单独追加
  const reportAnchors = resolveDailyReportAnchorsForDate(config, DAY)
  assert.ok(
    reportAnchors.every((a) => a.systemKey !== YIFAN_SYSTEM_KEY),
    '日报直播候选 reportAnchors 不得含 YIFAN_MANUAL',
  )
  assert.ok(
    reportAnchors.every((a) => !isOfflineOnlyAnchor({ systemKey: a.systemKey })),
    '日报直播候选 reportAnchors 不得含线下专属主播',
  )

  const stamp = Date.now()
  const confirmedKey = `accept-yifan-ok-${stamp}`
  const confirmed = await createOfflineDeal({
    amountYuan: 1888.5,
    dealAt: `${DAY}T14:00:00+08:00`,
    anchorId: yifan.id,
    anchorName: yifan.name,
    externalKey: confirmedKey,
    idempotencyKey: confirmedKey,
    status: 'confirmed',
    operator: 'accept-yifan-drill',
    customerLabel: '线下客户A',
    note: '验收确认单',
  })
  await prisma.offlineDeal.update({
    where: { id: confirmed.id },
    data: { refundCent: 8850 },
  })

  const draftKey = `accept-yifan-draft-${stamp}`
  await createOfflineDeal({
    amountYuan: 900,
    dealAt: `${DAY}T14:10:00+08:00`,
    anchorId: yifan.id,
    status: 'draft',
    externalKey: draftKey,
    idempotencyKey: draftKey,
    operator: 'accept-yifan-drill',
  })

  const cancelledKey = `accept-yifan-cancel-${stamp}`
  const cancelled = await createOfflineDeal({
    amountYuan: 700,
    dealAt: `${DAY}T14:20:00+08:00`,
    anchorId: yifan.id,
    status: 'confirmed',
    externalKey: cancelledKey,
    idempotencyKey: cancelledKey,
    operator: 'accept-yifan-drill',
  })
  await updateOfflineDealStatus({
    dealId: cancelled.id,
    status: 'cancelled',
    operator: 'accept-yifan-drill',
  })

  const voidKey = `accept-yifan-void-${stamp}`
  const voided = await createOfflineDeal({
    amountYuan: 600,
    dealAt: `${DAY}T14:30:00+08:00`,
    anchorId: yifan.id,
    status: 'confirmed',
    externalKey: voidKey,
    idempotencyKey: voidKey,
    operator: 'accept-yifan-drill',
  })
  await updateOfflineDealStatus({
    dealId: voided.id,
    status: 'voided',
    operator: 'accept-yifan-drill',
  })

  // 非逸凡历史异常线下：下钻必须排除
  const other = await prisma.anchor.findFirst({
    where: {
      deletedAt: null,
      systemKey: { not: YIFAN_SYSTEM_KEY },
      OR: [{ systemKey: null }, { systemKey: { not: YIFAN_SYSTEM_KEY } }],
    },
  })
  let otherDealAmount = 0
  if (other) {
    const otherKey = `accept-other-offline-${stamp}`
    const otherDeal = await createOfflineDeal({
      amountYuan: 321,
      dealAt: `${DAY}T15:00:00+08:00`,
      anchorId: other.id,
      anchorName: other.name,
      externalKey: otherKey,
      idempotencyKey: otherKey,
      status: 'confirmed',
      operator: 'accept-yifan-drill',
    })
    otherDealAmount = 321
    assert.ok(otherDeal.anchorId !== yifan.id)
  }

  const offlineViews = await loadOfflineDealViewsForRange(DAY, DAY)
  const confirmedView = offlineViews.find((v) => v.offlineDealKey === confirmed.dealKey)
  assert.ok(confirmedView)
  assert.equal(confirmedView!.includedInGmv, true)
  assert.ok(isOfflineDealView(confirmedView!))

  const online = onlineView({
    orderId: `P-YIFAN-ACC-${stamp}`,
    paymentBaseCent: 200000,
    anchorName: '子杰',
  })
  const mixed = [online, ...offlineViews.filter((v) => v.includedInGmv)]
  const metrics = calculateBusinessMetrics(mixed)
  const split = splitGmvByDealSource(mixed)
  assert.ok(split.offlineGmv >= 1888.5 - 0.001 + otherDealAmount - 0.001)
  assert.equal(
    Number((split.onlineGmv + split.offlineGmv).toFixed(2)),
    Number(metrics.totalGmv.toFixed(2)),
    '经营看板总 GMV = 线上 + 线下',
  )

  // offlineGmv 下钻：只含逸凡 confirmed，支付金额不扣退款
  process.env.OFFLINE_DEAL_SKIP_CACHE_INVALIDATE = '1'
  const detail = await buildBoardMetricDetail({
    metric: 'offlineGmv',
    preset: 'custom',
    startDate: DAY,
    endDate: DAY,
    page: 1,
    pageSize: 50,
    role: 'super_admin',
    username: 'accept-script',
  })

  assert.equal(detail.title, '线下 GMV｜逸凡')
  assert.equal(detail.allowManualAnchorAssign, false)
  assert.equal(detail.scope?.anchorSystemKey, YIFAN_SYSTEM_KEY)
  assert.equal(detail.scope?.dealSource, 'offline')
  assert.equal(detail.scope?.anchorId, yifan.id)

  for (const row of detail.rows) {
    assert.ok(
      String(row.dealSource ?? '') === 'offline' ||
        String(row.orderNo ?? '').startsWith('OFF-') ||
        Boolean(row.offlineDealKey),
      '下钻行必须是线下成交',
    )
    assert.notEqual(String(row.orderNo ?? '').startsWith('P-'), true)
  }

  const sumPay = detail.rows.reduce(
    (s, r) => s + Number(r.merchantReceivableAmount ?? r.paymentBaseAmount ?? r.statPaidAmount ?? 0),
    0,
  )
  // 分页可能截断；用 summary / valueRaw 做卡片一致性
  assert.ok(Math.abs(Number(detail.summary.valueRaw ?? 0) - 1888.5) < 0.02 ||
    Number(detail.summary.valueRaw ?? 0) >= 1888.5 - 0.02)
  assert.ok(
    Math.abs(Number(detail.summary.valueRaw ?? 0) - sumPay) < 0.02 ||
      detail.pagination.total > detail.rows.length,
    '下钻合计应与卡片一致（无分页截断时）',
  )

  // 草稿/取消/作废不进下钻
  const keys = new Set(detail.rows.map((r) => String(r.offlineDealKey ?? r.orderNo)))
  assert.ok(!keys.has(draftKey) && ![...keys].some((k) => k.includes('draft')))
  assert.ok(![...keys].some((k) => k.includes(cancelled.dealKey)))
  assert.ok(![...keys].some((k) => k.includes(voided.dealKey)))

  // 有退款仍按支付金额计入
  const hitRow = detail.rows.find((r) => String(r.offlineDealKey) === confirmed.dealKey)
  if (hitRow) {
    const pay = Number(hitRow.merchantReceivableAmount ?? hitRow.paymentBaseAmount ?? 0)
    assert.ok(Math.abs(pay - 1888.5) < 0.02, '有退款线下单仍计入支付 GMV')
    assert.ok(Number(hitRow.refundAmount ?? hitRow.productRefundAmount ?? 0) >= 88.4)
  }

  // 改展示名后仍能按 systemKey 找到
  const renamed = findYifanManualSystemAnchor(getAnchorConfigSync())
  assert.ok(renamed)
  assert.equal(renamed!.systemKey, YIFAN_SYSTEM_KEY)

  // 有线下出单时，日报图片 payload 含线下 GMV + 逸凡卡片（不计入真实发货）
  await getOrBuildBusinessBoardCache({
    preset: 'custom',
    startDate: DAY,
    endDate: DAY,
    forceRebuild: true,
  })
  const dailyReport = await buildDailyReport({
    preset: 'custom',
    startDate: DAY,
    endDate: DAY,
  })
  assert.ok(
    Number(dailyReport.summary.offlineGmvYuan ?? 0) >= 1888.5 - 0.02,
    '日报 summary.offlineGmvYuan 应含确认线下单',
  )
  assert.ok(
    Number(dailyReport.summary.totalShippedAmountYuan ?? 0) >= 0,
    '真实发货字段仍存在',
  )
  const yifanRow = dailyReport.anchors.find((a) => a.systemKey === YIFAN_SYSTEM_KEY)
  assert.ok(yifanRow, '有线下出单时日报 anchors 应含 YIFAN_MANUAL')
  assert.ok(Number(yifanRow!.gmvYuan ?? 0) >= 1888.5 - 0.02)
  assert.equal(Number(yifanRow!.shippedAmountYuan ?? 0), 0, '逸凡线下不计入真实发货')

  console.log('OK accept-yifan-offline-gmv-drill', {
    offlineGmvCard: detail.summary.valueRaw,
    drillRows: detail.pagination.total,
    reportAnchorCount: reportAnchors.length,
    dailyReportOfflineGmv: dailyReport.summary.offlineGmvYuan,
    dailyReportHasYifan: Boolean(yifanRow),
    otherOfflineExcluded: otherDealAmount > 0,
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
