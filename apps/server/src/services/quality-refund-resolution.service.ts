import type { AnalyzedOrderView } from '../types/analysis'
import { calcOrderRate } from './calc-refund-rate.service'
import type { NormalizedQualityBadCase } from './quality-badcase.types'
import {
  resolveQualityRefundCrossVerify,
  qualityVerifyDisplayLabel,
  type QualityRefundCrossVerify,
  type QualityVerifyStatus,
} from './quality-refund-cross-verify.service'
import { isOfflineDealView } from '../utils/offline-deal-view.util'

export type { QualityRefundCrossVerify, QualityVerifyStatus }
export { qualityVerifyDisplayLabel, buildQualityCrossVerifySummary } from './quality-refund-cross-verify.service'

/** @deprecated 使用 qualityVerifyStatus */
export type QualityRefundSource = 'official_bad_case' | 'after_sale' | 'both' | 'none'

export interface QualityRefundInfo extends QualityRefundCrossVerify {
  /** @deprecated 使用 qualityReasonText */
  reasonText: string
  matchedKeyword: string
  refundAmountCent: number
  source: string
  /** @deprecated 使用 verifyDisplayLabel */
  qualitySource: QualityRefundSource
}

function legacyQualitySource(status: QualityVerifyStatus, isQuality: boolean): QualityRefundSource {
  if (!isQuality) return status === 'after_sale_only' ? 'after_sale' : 'none'
  if (status === 'verified') return 'both'
  if (status === 'after_sale_only') return 'after_sale'
  return 'official_bad_case'
}

/** 主品退指标：官方品退命中，或严格商品问题售后（明细区分来源） */
export function resolveQualityRefundInfo(params: {
  view: AnalyzedOrderView
  afterSaleRecords?: Record<string, unknown>[]
  matchedOfficialPackageIds?: Set<string>
  officialCase?: NormalizedQualityBadCase
  verifySource?: 'after_sale_time_search' | 'after_sale_workbench'
}): QualityRefundInfo {
  const cv = resolveQualityRefundCrossVerify(params)
  return {
    ...cv,
    reasonText: cv.qualityReasonText,
    matchedKeyword: cv.officialReasonText,
    refundAmountCent: cv.afterSaleRefundAmountCent,
    source: cv.qualityMainSource,
    qualitySource: legacyQualitySource(cv.qualityVerifyStatus, cv.isQualityRefund),
  }
}

/** 主品退指标：官方品退 + 严格商品问题售后 */
export function viewCountsAsQualityRefund(
  v: AnalyzedOrderView,
  matchedOfficialPackageIds?: Set<string>,
  _afterSaleRecords?: Record<string, unknown>[],
  officialCase?: NormalizedQualityBadCase,
): boolean {
  return resolveQualityRefundInfo({
    view: v,
    matchedOfficialPackageIds,
    afterSaleRecords: _afterSaleRecords,
    officialCase,
  }).isQualityRefund
}

export function applyOfficialQualityToView(
  v: AnalyzedOrderView,
  cases: NormalizedQualityBadCase[],
): AnalyzedOrderView {
  if (!cases.length) return v
  if (isOfflineDealView(v)) return v
  const primary = cases[0]!
  return {
    ...v,
    officialQualityBadCase: true,
    officialQualityReasons: primary.negativeReasons,
    officialQualityFeedbackContent: primary.feedbackContent,
    officialQualityFeedbackTime: primary.feedbackTime ?? undefined,
    officialQualityPackagePayTime: primary.packagePayTime ?? undefined,
    officialQualitySourceBizId: primary.sourceBizId ?? undefined,
    officialQualityItemId: primary.itemId,
    officialQualityItemName: primary.itemName,
    officialQualityMatchStatus: primary.matchStatus,
    isQualityReturn: true,
  }
}

export function calcQualityRefundRate(params: {
  paidOrderNos: string[]
  qualityRefundOrderNos: string[]
}): number | null {
  return calcOrderRate({
    paidOrderNos: params.paidOrderNos,
    numeratorOrderNos: params.qualityRefundOrderNos,
  }).rate
}

export const QUALITY_REFUND_DATA_SOURCE_NOTE =
  '品退主来源：官方品质负反馈接口 + 严格商品问题售后；售后时间查询仅作交叉印证'

export const QUALITY_REFUND_TOOLTIP =
  '品退单数 = 官方品质问题接口命中且匹配订单主表，或售后单退货理由命中品退白名单的唯一 P 单号。' +
  '查售后单时读取退货理由，处理中/在途也可计入，不要求已退款成功。' +
  '品退率 = 品退订单数 ÷ 本期支付订单数。' +
  '按订单支付时间归属统计范围。'

export const QUALITY_UNMATCHED_HINT =
  '有 {count} 条官方品质反馈暂未匹配到系统订单，暂不计入核心品退率。系统正在自动同步订单数据，稍后会刷新品退明细。'

/** @deprecated 使用 qualityVerifyDisplayLabel */
export function qualitySourceDisplayLabel(source: QualityRefundSource): string {
  switch (source) {
    case 'official_bad_case':
      return '官方品退'
    case 'after_sale':
      return '售后疑似品退'
    case 'both':
      return '官方品退，售后已印证'
    default:
      return '—'
  }
}
