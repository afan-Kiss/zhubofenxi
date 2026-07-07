import type { AnalyzedOrderView, NormalizedOrder } from '../types/analysis'
import { getBuyerRankingProfile } from './buyer-ranking-cache.service'
import {
  aggregateAnchorLeaderboard,
  type BoardAnchorMetrics,
} from './board-metrics.service'
import { buildBlacklistedBuyerIds } from './business-metrics.service'
import type { BuyerRankingItem } from './buyer-ranking.service'
import { anchorLeaderboardRowMatches } from './anchor-attribution.util'
import {
  getBoardScopedViewsForRange,
  getAnchorPerformanceViews,
  normalizeAnchorDrillQuery,
} from './board-scoped-views.service'
import { viewMatchesBuyerKey } from './buyer-identity.service'
import { buildBuyerProfileOrdersResponse } from './buyer-profile-orders.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import {
  buildRawAnalyzeBundle,
  buildRawAnalyzeBundleAll,
} from './xhs-api-sync/xhs-analysis-from-raw.service'
import {
  buyerRankingRangeToAnalysisRange,
  resolveBuyerRankingDateRange,
} from '../utils/buyer-ranking-date-range'
import { viewBelongsToAnchor } from './anchor-attribution.util'
import { getAnchorConfigSync } from './anchor.service'
import { resolveAnchorWeeklyRankingScope } from './anchor-buyer-weekly-ranking.service'
import { enrichBuyerOrderRowFromWorkbench } from './buyer-order-standard.service'
import { mapViewToBoardDrillRow } from './order-row-mapper.service'
import { isAfterSalesResultPending, shouldFetchInputFromView } from './after-sales-fetch-decision.service'
import {
  bootstrapWorkbenchCache,
  buildLiveAccountOrderQueries,
  getWorkbenchRefundFromMemory,
  loadAfterSalesBundleForOrderNos,
  loadWorkbenchRefundMapFromDb,
  mergeWorkbenchIntoMemory,
  type AfterSalesWorkbenchRefund,
} from './xhs-after-sales-workbench.service'
import { warmWorkbenchCacheForOrders } from './workbench-cache-warm.service'
import {
  formatAnchorLiveSessionsSummary,
  resolveAnchorLiveSessionsForRange,
} from './anchor-live-sessions.service'
import {
  resolveOriginalSessionsForAssignedAnchorRange,
  shouldUsePerShopRealLiveSessions,
} from './daily-report-live-sessions.service'
import {
  attachRawByMatchToViews,
  filterViewsForAnchorPerformance,
  filterViewsForBuyerRanking,
} from './low-price-brush-order.service'
import { filterViewsForCoreMetrics } from './metrics-exclusion.service'
import {
  aggregateQualityRefundByAnchor,
  type QualityRefundAnchorAttribution,
  resolveQualityRefundAnchorByOrderTime,
} from './quality-refund-anchor-attribution.service'
import { resolveQualityRefundInfo } from './quality-refund-resolution.service'
import { liveAccountOrderKey, liveAccountPackageKey } from '../utils/live-account-cache-key.util'
import {
  bootstrapQualityBadCaseCache,
  loadAllQualityBadCases,
} from './quality-badcase-store.service'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { loadAfterSalesTimeSearchByOrderNo } from './xhs-after-sales-time-search.service'
import { buildAfterSaleRecordsFromOfficialCase } from './quality-refund-cross-verify.service'
import type { UserRole } from '../types/roles'
import {
  assertStaffAnchorAccess,
  assertStaffBuyerKeyAccess,
  isStaffUnbound,
  STAFF_UNBOUND_MESSAGE,
} from './staff-anchor-scope.service'
import { isEffectiveSignedView } from './strict-after-sale-metrics.service'
import { dedupeViewsByMetricOrderNo } from './calc-refund-rate.service'

function shouldExposeSignedDrillTab(preset?: string): boolean {
  if (!preset || preset === 'yesterday' || preset === 'today') return false
  return preset === 'thisWeek' || preset === 'thisMonth' || preset === 'lastMonth' || preset === 'custom'
}

