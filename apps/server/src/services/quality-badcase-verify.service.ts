import type { AnalyzedOrderView } from '../types/analysis'
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import { isStrictQualityRefundView } from './strict-after-sale-metrics.service'
import type { NormalizedQualityBadCase } from './quality-badcase.types'
import { isQualityBadCaseOrderMatched } from './quality-badcase.types'
import {
  getOfficialQualityPackageIdSet,
  loadAllQualityBadCases,
} from './quality-badcase-store.service'
import { viewCountsAsPaidOrder, isQualityRefundOrder } from './business-metrics.service'
import { buildOrderMetricSets } from './order-metric-sets.service'
import { fetchLiveRangeAnalysis } from './board-live-analysis.service'
import { matchStatusLabel } from './quality-badcase.types'

export interface QualityBadCaseVerifySample {
  packageId: string
  sourceBizId: string | null
  itemName: string
  feedbackContent: string
  feedbackTime: string | null
  packagePayTime: string | null
  matchedOrderNo: string
  matchedAfterSaleId: string
  matchedBuyerId: string
  matchedBuyerNickname: string
  matchedAnchorId: string
  matchedAnchorName: string
  matchStatus: string
  inCoreMetric: boolean
  excludedReason?: string
}

export interface QualityBadCaseVerifyResult {
  officialCaseCount: number
  matchedOrderCount: number
  matchedAfterSaleCount: number
  matchedAnchorCount: number
  unmatchedCount: number
  coreMetricIncludedCount: number
  excludedUnmatchedCount: number
  boardQualityNumerator?: number
  boardPaidDenominator?: number
  samples: QualityBadCaseVerifySample[]
}

function sampleFromCase(
  c: NormalizedQualityBadCase,
  inCoreMetric: boolean,
  excludedReason?: string,
): QualityBadCaseVerifySample {
  return {
    packageId: c.packageId,
    sourceBizId: c.sourceBizId,
    itemName: c.itemName,
    feedbackContent: c.feedbackContent,
    feedbackTime: c.feedbackTime,
    packagePayTime: c.packagePayTime,
    matchedOrderNo: c.matchedOrderNo,
    matchedAfterSaleId: c.matchedAfterSaleId,
    matchedBuyerId: c.matchedBuyerId,
    matchedBuyerNickname: c.matchedBuyerNickname,
    matchedAnchorId: c.matchedAnchorId,
    matchedAnchorName: c.matchedAnchorName,
    matchStatus: matchStatusLabel(c.matchStatus),
    inCoreMetric,
    excludedReason,
  }
}

function isInCoreMetric(
  c: NormalizedQualityBadCase,
  matchedPackageIds: Set<string>,
  paidPackageIds: Set<string>,
): boolean {
  if (!isQualityBadCaseOrderMatched(c)) return false
  const orderNo = c.matchedOrderNo || c.packageId
  if (!orderNo || !matchedPackageIds.has(orderNo)) return false
  if (!paidPackageIds.has(orderNo)) return false
  return true
}

