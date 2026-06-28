import type { UserRole } from '../types/roles'
import {
  endOfMonthKeyShanghai,
  formatDateKeyShanghai,
  startOfMonthKeyShanghai,
} from '../utils/business-timezone'
import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'
import {
  buildDailyOperationsReport,
  type DailyOperationsReportPayload,
} from './daily-operations-report.service'
import {
  getBusinessInsightActionStats,
} from './operations-business-insight-action.service'
import {
  buildBusinessInsightsFromSource,
  buildBusinessInsightsSourceFromComponents,
} from './operations-business-insights.service'
import { attachBusinessInsightActions } from './operations-business-insight-action.service'
import { getOperationsRankings } from './operations-rankings.service'
import {
  computeReturnOrderRateRatio,
  isReturnOrderRateAbnormal,
} from './operations-after-sale-order.util'
import { buildOperationsDailyTrendFromSnapshots } from './operations-daily-trend.service'
import { mergeAnchorRowsForRange } from './operations-anchor-ranking.service'
import { getOpsReviewNote } from './ops-review-note.service'
import { prisma } from '../lib/prisma'
import type {
  MonthlyCompareWithPreviousMonth,
  MonthlyDailyTrendRow,
  MonthlyNextMonthAction,
  MonthlyOperationsReportPayload,
  MonthlyOperationsReportSummary,
  MonthlyPlainLanguageItem,
  MonthlyRiskReminder,
} from './monthly-operations-report.types'
import {
  aggregateAfterSalesFromSnapshots,
  aggregatePriceBandsFromSnapshots,
  aggregateProductsFromSnapshots,
  aggregateWeeklySummaryForAcceptance,
  changePercent,
} from './weekly-operations-report.service'

const MONTH_KEY_RE = /^\d{4}-\d{2}$/
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 31

export class MonthlyOperationsReportValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MonthlyOperationsReportValidationError'
  }
}

function assertDateKey(value: string, label: string): void {
  if (!DATE_KEY_RE.test(value)) {
    throw new MonthlyOperationsReportValidationError(`${label} 格式应为 YYYY-MM-DD`)
  }
}

function parseMonthKey(month: string): { year: number; month: number } {
  if (!MONTH_KEY_RE.test(month)) {
    throw new MonthlyOperationsReportValidationError('month 格式应为 YYYY-MM')
  }
  const [y, m] = month.split('-').map(Number)
  if (m! < 1 || m! > 12) {
    throw new MonthlyOperationsReportValidationError('month 月份无效')
  }
  return { year: y!, month: m! }
}

function previousMonthKey(month: string): { year: number; month: number } {
  const { year, month: m } = parseMonthKey(month)
  return m === 1 ? { year: year - 1, month: 12 } : { year, month: m - 1 }
}

export function resolveMonthlyReportRange(params: {
  month?: string
  startDate?: string
  endDate?: string
}): { month: string; startDate: string; endDate: string } {
  if (params.month?.trim()) {
    const { year, month } = parseMonthKey(params.month.trim())
    const startDate = startOfMonthKeyShanghai(year, month)
    const endDate = endOfMonthKeyShanghai(year, month)
    return { month: params.month.trim(), startDate, endDate }
  }
  if (params.startDate?.trim() && params.endDate?.trim()) {
    assertDateKey(params.startDate.trim(), 'startDate')
    assertDateKey(params.endDate.trim(), 'endDate')
    const startDate = params.startDate.trim()
    const endDate = params.endDate.trim()
    if (startDate > endDate) {
      throw new MonthlyOperationsReportValidationError('startDate 不能晚于 endDate')
    }
    const days = eachDayInShanghaiRange(startDate, endDate)
    if (days.length === 0) {
      throw new MonthlyOperationsReportValidationError('日期范围无效')
    }
    if (days.length > MAX_RANGE_DAYS) {
      throw new MonthlyOperationsReportValidationError(`月报范围不能超过 ${MAX_RANGE_DAYS} 天`)
    }
    return { month: startDate.slice(0, 7), startDate, endDate }
  }
  throw new MonthlyOperationsReportValidationError('请提供 month 或 startDate 与 endDate')
}

