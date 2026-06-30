import type { UserRole } from '../types/roles'
import { addDaysShanghai } from '../utils/business-timezone'
import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { prisma } from '../lib/prisma'
import {
  buildDailyOperationsReport,
  buildAfterSalesItemsFromViews,
  type DailyOperationsAnchorRow,
  type DailyOperationsReportPayload,
} from './daily-operations-report.service'
import { getAnchorPerformanceViews, getBoardScopedViewsForRange } from './board-scoped-views.service'
import { buildOperationsProductAnalysis } from './operations-product-analysis.service'
import { buildOperationsPriceBandAnalysis } from './operations-price-band.service'
import { aggregateAfterSalesReasons } from './after-sales-reason-normalize.service'
import { getOpsReviewNote } from './ops-review-note.service'
import {
  buildAllAnchorRankings,
  mergeAnchorRowsForRange,
} from './operations-anchor-ranking.service'
import { buildProductRankingLists } from './operations-product-ranking-lists.service'
import { buildPriceBandRankingLists } from './operations-price-band-ranking.service'
import { buildAfterSalesRankingLists } from './operations-after-sales-ranking.service'
import type { BossSummaryItem, OperationsRankingsPayload } from './operations-rankings.types'
import { buildOperationsDailyTrendFromSnapshots } from './operations-daily-trend.service'
import {
  buildBusinessInsightsFromSource,
  type BusinessInsightsSource,
} from './operations-business-insights.service'
import { attachBusinessInsightActions } from './operations-business-insight-action.service'

export type OperationsRankingsPreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'custom'

const MAX_DAILY_TREND_DAYS = 31

