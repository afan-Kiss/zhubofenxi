import type { UserRole } from '../types/roles'
import { addDaysShanghai } from '../utils/business-timezone'
import { eachDayInShanghaiRange } from '../utils/each-day-shanghai'
import {
  buildDailyOperationsReport,
  type DailyOperationsReportPayload,
} from './daily-operations-report.service'
import { getOpsReviewNote, type OpsReviewNotePayload } from './ops-review-note.service'
import type { OperationsProductRow } from './operations-product-analysis.service'
import { computeReturnOrderRateRatio } from './operations-after-sale-order.util'
import { computeProductReturnRateByOrder } from './operations-product-analysis.service'
import {
  buildWeeklyProductRankings,
  type ProductRankItem,
  type ProductRankingQuality,
} from './operations-product-ranking.service'
import { prisma } from '../lib/prisma'
import { mergeAnchorRowsForRange } from './operations-anchor-ranking.service'
import {
  buildBusinessInsightsFromSource,
  buildBusinessInsightsSourceFromComponents,
} from './operations-business-insights.service'
import { attachBusinessInsightActions } from './operations-business-insight-action.service'
import type { BusinessInsightsPayload } from './operations-business-insights.types'
import {
  productRoleLabel,
  resolveProductRole,
} from '../config/operations-product-role.config'

export interface WeeklyDailyTrendRow {
  dateKey: string
  dateLabel: string
  validAmountYuan: number
  soldOrderCount: number
  returnOrderCount: number
}

export interface WeeklyAnchorRow {
  anchorName: string
  validAmountYuan: number
  soldOrderCount: number
  paidOrderCount: number
  returnOrderCount: number
  returnOrderRate: number | null
  liveDurationMinutes: number
  dealUserCount: number | null
}

export interface WeeklyProductHighlight extends ProductRankItem {
  soldAmountYuan: number
}

export type { ProductRankingQuality }

export interface WeeklyOperationsReportPayload {
  weekStart: string
  weekEnd: string
  title: string
  summary: DailyOperationsReportPayload['summary'] & {
    prevValidAmountYuan: number | null
    validAmountChangePercent: number | null
    prevSoldOrderCount: number | null
    soldOrderChangePercent: number | null
  }
  dailyTrend: WeeklyDailyTrendRow[]
  anchors: WeeklyAnchorRow[]
  hotProducts: WeeklyProductHighlight[]
  slowProducts: WeeklyProductHighlight[]
  highReturnProducts: WeeklyProductHighlight[]
  highReturnSampleTooSmall: WeeklyProductHighlight[]
  productRankingQuality: ProductRankingQuality
  priceBands: DailyOperationsReportPayload['priceBands']
  afterSalesReasons: DailyOperationsReportPayload['afterSalesReasons']
  reviewNote: OpsReviewNotePayload | null
  businessInsights: BusinessInsightsPayload
}

function formatDateLabel(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim())
  if (!m) return dateKey
  return `${Number(m[2])}.${Number(m[3])}`
}

export function changePercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

export function aggregateProductsFromSnapshots(
  snapshots: DailyOperationsReportPayload[],
): OperationsProductRow[] {
  const map = new Map<string, OperationsProductRow & { topShopDayAmount: number }>()
  for (const snap of snapshots) {
    for (const p of snap.products) {
      const existing = map.get(p.productKey)
      if (!existing) {
        map.set(p.productKey, { ...p, topShopDayAmount: p.soldAmountYuan })
        continue
      }
      if (p.shopName && p.shopName !== '—' && p.soldAmountYuan >= existing.topShopDayAmount) {
        existing.shopName = p.shopName
        existing.topShopDayAmount = p.soldAmountYuan
      }
      existing.soldCount += p.soldCount
      existing.soldOrderCount += p.soldOrderCount
      existing.soldAmountYuan += p.soldAmountYuan
      existing.buyerCount += p.buyerCount
      existing.returnOrderCount += p.returnOrderCount
      existing.returnRate = computeProductReturnRateByOrder(
        existing.soldOrderCount,
        existing.returnOrderCount,
      )
      const role = resolveProductRole({
        soldCount: existing.soldCount,
        returnRate: existing.returnRate,
      })
      existing.productRole = role
      existing.productRoleLabel = productRoleLabel(role)
    }
  }
  return [...map.values()].map(({ topShopDayAmount: _drop, ...row }) => row)
}