function pickAfterSaleString(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function pickAfterSaleReturnsId(rec: Record<string, unknown>): string {
  return pickAfterSaleString(rec, [
    'returns_id',
    'returnsId',
    'return_id',
    'returnId',
    'after_sale_id',
    'afterSaleId',
  ])
}

function pickAfterSaleReason(rec: Record<string, unknown>): string {
  return pickAfterSaleString(rec, [
    'reason_name_zh',
    'reasonNameZh',
    'reason_name',
    'reasonName',
    'reason',
    'refund_reason',
    'refundReason',
  ])
}

function pickAfterSaleStatus(rec: Record<string, unknown>): string {
  return pickAfterSaleString(rec, [
    'refund_status_name',
    'refundStatusName',
    'status_name',
    'statusName',
  ])
}

function pickAfterSaleRefundFeeYuan(rec: Record<string, unknown>): number {
  const fee = rec.refund_fee ?? rec.refundFee
  if (typeof fee === 'number' && fee > 0) return fee
  if (typeof fee === 'string' && fee.trim()) {
    const n = Number(fee)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

function pickAfterSaleRefundOkTime(rec: Record<string, unknown>): string {
  return pickAfterSaleString(rec, [
    'refund_ok_time',
    'refundOkTime',
    'refund_time',
    'refundTime',
    'update_at',
    'updateAt',
  ])
}

function afterSaleRecordCompleteness(rec: Record<string, unknown>): number {
  let score = 0
  if (pickAfterSaleReturnsId(rec)) score += 8
  if (pickAfterSaleReason(rec)) score += 4
  if (pickAfterSaleStatus(rec)) score += 2
  if (pickAfterSaleRefundFeeYuan(rec) > 0) score += 2
  if (pickAfterSaleRefundOkTime(rec)) score += 1
  return score
}

/** 合并两条售后 raw，保留字段更完整的一侧 */
function mergeAfterSaleRecordFields(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base, ...incoming }
  const returnsId = pickAfterSaleReturnsId(base) || pickAfterSaleReturnsId(incoming)
  if (returnsId) {
    out.returns_id = returnsId
    out.returnsId = returnsId
  }
  const reason = pickAfterSaleReason(incoming) || pickAfterSaleReason(base)
  if (reason) {
    out.reason_name_zh = reason
    out.reason_name = reason
  }
  const status = pickAfterSaleStatus(incoming) || pickAfterSaleStatus(base)
  if (status) out.refund_status_name = status
  const fee = pickAfterSaleRefundFeeYuan(incoming) || pickAfterSaleRefundFeeYuan(base)
  if (fee > 0) out.refund_fee = fee
  const okTime = pickAfterSaleRefundOkTime(incoming) || pickAfterSaleRefundOkTime(base)
  if (okTime) out.refund_ok_time = okTime
  return out
}

function workbenchToAfterSaleRecords(
  workbench: AfterSalesWorkbenchRefund | undefined,
): Record<string, unknown>[] {
  if (!workbench) return []
  const fromRaw: Record<string, unknown>[] = []
  const raw = workbench.rawDetail
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object') fromRaw.push(item as Record<string, unknown>)
    }
  } else if (raw && typeof raw === 'object') {
    fromRaw.push(raw as Record<string, unknown>)
  }
  if (fromRaw.length > 0) return fromRaw
  if (!workbench.returnsIds?.length) return []
  const feeYuan = workbench.officialRefundAmountCent / 100
  return workbench.returnsIds.map((rid) => ({
    returns_id: rid,
    refund_status_name: workbench.afterSaleStatus ?? '',
    reason_name_zh: workbench.afterSaleReason ?? '',
    reason_name: workbench.afterSaleReason ?? '',
    refund_fee: feeYuan > 0 ? feeYuan : undefined,
  }))
}

/** 品退 drill：合并工作台 / 时间查询 / 官方品退 / 内存工作台售后 raw，按售后单号去重 */
export function mergeQualityAfterSaleRecords(
  sources: Record<string, unknown>[][],
): Record<string, unknown>[] {
  const byReturnsId = new Map<string, Record<string, unknown>>()
  const noIdRecords: Record<string, unknown>[] = []

  for (const list of sources) {
    for (const rec of list) {
      if (!rec || typeof rec !== 'object') continue
      const rid = pickAfterSaleReturnsId(rec)
      if (rid) {
        const existing = byReturnsId.get(rid)
        if (!existing) {
          byReturnsId.set(rid, { ...rec })
          continue
        }
        const mergedA = mergeAfterSaleRecordFields(existing, rec)
        const mergedB = mergeAfterSaleRecordFields(rec, existing)
        byReturnsId.set(
          rid,
          afterSaleRecordCompleteness(mergedB) >= afterSaleRecordCompleteness(mergedA)
            ? mergedB
            : mergedA,
        )
      } else {
        noIdRecords.push({ ...rec })
      }
    }
  }

  if (byReturnsId.size > 0 && noIdRecords.length > 0) {
    for (const rec of noIdRecords) {
      let bestRid: string | null = null
      let bestGain = 0
      for (const [rid, existing] of byReturnsId) {
        const gain =
          afterSaleRecordCompleteness(mergeAfterSaleRecordFields(existing, rec)) -
          afterSaleRecordCompleteness(existing)
        if (gain > bestGain) {
          bestGain = gain
          bestRid = rid
        }
      }
      if (bestRid && bestGain > 0) {
        byReturnsId.set(
          bestRid,
          mergeAfterSaleRecordFields(byReturnsId.get(bestRid)!, rec),
        )
      }
    }
  }

  if (byReturnsId.size > 0) return [...byReturnsId.values()]
  return noIdRecords
}