async function loadDailySnapshots(params: {
  startDate: string
  endDate: string
  preset?: string
  role?: UserRole
  username?: string
}): Promise<DailyOperationsReportPayload[]> {
  const days = eachDayInShanghaiRange(params.startDate, params.endDate)
  const snapshots: DailyOperationsReportPayload[] = []
  for (const dateKey of days) {
    snapshots.push(
      await buildDailyOperationsReport({
        preset: 'custom',
        startDate: dateKey,
        endDate: dateKey,
        role: params.role,
        username: params.username,
      }),
    )
  }
  return snapshots
}

function buildMonthlySummary(
  snapshots: DailyOperationsReportPayload[],
  products: ReturnType<typeof aggregateProductsFromSnapshots>,
): MonthlyOperationsReportSummary {
  const base = aggregateWeeklySummaryForAcceptance(snapshots)
  const soldCount = products.reduce((sum, p) => sum + p.soldCount, 0)
  const buyerCount = products.reduce((sum, p) => sum + p.buyerCount, 0)
  const liveDurationHours =
    base.totalLiveDurationMinutes > 0 ? base.totalLiveDurationMinutes / 60 : null
  const productReturnRate = computeReturnOrderRateRatio(
    base.paidOrderCount,
    base.returnOrderCount,
  )

  return {
    validAmountYuan: base.validAmountYuan,
    soldOrderCount: base.soldOrderCount,
    soldCount,
    buyerCount,
    averageOrderValue: base.avgOrderAmountYuan,
    productReturnOrderCount: base.returnOrderCount,
    productReturnRate,
    productReturnRateAbnormal: isReturnOrderRateAbnormal(productReturnRate),
    liveDurationHours,
    hourlyAmountYuan: base.hourlyAmountYuan,
    viewSessionCount: base.viewSessionCount,
    joinUserCount: base.joinUserCount,
    dealUserCount: base.dealUserCount,
    dealConversionRate: base.dealConversionRate,
    dealConversionNumerator: base.dealUserCount,
    dealConversionDenominator: base.joinUserCount,
    dealConversionDenominatorLabel: '进房人数',
    newFollowerCount: base.totalNewFollowerCount,
    followerConversionRate: base.newFollowerRate,
  }
}

async function buildPreviousMonthSummary(params: {
  month: string
  preset?: string
  role?: UserRole
  username?: string
}): Promise<MonthlyOperationsReportSummary | null> {
  const prev = previousMonthKey(params.month)
  const prevStart = startOfMonthKeyShanghai(prev.year, prev.month)
  const prevEnd = endOfMonthKeyShanghai(prev.year, prev.month)
  const prevSnapshots = await loadDailySnapshots({
    startDate: prevStart,
    endDate: prevEnd,
    preset: params.preset,
    role: params.role,
    username: params.username,
  })
  if (prevSnapshots.every((s) => s.summary.soldOrderCount === 0 && s.summary.validAmountYuan === 0)) {
    return null
  }
  const prevProducts = aggregateProductsFromSnapshots(prevSnapshots)
  return buildMonthlySummary(prevSnapshots, prevProducts)
}

