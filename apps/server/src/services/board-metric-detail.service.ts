import type { UserRole } from '../types/roles'
import type { AnalyzedOrderView } from '../types/analysis'
import { mapViewToBoardDrillRow, type BoardDrillOrderRow } from './order-row-mapper.service'
import { normalizeBoardPreset } from './board-metrics.service'
import { formatCount, formatRate, formatYuan } from '../utils/money'
import { dedupeViewsByMetricOrderNo, dedupeRefundMetricViewsByOrderNoMaxRefund, dedupeCoreMetricViewsByOrderNoBestValue, dedupeFreightRefundViewsByOrderNoMaxFreight } from './calc-refund-rate.service'
import {
  calculateBusinessMetrics,
  pickMetricValue,
  buildBlacklistedBuyerIds,
  viewCountsAsPaidOrder,
  viewCountsAsRefundOrder,
  isQualityRefundOrder,
  type BoardMetricValueKey,
} from './business-metrics.service'
import { isEffectiveSignedView } from './strict-after-sale-metrics.service'
import {
  countUnmatchedOfficialQualityCases,
  getQualityBadCasesSync,
} from './quality-badcase-store.service'
import {
  isStaffUnbound,
  staffAnchorFilter,
  STAFF_UNBOUND_MESSAGE,
} from './staff-anchor-scope.service'
import {
  filterViewsByAnchorSpec,
  getBoardScopedViewsForRange,
} from './board-scoped-views.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import { resolveOverviewStableDrawerContext } from './overview-metric-snapshot.service'
import { isValidRevenueOrder } from './valid-revenue-order.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { remapViewsWithScheduleOverlay } from './anchor-schedule-attribution.service'
import { aggregateQualityRefundByAnchor } from './quality-refund-anchor-attribution.service'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { anchorLeaderboardRowMatches } from './anchor-attribution.util'

export type BoardDataSource = 'local_db' | 'live_api'

export type BoardMetricKey =
  | 'gmv'
  | 'effectiveGmv'
  | 'actualSignedAmount'
  | 'signedCount'
  | 'signRate'
  | 'returnAmount'
  | 'returnCount'
  | 'returnRefundCount'
  | 'qualityReturnCount'
  | 'qualityReturnRate'
  | 'orderCount'
  | 'freightRefundAmount'
  | 'returnRate'

const METRIC_DEFS: Record<
  BoardMetricKey,
  { title: string; formula: string; description: string; valueKey: BoardMetricValueKey }
