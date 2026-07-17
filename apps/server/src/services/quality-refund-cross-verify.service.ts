/**
 * 品退交叉印证：官方品质问题接口为主来源，售后时间查询仅作印证
 */
import type { AnalyzedOrderView } from '../types/analysis'
import { liveAccountPackageKey } from '../utils/live-account-cache-key.util'
import { resolveMetricOrderNo } from './calc-refund-rate.service'
import { matchPlatformReturnReason } from '../utils/quality-return'
import {
  aggregateStrictAfterSaleForOrder,
  extractAfterSaleReasonText,
  isSuccessfulAfterSale,
} from './strict-after-sale-metrics.service'
import type { NormalizedQualityBadCase } from './quality-badcase.types'
import {
  isQualityBadCaseOrderMatched,
  isQualityBadCaseMatchStatusMatched,
} from './quality-badcase.types'
import { isOfflineDealView } from './offline-deal.service'

function pickString(rec: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = rec[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export type QualityVerifyStatus =
  | 'verified'
  | 'official_only'
  | 'after_sale_only'
  | 'conflict'
  | 'unmatched'
  | 'none'

export interface QualityRefundCrossVerify {
  isQualityRefund: boolean
  qualityMainSource: 'official_bad_case' | 'after_sale' | 'none'
  qualityVerifySource: 'after_sale_time_search' | 'after_sale_workbench' | 'none'
  qualityVerifyStatus: QualityVerifyStatus
  qualityReasonText: string
  officialReasonText: string
  afterSaleReasonText: string
  officialPackageId: string
  afterSaleOrderNo: string
  afterSaleStatus: string
  afterSaleType: string
  afterSaleRefundAmountCent: number
  afterSaleSuccessTime: string
  qualityFeedbackContent: string
  qualityFeedbackTime: string
  qualityPackagePayTime: string
  qualityItemId: string
  qualityItemName: string
  qualitySourceBizId: string
  /** 售后疑似品退但官方未命中，不计入主指标 */
  suspectedQualityRefund: boolean
  verifyDisplayLabel: string
  /** 官方品退原因（与 officialReasonText 一致，供明细展示） */
  officialQualityReasonText: string
  /** 售后最终理由（买家可能后续修改） */
  afterSaleFinalReasonText: string
  /** 售后最终理由与官方品退原因不一致 */
  afterSaleReasonChanged: boolean
  /** 运营向补充说明 */
  extraHint: string
}

function pickAfterSaleSuccessTime(rec: Record<string, unknown>): string {
  for (const k of [
    'refund_ok_time',
    'refundOkTime',
    'refund_time',
    'refundTime',
    'update_at',
    'updateAt',
  ]) {
    const v = rec[k]
    if (v == null || v === '' || v === 0) continue
    return String(v)
  }
  return ''
}

function pickAfterSaleType(rec: Record<string, unknown>): string {
  const parts = [
    rec.return_type_name,
    rec.returnTypeName,
    rec.return_type,
    rec.returnType,
  ]
    .filter(Boolean)
    .map(String)
  return parts.join(' ') || ''
}

/** 售后工作台无 rawDetail 时，用官方品退已匹配的售后字段补全展示（不影响是否计入品退） */
export function buildAfterSaleRecordsFromOfficialCase(
  officialCase?: NormalizedQualityBadCase,
  view?: AnalyzedOrderView,
): Record<string, unknown>[] {
  if (!officialCase) return []
  const returnsId =
    officialCase.matchedAfterSaleId?.trim() || officialCase.sourceBizId?.trim() || ''
  const reasonFromView =
    view?.finalAfterSaleReason?.trim() || view?.afterSaleReasonText?.trim() || ''
  const statusFromView =
    view?.finalAfterSaleStatus?.trim() || view?.afterSaleStatusText?.trim() || ''
  const refundFromView =
    view?.successfulRefundAmountCent && view.successfulRefundAmountCent > 0
      ? view.successfulRefundAmountCent / 100
      : 0
  const refundFee =
    officialCase.afterSaleRefundAmount > 0
      ? officialCase.afterSaleRefundAmount
      : refundFromView
  const hasAfterSaleMeta =
    Boolean(returnsId) ||
    Boolean(officialCase.afterSaleReason?.trim()) ||
    Boolean(officialCase.afterSaleStatus?.trim()) ||
    Boolean(reasonFromView) ||
    Boolean(statusFromView) ||
    refundFee > 0
  if (!hasAfterSaleMeta) return []
  return [
    {
      returns_id: returnsId,
      reason_name_zh: officialCase.afterSaleReason?.trim() || reasonFromView,
      refund_status_name:
        officialCase.afterSaleStatus?.trim() || statusFromView || '退款成功',
      refund_fee: refundFee,
    },
  ]
}

function pickReturnsIdFromRecords(records: Record<string, unknown>[]): string {
  const pickFrom = (rec: Record<string, unknown>): string =>
    pickString(rec, [
      'returns_id',
      'returnsId',
      'return_id',
      'returnId',
      'after_sale_id',
      'afterSaleId',
    ])

  const successful = records.filter((r) => isSuccessfulAfterSale(r))
  const ordered =
    successful.length > 0
      ? [...successful].sort((a, b) => {
          const ta = Date.parse(pickAfterSaleSuccessTime(a)) || 0
          const tb = Date.parse(pickAfterSaleSuccessTime(b)) || 0
          return tb - ta
        })
      : records

  for (const rec of ordered) {
    const rid = pickFrom(rec)
    if (rid) return rid
  }
  return ''
}

function summarizeAfterSaleRecords(records: Record<string, unknown>[]): {
  hasAny: boolean
  hasSuccessful: boolean
  hasQualityReason: boolean
  hasNonQualityReason: boolean
  reasonText: string
  statusText: string
  typeText: string
  refundCent: number
  successTime: string
  returnsId: string
} {
  const strictAgg = aggregateStrictAfterSaleForOrder(records)
  let hasSuccessful = strictAgg.successfulRecordCount > 0
  let hasQualityReason = false
  let hasNonQualityReason = false
  let bestReason = ''
  let bestStatus = ''
  let bestType = ''
  let bestTime = ''
  let refundCent = strictAgg.successfulRefundAmountCent

  const successful = records.filter((r) => isSuccessfulAfterSale(r))
  if (successful.length > 0) {
    hasSuccessful = true
    successful.sort((a, b) => {
      const ta = Date.parse(pickAfterSaleSuccessTime(a)) || 0
      const tb = Date.parse(pickAfterSaleSuccessTime(b)) || 0
      return tb - ta
    })
    const latest = successful[0]!
    bestReason = extractAfterSaleReasonText(latest)
    bestStatus = [
      latest.refund_status_name,
      latest.refundStatusName,
      latest.status_name,
      latest.statusName,
    ]
      .filter(Boolean)
      .map(String)
      .join(' ')
    bestType = pickAfterSaleType(latest)
    bestTime = pickAfterSaleSuccessTime(latest)
    if (!refundCent) {
      const fee = latest.refund_fee ?? latest.refundFee
      if (typeof fee === 'number') refundCent = Math.round(fee * 100)
    }
  }

  for (const rec of records) {
    const reason = extractAfterSaleReasonText(rec)
    if (!reason) continue
    if (matchPlatformReturnReason(reason).isQualityReturn) hasQualityReason = true
    else hasNonQualityReason = true
  }

  if (successful.length === 0) {
    let pendingQualityReason = ''
    let pendingFallbackReason = ''
    for (const rec of records) {
      const reason = extractAfterSaleReasonText(rec)
      if (reason) {
        if (matchPlatformReturnReason(reason).isQualityReturn) {
          pendingQualityReason = reason
        } else if (!pendingFallbackReason) {
          pendingFallbackReason = reason
        }
      }
      if (!bestStatus) {
        bestStatus = [
          rec.refund_status_name,
          rec.refundStatusName,
          rec.status_name,
          rec.statusName,
        ]
          .filter(Boolean)
          .map(String)
          .join(' ')
      }
      if (!bestType) bestType = pickAfterSaleType(rec)
    }
    bestReason = pendingQualityReason || pendingFallbackReason
  }

  if (!bestReason && hasQualityReason) {
    for (const rec of records) {
      const reason = extractAfterSaleReasonText(rec)
      if (reason && matchPlatformReturnReason(reason).isQualityReturn) {
        bestReason = reason
        break
      }
    }
  }

  if (!bestReason && strictAgg.finalAfterSaleReason) {
    bestReason = strictAgg.finalAfterSaleReason
  }
  if (!bestStatus && strictAgg.finalAfterSaleStatus) {
    bestStatus = strictAgg.finalAfterSaleStatus
  }

  return {
    hasAny: records.length > 0,
    hasSuccessful,
    hasQualityReason,
    hasNonQualityReason,
    reasonText: bestReason,
    statusText: bestStatus,
    typeText: bestType,
    refundCent,
    successTime: bestTime,
    returnsId: pickReturnsIdFromRecords(records),
  }
}

/** 售后工作台/视图侧退货理由补入售后记录（查售后单时用于品退判定） */
export function mergeAfterSaleRecordsForQualityResolution(
  records: Record<string, unknown>[],
  opts?: {
    afterSaleReason?: string | null
    afterSaleStatus?: string | null
  },
): Record<string, unknown>[] {
  const reason = (opts?.afterSaleReason ?? '').trim()
  if (!reason) return records
  const alreadyHas = records.some((rec) => extractAfterSaleReasonText(rec) === reason)
  if (alreadyHas) return records
  return [
    ...records,
    {
      reason_name_zh: reason,
      refund_status_name: (opts?.afterSaleStatus ?? '').trim() || '售后中',
    },
  ]
}

export function qualityVerifyDisplayLabel(
  status: QualityVerifyStatus,
  opts?: { afterSaleMatched?: boolean },
): string {
  switch (status) {
    case 'verified':
      return opts?.afterSaleMatched === false
        ? '官方品退，售后已印证'
        : '官方品退，售后单已匹配'
    case 'official_only':
      return '官方品退，暂无售后单信息'
    case 'conflict':
      return '官方品退，售后原因存在差异'
    case 'after_sale_only':
      return '售后疑似品退（官方未命中）'
    case 'unmatched':
      return '官方品退暂未匹配订单主表'
    default:
      return '—'
  }
}

export function resolveQualityRefundCrossVerify(params: {
  view: AnalyzedOrderView
  afterSaleRecords?: Record<string, unknown>[]
  matchedOfficialPackageIds?: Set<string>
  officialCase?: NormalizedQualityBadCase
  verifySource?: 'after_sale_time_search' | 'after_sale_workbench'
}): QualityRefundCrossVerify {
  const { view: v } = params

  // 线下成交硬隔离：不参与官方品退 / 售后关键词 / 疑似品退
  if (isOfflineDealView(v)) {
    return {
      isQualityRefund: false,
      qualityMainSource: 'none',
      qualityVerifySource: 'none',
      qualityVerifyStatus: 'none',
      qualityReasonText: '',
      officialReasonText: '',
      afterSaleReasonText: '',
      officialPackageId: '',
      afterSaleOrderNo: '',
      afterSaleStatus: '',
      afterSaleType: '',
      afterSaleRefundAmountCent: 0,
      afterSaleSuccessTime: '',
      qualityFeedbackContent: '',
      qualityFeedbackTime: '',
      qualityPackagePayTime: '',
      qualityItemId: '',
      qualityItemName: '',
      qualitySourceBizId: '',
      suspectedQualityRefund: false,
      verifyDisplayLabel: '—',
      officialQualityReasonText: '',
      afterSaleFinalReasonText: '',
      afterSaleReasonChanged: false,
      extraHint: '',
    }
  }

  const { matchedOfficialPackageIds, officialCase } = params
  let afterSaleRecords = mergeAfterSaleRecordsForQualityResolution(
    params.afterSaleRecords ?? [],
    {
      afterSaleReason:
        v.afterSalesWorkbenchReason ??
        v.reasonText ??
        v.finalAfterSaleReason ??
        officialCase?.afterSaleReason,
      afterSaleStatus:
        v.afterSaleStatusText ?? v.finalAfterSaleStatus ?? officialCase?.afterSaleStatus,
    },
  )
  if (afterSaleRecords.length === 0) {
    afterSaleRecords = buildAfterSaleRecordsFromOfficialCase(officialCase, v)
  }
  const no = resolveMetricOrderNo(v)
  const officialPackageId = no || officialCase?.packageId || ''

  const hasOfficialMatched =
    Boolean(officialCase && isQualityBadCaseOrderMatched(officialCase)) ||
    Boolean(
      no &&
        matchedOfficialPackageIds?.has(liveAccountPackageKey(v.liveAccountId, no)) &&
        v.officialQualityBadCase,
    ) ||
    Boolean(
      v.officialQualityBadCase &&
        isQualityBadCaseMatchStatusMatched(v.officialQualityMatchStatus),
    )

  const officialReasonText =
    (v.officialQualityReasons ?? officialCase?.negativeReasons ?? []).join('、').trim() ||
    ''

  const afterSale = summarizeAfterSaleRecords(afterSaleRecords)
  const afterSaleQualityCandidate =
    afterSale.hasQualityReason &&
    (matchPlatformReturnReason(afterSale.reasonText).isQualityReturn ||
      afterSaleRecords.some(
        (rec) =>
          matchPlatformReturnReason(extractAfterSaleReasonText(rec)).isQualityReturn,
      ))
  const strictQualityRefund = v.strictQualityRefund === true

  let qualityVerifyStatus: QualityVerifyStatus = 'none'
  let isQualityRefund = false

  if (hasOfficialMatched && v.includedInGmv) {
    isQualityRefund = true
    if (!afterSale.hasAny) {
      qualityVerifyStatus = 'official_only'
    } else {
      // 官方品退为主来源：售后单仅补充展示，最终理由变更不影响计入品退
      qualityVerifyStatus = 'verified'
    }
  } else if ((strictQualityRefund || afterSaleQualityCandidate) && v.includedInGmv) {
    isQualityRefund = true
    qualityVerifyStatus = 'after_sale_only'
  } else if (officialCase && !isQualityBadCaseOrderMatched(officialCase)) {
    qualityVerifyStatus = 'unmatched'
  }

  const verifySource =
    afterSaleRecords.length > 0
      ? params.verifySource ?? 'after_sale_workbench'
      : 'none'

  const hasLinkedAfterSale =
    Boolean(afterSale.returnsId?.trim()) ||
    Boolean(officialCase?.matchedAfterSaleId?.trim()) ||
    Boolean(officialCase?.sourceBizId?.trim())

  const afterSaleReasonChanged =
    (afterSale.hasAny &&
      Boolean(officialReasonText) &&
      Boolean(afterSale.reasonText) &&
      afterSale.hasNonQualityReason &&
      !afterSale.hasQualityReason) ||
    (qualityVerifyStatus === 'verified' &&
      hasOfficialMatched &&
      hasLinkedAfterSale &&
      Boolean(officialReasonText) &&
      !afterSale.reasonText?.trim())

  const extraHint =
    afterSaleReasonChanged ||
    (qualityVerifyStatus === 'verified' &&
      hasOfficialMatched &&
      hasLinkedAfterSale &&
      Boolean(officialReasonText) &&
      !afterSale.reasonText?.trim())
      ? '买家后续可能改过售后理由，本单仍按官方品退计入品退'
      : ''

  const afterSaleMatched = afterSale.hasAny && qualityVerifyStatus === 'verified'

  return {
    isQualityRefund,
    qualityMainSource: isQualityRefund
      ? hasOfficialMatched
        ? 'official_bad_case'
        : 'after_sale'
      : 'none',
    qualityVerifySource: verifySource,
    qualityVerifyStatus,
    qualityReasonText: officialReasonText || afterSale.reasonText,
    officialReasonText,
    afterSaleReasonText: afterSale.reasonText,
    officialPackageId,
    afterSaleOrderNo: afterSale.returnsId,
    afterSaleStatus: afterSale.statusText || v.finalAfterSaleStatus || v.afterSaleStatusText || '',
    afterSaleType: afterSale.typeText || v.afterSaleDisplayType || v.afterSaleCategory || '',
    afterSaleRefundAmountCent:
      afterSale.refundCent ||
      v.successfulRefundAmountCent ||
      v.productRefundAmountCent ||
      0,
    afterSaleSuccessTime: afterSale.successTime,
    qualityFeedbackContent:
      v.officialQualityFeedbackContent?.trim() || officialCase?.feedbackContent || '',
    qualityFeedbackTime:
      v.officialQualityFeedbackTime?.trim() || officialCase?.feedbackTime || '',
    qualityPackagePayTime:
      v.officialQualityPackagePayTime?.trim() || officialCase?.packagePayTime || '',
    qualityItemId: v.officialQualityItemId?.trim() || officialCase?.itemId || '',
    qualityItemName: v.officialQualityItemName?.trim() || officialCase?.itemName || '',
    qualitySourceBizId:
      v.officialQualitySourceBizId?.trim() || officialCase?.sourceBizId || '',
    suspectedQualityRefund: qualityVerifyStatus === 'after_sale_only',
    verifyDisplayLabel: qualityVerifyDisplayLabel(qualityVerifyStatus, {
      afterSaleMatched,
    }),
    officialQualityReasonText: officialReasonText,
    afterSaleFinalReasonText: afterSale.reasonText,
    afterSaleReasonChanged,
    extraHint,
  }
}

export interface QualityCrossVerifySummary {
  officialBadCasePackageCount: number
  officialMatchedOrderCount: number
  officialQualityRefundOrderCount: number
  officialQualityRefundOrderNos: string[]
  afterSaleTimeSearchCount: number
  afterSaleMatchedOfficialCount: number
  verifiedCount: number
  officialOnlyCount: number
  afterSaleOnlyCount: number
  conflictCount: number
  unmatchedCount: number
  conflictSamples: Array<{
    packageId: string
    officialReason: string
    afterSaleReason: string
    afterSaleStatus: string
    refundAmountYuan: number
  }>
  afterSaleOnlySamples: Array<{
    orderNo: string
    afterSaleReason: string
    afterSaleStatus: string
    whyExcluded: string
  }>
}

export function buildQualityCrossVerifySummary(params: {
  views: AnalyzedOrderView[]
  officialCases: NormalizedQualityBadCase[]
  afterSaleTimeSearchCount: number
  getAfterSaleRecords: (orderNo: string) => Record<string, unknown>[]
}): QualityCrossVerifySummary {
  const officialByPackage = new Map<string, NormalizedQualityBadCase>()
  for (const c of params.officialCases) {
    officialByPackage.set(liveAccountPackageKey(c.liveAccountId, c.packageId), c)
    if (c.matchedOrderNo) {
      officialByPackage.set(liveAccountPackageKey(c.liveAccountId, c.matchedOrderNo), c)
    }
  }
  const matchedOfficial = params.officialCases.filter(isQualityBadCaseOrderMatched)
  const officialPackageIds = new Set(
    matchedOfficial.flatMap((c) => [
      liveAccountPackageKey(c.liveAccountId, c.packageId),
      c.matchedOrderNo ? liveAccountPackageKey(c.liveAccountId, c.matchedOrderNo) : '',
    ].filter(Boolean)),
  )

  const officialQualityRefundOrderNos: string[] = []
  let verifiedCount = 0
  let officialOnlyCount = 0
  let afterSaleOnlyCount = 0
  let conflictCount = 0
  let unmatchedCount = 0
  let afterSaleMatchedOfficialCount = 0
  const conflictSamples: QualityCrossVerifySummary['conflictSamples'] = []
  const afterSaleOnlySamples: QualityCrossVerifySummary['afterSaleOnlySamples'] = []

  for (const v of params.views) {
    const no = resolveMetricOrderNo(v)
    if (!no) continue
    const officialCase = no ? officialByPackage.get(liveAccountPackageKey(v.liveAccountId, no)) : undefined
    const cv = resolveQualityRefundCrossVerify({
      view: v,
      afterSaleRecords: params.getAfterSaleRecords(no),
      matchedOfficialPackageIds: officialPackageIds,
      officialCase,
      verifySource: 'after_sale_time_search',
    })

    if (cv.isQualityRefund && no) officialQualityRefundOrderNos.push(no)

    switch (cv.qualityVerifyStatus) {
      case 'verified':
        verifiedCount++
        if (cv.afterSaleReasonText) afterSaleMatchedOfficialCount++
        break
      case 'official_only':
        officialOnlyCount++
        break
      case 'after_sale_only':
        afterSaleOnlyCount++
        afterSaleOnlySamples.push({
          orderNo: no,
          afterSaleReason: cv.afterSaleReasonText,
          afterSaleStatus: cv.afterSaleStatus,
          whyExcluded: '售后疑似品退，官方品退接口未命中（已计入品退订单数）',
        })
        break
      case 'conflict':
        conflictCount++
        conflictSamples.push({
          packageId: no,
          officialReason: cv.officialReasonText,
          afterSaleReason: cv.afterSaleReasonText,
          afterSaleStatus: cv.afterSaleStatus,
          refundAmountYuan: cv.afterSaleRefundAmountCent / 100,
        })
        break
      case 'unmatched':
        unmatchedCount++
        break
    }
  }

  return {
    officialBadCasePackageCount: params.officialCases.length,
    officialMatchedOrderCount: matchedOfficial.length,
    officialQualityRefundOrderCount: [...new Set(officialQualityRefundOrderNos)].length,
    officialQualityRefundOrderNos: [...new Set(officialQualityRefundOrderNos)],
    afterSaleTimeSearchCount: params.afterSaleTimeSearchCount,
    afterSaleMatchedOfficialCount,
    verifiedCount,
    officialOnlyCount,
    afterSaleOnlyCount,
    conflictCount,
    unmatchedCount,
    conflictSamples,
    afterSaleOnlySamples,
  }
}