function filterDrillViewsByStatus(
  views: AnalyzedOrderView[],
  statusType?: string,
): AnalyzedOrderView[] {
  if (statusType === 'all') return views
  return views.filter((v) => isEffectiveSignedView(v))
}

function filterBuyerViews(views: AnalyzedOrderView[], buyerId: string): AnalyzedOrderView[] {
  const key = buyerId.trim()
  if (!key) return []
  return views.filter((v) => viewMatchesBuyerKey(v, key))
}

function filterBuyerNormalizedOrders(
  orders: NormalizedOrder[],
  buyerKey: string,
): NormalizedOrder[] {
  const key = buyerKey.trim()
  if (!key) return []
  return orders.filter((o) => {
    const raw = o.raw as Record<string, unknown> | undefined
    const k = raw?._buyerKey != null ? String(raw._buyerKey).trim() : ''
    return k === key
  })
}

function sortDrillRows(
  rows: ReturnType<typeof mapViewToBoardDrillRow>[],
  sort: string,
): ReturnType<typeof mapViewToBoardDrillRow>[] {
  const list = [...rows]
  if (sort === 'amount_desc') {
    list.sort((a, b) => b.payAmount - a.payAmount)
  } else {
    list.sort((a, b) => b.orderTime.localeCompare(a.orderTime))
  }
  return list
}

export async function buildAnchorDrill(params: {
  preset?: string
  anchorId?: string
  anchorName?: string
  startDate: string
  endDate: string
  page?: number
  pageSize?: number
  sort?: string
  statusType?: string
  role?: UserRole
  username?: string
}) {
  if (params.role && params.username && isStaffUnbound(params.role, params.username)) {
    throw new Error(STAFF_UNBOUND_MESSAGE)
  }

  const anchorQuery = normalizeAnchorDrillQuery({
    anchorId: params.anchorId,
    anchorName: params.anchorName,
  })

  if (params.role && params.username) {
    assertStaffAnchorAccess(
      params.role,
      params.username,
      anchorQuery.anchorId,
      anchorQuery.anchorName,
    )
  }

  const scoped = await getBoardScopedViewsForRange({
    preset: params.preset ?? 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    role: params.role,
    username: params.username,
  })

  const performanceScoped = await getAnchorPerformanceViews(
    scoped.views,
    scoped.rawByMatch,
    anchorQuery.anchorId,
    anchorQuery.anchorName,
  )

  const anchorViews = performanceScoped
  const dedupedAnchorViews = dedupeViewsByMetricOrderNo(anchorViews)
  const dedupedSignedViews = dedupeViewsByMetricOrderNo(
    anchorViews.filter((v) => isEffectiveSignedView(v)),
  )
  const statusType = params.statusType ?? 'all'
  const drillViews = statusType === 'signed' ? dedupedSignedViews : dedupedAnchorViews
  const signedCount = dedupedSignedViews.length
  const allOrderCount = dedupedAnchorViews.length
  const leaderboard = aggregateAnchorLeaderboard(performanceScoped)
  const stats =
    leaderboard.find((a) =>
      anchorLeaderboardRowMatches(a, {
        anchorId: anchorQuery.anchorId,
        anchorName: anchorQuery.anchorName,
      }),
    ) ??
    (anchorViews.length > 0 ? aggregateAnchorLeaderboard(anchorViews)[0] : null)

  const blacklist = buildBlacklistedBuyerIds(anchorViews)
  const allRows = sortDrillRows(
    drillViews.map((v) => {
      const raw = scoped.rawByMatch.get(v.matchOrderId || v.orderId)
      const bid = v.buyerId?.trim() ?? ''
      const row = mapViewToBoardDrillRow(
        Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
        { useBuyerRefund: true },
      )
      const blocked =
        blacklist.has(bid) || blacklist.has(`nick:${row.buyerNickname}`)
      return { ...row, isBlacklistedBuyer: blocked }
    }),
    params.sort ?? 'time_desc',
  )

  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))
  const total = allRows.length
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize)

  const isSingleDay =
    params.startDate.trim() === params.endDate.trim() && Boolean(params.startDate.trim())
  const useOriginalLiveSessions =
    isSingleDay && shouldUsePerShopRealLiveSessions(params.startDate, params.endDate)

  const liveSessions = useOriginalLiveSessions
    ? await resolveOriginalSessionsForAssignedAnchorRange({
        startDate: params.startDate,
        endDate: params.endDate,
        anchorName: anchorQuery.anchorName ?? '',
      })
    : await resolveAnchorLiveSessionsForRange({
        preset: params.preset,
        startDate: params.startDate,
        endDate: params.endDate,
        anchorId: anchorQuery.anchorId,
        anchorName: anchorQuery.anchorName,
        anchorOrders: anchorViews,
      })

  return {
    anchorId: stats?.anchorId ?? anchorQuery.anchorId ?? '',
    anchorName: stats?.anchorName ?? anchorQuery.anchorName ?? '',
    stats: stats as BoardAnchorMetrics | null,
    liveSessions,
    liveSummaryText: formatAnchorLiveSessionsSummary(liveSessions),
    blacklistedBuyerIds: [...blacklist],
    tabs: shouldExposeSignedDrillTab(params.preset)
      ? [
          { key: 'all', label: '全部订单', count: allOrderCount },
          { key: 'signed', label: '实际签收', count: signedCount },
        ]
      : [{ key: 'all', label: '全部订单', count: allOrderCount }],
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    rows,
  }
}