> = {
  gmv: {
    title: '支付金额',
    formula:
      '支付金额 = 统计时间内已支付订单的支付金额合计，不扣退款；已支付后退款/取消仍计入支付金额',
    description: '不含未支付、无支付时间订单；日期按支付时间归属，无支付时间时按下单时间。',
    valueKey: 'gmv',
  },
  effectiveGmv: {
    title: '内部有效成交口径',
    formula:
      '内部有效成交口径 = 已完成/已签收且无在途售后、未成功退款的订单成交金额合计（与运营报表有效成交金额同一口径，仅内部诊断用）',
    description:
      '仅供内部排查与诊断，经营看板对外展示请使用「已签收金额」。先筛有效成交订单池，再对池内订单成交金额求和。',
    valueKey: 'effectiveGmv',
  },
  actualSignedAmount: {
    title: '已签收金额',
    formula:
      '已签收金额 = 已签收/已完成，且没有影响成交的售后退款订单金额合计',
    description:
      '只统计真正留下来的订单；纯运费补偿不影响，小额商品退款按现有签收规则处理。',
    valueKey: 'actualSignedAmount',
  },
  signedCount: {
    title: '签收单数',
    formula: '签收单数 = 有效实际签收订单数（已签收，且无售后/取消/小额退款）',
    description:
      '已签收/已完成，且无售后、售后已取消，或商品退款不超过 ¥20.00 的订单，按 P 单号去重。',
    valueKey: 'signedCount',
  },
  signRate: {
    title: '签收率',
    formula: '签收率 = 有效签收订单数 ÷ 支付订单数',
    description: '',
    valueKey: 'signRate',
  },
  returnAmount: {
    title: '退款金额',
    formula: '退款金额 = 商品退款金额合计（含仅退款、退货退款、品退）',
    description:
      '明细含退款金额为 0 的相关订单；不含未支付且无售后记录的普通取消。不含运费补偿。',
    valueKey: 'returnAmount',
  },
  returnCount: {
    title: '退款单数',
    formula: '退款单数 = 有效成功售后且退款金额>0 的订单数（按订单号去重）',
    description: '仅统计匹配订单主表的有效成功售后；不含表外售后记录。',
    valueKey: 'returnCount',
  },
  returnRefundCount: {
    title: '退货退款单数',
    formula:
      '退货退款单数 = 本期已支付且真实商品退款金额>0，且售后类型判定为退货退款的订单数（按 P 单号去重）',
    description:
      '优先依据售后原始 return_type；不含仅退款、纯运费、申请中/已取消。类型未同步完整时卡片可能显示「--」。',
    valueKey: 'returnRefundCount',
  },
  qualityReturnCount: {
    title: '品退单数',
    formula:
      '品退单数 = 官方品质负反馈命中且匹配订单主表，或售后明确商品质量问题的唯一 P 单号数量',
    description:
      '官方品退与售后商品问题逻辑合并统计，按 P 单号去重。明细会区分「官方品退 / 售后疑似品退」。',
    valueKey: 'qualityReturnCount',
  },
  qualityReturnRate: {
    title: '品退率',
    formula: '品退率 = 品退订单数 ÷ 支付订单数',
    description:
      '数据来源：官方品质负反馈接口 + 严格商品问题售后。明细区分官方品退与售后疑似品退。',
    valueKey: 'qualityReturnRate',
  },
  orderCount: {
    title: '支付订单数',
    formula: '支付订单数 = 统计时间内有支付时间的订单数',
    description: '已支付后取消/退款仍计入；不含未支付、无支付时间订单。',
    valueKey: 'orderCount',
  },
  freightRefundAmount: {
    title: '运费补偿金额',
    formula: '运费补偿 = 仅退运费订单金额合计',
    description: '单独展示，不计入商品退款。',
    valueKey: 'freightRefundAmount',
  },
  returnRate: {
    title: '退款率',
    formula: '退款率 = 退款订单数 ÷ 支付订单数',
    description:
      '退款订单数 = 本期已支付且真实退款金额>0 的订单（P 订单号去重）；未签收不计入退款订单。',
    valueKey: 'returnRate',
  },
}

function matchMetricViews(views: AnalyzedOrderView[], metric: BoardMetricKey, tab?: string): AnalyzedOrderView[] {
  switch (metric) {
    case 'gmv':
      return views.filter((v) => v.includedInGmv)
    case 'effectiveGmv':
      return views.filter((v) => isValidRevenueOrder(v))
    case 'actualSignedAmount':
    case 'signedCount':
    case 'signRate': {
      const paidViews = views.filter((v) => viewCountsAsPaidOrder(v))
      if (tab === 'unsigned') return paidViews.filter((v) => !isEffectiveSignedView(v))
      return paidViews.filter((v) => isEffectiveSignedView(v))
    }
    case 'returnAmount':
    case 'returnCount':
    case 'returnRate':
      return views.filter((v) => viewCountsAsRefundOrder(v))
    case 'returnRefundCount':
      return views.filter((v) => viewCountsAsRefundOrder(v) && Boolean(v.isReturnRefundOrder))
    case 'freightRefundAmount':
      return views.filter((v) => v.isFreightRefundOnly)
    case 'qualityReturnCount':
    case 'qualityReturnRate':
      return views.filter((v) => isQualityRefundOrder(v))
    case 'orderCount':
      return views.filter((v) => viewCountsAsPaidOrder(v))
    default:
      return views
  }
}

