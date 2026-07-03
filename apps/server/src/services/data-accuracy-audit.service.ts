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
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import type { AnalyzedOrderView } from '../types/analysis'
import { resolveDateRange } from '../utils/date-range'
import { buildBuyerRankingAllItems } from './buyer-ranking.service'
import {
  buildBadBuyerProfile,
  capBadBuyerRate,
  isBadBuyerCandidate,
} from './bad-buyer-ranking.service'
import { centToYuan } from '../utils/money'
import { runPayTimePrefilterDiagnostic } from './order-pay-time-prefilter-diagnostic.service'
import { loadNormalizedOrdersFromRaw, buildOrderTimeDbWhere } from './xhs-api-sync/xhs-json-normalizer.service'
import { prisma } from '../lib/prisma'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import {
  attachRawByMatchToViews,
  filterViewsForBuyerRanking,
} from './low-price-brush-order.service'
import {
  buyerRankingRangeToAnalysisRange,
  resolveBuyerRankingDateRange,
} from '../utils/buyer-ranking-date-range'
import {
  buildBadBuyerDrawerAuditMetrics,
  buildBuyerDrawerAuditMetrics,
} from './buyer-profile-orders.service'
import type {
  DataAccuracyAuditReport,
  DataAccuracyCheck,
  DataAccuracyStatus,
  DuplicateOrderSample,
} from './monthly-close-auto.types'

function checkStatus(diffCent: number, diffCount: number): DataAccuracyStatus {
  if (diffCent !== 0 || diffCount !== 0) return 'danger'
  return 'pass'
}

export function dataAccuracyCheckStatus(diffCent: number, diffCount: number): DataAccuracyStatus {
  return checkStatus(diffCent, diffCount)
}

/** raw 与 normalized 数量核对：仅作数据链路提示，不轻易 danger */
export function resolveRawVsNormalizedCheck(rawInRange: number, normalized: number): {
  status: DataAccuracyStatus
  excludeFromTotals: boolean
  note: string
} {
  const diff = rawInRange - normalized
  const baseNote =
    'raw 表可能含重复/异常/无效/历史残留记录，与标准订单不一定一比一；差异需排查但不一定代表金额错。'

  if (rawInRange === 0 && normalized === 0) {
    return {
      status: 'pass',
      excludeFromTotals: true,
      note: `周期内无 raw 也无标准订单。${baseNote}`,
    }
  }
  if (rawInRange > 0 && normalized === 0) {
    return {
      status: 'danger',
      excludeFromTotals: true,
      note: `周期内 raw ${rawInRange} 条但标准订单 0 条，归一化或支付时间过滤可能全漏。${baseNote}`,
    }
  }
  if (normalized > rawInRange) {
    return {
      status: 'danger',
      excludeFromTotals: true,
      note: `标准订单 ${normalized} 条多于 raw ${rawInRange} 条，存在异常膨胀。${baseNote}`,
    }
  }
  if (diff === 0) {
    return {
      status: 'pass',
      excludeFromTotals: true,
      note: `周期内 raw ${rawInRange} 条 = 标准订单 ${normalized} 条。${baseNote}`,
    }
  }

  const largeDiff = diff > Math.max(10, Math.round(rawInRange * 0.1))
  return {
    status: 'warning',
    excludeFromTotals: true,
    note: largeDiff
      ? `周期内 raw ${rawInRange} 条，标准订单 ${normalized} 条，多 ${diff} 条（差异较大，建议排查归一化/去重/无效 raw，但不直接判定金额错）。${baseNote}`
      : `周期内 raw ${rawInRange} 条，标准订单 ${normalized} 条，多 ${diff} 条（差异不大，作数据链路提示）。${baseNote}`,
  }
}

export function resolveBuyerAuditSampleLimit(fullScan: boolean, total: number): number {
  if (fullScan) return total
  return Math.min(20, total)
}

export function resolveBadBuyerAuditSampleLimit(fullScan: boolean, total: number): number {
  if (fullScan) return total
  return Math.min(10, total)
}

