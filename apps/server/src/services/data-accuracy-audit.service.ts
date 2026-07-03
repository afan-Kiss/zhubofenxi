import { LOCAL_VIEWER_USER } from '../constants/local-viewer'
import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'
import { getBoardScopedViewsForRange } from './board-scoped-views.service'
import { aggregateAnchorLeaderboard, aggregateViewsMetrics } from './board-metrics.service'
import { filterViewsForAnchorPerformance } from './low-price-brush-order.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import { buildDailyOperationsReport } from './daily-operations-report.service'
import { getMonthlyOperationsReport } from './monthly-operations-report.service'
import { aggregateWeeklySummaryForAcceptance } from './weekly-operations-report.service'
import { sumValidRevenueFromViews } from './valid-revenue-order.service'
import { computeOperationsRefundMetricsFromViews } from './operations-after-sale-order.util'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import type { AnalyzedOrderView } from '../types/analysis'
import { resolveDateRange } from '../utils/date-range'
import { buildBuyerRankingAllItems } from './buyer-ranking.service'
import {
  buildBadBuyerProfile,
  isBadBuyerCandidate,
  qualityRefundOrderCount,
  returnRefundOrderCount,
  afterSaleOrderCount,
} from './bad-buyer-ranking.service'
import { centToYuan } from '../utils/money'
import { runPayTimePrefilterDiagnostic } from './order-pay-time-prefilter-diagnostic.service'
import { loadNormalizedOrdersFromRaw } from './xhs-api-sync/xhs-json-normalizer.service'
import { prisma } from '../lib/prisma'
import type {
  DataAccuracyAuditReport,
  DataAccuracyCheck,
  DataAccuracyStatus,
} from './monthly-close-auto.types'

function checkStatus(diffCent: number, diffCount: number): DataAccuracyStatus {
  if (diffCent !== 0 || diffCount !== 0) return 'danger'
  return 'pass'
}

function pushCheck(
  checks: DataAccuracyCheck[],
  check: DataAccuracyCheck,
  blockers: string[],
  warnings: string[],
): void {
  checks.push(check)
  if (check.status === 'danger') blockers.push(`${check.title}：${check.note}`)
  else if (check.status === 'warning') warnings.push(`${check.title}：${check.note}`)
}

function duplicateSamples(views: AnalyzedOrderView[], limit = 5): string[] {
  const map = new Map<string, number>()
  for (const v of dedupeViewsByMetricOrderNo(views)) {
    const id = resolveMetricOrderNo(v)
    if (!id) continue
    map.set(id, (map.get(id) ?? 0) + 1)
  }
  return [...map.entries()]
    .filter(([, c]) => c > 1)
    .slice(0, limit)
    .map(([id]) => id)
}

