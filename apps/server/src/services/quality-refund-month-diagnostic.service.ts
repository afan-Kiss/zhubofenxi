import type { AnalyzedOrderView } from '../types/analysis'
import { liveAccountPackageKey } from '../utils/live-account-cache-key.util'
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import { calculateBusinessMetrics, viewCountsAsPaidOrder } from './business-metrics.service'
import {
  getMatchedOfficialQualityCasesByPackage,
  getQualityBadCasesSync,
} from './quality-badcase-store.service'
import {
  isQualityBadCaseOrderMatched,
  type NormalizedQualityBadCase,
} from './quality-badcase.types'
import { viewCountsAsQualityRefund } from './quality-refund-resolution.service'
import { isLowPriceBrushOrderView } from './low-price-brush-order.service'
import { resolveQualityRefundCrossVerify } from './quality-refund-cross-verify.service'

export interface QualityRefundExcludeSample {
  orderNo: string
  packageId: string
  reason: string
}

export interface QualityRefundMonthDiagnostic {
  officialRawCount: number
  officialMatchedInPeriodCount: number
  suspectedQualityRefundInPeriodCount: number
  unmatchedOfficialInPeriodCount: number
  excludedByLowPriceBrushCount: number
  excludedByPayTimeOutOfPeriodCount: number
  periodQualityRefundOrderCount: number
  /** @deprecated 使用 officialMatchedInPeriodCount */
  matchedOrderCount: number
  /** @deprecated 使用 unmatchedOfficialInPeriodCount */
  unmatchedOrderCount: number
  excludeSamples: QualityRefundExcludeSample[]
  note: string
}

function casePayDateKey(c: NormalizedQualityBadCase): string | null {
  const raw = (c.packagePayTime ?? c.feedbackTime ?? '').trim().slice(0, 10)
  return raw || null
}

function inDateRange(dateKey: string | null, startDate: string, endDate: string): boolean {
  if (!dateKey) return false
  return dateKey >= startDate && dateKey <= endDate
}

function viewPayDateKey(view: AnalyzedOrderView): string | null {
  const payDate = (view.orderTimeText ?? '').trim().slice(0, 10)
  return payDate || null
}

function findViewForOfficialCase(
  views: AnalyzedOrderView[],
  c: NormalizedQualityBadCase,
): AnalyzedOrderView | undefined {
  const pkg = c.matchedOrderNo || c.packageId
  if (!pkg) return undefined
  const key = liveAccountPackageKey(c.liveAccountId, pkg)
  for (const v of views) {
    const orderNo = resolveMetricOrderNo(v)
    const vKey = liveAccountPackageKey(v.liveAccountId ?? '', orderNo || v.packageId || '')
    if (vKey === key) return v
    if (orderNo && (orderNo === c.matchedOrderNo || orderNo === c.packageId)) return v
    if (v.packageId && (v.packageId === c.packageId || v.packageId === c.matchedOrderNo)) return v
  }
  return undefined
}

function explainPeriodQualityExclude(params: {
  view?: AnalyzedOrderView
  caseRow: NormalizedQualityBadCase
  startDate: string
  endDate: string
  officialPackageIds: Set<string>
}): string {
  const { view, caseRow, startDate, endDate, officialPackageIds } = params
  if (!isQualityBadCaseOrderMatched(caseRow)) {
    return '官方品退未匹配订单主表'
  }
  if (!view) {
    return '已匹配官方品退但订单不在本期标准视图'
  }
  if (isLowPriceBrushOrderView(view)) {
    return '被低价刷单排除'
  }
  const payDate = viewPayDateKey(view)
  if (payDate && (payDate < startDate || payDate > endDate)) {
    return '订单支付时间不在本期核对范围'
  }
  if (!view.includedInGmv) {
    return 'includedInGmv=false，未计入支付订单'
  }
  const orderNo = resolveMetricOrderNo(view)
  const key = liveAccountPackageKey(view.liveAccountId ?? caseRow.liveAccountId, orderNo || view.packageId || '')
  if (!officialPackageIds.has(key)) {
    return 'liveAccountId/packageId 与官方品退索引不一致'
  }
  if (!viewCountsAsQualityRefund(view, officialPackageIds)) {
    return '官方已匹配但主品退判定未命中（可能售后状态或交叉印证未通过）'
  }
  return '已计入本期品退'
}

