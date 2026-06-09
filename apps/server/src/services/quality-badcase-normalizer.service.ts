import type { QualityDetailItem, QualitySummaryItem } from './quality-badcase-api.service'
import type { NormalizedQualityBadCase } from './quality-badcase.types'

function buildCaseKey(input: {
  packageId: string
  sourceBizId: string | null
  itemId: string
  feedbackTime: string | null
}): string {
  if (input.sourceBizId) return `${input.packageId}_${input.sourceBizId}`
  const ft = input.feedbackTime ?? 'unknown'
  return `${input.packageId}_${input.itemId}_${ft}`
}

export function normalizeQualityDetailRow(
  detail: QualityDetailItem,
  summary: QualitySummaryItem,
  liveAccountId: string,
): NormalizedQualityBadCase {
  return {
    caseKey: buildCaseKey({
      packageId: detail.packageId,
      sourceBizId: detail.sourceBizId,
      itemId: detail.itemId,
      feedbackTime: detail.feedbackTime,
    }),
    liveAccountId,
    packageId: detail.packageId,
    sourceBizId: detail.sourceBizId,
    itemId: detail.itemId,
    itemName: summary.itemName,
    itemImage: summary.itemImage,
    problemType: '品质问题',
    negativeReasons:
      detail.negativeReasonList.length > 0
        ? detail.negativeReasonList
        : summary.negativeReasonList,
    feedbackContent: detail.feedbackContent,
    feedbackTime: detail.feedbackTime,
    packagePayTime: detail.packagePayTime,
    matchedOrderNo: detail.packageId,
    matchedOrderId: '',
    matchedAfterSaleId: detail.sourceBizId ?? '',
    matchedBuyerId: '',
    matchedBuyerNickname: '',
    matchedAnchorId: '',
    matchedAnchorName: '',
    afterSaleStatus: '',
    afterSaleReason: '',
    afterSaleRefundAmount: 0,
    afterSaleRefunded: false,
    source: 'official_quality_badcase',
    matchStatus: 'unmatched',
    confidence: 'high',
  }
}