function qualityAttributionMatchesAnchor(
  attr: QualityRefundAnchorAttribution,
  query: { anchorId?: string; anchorName?: string },
): boolean {
  if (query.anchorName === '未归属') {
    return attr.anchorName === '未归属'
  }
  return anchorLeaderboardRowMatches(
    { anchorId: attr.anchorId, anchorName: attr.anchorName },
    query,
  )
}

export async function buildAnchorQualityRefundDrill(params: {
  preset?: string
  anchorId?: string
  anchorName?: string
  startDate: string
  endDate: string
  page?: number
  pageSize?: number
  role?: UserRole
  username?: string
}) {
  if (params.role && params.username && isStaffUnbound(params.role, params.username)) {
    throw new Error(STAFF_UNBOUND_MESSAGE)
  }

  const anchorQuery = normalizeAnchorDrillQuery({
    anchorId: params.anchorId,
    anchorName: params.anchorName,
  })

  if (params.role && params.username) {
    assertStaffAnchorAccess(
      params.role,
      params.username,
      anchorQuery.anchorId,
      anchorQuery.anchorName,
    )
  }

  const scoped = await getBoardScopedViewsForRange({
    preset: params.preset ?? 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    role: params.role,
    username: params.username,
  })

  const coreViews = filterViewsForCoreMetrics(scoped.views)
  const performanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)

  const range = resolveDateRange(
    (params.preset ?? 'custom') as DateRangePreset,
    params.startDate,
    params.endDate,
  )
  const liveBundle = await buildRawAnalyzeBundle(range)
  const liveSessions = liveBundle?.liveSessions ?? []

  const agg = aggregateQualityRefundByAnchor({ views: coreViews, liveSessions })
  const matched = agg.attributions.filter((attr) =>
    qualityAttributionMatchesAnchor(attr, anchorQuery),
  )

  const resolveQualityCountForAnchor = (): number => {
    if (anchorQuery.anchorName === '未归属') {
      return agg.unassigned.length
    }
    const name = anchorQuery.anchorName?.trim()
    if (name) {
      let total = 0
      for (const bucket of agg.byAnchorKey.values()) {
        if (bucket.anchorName === name) total += bucket.count
      }
      return total
    }
    return matched.length
  }
  const qualityReturnCountForAnchor = resolveQualityCountForAnchor()

  const orderQueries = buildLiveAccountOrderQueries(
    matched.map((attr) => ({
      liveAccountId: attr.view.liveAccountId,
      displayOrderNo: attr.orderNo,
      packageId: attr.view.packageId,
      officialOrderNo: attr.view.officialOrderNo,
    })),
  )
  await bootstrapWorkbenchCache()
  const { rawAfterSalesByOrderNo } = await loadAfterSalesBundleForOrderNos(orderQueries)
  const timeSearchMap = await loadAfterSalesTimeSearchByOrderNo(range, orderQueries)
  await bootstrapQualityBadCaseCache()
  const officialCases = await loadAllQualityBadCases()
  const officialByOrderKey = new Map(
    officialCases.flatMap((c) => {
      const keys = [
        liveAccountPackageKey(c.liveAccountId, c.packageId),
        c.matchedOrderNo
          ? liveAccountPackageKey(c.liveAccountId, c.matchedOrderNo)
          : '',
      ].filter(Boolean)
      return keys.map((k) => [k, c] as const)
    }),
  )

  const leaderboard = aggregateAnchorLeaderboard(performanceViews, undefined, {
    liveSessions,
    qualityRefundViews: coreViews,
  })
  const leaderboardRow = leaderboard.find((a) => anchorLeaderboardRowMatches(a, anchorQuery))
  const stats =
    leaderboardRow != null
      ? { ...leaderboardRow, qualityReturnCount: qualityReturnCountForAnchor }
      : matched.length > 0
        ? {
            anchorId: anchorQuery.anchorId ?? matched[0]?.anchorId ?? '',
            anchorName: anchorQuery.anchorName ?? matched[0]?.anchorName ?? '',
            qualityReturnCount: qualityReturnCountForAnchor,
          }
        : qualityReturnCountForAnchor > 0
          ? {
              anchorId: anchorQuery.anchorId ?? '',
              anchorName: anchorQuery.anchorName ?? '',
              qualityReturnCount: qualityReturnCountForAnchor,
            }
          : null

  const allRows = matched
    .map((attr) => {
      const raw = scoped.rawByMatch.get(attr.view.matchOrderId || attr.view.orderId)
      const buyerNickname = String(
        (raw as Record<string, unknown> | undefined)?._buyerNickname ??
          attr.view.buyerId ??
          '',
      )
      const cacheKey = liveAccountOrderKey(attr.view.liveAccountId, attr.orderNo)
      const officialCase = officialByOrderKey.get(
        liveAccountPackageKey(attr.view.liveAccountId, attr.orderNo),
      )
      const workbench = getWorkbenchRefundFromMemory(attr.view.liveAccountId, attr.orderNo)
      const fromOfficialCase = buildAfterSaleRecordsFromOfficialCase(officialCase, attr.view)
      const mergedAfterSaleRecords = mergeQualityAfterSaleRecords([
        rawAfterSalesByOrderNo.get(cacheKey) ?? [],
        timeSearchMap.get(cacheKey) ?? [],
        fromOfficialCase,
        workbenchToAfterSaleRecords(workbench),
      ])
      const qualityInfo = resolveQualityRefundInfo({
        view: attr.view,
        afterSaleRecords: mergedAfterSaleRecords,
        officialCase,
        verifySource: 'after_sale_workbench',
      })
      const attrWithAfterSale = resolveQualityRefundAnchorByOrderTime({
        view: attr.view,
        liveSessions,
        afterSaleRecords: mergedAfterSaleRecords,
      })
      const anchorNameResolved = attrWithAfterSale?.anchorName ?? attr.anchorName
      return {
        orderNo: attr.orderNo,
        buyerNickname,
        orderTime: attr.orderTimeText,
        qualityAttributionAnchorName: anchorNameResolved,
        matchedLiveSessionStart: attr.matchedLiveStartTime,
        matchedLiveSessionEnd: attr.matchedLiveEndTime,
        qualityMainSource: qualityInfo.qualityMainSource,
        qualitySourceLabel: qualityInfo.verifyDisplayLabel,
        officialQualityReasonText: qualityInfo.officialQualityReasonText,
        qualityReasonText: qualityInfo.officialQualityReasonText || qualityInfo.qualityReasonText,
        afterSaleOrderNo: qualityInfo.afterSaleOrderNo,
        afterSaleStatus: qualityInfo.afterSaleStatus,
        afterSaleReasonText: qualityInfo.afterSaleReasonText,
        afterSaleFinalReasonText: qualityInfo.afterSaleFinalReasonText,
        afterSaleRefundAmountYuan: qualityInfo.afterSaleRefundAmountCent / 100,
        afterSaleReasonChanged: qualityInfo.afterSaleReasonChanged,
        extraHint: qualityInfo.extraHint,
        isQualityRefund: qualityInfo.isQualityRefund,
        qianfanDetailAvailable: Boolean(attr.orderNo?.trim()),
        qualityUnassignedReason: attr.unassignedReason,
        paymentAnchorName: attr.paymentAnchorName,
      }
    })
    .sort((a, b) => b.orderTime.localeCompare(a.orderTime))

  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 20)))
  const total = allRows.length
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize)

  return {
    anchorId: stats && 'anchorId' in stats ? stats.anchorId : anchorQuery.anchorId ?? '',
    anchorName:
      stats && 'anchorName' in stats ? stats.anchorName : anchorQuery.anchorName ?? '',
    attributionNote:
      '品退按下单时所在直播场次归属，方便追当场讲品和售后问题；与支付归属可能不同。',
    stats: stats as BoardAnchorMetrics | Record<string, unknown> | null,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    rows,
  }
}