function aggregateWeeklySummary(
  snapshots: DailyOperationsReportPayload[],
): DailyOperationsReportPayload['summary'] {
  let validAmountCent = 0
  let soldOrderCount = 0
  let invalidOrderCount = 0
  let returnOrderCount = 0
  let paidOrderCount = 0
  let totalLiveDurationMinutes = 0
  let assignedLiveDurationMinutes = 0
  let unassignedLiveDurationMinutes = 0
  let unassignedLiveSessionCount = 0
  let anchorAssignedValidCent = 0
  let unassignedValidCent = 0
  let unassignedValidOrderCount = 0
  let anchorAssignedInvalidOrderCount = 0
  let unassignedInvalidOrderCount = 0
  let totalNewFollowerCount = 0
  let dealUserCount: number | null = null
  let joinUserCount: number | null = null
  let viewSessionCount: number | null = null
  let avgOnlineWeighted = 0
  let avgOnlineWeight = 0
  let avgStayWeighted = 0
  let avgStayWeight = 0
  const liveRoomMap = new Map<string, number>()

  for (const snap of snapshots) {
    validAmountCent += snap.summary.validAmountCent ?? Math.round(snap.summary.validAmountYuan * 100)
    soldOrderCount += snap.summary.soldOrderCount
    invalidOrderCount += snap.summary.invalidOrderCount
    returnOrderCount += snap.summary.returnOrderCount
    paidOrderCount += snap.summary.paidOrderCount ?? 0
    totalLiveDurationMinutes += snap.summary.totalLiveDurationMinutes
    assignedLiveDurationMinutes += snap.summary.assignedLiveDurationMinutes ?? 0
    unassignedLiveDurationMinutes += snap.summary.unassignedLiveDurationMinutes ?? 0
    unassignedLiveSessionCount += snap.summary.unassignedLiveSessionCount ?? 0
    anchorAssignedValidCent += Math.round((snap.summary.anchorAssignedValidAmountYuan ?? 0) * 100)
    unassignedValidCent += Math.round((snap.summary.unassignedValidAmountYuan ?? 0) * 100)
    unassignedValidOrderCount += snap.summary.unassignedValidOrderCount ?? 0
    anchorAssignedInvalidOrderCount += snap.summary.anchorAssignedInvalidOrderCount ?? 0
    unassignedInvalidOrderCount += snap.summary.unassignedInvalidOrderCount ?? 0
    totalNewFollowerCount += snap.summary.totalNewFollowerCount
    if (snap.summary.dealUserCount != null) {
      dealUserCount = (dealUserCount ?? 0) + snap.summary.dealUserCount
    }
    if (snap.summary.joinUserCount != null) {
      joinUserCount = (joinUserCount ?? 0) + snap.summary.joinUserCount
    }
    if (snap.summary.viewSessionCount != null) {
      viewSessionCount = (viewSessionCount ?? 0) + snap.summary.viewSessionCount
    }
    const joinW = snap.summary.joinUserCount ?? snap.summary.viewSessionCount ?? 0
    if (snap.summary.avgOnlineUserCount != null && joinW > 0) {
      avgOnlineWeighted += snap.summary.avgOnlineUserCount * joinW
      avgOnlineWeight += joinW
    }
    if (snap.summary.avgViewDurationSeconds != null && joinW > 0) {
      avgStayWeighted += snap.summary.avgViewDurationSeconds * joinW
      avgStayWeight += joinW
    }
    for (const row of snap.summary.liveRoomNewFollowers) {
      liveRoomMap.set(row.liveAccountName, (liveRoomMap.get(row.liveAccountName) ?? 0) + row.newFollowerCount)
    }
  }

  const totalLiveHours = totalLiveDurationMinutes / 60
  const validAmountYuan = validAmountCent / 100

  return {
    validAmountCent,
    validAmountYuan,
    anchorAssignedValidAmountYuan: anchorAssignedValidCent / 100,
    unassignedValidAmountYuan: unassignedValidCent / 100,
    unassignedValidOrderCount,
    soldOrderCount,
    invalidOrderCount,
    anchorAssignedInvalidOrderCount,
    unassignedInvalidOrderCount,
    returnOrderCount,
    returnOrderRate: computeReturnOrderRateRatio(paidOrderCount, returnOrderCount),
    paidOrderCount,
    dealUserCount,
    joinUserCount,
    viewSessionCount,
    avgOnlineUserCount: avgOnlineWeight > 0 ? avgOnlineWeighted / avgOnlineWeight : null,
    avgViewDurationSeconds: avgStayWeight > 0 ? avgStayWeighted / avgStayWeight : null,
    dealConversionRate:
      joinUserCount != null && joinUserCount > 0 && dealUserCount != null
        ? dealUserCount / joinUserCount
        : null,
    avgOrderAmountYuan:
      soldOrderCount > 0 ? Math.round(validAmountYuan / soldOrderCount) : null,
    totalLiveDurationMinutes,
    assignedLiveDurationMinutes,
    unassignedLiveDurationMinutes,
    unassignedLiveSessionCount,
    hourlyAmountYuan:
      totalLiveHours > 0 ? Math.round(validAmountYuan / totalLiveHours) : null,
    liveRoomNewFollowers: [...liveRoomMap.entries()].map(([liveAccountName, count]) => ({
      liveAccountName,
      newFollowerCount: count,
    })),
    totalNewFollowerCount,
    newFollowerRate:
      viewSessionCount != null && viewSessionCount > 0 && totalNewFollowerCount > 0
        ? totalNewFollowerCount / viewSessionCount
        : null,
  }
}