const METRICS_ORDER_DEDUPE: BoardMetricKey[] = [
  'gmv',
  'orderCount',
  'actualSignedAmount',
  'signedCount',
  'signRate',
  'effectiveGmv',
  'returnAmount',
  'returnCount',
  'returnRate',
  'returnRefundCount',
  'qualityReturnCount',
  'qualityReturnRate',
  'freightRefundAmount',
]

function usesCoreMetricBestValueDedupe(metric: BoardMetricKey): boolean {
  return (
    metric === 'gmv' ||
    metric === 'orderCount' ||
    metric === 'actualSignedAmount' ||
    metric === 'signedCount' ||
    metric === 'signRate'
  )
}

function needsMetricOrderDedupe(metric: BoardMetricKey): boolean {
  return METRICS_ORDER_DEDUPE.includes(metric)
}

function countDedupedSignedViews(views: AnalyzedOrderView[]): number {
  const paidViews = views.filter((v) => viewCountsAsPaidOrder(v))
  return dedupeViewsByMetricOrderNo(paidViews.filter((v) => isEffectiveSignedView(v))).length
}

function countDedupedUnsignedViews(views: AnalyzedOrderView[]): number {
  const paidViews = views.filter((v) => viewCountsAsPaidOrder(v))
  return dedupeViewsByMetricOrderNo(paidViews.filter((v) => !isEffectiveSignedView(v))).length
}

function buildPageSummary(views: AnalyzedOrderView[]): Record<string, unknown> {
  const m = calculateBusinessMetrics(views)
  return {
    metricsVersion: m.version,
    productGmv: m.totalGmv,
    totalGmv: m.totalGmv,
    gmv: m.totalGmv,
    effectiveGmv: m.validSalesAmount,
    validSalesAmount: m.validSalesAmount,
    actualSignedAmount: m.actualSignedAmount,
    orderCount: m.orderCount,
    periodOrderCount: m.periodOrderCount,
    signRate: m.signRate,
    returnRate: m.refundRate,
    qualityReturnRate: m.qualityRefundRate,
    signedOrderCount: m.signedOrderCount,
    actualSignedCount: m.signedOrderCount,
    returnCount: m.refundOrderCount,
    returnRefundCount: m.returnOrderCount,
    refundOnlyCount: m.refundOnlyOrderCount,
    unknownRefundTypeCount: m.unknownRefundTypeOrderCount,
    returnRefundTypeIncomplete: m.returnRefundTypeIncomplete,
    afterSaleRecordCount: m.afterSaleRecordCount,
    qualityReturnCount: m.qualityRefundOrderCount,
    returnAmount: m.refundAmount,
    productRefundAmount: m.refundAmount,
    freightRefundAmount: m.freightRefundAmount,
  }
}

function sortRows(rows: BoardDrillOrderRow[], sort: string): BoardDrillOrderRow[] {
  const list = [...rows]
  const anchorSortKey = (name: string | undefined) => {
    const n = (name || '').trim()
    if (!n || n === '未归属') return '\uffff'
    return n
  }
  if (sort === 'anchor_asc') {
    list.sort((a, b) => {
      const anchorCmp = anchorSortKey(a.anchorName).localeCompare(anchorSortKey(b.anchorName), 'zh-CN')
      if (anchorCmp !== 0) return anchorCmp
      return b.orderTime.localeCompare(a.orderTime)
    })
  } else if (sort === 'amount_desc') {
    list.sort((a, b) => b.payAmount - a.payAmount)
  } else if (sort === 'refund_desc') {
    list.sort((a, b) => b.productRefundAmount - a.productRefundAmount)
  } else {
    list.sort((a, b) => b.orderTime.localeCompare(a.orderTime))
  }
  return list
}

