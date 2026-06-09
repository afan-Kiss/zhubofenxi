import type { UserRole } from '../types/roles'
import type { AnalyzedOrderView } from '../types/analysis'
import { buildBuyerRanking, type BuyerRankingType } from './buyer-ranking.service'
import { loadBuyerRankingWithAutoFill } from './buyer-ranking-fill.service'
import { mapViewToBoardOrderRow } from './order-row-mapper.service'
import { paginatedResponse, clampPagination } from '../utils/pagination'
import { normalizeBoardPreset } from './board-metrics.service'
import { resolveBusinessRange } from '../utils/business-range'
import { getOrBuildBusinessBoardCache } from './business-cache.service'
import {
  isStaffUnbound,
  staffAnchorFilter,
  staffScopeMeta,
  STAFF_UNBOUND_MESSAGE,
  filterViewsForStaffScope,
  resolveStaffAnchorScope,
} from './staff-anchor-scope.service'
import type { BuyerRankingProfilePayload } from './buyer-ranking-cache.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { buildRawAnalyzeBundleAll } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { resolveBuyerIdentityFromView } from './buyer-identity.service'
import { buildBuyerRankingTabSummary } from './buyer-ranking-tab-filters'

export { staffAnchorFilter } from './staff-anchor-scope.service'

function filterBoardOrderViews(
  views: AnalyzedOrderView[],
  q: {
    anchorName?: string
    buyerId?: string
    orderId?: string
    statusType?: string
  },
  forcedAnchor?: string,
): AnalyzedOrderView[] {
  let list = [...views]
  if (forcedAnchor) {
    list = list.filter((v) => v.anchorName === forcedAnchor)
  } else {
    const anchor = q.anchorName?.trim()
    if (anchor && anchor !== '全部') {
      list = list.filter((v) => v.anchorName === anchor || v.anchorName.includes(anchor))
    }
  }
  const buyer = q.buyerId?.trim()
  if (buyer) {
    list = list.filter((v) => v.buyerId.includes(buyer))
  }
  const orderSearch = q.orderId?.trim()
  if (orderSearch) {
    list = list.filter(
      (v) =>
        v.orderId.includes(orderSearch) ||
        v.bizOrderId.includes(orderSearch) ||
        v.packageId.includes(orderSearch) ||
        v.matchOrderId.includes(orderSearch) ||
        (v.displayOrderNo ?? '').includes(orderSearch) ||
        (v.officialOrderNo ?? '').includes(orderSearch),
    )
  }
  switch (q.statusType) {
    case 'signed':
      list = list.filter((v) => v.isActualSigned)
      break
    case 'returned':
      list = list.filter((v) => v.isRealProductRefund || v.isReturnRefund)
      break
    case 'freight_refund':
      list = list.filter((v) => v.isFreightRefundOnly)
      break
    case 'quality_return':
      list = list.filter((v) => v.isQualityReturn)
      break
    case 'refund_only':
      list = list.filter((v) => v.isRefundOnly)
      break
    case 'after_sale_closed':
      list = list.filter((v) => v.afterSaleClosedNoRefund)
      break
    default:
      break
  }
  return list
}