export async function runDataAccuracyAudit(params: {
  startDate: string
  endDate: string
  scope?: 'daily' | 'weekly' | 'monthly' | 'custom'
  fullScan?: boolean
}): Promise<DataAccuracyAuditReport> {
  const { startDate, endDate } = params
  const checks: DataAccuracyCheck[] = []
  const blockers: string[] = []
  const warnings: string[] = []
  const suggestions: string[] = []

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate,
    endDate,
    role: LOCAL_VIEWER_USER.role,
    username: LOCAL_VIEWER_USER.username,
  })
  const coreViews = filterViewsForCoreMetrics(scoped.views)
  const performanceViews = filterViewsForAnchorPerformance(coreViews)
  const boardMetrics = aggregateViewsMetrics(coreViews)
  const validRevenue = sumValidRevenueFromViews(coreViews)
  const refundMetrics = computeOperationsRefundMetricsFromViews(coreViews)

  const monthKey = startDate.slice(0, 7)
  let dailySumCent = 0
  let dailySumOrders = 0
  try {
    const days = eachDayInShanghaiRange(startDate, endDate)
    const snapshots = []
    for (const dateKey of days) {
      snapshots.push(
        await buildDailyOperationsReport({
          preset: 'custom',
          startDate: dateKey,
          endDate: dateKey,
          role: LOCAL_VIEWER_USER.role,
          username: LOCAL_VIEWER_USER.username,
        }),
      )
    }
    const dailySum = aggregateWeeklySummaryForAcceptance(snapshots)
    dailySumCent = Math.round(dailySum.validAmountYuan * 100)
    dailySumOrders = dailySum.soldOrderCount
  } catch (err) {
    warnings.push(`运营日报逐日求和失败：${err instanceof Error ? err.message : String(err)}`)
  }

  let monthlyReportCent = 0
  let monthlyReportOrders = 0
  try {
    const monthly = await getMonthlyOperationsReport({
      month: monthKey,
      preset: 'custom',
      role: LOCAL_VIEWER_USER.role,
      username: LOCAL_VIEWER_USER.username,
    })
    monthlyReportCent = Math.round(monthly.summary.validAmountYuan * 100)
    monthlyReportOrders = monthly.summary.soldOrderCount
  } catch {
    /* optional for non-full-month ranges */
  }

  const boardValidCent = validRevenue.validAmountCent
  const boardValidOrders = validRevenue.soldOrderCount

  pushCheck(
    checks,
    {
      key: 'board_vs_daily_sum',
      title: '经营总览 vs 运营日报逐日求和',
      status: checkStatus(Math.abs(boardValidCent - dailySumCent), Math.abs(boardValidOrders - dailySumOrders)),
      expectedCent: boardValidCent,
      actualCent: dailySumCent,
      diffCent: boardValidCent - dailySumCent,
      expectedCount: boardValidOrders,
      actualCount: dailySumOrders,
      diffCount: boardValidOrders - dailySumOrders,
      note: '同周期有效成交金额（cent）与成交单数必须完全一致',
    },
    blockers,
    warnings,
  )

  if (monthlyReportCent > 0 || monthlyReportOrders > 0) {
    pushCheck(
      checks,
      {
        key: 'monthly_close_vs_daily_sum',
        title: '月度运营月报 vs 每日求和',
        status: checkStatus(
          Math.abs(monthlyReportCent - dailySumCent),
          Math.abs(monthlyReportOrders - dailySumOrders),
        ),
        expectedCent: monthlyReportCent,
        actualCent: dailySumCent,
        diffCent: monthlyReportCent - dailySumCent,
        expectedCount: monthlyReportOrders,
        actualCount: dailySumOrders,
        diffCount: monthlyReportOrders - dailySumOrders,
        note: '月度有效成交金额必须等于每日运营日报求和',
      },
      blockers,
      warnings,
    )
  }

  const anchorRows = aggregateAnchorLeaderboard(performanceViews)
  const anchorAssignedCent = anchorRows
    .filter((a) => a.anchorName !== '未归属')
    .reduce((s, a) => s + Math.round(a.validSalesAmount * 100), 0)
  const unassignedRow = anchorRows.find((a) => a.anchorName === '未归属')
  const unassignedCent = unassignedRow ? Math.round(unassignedRow.validSalesAmount * 100) : 0
  const unassignedOrders = unassignedRow?.orderCount ?? 0

  pushCheck(
    checks,
    {
      key: 'anchor_sum_vs_board',
      title: '主播业绩合计 vs 经营总览（已归属）',
      status: checkStatus(Math.abs(anchorAssignedCent - (boardValidCent - unassignedCent)), 0),
      expectedCent: boardValidCent - unassignedCent,
      actualCent: anchorAssignedCent,
      diffCent: anchorAssignedCent - (boardValidCent - unassignedCent),
      note:
        unassignedOrders > 0
          ? `另有 ${unassignedOrders} 单未归属主播，金额 ${centToYuan(unassignedCent)} 元单独列出`
          : '已归属主播有效成交金额应与经营总览一致',
      sampleOrderIds:
        unassignedOrders > 0
          ? duplicateSamples(performanceViews.filter((v) => !v.anchorName?.trim()), 5)
          : undefined,
    },
    blockers,
    warnings,
  )

  pushCheck(
    checks,
    {
      key: 'ranking_vs_standard_orders',
      title: '榜单中心（经营指标）vs 标准订单聚合',
      status: checkStatus(
        Math.abs(boardValidCent - Math.round(boardMetrics.validSalesAmount * 100)),
        Math.abs(boardValidOrders - boardMetrics.orderCount),
      ),
      expectedCent: boardValidCent,
      actualCent: Math.round(boardMetrics.validSalesAmount * 100),
      diffCent: boardValidCent - Math.round(boardMetrics.validSalesAmount * 100),
      expectedCount: boardValidOrders,
      actualCount: boardMetrics.orderCount,
      diffCount: boardValidOrders - boardMetrics.orderCount,
      note: '经营总览与标准订单视图聚合必须同口径',
    },
    blockers,
    warnings,
  )

  const dupSamples = duplicateSamples(coreViews)
  pushCheck(
    checks,
    {
      key: 'duplicate_orders',
      title: '重复订单检查',
      status: dupSamples.length > 0 ? 'danger' : 'pass',
      expectedCount: 0,
      actualCount: dupSamples.length,
      diffCount: dupSamples.length,
      note: dupSamples.length > 0 ? `发现 ${dupSamples.length} 组重复样本` : '未发现重复订单号',
      sampleOrderIds: dupSamples,
    },
    blockers,
    warnings,
  )

  const rawOrderCount = await prisma.xhsRawOrder.count()
  const rangeResolved = resolveDateRange('custom', startDate, endDate)
  const normalized = await loadNormalizedOrdersFromRaw({ range: rangeResolved })
  pushCheck(
    checks,
    {
      key: 'raw_vs_normalized',
      title: 'raw 订单 vs 标准订单',
      status: 'pass',
      expectedCount: rawOrderCount,
      actualCount: normalized.length,
      diffCount: rawOrderCount - normalized.length,
      note: `raw 全库 ${rawOrderCount} 条；本周期标准订单 ${normalized.length} 条`,
    },
    blockers,
    warnings,
  )

  try {
    const payTimeDiag = await runPayTimePrefilterDiagnostic({
      paymentRange: rangeResolved,
      scanAll: params.fullScan === true,
    })
    pushCheck(
      checks,
      {
        key: 'pay_time_gap',
        title: '支付时间漏单诊断',
        status: payTimeDiag.wouldMissWithCurrentPrefilterCount > 0 ? 'danger' : 'pass',
        expectedCount: 0,
        actualCount: payTimeDiag.wouldMissWithCurrentPrefilterCount,
        diffCount: payTimeDiag.wouldMissWithCurrentPrefilterCount,
        note: payTimeDiag.note,
        sampleOrderIds: payTimeDiag.rows.slice(0, 5).map((s) => s.orderId),
      },
      blockers,
      warnings,
    )
  } catch (err) {
    warnings.push(`支付时间漏单诊断失败：${err instanceof Error ? err.message : String(err)}`)
  }

  try {
    const rankingItems = await buildBuyerRankingAllItems({
      preset: 'custom',
      startDate,
      endDate,
      type: 'all',
    })
    let buyerDiff = 0
    for (const item of rankingItems.slice(0, 20)) {
      const summary = item.buyerSummary
      if (!summary) continue
      const listCent = summary.displayEarnedAmountCent ?? summary.realDealAmountCent ?? 0
      const earnedCent = Math.round((item.earnedAmount ?? 0) * 100)
      if (listCent > 0 && earnedCent > 0 && listCent !== earnedCent) buyerDiff += 1
    }
    pushCheck(
      checks,
      {
        key: 'buyer_ranking_vs_drawer',
        title: '买家榜金额 vs buyerSummary（抽样20）',
        status: buyerDiff === 0 ? 'pass' : 'danger',
        diffCount: buyerDiff,
        note:
          buyerDiff === 0
            ? '抽样买家 list 与 buyerSummary 成交金额一致'
            : `${buyerDiff} 个抽样买家 list 与 buyerSummary 不一致`,
      },
      blockers,
      warnings,
    )

    const badItems = rankingItems.filter(isBadBuyerCandidate).slice(0, 10)
    let badDiff = 0
    for (const item of badItems) {
      const profile = buildBadBuyerProfile(item)
      if (profile.qualityRefundOrderCount !== qualityRefundOrderCount(item)) badDiff += 1
      if (profile.returnRefundOrderCount !== returnRefundOrderCount(item)) badDiff += 1
      if (profile.afterSaleOrderCount !== afterSaleOrderCount(item)) badDiff += 1
    }
    pushCheck(
      checks,
      {
        key: 'bad_buyer_vs_drawer',
        title: '垃圾客户榜 vs 同口径 buyerSummary',
        status: badDiff === 0 ? 'pass' : 'danger',
        diffCount: badDiff,
        note:
          badDiff === 0
            ? '垃圾客户榜品退/退货/售后与 buyerSummary 一致'
            : `${badDiff} 项指标与 buyerSummary 不一致`,
      },
      blockers,
      warnings,
    )
  } catch (err) {
    warnings.push(`买家/垃圾客户榜核对跳过：${err instanceof Error ? err.message : String(err)}`)
  }

  pushCheck(
    checks,
    {
      key: 'refund_metrics_consistency',
      title: '售后/退款/品退口径',
      status: checkStatus(0, Math.abs(refundMetrics.refundOrderCount - boardMetrics.refundOrderCount)),
      expectedCount: refundMetrics.refundOrderCount,
      actualCount: boardMetrics.refundOrderCount,
      diffCount: refundMetrics.refundOrderCount - boardMetrics.refundOrderCount,
      note: '退款单数与经营总览退款指标交叉核对',
    },
    blockers,
    warnings,
  )

  const moneyDiffCentTotal = checks.reduce((s, c) => s + Math.abs(c.diffCent ?? 0), 0)
  const orderDiffTotal = checks.reduce((s, c) => s + Math.abs(c.diffCount ?? 0), 0)
  const dangerCount = checks.filter((c) => c.status === 'danger').length
  const score = Math.max(0, 100 - dangerCount * 15 - checks.filter((c) => c.status === 'warning').length * 5)
  let status: DataAccuracyStatus = 'pass'
  if (dangerCount > 0 || moneyDiffCentTotal > 0 || orderDiffTotal > 0) status = 'danger'
  else if (warnings.length > 0) status = 'warning'

  if (status === 'danger') {
    suggestions.push('请先处理 blockers 中的差异项，再用于结账或复盘')
  }

  return {
    range: { startDate, endDate },
    generatedAt: new Date().toISOString(),
    score,
    status,
    checks,
    moneyDiffCentTotal,
    orderDiffTotal,
    blockers,
    warnings,
    suggestions,
  }
}