/** 验收用：周报汇总与逐日快照金额/订单一致性校验 */
export function aggregateWeeklySummaryForAcceptance(
  snapshots: DailyOperationsReportPayload[],
): DailyOperationsReportPayload['summary'] {
  return aggregateWeeklySummary(snapshots)
}

function aggregateWeeklyAnchors(
  snapshots: DailyOperationsReportPayload[],
): WeeklyAnchorRow[] {
  const map = new Map<string, WeeklyAnchorRow>()
  for (const snap of snapshots) {
    for (const row of snap.anchors) {
      const existing = map.get(row.anchorName) ?? {
        anchorName: row.anchorName,
        validAmountYuan: 0,
        soldOrderCount: 0,
        paidOrderCount: 0,
        returnOrderCount: 0,
        returnOrderRate: null,
        liveDurationMinutes: 0,
        dealUserCount: 0 as number | null,
      }
      existing.validAmountYuan += row.validAmountYuan
      existing.soldOrderCount += row.soldOrderCount
      existing.paidOrderCount += row.paidOrderCount
      existing.returnOrderCount += row.returnOrderCount
      existing.liveDurationMinutes += row.liveDurationMinutes
      if (row.dealUserCount != null) {
        existing.dealUserCount = (existing.dealUserCount ?? 0) + row.dealUserCount
      }
      existing.returnOrderRate = computeReturnOrderRateRatio(
        existing.paidOrderCount,
        existing.returnOrderCount,
      )
      map.set(row.anchorName, existing)
    }
  }
  return [...map.values()].sort((a, b) => b.validAmountYuan - a.validAmountYuan)
}

export function aggregatePriceBandsFromSnapshots(
  snapshots: DailyOperationsReportPayload[],
): DailyOperationsReportPayload['priceBands'] {
  const map = new Map<string, DailyOperationsReportPayload['priceBands'][number]>()
  for (const snap of snapshots) {
    for (const band of snap.priceBands) {
      const existing = map.get(band.bandLabel)
      if (!existing) {
        map.set(band.bandLabel, { ...band })
        continue
      }
      existing.orderCount += band.orderCount
      existing.amountYuan += band.amountYuan
      existing.buyerCount += band.buyerCount
      existing.returnOrderCount += band.returnOrderCount
      existing.returnRate = computeReturnOrderRateRatio(
        existing.orderCount,
        existing.returnOrderCount,
      )
    }
  }
  const totalAmount = [...map.values()].reduce((s, b) => s + b.amountYuan, 0)
  return [...map.values()]
    .map((b) => ({
      ...b,
      amountSharePercent:
        totalAmount > 0 ? Math.round((b.amountYuan / totalAmount) * 100) : null,
      avgOrderAmountYuan:
        b.orderCount > 0 ? Math.round(b.amountYuan / b.orderCount) : null,
    }))
    .sort((a, b) => b.amountYuan - a.amountYuan)
}