function formatValueText(metric: BoardMetricKey, value: number | null): string {
  if (value == null) return '—'
  if (metric.includes('Rate') || metric === 'signRate' || metric === 'qualityReturnRate') {
    return formatRate(value)
  }
  if (
    metric === 'orderCount' ||
    metric === 'signedCount' ||
    metric === 'returnCount' ||
    metric === 'returnRefundCount' ||
    metric === 'qualityReturnCount'
  ) {
    return formatCount(value)
  }
  return formatYuan(value)
}

export async function buildBoardMetricDetail(params: {
  metric: BoardMetricKey
  preset?: string
  startDate: string
  endDate: string
  anchorId?: string
  anchorName?: string
  page?: number
  pageSize?: number
  tab?: string
  sort?: string
  role: UserRole
  username: string
  overviewStableSnapshot?: boolean
}) {
  const def = METRIC_DEFS[params.metric]
  const preset = normalizeBoardPreset(params.preset ?? 'custom')
  const requestId = `metric-${Date.now()}`

  if (isStaffUnbound(params.role, params.username)) {
    throw new Error(STAFF_UNBOUND_MESSAGE)
  }
  const forcedAnchor = staffAnchorFilter(params.role, params.username)
  const anchorId = forcedAnchor ? undefined : params.anchorId
  const anchorName = forcedAnchor ?? params.anchorName

  const normalizedPreset = normalizeBoardPreset(params.preset ?? 'custom')
  const scoped = await getBoardScopedViewsForRange({
    preset: normalizedPreset,
    startDate: params.startDate,
    endDate: params.endDate,
    role: params.role,
    username: params.username,
  })

  const coreViews = filterViewsForCoreMetrics(scoped.views)
  const rawByMatch = scoped.rawByMatch
  const range = scoped.range

  const viewsWithRaw = attachRawByMatchToViews(coreViews, rawByMatch)
  const remappedViews = await remapViewsWithScheduleOverlay(viewsWithRaw)

  const isQualityMetric =
    params.metric === 'qualityReturnCount' || params.metric === 'qualityReturnRate'

  let qualityMatchedViews: AnalyzedOrderView[] | null = null
  let qualityMatchedCount: number | null = null

  if (isQualityMetric) {
    const liveBundle = await buildRawAnalyzeBundle(
      resolveDateRange(normalizedPreset as DateRangePreset, range.startDate, range.endDate),
    )
    const liveSessions = liveBundle?.liveSessions ?? []
    const agg = await aggregateQualityRefundByAnchor({ views: remappedViews, liveSessions })
    const anchorQuery = { anchorId, anchorName }

    if (anchorId || anchorName) {
      const matched = agg.attributions.filter((attr) => {
        if (anchorName === '未归属') return attr.anchorName === '未归属'
        return anchorLeaderboardRowMatches(
          { anchorId: attr.anchorId, anchorName: attr.anchorName },
          anchorQuery,
        )
      })
      qualityMatchedViews = matched.map((attr) => attr.view)
      if (anchorName === '未归属') {
        qualityMatchedCount = agg.unassigned.length
      } else if (anchorName?.trim()) {
        qualityMatchedCount = [...agg.byAnchorKey.values()]
          .filter((b) => b.anchorName === anchorName.trim())
          .reduce((sum, b) => sum + b.count, 0)
      } else {
        qualityMatchedCount = matched.length
      }
    } else {
      qualityMatchedViews = agg.attributions.map((attr) => attr.view)
      qualityMatchedCount = agg.totalQualityRefundCount
    }
  }

  let viewsForTotals = coreViews
  let displayViews = remappedViews
  if (anchorId || anchorName) {
    const filteredRemapped = filterViewsByAnchorSpec(remappedViews, anchorId, anchorName)
    viewsForTotals = filteredRemapped
    displayViews = filteredRemapped
  }

  const totals = calculateBusinessMetrics(viewsForTotals)
  let valueRaw: number | null = pickMetricValue(totals, def.valueKey)

  if (isQualityMetric && qualityMatchedCount != null) {
    valueRaw =
      params.metric === 'qualityReturnRate'
        ? totals.orderCount > 0
          ? qualityMatchedCount / totals.orderCount
          : null
        : qualityMatchedCount
  }

  let sourceViews =
    isQualityMetric && qualityMatchedViews
      ? qualityMatchedViews
      : matchMetricViews(displayViews, params.metric, params.tab)
  if (needsMetricOrderDedupe(params.metric)) {
    if (
      params.metric === 'returnAmount' ||
      params.metric === 'returnCount' ||
      params.metric === 'returnRate' ||
      params.metric === 'returnRefundCount'
    ) {
      sourceViews = dedupeRefundMetricViewsByOrderNoMaxRefund(sourceViews)
    } else if (params.metric === 'freightRefundAmount') {
      sourceViews = dedupeFreightRefundViewsByOrderNoMaxFreight(sourceViews)
    } else if (usesCoreMetricBestValueDedupe(params.metric)) {
      sourceViews = dedupeCoreMetricViewsByOrderNoBestValue(sourceViews)
    } else {
      sourceViews = dedupeViewsByMetricOrderNo(sourceViews)
    }
  }
  const signedTabCount = countDedupedSignedViews(viewsForTotals)
  const unsignedTabCount = countDedupedUnsignedViews(viewsForTotals)
  const blacklist = buildBlacklistedBuyerIds(viewsForTotals)

  const sortMode =
    params.sort ??
    (params.metric === 'actualSignedAmount' && !anchorId && !anchorName ? 'anchor_asc' : 'time_desc')

  const allRows = sortRows(
    sourceViews
      .map((v) => {
        const raw = rawByMatch.get(v.matchOrderId || v.orderId)
        const row = mapViewToBoardDrillRow(
          Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
          { useBuyerRefund: true },
        )
        const blocked = blacklist.has(row.buyerKey)
        return { ...row, isBlacklistedBuyer: blocked }
      })
      .filter((row) => {
        if (params.metric !== 'actualSignedAmount') return true
        return Number(row.signedAmount ?? 0) > 0
      }),
    sortMode,
  )

  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))
  const total = allRows.length
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize)

  const tabs =
    params.metric === 'signRate' || params.metric === 'signedCount'
      ? [
          { key: 'signed', label: '已签收', count: signedTabCount },
          {
            key: 'unsigned',
            label: '未签收/售后',
            count: unsignedTabCount,
          },
        ]
      : []

  const matchedOrders = (() => {
    if (isQualityMetric && qualityMatchedCount != null) return qualityMatchedCount
    if (params.metric === 'effectiveGmv') {
      return dedupeViewsByMetricOrderNo(viewsForTotals.filter((v) => isValidRevenueOrder(v))).length
    }
    if (params.metric === 'signedCount' || params.metric === 'signRate') {
      return params.tab === 'unsigned'
        ? Math.max(0, totals.orderCount - totals.signedOrderCount)
        : totals.signedOrderCount
    }
    if (params.metric === 'actualSignedAmount') return totals.signedOrderCount
    if (params.metric === 'gmv' || params.metric === 'orderCount') {
      return totals.orderCount
    }
    if (
      params.metric === 'returnAmount' ||
      params.metric === 'returnCount' ||
      params.metric === 'returnRate'
    ) {
      return totals.refundOrderCount
    }
    if (params.metric === 'freightRefundAmount') {
      return sourceViews.length
    }
    if (needsMetricOrderDedupe(params.metric)) return sourceViews.length
    return sourceViews.length
  })()

  const unmatchedOfficialQualityCount = isQualityMetric
    ? countUnmatchedOfficialQualityCases(getQualityBadCasesSync())
    : 0

  const stableDrawer = await resolveOverviewStableDrawerContext({
    preset: normalizedPreset,
    startDate: range.startDate,
    valueKey: def.valueKey,
    latestValueRaw: valueRaw ?? 0,
    overviewStableSnapshot: params.overviewStableSnapshot,
  })

  return {
    metric: params.metric,
    title: def.title,
    formulaText: def.formula,
    dateRange: {
      preset: params.preset,
      startDate: range.startDate,
      endDate: range.endDate,
    },
    summary: {
      totalOrders: totals.periodOrderCount,
      matchedOrders,
      value: valueRaw,
      valueRaw,
      valueText: formatValueText(params.metric, valueRaw),
      freightRefundAmount: totals.freightRefundAmount,
      productRefundAmount: totals.refundAmount,
      refundRelatedOrderCount: totals.refundOrderCount,
      refundWithAmountOrderCount: totals.refundWithAmountOrderCount,
      paidOrderCount: totals.orderCount,
      qualityRefundOrderCount: totals.qualityRefundOrderCount,
      unmatchedOfficialQualityCount,
      description: def.description,
      ...(stableDrawer
        ? {
            stableValueRaw: stableDrawer.stableValueRaw,
            latestValueRaw: stableDrawer.latestValueRaw,
            diffAmount: stableDrawer.diffAmount,
          }
        : {}),
    },
    tabs,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    rows,
    pageSummary: buildPageSummary(viewsForTotals),
    blacklistedBuyerIds: [...blacklist],
    source: 'local_db' as BoardDataSource,
    ...(stableDrawer
      ? {
          overviewStableWarning: stableDrawer.overviewStableWarning,
          overviewStableSnapshot: true,
        }
      : {}),
  }
}