export async function buildBuyerProfileDrill(params: {
  buyerId: string
  buyerKey?: string
  page?: number
  pageSize?: number
  sort?: string
  tab?: string
  role?: UserRole
  username?: string
  weeklyScope?: {
    startDate: string
    endDate: string
    anchorName?: string
    source?: 'anchor_weekly_ranking' | 'bad_buyer_ranking'
  }
}) {
  const isWeeklyScope = params.weeklyScope?.source === 'anchor_weekly_ranking'
  const isBadBuyerScope = params.weeklyScope?.source === 'bad_buyer_ranking'
  const isRangeScope = isWeeklyScope || isBadBuyerScope

  if (isWeeklyScope && params.role && params.username) {
    const scope = resolveAnchorWeeklyRankingScope(
      params.role,
      params.username,
      params.weeklyScope?.anchorName,
    )
    if (scope.mode === 'unbound') {
      throw new Error(scope.message)
    }
  } else if (params.role && params.username && isStaffUnbound(params.role, params.username)) {
    throw new Error(STAFF_UNBOUND_MESSAGE)
  }

  const profile = isRangeScope ? null : await getBuyerRankingProfile()
  const buyerKey = (params.buyerKey ?? params.buyerId).trim()
  const cachedStats: BuyerRankingItem | null = isRangeScope
    ? null
    : (profile?.items.find((i) => i.buyerKey === buyerKey) ??
      profile?.items.find((i) => i.buyerId === buyerKey) ??
      null)

  const bundle = isRangeScope
    ? await buildRawAnalyzeBundle(
        buyerRankingRangeToAnalysisRange(
          resolveBuyerRankingDateRange(
            'custom',
            params.weeklyScope!.startDate,
            params.weeklyScope!.endDate,
          ),
        ),
      )
    : await buildRawAnalyzeBundleAll()
  if (!bundle) {
    return {
      buyerId: params.buyerId,
      nickname: cachedStats?.nickname ?? params.buyerId,
      stats: cachedStats,
      source: 'buyer_profile_cache' as const,
      blacklistedBuyerIds: profile?.blacklistedBuyerIds ?? [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
      rows: [],
      needAfterSalesSync: false,
      pendingAfterSalesOrderNos: [] as string[],
    }
  }

  const buyerOrders = filterBuyerNormalizedOrders(bundle.orders, buyerKey)
  await bootstrapWorkbenchCache()
  const orderQueries = buildLiveAccountOrderQueries(buyerOrders).filter((q) =>
    /^P/i.test(q.orderNo),
  )
  if (orderQueries.length > 0) {
    const fromDb = await loadWorkbenchRefundMapFromDb(orderQueries)
    for (const [k, v] of fromDb) {
      const [accountId, orderNo] = k.split('::')
      mergeWorkbenchIntoMemory(accountId, orderNo, v)
    }
  }

  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const allViews = artifacts?.views ?? []
  if (params.role && params.username) {
    assertStaffBuyerKeyAccess(params.role, params.username, buyerKey, allViews)
  }
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  let buyerRankingViews = filterViewsForBuyerRanking(
    attachRawByMatchToViews(allViews, rawByMatch),
  )

  if (isWeeklyScope && params.weeklyScope?.anchorName) {
    const cfg = getAnchorConfigSync()
    const anchor = cfg.anchors.find((a) => a.name === params.weeklyScope!.anchorName)
    if (anchor) {
      buyerRankingViews = buyerRankingViews.filter((v) =>
        viewBelongsToAnchor(v, { anchorId: anchor.id, anchorName: anchor.name }),
      )
    } else {
      buyerRankingViews = buyerRankingViews.filter(
        (v) => v.anchorName === params.weeklyScope!.anchorName,
      )
    }
  }

  const buyerViews = filterBuyerViews(buyerRankingViews, buyerKey)
  const tab = params.tab ?? ''

  const ordersPayload = buildBuyerProfileOrdersResponse({
    buyerKey,
    allViews: buyerRankingViews,
    rawByMatch,
    cachedStats,
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
    tab,
  })

  const pendingAfterSalesOrderNos = [
    ...new Set(
      buyerViews
        .filter((v) => {
          const raw = rawByMatch.get(v.matchOrderId || v.orderId)
          const input = shouldFetchInputFromView(
            Object.assign({}, v, {
              raw,
            }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
          )
          const orderNo = (v.displayOrderNo || v.officialOrderNo || v.packageId || '').trim()
          const cached = orderNo
            ? getWorkbenchRefundFromMemory(v.liveAccountId, orderNo)
            : undefined
          return isAfterSalesResultPending(input, cached, v.buyerProductRefundSource)
        })
        .map((v) => v.displayOrderNo || v.officialOrderNo || v.packageId)
        .filter(Boolean),
    ),
  ]
  const needAfterSalesSync = pendingAfterSalesOrderNos.length > 0

  const blacklist = new Set(
    profile?.blacklistedBuyerIds ?? [...buildBlacklistedBuyerIds(buyerRankingViews)],
  )
  const stats = ordersPayload.stats
  const legacyRows = sortDrillRows(
    ordersPayload.rows.map((stdRaw) => {
      const v = buyerViews.find(
        (view) =>
          (view.displayOrderNo || view.officialOrderNo || view.packageId) === stdRaw.orderNo,
      )
      const raw = v ? rawByMatch.get(v.matchOrderId || v.orderId) : undefined
      const orderNo = stdRaw.orderNo
      const workbench = v
        ? getWorkbenchRefundFromMemory(v.liveAccountId, orderNo)
        : undefined
      const std = enrichBuyerOrderRowFromWorkbench(stdRaw, workbench ?? null, v)
      const row = mapViewToBoardDrillRow(
        Object.assign({}, v ?? {}, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
        { useBuyerRefund: true },
      )
      const blocked = blacklist.has(row.buyerKey) || Boolean(stats?.isBlacklisted)
      return {
        ...row,
        isBlacklistedBuyer: blocked,
        isQualityReturn: std.isQualityRefund,
        afterSaleReason: std.afterSaleReason,
        afterSaleReasonText: std.afterSaleReason,
        afterSaleStatus: std.afterSaleTypeLabel !== '—' ? std.afterSaleTypeLabel : std.afterSaleStatusText,
        afterSaleDisplayType: std.afterSaleTypeLabel,
        officialPaidAmount: std.payAmountCent > 0 ? std.payAmountCent / 100 : undefined,
        productTotalAmount: std.goodsAmountCent / 100,
        freightAmount: std.freightAmountCent / 100,
        receivableAmount: std.receivableAmountCent / 100,
        refundAmount: std.refundAmountCent / 100,
        productRefundAmount: std.refundAmountCent / 100,
        refundAmountPending: std.refundAmountPending,
        refundAmountSource: v?.buyerProductRefundSource?.trim() || undefined,
        refundSourceText: std.refundSourceText,
        cardStatusLabel: std.orderStatusLabel,
        orderStatusLabel: std.orderStatusLabel,
        afterSaleStatusLabel: std.afterSaleStatusLabel,
        afterSaleDisplayTone: std.afterSaleDisplayTone,
        hasEffectiveAfterSale: std.hasEffectiveAfterSale,
        payTime: std.payTime,
        signTime: std.signTime,
        afterSaleApplyTime: std.afterSaleApplyTime,
        afterSaleCompleteTime: std.afterSaleCompleteTime,
        netDealAmount: std.netDealAmountCent / 100,
        earnedAmount: std.earnedAmountCent / 100,
        afterSaleNo: std.afterSaleNo,
        isQualityRefund: std.isQualityRefund,
      }
    }),
    params.sort ?? 'time_desc',
  )

  const page = ordersPayload.pagination.page
  const pageSize = ordersPayload.pagination.pageSize
  const total = ordersPayload.pagination.total
  const rows = legacyRows

  const identityCode = stats?.buyerShortCode ?? stats?.buyerIdentityCode
  return {
    buyerKey: stats?.buyerKey ?? buyerKey,
    buyerId: stats?.buyerKey ?? buyerKey,
    officialBuyerId: stats?.buyerId,
    nickname: stats?.buyerDisplayName ?? stats?.nickname ?? params.buyerId,
    buyerDisplayName: stats?.buyerDisplayName ?? stats?.nickname,
    buyerDisplayLabel: stats?.buyerDisplayLabel,
    identitySource: stats?.identitySource,
    buyerIdentityCode: identityCode,
    buyerShortCode: identityCode,
    stats,
    source: (isRangeScope
      ? params.weeklyScope!.source ?? 'anchor_weekly_ranking'
      : 'buyer_profile_cache') as
      | 'buyer_profile_cache'
      | 'anchor_weekly_ranking'
      | 'bad_buyer_ranking',
    profileUpdatedAt: profile?.updatedAt ?? null,
    weeklyScope: isRangeScope ? params.weeklyScope : undefined,
    blacklistedBuyerIds: [...blacklist],
    needAfterSalesSync,
    pendingAfterSalesOrderNos,
    afterSalesSyncedOrderNos: [] as string[],
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    rows,
    tabs: ordersPayload.tabs,
    buyerSummary: ordersPayload.buyerSummary,
    currentFilterSummary: ordersPayload.currentFilterSummary,
    emptyText: ordersPayload.emptyText,
  }
}

/** 手动同步当前买家需查售后工作台的订单 */
export async function syncBuyerProfileAfterSales(params: {
  buyerKey: string
  orderNos?: string[]
}): Promise<{
  buyerKey: string
  synced: string[]
  pending: string[]
  failed: Array<{ orderNo: string; error: string }>
  message: string
}> {
  const buyerKey = params.buyerKey.trim()
  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    return {
      buyerKey,
      synced: [],
      pending: [],
      failed: [],
      message: '暂无订单数据',
    }
  }

  let buyerOrders = filterBuyerNormalizedOrders(bundle.orders, buyerKey)
  if (params.orderNos?.length) {
    const set = new Set(params.orderNos.map((n) => n.trim()))
    buyerOrders = buyerOrders.filter((o) =>
      set.has((o.displayOrderNo || o.officialOrderNo || '').trim()),
    )
  }

  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const allViews = artifacts?.views ?? []
  const buyerViews = filterBuyerViews(allViews, buyerKey)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts?.dedupe.uniqueOrders ?? []) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }

  const needsSyncNos = [
    ...new Set(
      buyerViews
        .filter((v) => {
          const raw = rawByMatch.get(v.matchOrderId || v.orderId)
          const input = shouldFetchInputFromView(
            Object.assign({}, v, { raw }) as AnalyzedOrderView & { raw?: Record<string, unknown> },
          )
          const orderNo = (v.displayOrderNo || v.officialOrderNo || v.packageId || '').trim()
          const cached = orderNo
            ? getWorkbenchRefundFromMemory(v.liveAccountId, orderNo)
            : undefined
          return isAfterSalesResultPending(input, cached, v.buyerProductRefundSource)
        })
        .map((v) => v.displayOrderNo || v.officialOrderNo || v.packageId)
        .filter(Boolean),
    ),
  ]

  const targetNos =
    params.orderNos?.length && params.orderNos.length > 0
      ? params.orderNos.map((n) => n.trim()).filter(Boolean)
      : needsSyncNos

  if (targetNos.length === 0) {
    return {
      buyerKey,
      synced: [],
      pending: [],
      failed: [],
      message: '当前订单售后金额已是最新',
    }
  }

  const targetSet = new Set(targetNos)
  const ordersToWarm = buyerOrders.filter((o) =>
    targetSet.has((o.displayOrderNo || o.officialOrderNo || '').trim()),
  )

  try {
    const warmResult = await warmWorkbenchCacheForOrders(ordersToWarm, {
      maxImmediateSync: Math.min(20, ordersToWarm.length || targetNos.length),
    })

    const message =
      warmResult.synced.length > 0
        ? '售后金额已同步'
        : warmResult.pending.length > 0
          ? '部分订单仍在同步中，请稍后刷新'
          : '当前订单售后金额已是最新'

    return {
      buyerKey,
      synced: warmResult.synced,
      pending: warmResult.pending,
      failed: [],
      message,
    }
  } catch (err) {
    return {
      buyerKey,
      synced: [],
      pending: targetNos,
      failed: [{ orderNo: targetNos[0] ?? '', error: err instanceof Error ? err.message : '同步失败' }],
      message: err instanceof Error ? err.message : '同步售后金额失败',
    }
  }
}