export function buildQualityRefundMonthDiagnostic(params: {
  views: AnalyzedOrderView[]
  allViews?: AnalyzedOrderView[]
  startDate: string
  endDate: string
}): QualityRefundMonthDiagnostic {
  const { views, startDate, endDate } = params
  const allViews = params.allViews ?? views
  const allCases = getQualityBadCasesSync()
  const periodCases = allCases.filter((c) => inDateRange(casePayDateKey(c), startDate, endDate))
  const officialRawCount = periodCases.length
  const officialMatchedInPeriodCount = periodCases.filter(isQualityBadCaseOrderMatched).length
  const unmatchedOfficialInPeriodCount = officialRawCount - officialMatchedInPeriodCount

  const metrics = calculateBusinessMetrics(views)
  const periodQualityRefundOrderCount = metrics.qualityRefundOrderCount

  const officialByPackage = getMatchedOfficialQualityCasesByPackage(allCases)
  const officialPackageIds = new Set<string>(officialByPackage.keys())

  const paidInPeriod = (v: AnalyzedOrderView) => {
    const payDate = viewPayDateKey(v)
    return Boolean(payDate && payDate >= startDate && payDate <= endDate && viewCountsAsPaidOrder(v))
  }

  let suspectedQualityRefundInPeriodCount = 0
  let excludedByLowPriceBrushCount = 0
  let excludedByPayTimeOutOfPeriodCount = 0
  const suspectedOrderNos = new Set<string>()
  const brushExcludedOrderNos = new Set<string>()

  for (const v of allViews) {
    if (!paidInPeriod(v)) continue
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    const isQuality = viewCountsAsQualityRefund(v, officialPackageIds)
    if (!isQuality) continue
    if (isLowPriceBrushOrderView(v)) {
      brushExcludedOrderNos.add(no)
      continue
    }
    const officialCase = officialByPackage.get(liveAccountPackageKey(v.liveAccountId ?? '', no))?.[0]
    const cv = resolveQualityRefundCrossVerify({
      view: v,
      matchedOfficialPackageIds: officialPackageIds,
      officialCase,
    })
    if (cv.qualityVerifyStatus === 'after_sale_only') {
      suspectedOrderNos.add(no)
    }
  }

  for (const v of views) {
    const no = resolveMetricOrderNo(v)
    if (!no || !paidInPeriod(v)) continue
    const cv = resolveQualityRefundCrossVerify({
      view: v,
      matchedOfficialPackageIds: officialPackageIds,
      officialCase: officialByPackage.get(liveAccountPackageKey(v.liveAccountId ?? '', no))?.[0],
    })
    if (cv.qualityVerifyStatus === 'after_sale_only') {
      suspectedOrderNos.add(no)
    }
  }

  suspectedQualityRefundInPeriodCount = suspectedOrderNos.size
  excludedByLowPriceBrushCount = brushExcludedOrderNos.size

  for (const c of periodCases) {
    if (!isQualityBadCaseOrderMatched(c)) continue
    const view = findViewForOfficialCase(allViews, c)
    if (!view) continue
    const payDate = viewPayDateKey(view)
    if (payDate && (payDate < startDate || payDate > endDate)) {
      excludedByPayTimeOutOfPeriodCount += 1
    }
  }

  const excludeSamples: QualityRefundExcludeSample[] = []
  for (const c of periodCases) {
    if (excludeSamples.length >= 10) break
    if (!isQualityBadCaseOrderMatched(c)) {
      excludeSamples.push({
        orderNo: c.matchedOrderNo || c.packageId || '—',
        packageId: c.packageId,
        reason: '官方品退未匹配订单主表',
      })
      continue
    }
    const view = findViewForOfficialCase(allViews, c)
    const reason = explainPeriodQualityExclude({
      view,
      caseRow: c,
      startDate,
      endDate,
      officialPackageIds,
    })
    if (reason === '已计入本期品退') continue
    excludeSamples.push({
      orderNo: c.matchedOrderNo || c.packageId || '—',
      packageId: c.packageId,
      reason,
    })
  }

  let note =
    `官方品退 ${officialRawCount} 条，本期匹配 ${officialMatchedInPeriodCount} 条，` +
    `未匹配 ${unmatchedOfficialInPeriodCount} 条；` +
    `售后疑似品退 ${suspectedQualityRefundInPeriodCount} 单；` +
    `本期计入品退订单 ${periodQualityRefundOrderCount} 单。`
  if (excludedByLowPriceBrushCount > 0) {
    note += ` 其中 ${excludedByLowPriceBrushCount} 单因低价刷单规则未计入经营总览。`
  }
  if (excludedByPayTimeOutOfPeriodCount > 0) {
    note += ` ${excludedByPayTimeOutOfPeriodCount} 单官方品退已匹配但支付时间不在本期。`
  }
  if (officialMatchedInPeriodCount > 0 && periodQualityRefundOrderCount === 0) {
    note += ' 官方已匹配订单存在但未计入本期品退，见下方未计入原因样本。'
  } else if (officialRawCount > 0 && periodQualityRefundOrderCount === 0) {
    note += ' 本期品退为 0，请对照下方诊断样本排查。'
  }

  const matchedOrderCount = officialMatchedInPeriodCount
  const unmatchedOrderCount = unmatchedOfficialInPeriodCount

  return {
    officialRawCount,
    officialMatchedInPeriodCount,
    suspectedQualityRefundInPeriodCount,
    unmatchedOfficialInPeriodCount,
    excludedByLowPriceBrushCount,
    excludedByPayTimeOutOfPeriodCount,
    periodQualityRefundOrderCount,
    matchedOrderCount,
    unmatchedOrderCount,
    excludeSamples,
    note,
  }
}

export function viewInPeriodForQualityDiagnostic(
  view: AnalyzedOrderView,
  startDate: string,
  endDate: string,
): boolean {
  const payDate = viewPayDateKey(view)
  return Boolean(payDate && payDate >= startDate && payDate <= endDate && viewCountsAsPaidOrder(view))
}