export async function getBoardOrders(
  q: {
    preset?: string
    startDate?: string
    endDate?: string
    anchorName?: string
    statusType?: string
    buyerId?: string
    orderId?: string
    page?: number
    pageSize?: number
  },
  role: UserRole,
  username: string,
) {
  if (isStaffUnbound(role, username)) {
    const { page, pageSize } = clampPagination(q.page, q.pageSize)
    return {
      ...paginatedResponse([], page, pageSize, 0),
      message: STAFF_UNBOUND_MESSAGE,
      staffUnbound: true,
      ...staffScopeMeta(role, username),
    }
  }
  const forcedAnchor = staffAnchorFilter(role, username)
  const preset = normalizeBoardPreset(q.preset ?? 'thisMonth')
  const range = resolveBusinessRange(preset as import('../utils/business-range').BusinessRangePreset, q.startDate, q.endDate)
  const cached = await getOrBuildBusinessBoardCache({
    preset: q.preset ?? 'thisMonth',
    startDate: range.startDate,
    endDate: range.endDate,
  })
  const views = cached.views
  const rawByMatch = cached.rawByMatch

  const filtered = filterBoardOrderViews(
    views,
    {
      anchorName: forcedAnchor ? undefined : q.anchorName,
      buyerId: q.buyerId,
      orderId: q.orderId,
      statusType: q.statusType,
    },
    forcedAnchor,
  )

  const rows = filtered.map((v) => {
    const raw = rawByMatch.get(v.matchOrderId || v.orderId)
    const row = mapViewToBoardOrderRow(
      Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
    )
    return {
      orderNo: row.orderNo,
      displayOrderNo: row.displayOrderNo,
      officialOrderNo: row.officialOrderNo,
      orderTime: row.orderTime,
      signTime: row.signTime,
      anchorName: row.anchorName,
      buyerNickname: row.buyerNickname,
      buyerId: row.buyerId,
      productName: row.productName,
      payAmount: row.payAmount,
      refundAmount: row.refundAmount,
      productRefundAmount: row.productRefundAmount,
      freightRefundAmount: row.freightRefundAmount,
      actualAmount: row.actualAmount,
      signedAmount: row.signedAmount,
      orderStatus: row.orderStatus,
      afterSaleStatus: row.afterSaleStatus,
      afterSaleReason: row.afterSaleReason,
      afterSaleDisplayType: row.afterSaleDisplayType,
      statusText: row.statusText,
    }
  })

  rows.sort((a, b) => String(b.orderTime).localeCompare(String(a.orderTime)))

  const { page, pageSize } = clampPagination(q.page, q.pageSize)
  const total = rows.length
  const items = rows.slice((page - 1) * pageSize, page * pageSize)

  return paginatedResponse(items, page, pageSize, total)
}

export async function getBoardBuyerRanking(
  params: Parameters<typeof buildBuyerRanking>[0] & {
    rankingTab?: string
    syncJobId?: string
  },
  autoFill: boolean,
  userId: string | null,
  role: UserRole,
  username: string,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
) {
  const forcedAnchor = staffAnchorFilter(role, username)
  const type: BuyerRankingType = 'all'
  const query = {
    ...params,
    type,
    rankingTab: params.rankingTab,
    anchorName: forcedAnchor ?? params.anchorName,
    anchorId: params.anchorId,
  }

  if (autoFill) {
    return loadBuyerRankingWithAutoFill({
      ...query,
      triggeredBy: userId,
      audit,
    })
  }
  const ranking = await buildBuyerRanking(query)
  return { status: 'ready' as const, ranking }
}

export async function filterBuyerProfileForStaff(
  profile: BuyerRankingProfilePayload | null,
  role: UserRole,
  username: string,
): Promise<BuyerRankingProfilePayload | null> {
  const scope = resolveStaffAnchorScope(role, username)
  if (scope.kind === 'all') return profile
  if (!profile) return profile

  if (scope.kind === 'unbound') {
    return {
      ...profile,
      items: [],
      summary: {
        highValueCount: 0,
        repurchaseCount: 0,
        refundCount: 0,
        qualityHeavyCount: 0,
        blacklistCount: 0,
      },
      buyerCount: 0,
      orderCount: 0,
      ...staffScopeMeta(role, username),
    }
  }

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    return { ...profile, items: [], buyerCount: 0 }
  }
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const anchorViews = filterViewsForStaffScope(artifacts.views, role, username)
  const buyerKeys = new Set<string>()
  for (const v of anchorViews) {
    const id = resolveBuyerIdentityFromView(v)
    if (id?.buyerKey) buyerKeys.add(id.buyerKey)
  }
  const items = profile.items.filter((i) => buyerKeys.has(i.buyerKey))
  return {
    ...profile,
    items,
    summary: buildBuyerRankingTabSummary(items),
    buyerCount: items.length,
    ...staffScopeMeta(role, username),
  }
}