export async function buildBuyerSummaryDrill(params: {
  summaryKey: 'highValue' | 'repurchase' | 'refund' | 'qualityHeavy'
  preset?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
  sort?: string
  anchorName?: string
}) {
  const { getBuyerRankingProfile } = await import('./buyer-ranking-cache.service')
  const { isHighValueBuyer, isRepurchaseBuyer, BUYER_SUMMARY_FORMULAS, BUYER_SUMMARY_EMPTY } =
    await import('./buyer-ranking-classification')
  const { isRefundRankingBuyer, isQualityRankingBuyer } = await import('./buyer-ranking-tab-filters')

  const profile = await getBuyerRankingProfile()
  const allItems = profile?.items ?? []

  const titles: Record<string, string> = {
    highValue: '高价值客户',
    repurchase: '复购客户',
    refund: '退款客户',
    qualityHeavy: '品退客户',
  }

  const filterMap: Record<string, (i: import('./buyer-ranking.service').BuyerRankingItem) => boolean> = {
    highValue: isHighValueBuyer,
    repurchase: isRepurchaseBuyer,
    refund: isRefundRankingBuyer,
    qualityHeavy: isQualityRankingBuyer,
  }

  let items = allItems.filter(filterMap[params.summaryKey] ?? (() => true))
  const sort = params.sort ?? 'signedAmount'
  const dir = -1
  items = [...items].sort((a, b) => {
    if (sort === 'orderCount') return (a.orderCount - b.orderCount) * dir
    if (sort === 'refundAmount') return (a.productRefundAmount - b.productRefundAmount) * dir
    if (sort === 'signedCount') return (a.signedOrderCount - b.signedOrderCount) * dir
    return (a.signedAmount - b.signedAmount) * dir
  })

  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))
  const total = items.length
  const slice = items.slice((page - 1) * pageSize, page * pageSize)

  return {
    summaryKey: params.summaryKey,
    title: titles[params.summaryKey] ?? '客户明细',
    formula: BUYER_SUMMARY_FORMULAS[params.summaryKey] ?? '',
    emptyMessage: BUYER_SUMMARY_EMPTY[params.summaryKey] ?? '暂无客户',
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    items: slice,
  }
}