export function duplicateSamplesFromRawViewsForTest(
  views: AnalyzedOrderView[],
  limit = 10,
): { samples: DuplicateOrderSample[]; duplicateGroupCount: number } {
  return duplicateSamplesFromRawViews(views, limit)
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

function viewOrderId(v: AnalyzedOrderView): string {
  return resolveMetricOrderNo(v) || v.displayOrderNo || v.matchOrderId || v.orderId
}

function duplicateSamplesFromRawViews(
  views: AnalyzedOrderView[],
  limit = 10,
): { samples: DuplicateOrderSample[]; duplicateGroupCount: number } {
  const keyTypes: Array<DuplicateOrderSample['keyType']> = [
    'orderNo',
    'packageId',
    'dedupeKey',
    'matchOrderId',
  ]
  const samples: DuplicateOrderSample[] = []

  for (const keyType of keyTypes) {
    const map = new Map<string, { count: number; orderIds: string[] }>()
    for (const v of views) {
      let key = ''
      if (keyType === 'orderNo') key = resolveMetricOrderNo(v)
      else if (keyType === 'packageId') key = (v.packageId ?? '').trim()
      else if (keyType === 'matchOrderId') key = (v.matchOrderId ?? '').trim()
      else {
        const orderNo = resolveMetricOrderNo(v)
        const pkg = (v.packageId ?? '').trim()
        key = orderNo && pkg ? `${orderNo}::${pkg}` : orderNo || pkg || (v.matchOrderId ?? '').trim()
      }
      if (!key) continue
      const oid = viewOrderId(v)
      const prev = map.get(key) ?? { count: 0, orderIds: [] }
      prev.count += 1
      if (oid && prev.orderIds.length < 5) prev.orderIds.push(oid)
      map.set(key, prev)
    }
    for (const [key, { count, orderIds }] of map.entries()) {
      if (count <= 1) continue
      samples.push({ keyType, key, count, sampleOrderIds: orderIds })
    }
  }

  samples.sort((a, b) => b.count - a.count)
  return { samples: samples.slice(0, limit), duplicateGroupCount: samples.length }
}

async function loadBuyerRankingPeriodContext(startDate: string, endDate: string): Promise<{
  views: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
}> {
  const range = resolveBuyerRankingDateRange('custom', startDate, endDate)
  const bundle = await buildRawAnalyzeBundle(buyerRankingRangeToAnalysisRange(range))
  if (!bundle) return { views: [], rawByMatch: new Map() }
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  const views = filterViewsForBuyerRanking(
    attachRawByMatchToViews(artifacts?.views ?? [], rawByMatch),
  )
  return { views, rawByMatch }
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
          ? performanceViews
              .filter((v) => !v.anchorName?.trim())
              .slice(0, 5)
              .map(viewOrderId)
              .filter(Boolean)
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

  const dupResult = duplicateSamplesFromRawViews(coreViews)
  pushCheck(
    checks,
    {
      key: 'duplicate_orders',
      title: '重复订单检查',
      status: dupResult.duplicateGroupCount > 0 ? 'danger' : 'pass',
      expectedCount: 0,
      actualCount: dupResult.duplicateGroupCount,
      diffCount: dupResult.duplicateGroupCount,
      note:
        dupResult.duplicateGroupCount > 0
          ? `原始视图发现 ${dupResult.duplicateGroupCount} 组重复键（未先去重）`
          : '原始视图未发现重复 orderNo/packageId/dedupeKey/matchOrderId',
      duplicateSamples: dupResult.samples,
      sampleOrderIds: dupResult.samples.flatMap((s) => s.sampleOrderIds).slice(0, 5),
    },
    blockers,
    warnings,
  )

  const rangeResolved = resolveDateRange('custom', startDate, endDate)
  const rawOrderCountAll = await prisma.xhsRawOrder.count()
  const rawOrderCountInRange = await prisma.xhsRawOrder.count({
    where: buildOrderTimeDbWhere(rangeResolved),
  })
  const normalizedInRange = await loadNormalizedOrdersFromRaw({ range: rangeResolved })
  const rawNorm = resolveRawVsNormalizedCheck(rawOrderCountInRange, normalizedInRange.length)

  pushCheck(
    checks,
    {
      key: 'raw_full_db_info',
      title: 'raw 全库数量说明',
      status: 'warning',
      expectedCount: rawOrderCountAll,
      actualCount: normalizedInRange.length,
      diffCount: rawOrderCountAll - normalizedInRange.length,
      excludeFromTotals: true,
      note: `raw 全库共 ${rawOrderCountAll} 条；当前核对周期（${startDate}~${endDate}）标准订单 ${normalizedInRange.length} 条。全库数量包含历史各月订单，不能与单周期标准订单直接相等，此处仅作参考。`,
    },
    blockers,
    warnings,
  )

  pushCheck(
    checks,
    {
      key: 'raw_vs_normalized',
      title: '同周期 raw vs 标准订单（数据链路提示）',
      status: rawNorm.status,
      expectedCount: rawOrderCountInRange,
      actualCount: normalizedInRange.length,
      diffCount: rawOrderCountInRange - normalizedInRange.length,
      excludeFromTotals: rawNorm.excludeFromTotals,
      note: rawNorm.note,
    },
    blockers,
    warnings,
  )

  const fullScan = params.fullScan === true
  const auditScopeNote = fullScan
    ? 'fullScan=true：买家榜与高风险售后客户榜为全量核对'
    : 'fullScan=false：买家榜抽样前20、高风险售后客户榜抽样前10'

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
    const periodCtx = await loadBuyerRankingPeriodContext(startDate, endDate)

    const badCandidates = rankingItems.filter(isBadBuyerCandidate)
    const buyerLimit = resolveBuyerAuditSampleLimit(fullScan, rankingItems.length)
    const badLimit = resolveBadBuyerAuditSampleLimit(fullScan, badCandidates.length)

    let buyerDiff = 0
    const buyerSampleKeys: string[] = []
    const buyerSampleOrderIds: string[] = []

    for (const item of rankingItems.slice(0, buyerLimit)) {
      const drawer = buildBuyerDrawerAuditMetrics({
        buyerKey: item.buyerKey,
        allViews: periodCtx.views,
        rawByMatch: periodCtx.rawByMatch,
      })
      const summary = item.buyerSummary
      const listEarnedCent =
        summary?.displayEarnedAmountCent ??
        summary?.realDealAmountCent ??
        Math.round((item.earnedAmount ?? 0) * 100)
      const drawerEarnedCent = drawer.summary.displayEarnedAmountCent

      const diffs: string[] = []
      if (listEarnedCent !== drawerEarnedCent) diffs.push(`成交金额差 ${listEarnedCent - drawerEarnedCent} 分`)
      if ((item.signedOrderCount ?? 0) !== drawer.signedOrderCount) {
        diffs.push(`签收单差 ${(item.signedOrderCount ?? 0) - drawer.signedOrderCount}`)
      }
      if ((item.completedOrderCount ?? 0) !== drawer.completedOrderCount) {
        diffs.push(`完成单差 ${(item.completedOrderCount ?? 0) - drawer.completedOrderCount}`)
      }
      if ((item.afterSaleCount ?? 0) !== drawer.afterSaleCount) {
        diffs.push(`售后单差 ${(item.afterSaleCount ?? 0) - drawer.afterSaleCount}`)
      }
      const listRefund = summary?.refundOrderCount ?? item.refundCount ?? 0
      if (listRefund !== drawer.summary.refundOrderCount) {
        diffs.push(`退款单差 ${listRefund - drawer.summary.refundOrderCount}`)
      }
      const listQuality = summary?.qualityRefundOrderCount ?? item.qualityReturnCount ?? 0
      if (listQuality !== drawer.summary.qualityRefundOrderCount) {
        diffs.push(`品退单差 ${listQuality - drawer.summary.qualityRefundOrderCount}`)
      }

      if (diffs.length > 0) {
        buyerDiff += 1
        buyerSampleKeys.push(item.buyerKey)
        buyerSampleOrderIds.push(...drawer.sampleOrderIds)
      }
    }

    pushCheck(
      checks,
      {
        key: 'buyer_ranking_vs_drawer',
        title: fullScan
          ? `买家榜 vs 订单明细 Drawer（全量 ${buyerLimit}）`
          : '买家榜 vs 订单明细 Drawer（抽样20）',
        status: buyerDiff === 0 ? 'pass' : 'danger',
        diffCount: buyerDiff,
        note:
          buyerDiff === 0
            ? `${auditScopeNote}；榜单与订单明细逐单汇总一致（成交金额/签收/完成/售后/退款/品退）`
            : `${auditScopeNote}；${buyerDiff} 个买家榜单与订单明细不一致，差 1 分或 1 单即记为 danger`,
        sampleBuyerKeys: buyerSampleKeys.slice(0, 5),
        sampleOrderIds: buyerSampleOrderIds.slice(0, 5),
      },
      blockers,
      warnings,
    )

    let badDiff = 0
    const badSampleKeys: string[] = []
    const badSampleOrderIds: string[] = []

    for (const item of badCandidates.slice(0, badLimit)) {
      const drawer = buildBadBuyerDrawerAuditMetrics({
        buyerKey: item.buyerKey,
        allViews: periodCtx.views,
        rawByMatch: periodCtx.rawByMatch,
      })
      const profile = buildBadBuyerProfile(item)
      const listRefundRate = capBadBuyerRate(profile.refundOrderCount, profile.paidCount)

      const diffs: string[] = []
      if (profile.qualityRefundOrderCount !== drawer.qualityRefundOrderCount) {
        diffs.push(`品退单差 ${profile.qualityRefundOrderCount - drawer.qualityRefundOrderCount}`)
      }
      if (profile.returnRefundOrderCount !== drawer.returnRefundOrderCount) {
        diffs.push(`退货退款单差 ${profile.returnRefundOrderCount - drawer.returnRefundOrderCount}`)
      }
      if (profile.aftersaleCount !== drawer.aftersaleCount) {
        diffs.push(`售后单差 ${profile.aftersaleCount - drawer.aftersaleCount}`)
      }
      if (Math.round(profile.refundAmountYuan * 100) !== drawer.refundAmountCent) {
        diffs.push(
          `退款金额差 ${Math.round(profile.refundAmountYuan * 100) - drawer.refundAmountCent} 分`,
        )
      }
      if (profile.refundOrderCount !== drawer.refundOrderCount) {
        diffs.push(`退款单差 ${profile.refundOrderCount - drawer.refundOrderCount}`)
      }
      if (Math.abs(listRefundRate - drawer.refundRate) > 0.0001) {
        diffs.push(`退款率差 ${listRefundRate - drawer.refundRate}`)
      }

      if (diffs.length > 0) {
        badDiff += 1
        badSampleKeys.push(item.buyerKey)
        badSampleOrderIds.push(...drawer.sampleOrderIds)
      }
    }

    pushCheck(
      checks,
      {
        key: 'bad_buyer_vs_drawer',
        title: fullScan
          ? `高风险售后客户 vs 订单明细 Drawer（全量 ${badLimit}）`
          : '高风险售后客户 vs 订单明细 Drawer（抽样10）',
        status: badDiff === 0 ? 'pass' : 'danger',
        diffCount: badDiff,
        note:
          badDiff === 0
            ? `${auditScopeNote}；与订单明细逐单汇总一致（纯运费补偿不计入退货退款）`
            : `${auditScopeNote}；${badDiff} 项与订单明细不一致，差 1 单或 1 分即记为 danger`,
        sampleBuyerKeys: badSampleKeys.slice(0, 5),
        sampleOrderIds: badSampleOrderIds.slice(0, 5),
      },
      blockers,
      warnings,
    )
  } catch (err) {
    warnings.push(`买家/高风险售后客户核对跳过：${err instanceof Error ? err.message : String(err)}`)
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

  const moneyDiffCentTotal = checks
    .filter((c) => !c.excludeFromTotals)
    .reduce((s, c) => s + Math.abs(c.diffCent ?? 0), 0)
  const orderDiffTotal = checks
    .filter((c) => !c.excludeFromTotals)
    .reduce((s, c) => s + Math.abs(c.diffCount ?? 0), 0)
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