function buildCompareWithPreviousMonth(
  current: MonthlyOperationsReportSummary,
  previous: MonthlyOperationsReportSummary | null,
): MonthlyCompareWithPreviousMonth {
  const warnings: string[] = []
  if (!previous) {
    warnings.push('上月数据不足，暂时不能对比')
    return {
      validAmountYuanChangePercent: null,
      soldOrderCountChangePercent: null,
      productReturnRateChangePercent: null,
      dealConversionRateChangePercent: null,
      newFollowerCountChangePercent: null,
      warnings,
    }
  }
  return {
    validAmountYuanChangePercent: changePercent(
      current.validAmountYuan,
      previous.validAmountYuan,
    ),
    soldOrderCountChangePercent: changePercent(
      current.soldOrderCount,
      previous.soldOrderCount,
    ),
    productReturnRateChangePercent:
      previous.productReturnRate != null &&
      previous.productReturnRate > 0 &&
      current.productReturnRate != null
        ? changePercent(current.productReturnRate * 100, previous.productReturnRate * 100)
        : null,
    dealConversionRateChangePercent:
      previous.dealConversionRate != null &&
      previous.dealConversionRate > 0 &&
      current.dealConversionRate != null
        ? changePercent(current.dealConversionRate * 100, previous.dealConversionRate * 100)
        : null,
    newFollowerCountChangePercent: changePercent(
      current.newFollowerCount ?? 0,
      previous.newFollowerCount ?? 0,
    ),
    warnings,
  }
}

function buildPlainLanguageSummary(params: {
  month: string
  summary: MonthlyOperationsReportSummary
  compare: MonthlyCompareWithPreviousMonth
}): MonthlyOperationsReportPayload['plainLanguageSummary'] {
  const items: MonthlyPlainLanguageItem[] = [
    {
      label: '本月卖得怎么样',
      text: `本月有效成交金额 ${Math.round(params.summary.validAmountYuan).toLocaleString('zh-CN')} 元，成交 ${params.summary.soldOrderCount} 单，成交件数 ${params.summary.soldCount} 件。`,
      level: 'info',
    },
    {
      label: '退货压力大不大',
      text:
        params.summary.productReturnRate != null
          ? `商品退货率 ${(params.summary.productReturnRate * 100).toFixed(1)}%，共 ${params.summary.productReturnOrderCount} 单商品退货。`
          : '本月暂无足够商品成交数据，暂时算不出商品退货率。',
      level:
        params.summary.productReturnRate != null && params.summary.productReturnRate >= 0.3
          ? 'warning'
          : 'info',
    },
    {
      label: '流量和成交有没有跟上',
      text:
        params.summary.dealConversionRate != null
          ? `进房 ${params.summary.joinUserCount ?? '--'} 人，成交 ${params.summary.dealUserCount ?? '--'} 人，成交率 ${(params.summary.dealConversionRate * 100).toFixed(1)}%。`
          : '缺少官方成交人数，暂时算不出成交率。',
      level: params.summary.dealConversionRate == null ? 'warning' : 'info',
    },
  ]

  if (params.compare.warnings.length > 0) {
    items.push({
      label: '比上个月',
      text: params.compare.warnings[0]!,
      level: 'warning',
    })
  } else if (params.compare.validAmountYuanChangePercent != null) {
    const dir = params.compare.validAmountYuanChangePercent >= 0 ? '多卖' : '少卖'
    items.push({
      label: '比上个月',
      text: `成交金额比上期${dir} ${Math.abs(params.compare.validAmountYuanChangePercent)}%，订单数变化 ${params.compare.soldOrderCountChangePercent ?? '--'}%。`,
      level: params.compare.validAmountYuanChangePercent >= 0 ? 'good' : 'warning',
    })
  }

  return {
    title: `${params.month} 月度经营复盘`,
    items,
  }
}

