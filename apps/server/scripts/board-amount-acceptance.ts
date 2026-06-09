/**
 * 经营看板金额一致性验收（不依赖 HTTP，直接调 service）
 * 用法: npx tsx scripts/board-amount-acceptance.ts [startDate] [endDate]
 */
import { buildAmountCheckReport } from '../src/services/amount-check.service'
import { fetchLiveRangeAnalysis } from '../src/services/board-live-analysis.service'
import {
  aggregateAnchorLeaderboard,
  aggregateViewsMetrics,
} from '../src/services/board-metrics.service'
import { buildAnchorMetricDetail } from '../src/services/anchor-metric-detail.service'
import { getAnchorConfigSync } from '../src/services/anchor.service'

const startDate = process.argv[2] ?? '2026-05-01'
const endDate = process.argv[3] ?? '2026-05-31'

function eq(a: number, b: number, label: string, issues: string[]) {
  if (Math.abs(a - b) > 0.02) {
    issues.push(`${label}: amount-check=${a} vs board=${b}`)
  }
}

async function main() {
  const issues: string[] = []

  const check = await buildAmountCheckReport(startDate, endDate, 1, 500)
  const { views } = await fetchLiveRangeAnalysis({
    startDate,
    endDate,
    requestId: `acceptance-${Date.now()}`,
  })
  const boardMetrics = aggregateViewsMetrics(views)
  const anchorRows = aggregateAnchorLeaderboard(views)
  const perf = {
    cards: boardMetrics,
    anchors: anchorRows,
  }

  if (views.length === 0) {
    console.log(
      JSON.stringify(
        { ok: false, error: '该日期范围内无订单数据', range: { startDate, endDate } },
        null,
        2,
      ),
    )
    process.exit(1)
  }

  const s = check.summary
  eq(s.orderCount, boardMetrics.orderCount, '订单总数(经营总览 views)', issues)
  eq(s.signedCount, boardMetrics.signedCount, '签收单数(经营总览 views)', issues)
  eq(s.returnCount, boardMetrics.returnCount, '退款单数(经营总览 views)', issues)
  eq(s.qualityReturnCount, boardMetrics.qualityReturnCount, '品退单数(经营总览 views)', issues)
  eq(s.productGmvYuan, boardMetrics.productGmv, '总销售额 GMV', issues)
  eq(s.effectiveGmvYuan, boardMetrics.effectiveGmv, '有效销售额', issues)
  eq(s.actualSignedAmountYuan, boardMetrics.actualSignedAmount, '实际签收金额', issues)
  eq(s.refundAmountYuan, boardMetrics.returnAmount, '退款金额', issues)
  eq(s.signRate, boardMetrics.signRate, '签收率', issues)
  eq(s.qualityReturnRate, boardMetrics.qualityReturnRate, '品退率', issues)

  const perfTotals = perf.cards
  eq(s.orderCount, Number(perfTotals.orderCount ?? 0), '订单总数(主播业绩 live-query)', issues)
  eq(s.signedCount, Number(perfTotals.signedCount ?? 0), '签收单数(主播业绩 live-query)', issues)
  eq(s.returnCount, Number(perfTotals.returnCount ?? 0), '退款单数(主播业绩 live-query)', issues)
  eq(s.qualityReturnCount, Number(perfTotals.qualityReturnCount ?? 0), '品退单数(主播业绩 live-query)', issues)
  eq(s.signRate, Number(perfTotals.signRate ?? 0), '签收率(主播业绩 live-query)', issues)
  eq(s.qualityReturnRate, Number(perfTotals.qualityReturnRate ?? 0), '品退率(主播业绩 live-query)', issues)

  const config = getAnchorConfigSync()
  const firstAnchor = config.anchors.find((a) => a.enabled)
  let anchorDetailOk = true
  if (firstAnchor) {
    const row = perf.anchors.find(
      (a) => a.anchorId === firstAnchor.id || a.anchorName === firstAnchor.name,
    )
    const signDetail = await buildAnchorMetricDetail({
      anchorId: firstAnchor.id,
      metric: 'signRate',
      startDate,
      endDate,
      role: 'super_admin',
      username: 'admin',
    })
    const qrDetail = await buildAnchorMetricDetail({
      anchorId: firstAnchor.id,
      metric: 'qualityRefundRate',
      startDate,
      endDate,
      role: 'super_admin',
      username: 'admin',
    })
    if (row) {
      const denom = signDetail.summary.totalOrders
      if (denom !== qrDetail.summary.totalOrders) {
        issues.push(
          `品退率/签收率分母不一致: sign=${denom} quality=${qrDetail.summary.totalOrders}`,
        )
        anchorDetailOk = false
      }
      if (denom !== row.orderCount) {
        issues.push(`主播详情分母与列表不一致: detail=${denom} list=${row.orderCount}`)
        anchorDetailOk = false
      }
    }
  }

  const report = {
    ok: issues.length === 0,
    range: { startDate, endDate },
    amountCheck: {
      orderCount: s.orderCount,
      signedCount: s.signedCount,
      returnCount: s.returnCount,
      qualityReturnCount: s.qualityReturnCount,
      productGmvYuan: s.productGmvYuan,
      effectiveGmvYuan: s.effectiveGmvYuan,
      actualSignedAmountYuan: s.actualSignedAmountYuan,
      refundAmountYuan: s.refundAmountYuan,
      signRate: s.signRate,
      qualityReturnRate: s.qualityReturnRate,
    },
    boardMetrics,
    anchorPerformanceTotals: perfTotals,
    rateDenominatorConsistent: anchorDetailOk,
    issues,
  }

  console.log(JSON.stringify(report, null, 2))
  process.exit(issues.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