export function aggregateAfterSalesFromSnapshots(
  snapshots: DailyOperationsReportPayload[],
): DailyOperationsReportPayload['afterSalesReasons'] {
  const map = new Map<string, DailyOperationsReportPayload['afterSalesReasons'][number]>()
  for (const snap of snapshots) {
    for (const row of snap.afterSalesReasons) {
      const existing = map.get(row.category)
      if (!existing) {
        map.set(row.category, { ...row })
        continue
      }
      existing.orderCount += row.orderCount
      existing.refundAmountYuan += row.refundAmountYuan
    }
  }
  const totalOrders = [...map.values()].reduce((s, r) => s + r.orderCount, 0)
  return [...map.values()]
    .map((r) => ({
      ...r,
      sharePercent: totalOrders > 0 ? Math.round((r.orderCount / totalOrders) * 100) : null,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
}

function toProductHighlight(p: ProductRankItem): WeeklyProductHighlight {
  return { ...p, soldAmountYuan: p.validAmountYuan }
}

export async function buildWeeklyOperationsReport(params: {
  weekStart: string
  weekEnd: string
  preset?: string
  role?: UserRole
  username?: string
}): Promise<WeeklyOperationsReportPayload> {
  const days = eachDayInShanghaiRange(params.weekStart, params.weekEnd)
  if (days.length === 0) throw new Error('周报日期范围无效')

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

  const weekLength = days.length
  const prevEnd = addDaysShanghai(params.weekStart, -1)
  const prevStart = addDaysShanghai(prevEnd, -(weekLength - 1))
  const prevDays = eachDayInShanghaiRange(prevStart, prevEnd)
  let prevValidAmountYuan = 0
  let prevSoldOrderCount = 0
  for (const dateKey of prevDays) {
    const snap = await buildDailyOperationsReport({
      preset: 'custom',
      startDate: dateKey,
      endDate: dateKey,
      role: params.role,
      username: params.username,
    })
    prevValidAmountYuan += snap.summary.validAmountYuan
    prevSoldOrderCount += snap.summary.soldOrderCount
  }

  const summaryBase = aggregateWeeklySummary(snapshots)
  const products = aggregateProductsFromSnapshots(snapshots)
  const dimensions = await prisma.productDimension.findMany()
  const reviewNoteForRank = await getOpsReviewNote({
    reportDate: params.weekStart,
    reportType: 'weekly',
  })
  const rankings = buildWeeklyProductRankings({
    products,
    dimensions,
    reviewNote: reviewNoteForRank,
  })

  const reviewNote = reviewNoteForRank

  const aggregatedPriceBands = aggregatePriceBandsFromSnapshots(snapshots)
  const aggregatedAfterSales = aggregateAfterSalesFromSnapshots(snapshots)
  const mergedAnchorRows = mergeAnchorRowsForRange(snapshots.map((s) => s.anchors))

  let businessInsights: BusinessInsightsPayload
  try {
    businessInsights = await attachBusinessInsightActions(
      buildBusinessInsightsFromSource(
        buildBusinessInsightsSourceFromComponents({
          startDate: params.weekStart,
          endDate: params.weekEnd,
          scope: 'weekly',
          anchors: mergedAnchorRows,
          products,
          priceBands: aggregatedPriceBands,
          afterSalesReasons: aggregatedAfterSales,
          dimensions,
          reviewNote,
          summaryTraffic: {
            dealUserCount: summaryBase.dealUserCount,
            joinUserCount: summaryBase.joinUserCount,
            viewSessionCount: summaryBase.viewSessionCount,
          },
          extraWarnings: rankings.productRankingQuality.warnings,
        }),
      ),
      {
        startDate: params.weekStart,
        endDate: params.weekEnd,
        scope: 'weekly',
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

  return {
    weekStart: params.weekStart,
    weekEnd: params.weekEnd,
    title: `${formatDateLabel(params.weekStart)}~${formatDateLabel(params.weekEnd)} 运营周报`,
    summary: {
      ...summaryBase,
      prevValidAmountYuan: prevDays.length > 0 ? prevValidAmountYuan : null,
      validAmountChangePercent: changePercent(summaryBase.validAmountYuan, prevValidAmountYuan),
      prevSoldOrderCount: prevDays.length > 0 ? prevSoldOrderCount : null,
      soldOrderChangePercent: changePercent(summaryBase.soldOrderCount, prevSoldOrderCount),
    },
    dailyTrend: snapshots.map((snap) => ({
      dateKey: snap.startDate,
      dateLabel: snap.dateLabel,
      validAmountYuan: snap.summary.validAmountYuan,
      soldOrderCount: snap.summary.soldOrderCount,
      returnOrderCount: snap.summary.returnOrderCount,
    })),
    anchors: aggregateWeeklyAnchors(snapshots),
    hotProducts: rankings.hotProducts.map(toProductHighlight),
    slowProducts: rankings.slowProducts.map(toProductHighlight),
    highReturnProducts: rankings.highReturnProducts.map(toProductHighlight),
    highReturnSampleTooSmall: rankings.highReturnSampleTooSmall.map(toProductHighlight),
    productRankingQuality: rankings.productRankingQuality,
    priceBands: aggregatedPriceBands,
    afterSalesReasons: aggregatedAfterSales,
    reviewNote,
    businessInsights,
  }
}