function buildRiskReminders(params: {
  rankings: MonthlyOperationsReportPayload['rankings']
  businessInsights: MonthlyOperationsReportPayload['businessInsights']
  insightActionStats: MonthlyOperationsReportPayload['insightActionStats']
  dataQualityWarnings: string[]
}): MonthlyRiskReminder[] {
  const risks: MonthlyRiskReminder[] = []
  for (const item of params.rankings.products.highReturn.items.slice(0, 3)) {
    risks.push({
      text: `高退货商品「${item.productName}」：建议先看描述、圈口说明和质检。`,
      level: 'warning',
    })
  }
  for (const item of params.rankings.afterSales.byReason.items.slice(0, 2)) {
    risks.push({
      text: `售后原因「${item.categoryLabel}」本月出现 ${item.orderCount} 单，值得提前看一眼。`,
      level: 'warning',
    })
  }
  for (const w of params.dataQualityWarnings.slice(0, 3)) {
    risks.push({ text: w, level: 'info' })
  }
  const pendingInsights = params.businessInsights.items.filter(
    (i) => (i.actionState?.status ?? 'pending') === 'pending',
  ).length
  if (pendingInsights >= 3) {
    risks.push({
      text: `本月还有 ${pendingInsights} 条经营建议未处理，建议抽空点一下处理状态。`,
      level: 'info',
    })
  }
  if (risks.length === 0) {
    risks.push({
      text: '这些不是一定有问题，但值得优先看一眼；本月暂未检出明显风险项。',
      level: 'info',
    })
  }
  return risks
}

function buildNextMonthActions(
  businessInsights: MonthlyOperationsReportPayload['businessInsights'],
): MonthlyNextMonthAction[] {
  const actions: MonthlyNextMonthAction[] = []
  for (const item of businessInsights.items.slice(0, 5)) {
    if (item.evidence.length === 0) continue
    const prefix = '下月'
    const text = item.suggestedAction.startsWith('下月')
      ? item.suggestedAction
      : `${prefix}${item.suggestedAction.replace(/^[请建议]/, '')}`
    actions.push({ text, evidence: item.evidence })
  }
  return actions
}

