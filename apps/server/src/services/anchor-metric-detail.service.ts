import type { UserRole } from '../types/roles'
import { normalizeBoardPreset } from './board-metrics.service'
import type { DateRangePreset } from '../utils/date-range'
import { getAnchorConfigSync } from './anchor.service'
import { dedupeViewsByMetricOrderNo } from './calc-refund-rate.service'
import { buildOrderMetricSets } from './order-metric-sets.service'
import { mapViewToBoardOrderRow, type BoardOrderRow } from './order-row-mapper.service'
import type { AnalyzedOrderView } from '../types/analysis'
import { isQualityRefundOrder, viewCountsAsPaidOrder } from './business-metrics.service'
import { countUnmatchedOfficialQualityCases, getQualityBadCasesSync } from './quality-badcase-store.service'
import { isEffectiveSignedView } from './strict-after-sale-metrics.service'
import {
  assertStaffAnchorAccess,
  isStaffUnbound,
  STAFF_UNBOUND_MESSAGE,
} from './staff-anchor-scope.service'
import { getBoardScopedViewsForRange, getAnchorPerformanceViews } from './board-scoped-views.service'
import { viewBelongsToAnchor } from './anchor-attribution.util'

export type AnchorMetricType = 'qualityRefundRate' | 'signRate'

function assertAnchorAccess(
  role: UserRole,
  username: string,
  anchorId: string,
  anchorName: string,
): void {
  assertStaffAnchorAccess(role, username, anchorId, anchorName)
}

function resolveAnchor(anchorId: string): { id: string; name: string } {
  const config = getAnchorConfigSync()
  const byId = config.anchors.find((a) => a.id === anchorId)
  if (byId) return { id: byId.id, name: byId.name }
  const byName = config.anchors.find((a) => a.name === anchorId)
  if (byName) return { id: byName.id, name: byName.name }
  return { id: anchorId, name: anchorId }
}

function filterAnchorViews(
  views: AnalyzedOrderView[],
  anchor: { id: string; name: string },
): AnalyzedOrderView[] {
  return views.filter((v) => viewBelongsToAnchor(v, { anchorId: anchor.id, anchorName: anchor.name }))
}

function afterSaleMatch(v: AnalyzedOrderView, afterSaleType: string): boolean {
  if (afterSaleType === 'refund_only') return v.isRefundOnly && !v.isFreightRefundOnly
  if (afterSaleType === 'return_refund') return v.isReturnRefund
  if (afterSaleType === 'freight') return v.isFreightRefundOnly
  if (afterSaleType === 'quality_issue') return isQualityRefundOrder(v)
  return true
}

function sortRows(rows: BoardOrderRow[], sort: string): BoardOrderRow[] {
  const list = [...rows]
  if (sort === 'amount_desc') {
    list.sort((a, b) => b.payAmount - a.payAmount)
  } else {
    list.sort((a, b) => b.orderTime.localeCompare(a.orderTime))
  }
  return list
}

export async function buildAnchorMetricDetail(params: {
  anchorId: string
  metric: AnchorMetricType
  startDate: string
  endDate: string
  page?: number
  pageSize?: number
  tab?: string
  sort?: string
  afterSaleType?: string
  role: UserRole
  username: string
}) {
  const anchor = resolveAnchor(params.anchorId)
  assertAnchorAccess(params.role, params.username, anchor.id, anchor.name)

  if (isStaffUnbound(params.role, params.username)) {
    throw new Error(STAFF_UNBOUND_MESSAGE)
  }

  const { views, rawByMatch } = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    role: params.role,
    username: params.username,
  })
  const performanceViews = getAnchorPerformanceViews(views, rawByMatch)
  const anchorViews = filterAnchorViews(performanceViews, anchor)
  const paidViews = anchorViews.filter((v) => viewCountsAsPaidOrder(v))
  const metricSets = buildOrderMetricSets(
    paidViews,
    { scope: 'anchor-metric', anchorId: anchor.id, anchorName: anchor.name },
    getQualityBadCasesSync(),
  )
  const paidOrderCount = metricSets.paidOrderCount

  const qualityViews = dedupeViewsByMetricOrderNo(paidViews.filter((v) => isQualityRefundOrder(v)))
  const signedViews = paidViews.filter((v) => isEffectiveSignedView(v))
  const unsignedViews = paidViews.filter((v) => !isEffectiveSignedView(v))

  const isSign = params.metric === 'signRate'
  const matchedCount = isSign ? metricSets.signedOrderCount : metricSets.qualityRefundOrderCount
  const rate = paidOrderCount > 0 ? matchedCount / paidOrderCount : 0

  const title = isSign ? '签收率' : '品退率'
  const formulaText = isSign
    ? '签收率 = 有效签收订单数 ÷ 支付订单数'
    : '品退率 = 品退订单数 ÷ 支付订单数'

  let sourceViews: AnalyzedOrderView[] = []
  if (isSign) {
    if (params.tab === 'unsigned') sourceViews = unsignedViews
    else sourceViews = signedViews
  } else {
    sourceViews = qualityViews.filter((v) => afterSaleMatch(v, params.afterSaleType ?? 'all'))
  }

  const allRows = sortRows(
    sourceViews.map((v) => {
      const raw = rawByMatch.get(v.matchOrderId || v.orderId)
      return mapViewToBoardOrderRow(
        Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
        { useBuyerRefund: true },
      )
    }),
    params.sort ?? 'time_desc',
  )

  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))
  const total = allRows.length
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize)

  const tabs = isSign
    ? [
        { key: 'signed', label: '已签收订单', count: signedViews.length },
        { key: 'unsigned', label: '未签收 / 售后订单', count: unsignedViews.length },
      ]
    : [{ key: 'qualityRefund', label: '品退订单', count: qualityViews.length }]

  return {
    metric: params.metric,
    title,
    formulaText,
    summary: {
      totalOrders: paidOrderCount,
      matchedOrders: matchedCount,
      rate,
      rateText: `${(rate * 100).toFixed(2)}%`,
      unmatchedOfficialQualityCount: isSign
        ? 0
        : countUnmatchedOfficialQualityCases(getQualityBadCasesSync()),
      description: isSign
        ? `本期共 ${paidOrderCount} 笔支付订单，其中 ${matchedCount} 笔有效签收，签收率为 ${(rate * 100).toFixed(2)}%。`
        : `本期共 ${paidOrderCount} 笔支付订单，其中 ${matchedCount} 笔品退订单，品退率为 ${(rate * 100).toFixed(2)}%。数据来源：官方品质负反馈接口 + 售后接口交叉印证。`,
    },
    tabs,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    rows,
  }
}
