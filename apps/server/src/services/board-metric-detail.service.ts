import type { UserRole } from '../types/roles'
import type { AnalyzedOrderView } from '../types/analysis'
import { mapViewToBoardDrillRow, type BoardDrillOrderRow } from './order-row-mapper.service'
import { normalizeBoardPreset } from './board-metrics.service'
import { formatCount, formatRate, formatYuan } from '../utils/money'
import { dedupeViewsByMetricOrderNo } from './calc-refund-rate.service'
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

export type BoardMetricKey =
  | 'gmv'
  | 'effectiveGmv'
  | 'actualSignedAmount'
  | 'signedCount'
  | 'signRate'
  | 'returnAmount'
  | 'returnCount'
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
    title: '有效成交额',
    formula: '有效成交额 = 支付金额 − 已取消/已关闭支付订单金额',
    description: '本期已支付且未取消/关闭的成交额合计。',
    valueKey: 'effectiveGmv',
  },
  actualSignedAmount: {
    title: '实际签收金额',
    formula: '实际签收金额 = 已签收/已完成订单 max(支付金额−有效成功退款, 0) 合计',
    description: '仅统计有效签收订单（签收净额>0）。',
    valueKey: 'actualSignedAmount',
  },
  signedCount: {
    title: '签收单数',
    formula: '签收单数 = 有效签收订单数（已签收且签收净额>0）',
    description: '已签收/已完成且扣除全额退款后仍有净额的订单。',
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
  qualityReturnCount: {
    title: '品退单数',
    formula: '品退单数 = 命中官方品质负反馈或严格商品问题售后的唯一 P 单号数量',
    description:
      '来自官方品质负反馈明细接口 + 售后商品问题逻辑交叉识别，按 P 单号去重。同一 P 单号多条反馈只计 1 单。',
    valueKey: 'qualityReturnCount',
  },
  qualityReturnRate: {
    title: '品退率',
    formula: '品退率 = 品退订单数 ÷ 支付订单数',
    description:
      '数据来源：小红书官方品质负反馈接口 + 售后接口交叉印证。官方接口当前覆盖近 30 天，超出范围使用历史缓存和售后原因辅助识别。',
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
      return views.filter((v) => v.effectiveGmvCent > 0 || v.includedInGmv)
    case 'actualSignedAmount':
    case 'signedCount':
      if (tab === 'unsigned') return views.filter((v) => !isEffectiveSignedView(v))
      return views.filter((v) => isEffectiveSignedView(v))
    case 'signRate':
      if (tab === 'unsigned') return views.filter((v) => !isEffectiveSignedView(v))
      return views.filter((v) => isEffectiveSignedView(v))
    case 'returnAmount':
    case 'returnCount':
    case 'returnRate':
      return views.filter((v) => viewCountsAsRefundOrder(v))
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
    afterSaleRecordCount: m.afterSaleRecordCount,
    qualityReturnCount: m.qualityRefundOrderCount,
    returnAmount: m.refundAmount,
    productRefundAmount: m.refundAmount,
    freightRefundAmount: m.freightRefundAmount,
  }
}

function sortRows(rows: BoardDrillOrderRow[], sort: string): BoardDrillOrderRow[] {
  const list = [...rows]
  if (sort === 'amount_desc') {
    list.sort((a, b) => b.payAmount - a.payAmount)
  } else if (sort === 'refund_desc') {
    list.sort((a, b) => b.productRefundAmount - a.productRefundAmount)
  } else {
    list.sort((a, b) => b.orderTime.localeCompare(a.orderTime))
  }
  return list
}

function formatValueText(metric: BoardMetricKey, value: number): string {
  if (metric.includes('Rate') || metric === 'signRate' || metric === 'qualityReturnRate') {
    return formatRate(value)
  }
  if (
    metric === 'orderCount' ||
    metric === 'signedCount' ||
    metric === 'returnCount' ||
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

  let views = filterViewsForCoreMetrics(scoped.views)
  if (anchorId || anchorName) {
    views = filterViewsByAnchorSpec(views, anchorId, anchorName)
  }
  const rawByMatch = scoped.rawByMatch
  const range = scoped.range
  const totals = calculateBusinessMetrics(views)
  const valueRaw = pickMetricValue(totals, def.valueKey)
  const isQualityMetric =
    params.metric === 'qualityReturnCount' || params.metric === 'qualityReturnRate'
  let sourceViews = matchMetricViews(views, params.metric, params.tab)
  if (isQualityMetric) {
    sourceViews = dedupeViewsByMetricOrderNo(sourceViews)
  }
  const blacklist = buildBlacklistedBuyerIds(views)

  const allRows = sortRows(
    sourceViews.map((v) => {
      const raw = rawByMatch.get(v.matchOrderId || v.orderId)
      const row = mapViewToBoardDrillRow(
        Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
        { useBuyerRefund: true },
      )
      const blocked = blacklist.has(row.buyerKey)
      return { ...row, isBlacklistedBuyer: blocked }
    }),
    params.sort ?? 'time_desc',
  )

  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))
  const total = allRows.length
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize)

  const tabs =
    params.metric === 'signRate' || params.metric === 'signedCount'
      ? [
          { key: 'signed', label: '已签收', count: views.filter((v) => isEffectiveSignedView(v)).length },
          {
            key: 'unsigned',
            label: '未签收/售后',
            count: views.filter((v) => !isEffectiveSignedView(v)).length,
          },
        ]
      : []

  const unmatchedOfficialQualityCount = isQualityMetric
    ? countUnmatchedOfficialQualityCases(getQualityBadCasesSync())
    : 0

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
      matchedOrders: isQualityMetric
        ? totals.qualityRefundOrderCount
        : sourceViews.length,
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
    },
    tabs,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    rows,
    pageSummary: buildPageSummary(views),
    blacklistedBuyerIds: [...blacklist],
    source: 'live_api' as const,
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