export async function getMonthlyOperationsReport(params: {
  month?: string
  startDate?: string
  endDate?: string
  preset?: string
  role?: UserRole
  username?: string
}): Promise<MonthlyOperationsReportPayload> {
  const resolved = resolveMonthlyReportRange(params)
  const todayKey = formatDateKeyShanghai(new Date())
  const endDate = resolved.endDate > todayKey ? todayKey : resolved.endDate
  if (resolved.startDate > endDate) {
    throw new MonthlyOperationsReportValidationError('所选月份尚无经营数据')
  }
  const range = { ...resolved, endDate }
  const prev = previousMonthKey(range.month)
  const prevStartDate = startOfMonthKeyShanghai(prev.year, prev.month)
  const prevEndDate = endOfMonthKeyShanghai(prev.year, prev.month)

  const snapshots = await loadDailySnapshots({
    startDate: range.startDate,
    endDate: range.endDate,
    preset: params.preset,
    role: params.role,
    username: params.username,
  })

  const products = aggregateProductsFromSnapshots(snapshots)
  const summary = buildMonthlySummary(snapshots, products)
  const previousSummary = await buildPreviousMonthSummary({
    month: range.month,
    preset: params.preset,
    role: params.role,
    username: params.username,
  })
  const compareWithPreviousMonth = buildCompareWithPreviousMonth(summary, previousSummary)
  const dailyTrend = buildOperationsDailyTrendFromSnapshots(snapshots, {
    startDate: range.startDate,
    endDate: range.endDate,
  })

  const rankingsPayload = await getOperationsRankings({
    startDate: range.startDate,
    endDate: range.endDate,
    preset: 'custom',
    scope: 'custom',
    role: params.role,
    username: params.username,
  })

  const aggregatedPriceBands = aggregatePriceBandsFromSnapshots(snapshots)
  const aggregatedAfterSales = aggregateAfterSalesFromSnapshots(snapshots)
  const mergedAnchorRows = mergeAnchorRowsForRange(snapshots.map((s) => s.anchors))
  const dimensions = await prisma.productDimension.findMany()
  const reviewNote = await getOpsReviewNote({
    reportDate: range.startDate,
    reportType: 'weekly',
  })

  const dataQualityWarnings: string[] = [...(rankingsPayload.dataQuality?.warnings ?? [])]
  if (summary.dealConversionRate == null) {
    dataQualityWarnings.push('缺少官方成交人数，暂时算不出成交率')
  }
  if (summary.buyerCount > 0) {
    dataQualityWarnings.push('成交买家数为商品维度汇总，同一买家购买多件商品可能重复计数')
  }

  let businessInsights = rankingsPayload.businessInsights
  try {
    businessInsights = await attachBusinessInsightActions(
      buildBusinessInsightsFromSource(
        buildBusinessInsightsSourceFromComponents({
          startDate: range.startDate,
          endDate: range.endDate,
          scope: 'custom',
          anchors: mergedAnchorRows,
          products,
          priceBands: aggregatedPriceBands,
          afterSalesReasons: aggregatedAfterSales,
          dimensions,
          reviewNote,
          summaryTraffic: {
            dealUserCount: summary.dealUserCount,
            joinUserCount: summary.joinUserCount,
            viewSessionCount: summary.viewSessionCount,
          },
          extraWarnings: rankingsPayload.products.highReturn.dataQuality.warnings,
        }),
      ),
      {
        startDate: range.startDate,
        endDate: range.endDate,
        scope: 'custom',
      },
    )
  } catch (err) {
    businessInsights = {
      items: [],
      dataQuality: {
        reliable: false,
        warnings: [
          `经营建议生成失败：${err instanceof Error ? err.message : '未知错误'}`,
        ],
      },
    }
  }

  const insightActionStats = await getBusinessInsightActionStats({
    startDate: range.startDate,
    endDate: range.endDate,
    scope: 'custom',
  })

  const rankings = {
    anchors: {
      byAmount: rankingsPayload.anchors.byAmount,
      byOrders: rankingsPayload.anchors.byOrders,
      byHourlyAmount: rankingsPayload.anchors.byHourlyAmount,
      byDealConversion: rankingsPayload.anchors.byDealConversion,
      byReturnRate: rankingsPayload.anchors.byReturnRate,
    },
    products: {
      hot: rankingsPayload.products.hot,
      highReturn: rankingsPayload.products.highReturn,
      slow: rankingsPayload.products.slow,
      highAverageOrderValue: rankingsPayload.products.highAverageOrderValue,
    },
    priceBands: {
      byAmount: rankingsPayload.priceBands.byAmount,
      byShare: rankingsPayload.priceBands.byShare,
      byReturnRate: rankingsPayload.priceBands.byReturnRate,
    },
    afterSales: {
      byReason: rankingsPayload.afterSales.byReason,
      byRefundAmount: rankingsPayload.afterSales.byRefundAmount,
    },
  }

  const plainLanguageSummary = buildPlainLanguageSummary({
    month: range.month,
    summary,
    compare: compareWithPreviousMonth,
  })

  const riskReminders = buildRiskReminders({
    rankings,
    businessInsights,
    insightActionStats,
    dataQualityWarnings,
  })

  const nextMonthActions = buildNextMonthActions(businessInsights)

  const allWarnings = [
    ...dataQualityWarnings,
    ...compareWithPreviousMonth.warnings,
    ...(businessInsights.dataQuality.warnings ?? []),
  ]
  if (resolved.endDate > todayKey) {
    allWarnings.push(`本月尚未结束，月报统计截至 ${endDate}`)
  }

  return {
    range: {
      month: range.month,
      startDate: range.startDate,
      endDate: range.endDate,
      prevStartDate,
      prevEndDate,
    },
    title: `${range.month} 运营月报`,
    summary,
    compareWithPreviousMonth,
    dailyTrend,
    rankings,
    businessInsights,
    insightActionStats,
    plainLanguageSummary,
    riskReminders,
    nextMonthActions,
    dataQuality: {
      reliable: allWarnings.length === 0 && businessInsights.dataQuality.reliable,
      warnings: [...new Set(allWarnings)],
    },
  }
}