export async function verifyQualityBadCases(params?: {
  startDate?: string
  endDate?: string
}): Promise<QualityBadCaseVerifyResult> {
  const cases = await loadAllQualityBadCases(true)
  const matchedOrderCount = cases.filter(isQualityBadCaseOrderMatched).length
  const matchedAfterSaleCount = cases.filter(
    (c) =>
      c.matchStatus === 'matched_order_and_after_sale' ||
      c.matchStatus === 'matched_after_sale_only',
  ).length
  const anchorIds = new Set(
    cases.filter((c) => c.matchedAnchorId).map((c) => c.matchedAnchorId),
  )
  const unmatchedCount = cases.filter((c) => c.matchStatus === 'unmatched').length

  let boardQualityNumerator: number | undefined
  let boardPaidDenominator: number | undefined
  const paidPackageIds = new Set<string>()
  const coreIncludedPackageIds = new Set<string>()

  if (params?.startDate && params?.endDate) {
    const { views } = await fetchLiveRangeAnalysis({
      startDate: params.startDate,
      endDate: params.endDate,
      requestId: `quality-verify-${Date.now()}`,
    })
    const metricSets = buildOrderMetricSets(views, { scope: 'quality-verify' }, cases)
    boardQualityNumerator = metricSets.qualityRefundOrderCount
    boardPaidDenominator = metricSets.paidOrderCount
    for (const no of metricSets.paidOrderNos) paidPackageIds.add(no)
    for (const no of metricSets.qualityRefundOrderNos) coreIncludedPackageIds.add(no)
  } else {
    const matchedOfficialIds = getOfficialQualityPackageIdSet(cases)
    for (const c of cases) {
      if (isQualityBadCaseOrderMatched(c)) {
        const no = c.matchedOrderNo || c.packageId
        if (no) matchedOfficialIds.add(no)
      }
    }
  }

  const officialMatchedIds = getOfficialQualityPackageIdSet(cases)
  let coreMetricIncludedCount = 0
  let excludedUnmatchedCount = 0

  const samples: QualityBadCaseVerifySample[] = []
  for (const c of cases.slice(0, 20)) {
    let inCore = false
    let excludedReason: string | undefined
    if (c.matchStatus === 'unmatched') {
      excludedReason = '未匹配系统订单'
      excludedUnmatchedCount += 1
    } else if (c.matchStatus === 'matched_after_sale_only') {
      excludedReason = '仅匹配售后，未匹配系统订单'
      excludedUnmatchedCount += 1
    } else if (params?.startDate && params?.endDate) {
      inCore = isInCoreMetric(c, coreIncludedPackageIds, paidPackageIds)
      if (!inCore) {
        excludedReason = '已匹配订单但不在当前日期范围支付订单内'
      } else {
        coreMetricIncludedCount += 1
      }
    } else if (officialMatchedIds.has(c.matchedOrderNo || c.packageId)) {
      inCore = true
      coreMetricIncludedCount += 1
    }
    samples.push(sampleFromCase(c, inCore, excludedReason))
  }

  if (!params?.startDate) {
    coreMetricIncludedCount = cases.filter(isQualityBadCaseOrderMatched).length
    excludedUnmatchedCount = cases.length - coreMetricIncludedCount
  }

  return {
    officialCaseCount: cases.length,
    matchedOrderCount,
    matchedAfterSaleCount,
    matchedAnchorCount: anchorIds.size,
    unmatchedCount,
    coreMetricIncludedCount,
    excludedUnmatchedCount,
    boardQualityNumerator,
    boardPaidDenominator,
    samples,
  }
}

export async function findQualityBadCaseByPackageId(
  packageId: string,
): Promise<NormalizedQualityBadCase | null> {
  const cases = await loadAllQualityBadCases(true)
  return (
    cases.find((c) => c.packageId === packageId || c.matchedOrderNo === packageId) ?? null
  )
}

export function explainHarSampleInclusion(
  c: NormalizedQualityBadCase | null,
  views: AnalyzedOrderView[],
): {
  inBoardNumerator: boolean
  inAnchorNumerator: boolean
  inBuyerRanking: boolean
  detail: string
} {
  if (!c) {
    return {
      inBoardNumerator: false,
      inAnchorNumerator: false,
      inBuyerRanking: false,
      detail: '未找到官方品退记录',
    }
  }
  if (!isQualityBadCaseOrderMatched(c)) {
    return {
      inBoardNumerator: false,
      inAnchorNumerator: false,
      inBuyerRanking: false,
      detail: `未计入核心品退：${matchStatusLabel(c.matchStatus)}`,
    }
  }
  const orderNo = c.matchedOrderNo || c.packageId
  const view = views.find(
    (v) => resolveMetricOrderNo(v) === orderNo || v.packageId === orderNo,
  )
  const inBoard = view ? isQualityRefundOrder(view) : false
  const inAnchor =
    inBoard &&
    Boolean(
      view &&
        (view.anchorId === c.matchedAnchorId || view.anchorName === c.matchedAnchorName),
    )
  const inBuyer =
    inBoard && Boolean(view && (view.buyerId === c.matchedBuyerId || view.buyerKey))
  return {
    inBoardNumerator: inBoard,
    inAnchorNumerator: inAnchor,
    inBuyerRanking: inBuyer,
    detail: inBoard
      ? '已匹配订单且在当期支付订单范围内，计入核心品退'
      : '已匹配订单但不在当期视图/支付范围内',
  }
}