function formatMoneyYuan(yuan: number): string {
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}`
}

function buildBossSummary(params: {
  anchors: ReturnType<typeof buildAllAnchorRankings>
  products: ReturnType<typeof buildProductRankingLists>
  priceBands: ReturnType<typeof buildPriceBandRankingLists>
  afterSales: ReturnType<typeof buildAfterSalesRankingLists>
}): BossSummaryItem[] {
  const items: BossSummaryItem[] = []

  const topAnchorAmount = params.anchors.byAmount.items[0]
  if (topAnchorAmount) {
    items.push({
      title: '成交冠军主播',
      primaryText: topAnchorAmount.anchorName,
      metrics: [
        { label: '有效成交金额', value: formatMoneyYuan(topAnchorAmount.validAmountYuan) },
        { label: '成交订单', value: String(topAnchorAmount.soldOrderCount) },
      ],
      reason: topAnchorAmount.rankReason,
      basis: 'computed_from_valid_performance_view',
      confidence: 'high',
    })
  } else {
    items.push({
      title: '成交冠军主播',
      primaryText: '暂无可靠数据',
      metrics: [],
      reason: '本期无有效成交主播',
      basis: 'insufficient_data',
      confidence: 'insufficient',
      empty: true,
    })
  }

  const topAnchorOrders = params.anchors.byOrders.items[0]
  if (topAnchorOrders) {
    items.push({
      title: '订单冠军主播',
      primaryText: topAnchorOrders.anchorName,
      metrics: [
        { label: '成交订单', value: String(topAnchorOrders.soldOrderCount) },
        { label: '有效成交金额', value: formatMoneyYuan(topAnchorOrders.validAmountYuan) },
      ],
      reason: topAnchorOrders.rankReason,
      basis: 'computed_from_valid_performance_view',
      confidence: 'high',
    })
  }

  const topProduct = params.products.hot.items[0]
  if (topProduct) {
    items.push({
      title: '热卖商品',
      primaryText: topProduct.productName,
      metrics: [
        { label: '有效成交金额', value: formatMoneyYuan(topProduct.validAmountYuan) },
        { label: '成交订单', value: String(topProduct.soldOrderCount) },
        { label: '成交件数', value: String(topProduct.soldCount) },
      ],
      reason: topProduct.rankReason,
      basis: 'computed_from_valid_performance_view',
      confidence: 'high',
    })
  } else {
    items.push({
      title: '热卖商品',
      primaryText: '暂无可靠数据',
      metrics: [],
      reason: '本期无有效成交商品',
      basis: 'insufficient_data',
      confidence: 'insufficient',
      empty: true,
    })
  }

  const topHighReturn =
    params.products.highReturn.items[0] ?? params.products.highReturn.sampleTooSmall?.[0]
  if (topHighReturn) {
    items.push({
      title: '高退货风险商品',
      primaryText: topHighReturn.productName,
      metrics: [
        { label: '退货订单', value: String(topHighReturn.returnOrderCount) },
        { label: '成交订单', value: String(topHighReturn.soldOrderCount) },
      ],
      reason: topHighReturn.rankReason,
      basis: 'computed_from_valid_performance_view',
      confidence: topHighReturn.sampleTooSmall ? 'low' : 'high',
    })
  }

  const topBand = params.priceBands.byAmount.items[0]
  if (topBand) {
    items.push({
      title: '成交金额最高价格带',
      primaryText: topBand.bandLabel,
      metrics: [
        { label: '成交金额', value: formatMoneyYuan(topBand.validAmountYuan) },
        { label: '成交订单', value: String(topBand.soldOrderCount) },
      ],
      reason: topBand.rankReason,
      basis: 'computed_from_price_band_analysis',
      confidence: 'high',
    })
  }

  const topReason = params.afterSales.byReason.items[0]
  if (topReason) {
    items.push({
      title: '最大售后原因',
      primaryText: topReason.categoryLabel,
      metrics: [
        { label: '售后订单', value: String(topReason.orderCount) },
        { label: '退款金额', value: formatMoneyYuan(topReason.refundAmountYuan) },
      ],
      reason: topReason.rankReason,
      basis: 'computed_from_after_sales_reason',
      confidence: 'high',
    })
  }

  return items
}

function collectWarnings(payload: Partial<OperationsRankingsPayload>): string[] {
  const warnings: string[] = []
  const push = (w: string[] | undefined) => {
    if (w) warnings.push(...w)
  }
  if (payload.anchors) {
    for (const list of Object.values(payload.anchors)) {
      push(list.dataQuality.warnings)
    }
  }
  if (payload.products) {
    for (const list of Object.values(payload.products)) {
      push(list.dataQuality.warnings)
    }
  }
  if (payload.priceBands) {
    for (const list of Object.values(payload.priceBands)) {
      push(list.dataQuality.warnings)
    }
  }
  if (payload.afterSales) {
    for (const list of Object.values(payload.afterSales)) {
      push(list.dataQuality.warnings)
    }
  }
  return [...new Set(warnings)]
}

function resolvePrevRange(startDate: string, endDate: string): { prevStartDate: string; prevEndDate: string } {
  const days = eachDayInShanghaiRange(startDate, endDate)
  const len = days.length
  const prevEndDate = addDaysShanghai(startDate, -1)
  const prevStartDate = addDaysShanghai(prevEndDate, -(len - 1))
  return { prevStartDate, prevEndDate }
}

async function loadDailySnapshotsForRange(params: {
  preset?: string
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<DailyOperationsReportPayload[]> {
  const days = eachDayInShanghaiRange(params.startDate, params.endDate)
  const snapshots: DailyOperationsReportPayload[] = []
  for (const day of days) {
    snapshots.push(
      await buildDailyOperationsReport({
        preset: 'custom',
        startDate: day,
        endDate: day,
        role: params.role,
        username: params.username,
      }),
    )
  }
  return snapshots
}

function buildDailyTrendFromSnapshots(
  snapshots: DailyOperationsReportPayload[],
  startDate: string,
  endDate: string,
): OperationsRankingsPayload['dailyTrend'] {
  const days = eachDayInShanghaiRange(startDate, endDate)
  const cappedEnd =
    days.length > MAX_DAILY_TREND_DAYS
      ? days[MAX_DAILY_TREND_DAYS - 1]!
      : endDate
  const cappedStart = days.length > MAX_DAILY_TREND_DAYS ? days[0]! : startDate
  const trendSnapshots =
    days.length > MAX_DAILY_TREND_DAYS
      ? snapshots.slice(0, MAX_DAILY_TREND_DAYS)
      : snapshots
  return buildOperationsDailyTrendFromSnapshots(trendSnapshots, {
    startDate: cappedStart,
    endDate: cappedEnd,
  })
}

export async function getOperationsRankings(params: {
  startDate: string
  endDate: string
  preset?: OperationsRankingsPreset | string
  scope?: 'daily' | 'weekly' | 'custom'
  sections?: string[]
  limit?: number
  role?: UserRole
  username?: string
}): Promise<OperationsRankingsPayload> {
  const limit = params.limit ?? 10
  const preset = (params.preset ?? 'custom') as DateRangePreset
  const range = resolveDateRange(preset, params.startDate, params.endDate)
  const startDate = range.startDate
  const endDate = range.endDate
  const { prevStartDate, prevEndDate } = resolvePrevRange(startDate, endDate)

  const scoped = await getBoardScopedViewsForRange({
    preset,
    startDate,
    endDate,
    role: params.role,
    username: params.username,
  })
  const performanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const products = await buildOperationsProductAnalysis(performanceViews, scoped.rawByMatch)
  const priceBandRows = buildOperationsPriceBandAnalysis(performanceViews)
  const afterSalesRows = aggregateAfterSalesReasons(
    buildAfterSalesItemsFromViews(performanceViews),
  )

  let mergedAnchors: DailyOperationsAnchorRow[] = []
  let dailyTrend: OperationsRankingsPayload['dailyTrend'] = []
  let dailyTrendError: string | null = null
  try {
    const daySnapshots = await loadDailySnapshotsForRange({
      preset,
      startDate,
      endDate,
      role: params.role,
      username: params.username,
    })
    mergedAnchors = mergeAnchorRowsForRange(daySnapshots.map((snap) => snap.anchors))
    dailyTrend = buildDailyTrendFromSnapshots(daySnapshots, startDate, endDate)
  } catch (err) {
    dailyTrendError = err instanceof Error ? err.message : '未知错误'
    mergedAnchors = []
    dailyTrend = []
  }

  const dimensions = await prisma.productDimension.findMany()
  const isSingleDay = startDate === endDate
  const reviewNote = await getOpsReviewNote({
    reportDate: isSingleDay ? startDate : startDate,
    reportType: isSingleDay ? 'daily' : 'weekly',
  })

  const anchors = buildAllAnchorRankings(mergedAnchors, limit)
  const productLists = buildProductRankingLists({
    products,
    dimensions,
    reviewNote,
    limit,
  })
  const priceBands = buildPriceBandRankingLists(priceBandRows, limit)
  const afterSales = buildAfterSalesRankingLists(afterSalesRows, limit)

  const bossSummary = buildBossSummary({ anchors, products: productLists, priceBands, afterSales })

  const payload: OperationsRankingsPayload = {
    range: { startDate, endDate, prevStartDate, prevEndDate },
    dataQuality: {
      reliable: bossSummary.some((b) => !b.empty),
      warnings: [],
    },
    dailyTrend,
    bossSummary,
    anchors,
    products: productLists,
    priceBands,
    afterSales: {
      byReason: afterSales.byReason,
      byRefundAmount: afterSales.byRefundAmount,
    },
  }

  payload.dataQuality.warnings = collectWarnings(payload)

  if (dailyTrendError) {
    payload.dataQuality.warnings.push(`成交走势生成失败：${dailyTrendError}`)
  }

  try {
    const insightSource: BusinessInsightsSource = {
      startDate,
      endDate,
      scope: params.scope ?? 'custom',
      anchors,
      products: productLists,
      priceBands,
      afterSales,
      extraWarnings: payload.dataQuality.warnings,
    }
    payload.businessInsights = await attachBusinessInsightActions(
      buildBusinessInsightsFromSource(insightSource),
      {
        startDate,
        endDate,
        scope: params.scope ?? 'custom',
      },
    )
  } catch (err) {
    payload.businessInsights = {
      items: [],
      dataQuality: {
        reliable: false,
        warnings: [
          `经营建议生成失败：${err instanceof Error ? err.message : '未知错误'}`,
        ],
      },
    }
  }

  return payload
}
