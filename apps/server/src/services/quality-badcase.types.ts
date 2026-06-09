export type QualityBadCaseMatchStatus =
  | 'matched_order_and_after_sale'
  | 'matched_order_only'
  | 'matched_after_sale_only'
  | 'unmatched'

export type QualityBadCaseSource = 'official_quality_badcase'

/** 品退来源：官方品质问题 / 售后工作台 / 两者 */
export type QualityRefundSource = 'official_bad_case' | 'after_sale' | 'both' | 'none'

export interface NormalizedQualityBadCase {
  caseKey: string
  liveAccountId: string
  packageId: string
  sourceBizId: string | null
  itemId: string
  itemName: string
  itemImage: string
  problemType: string
  negativeReasons: string[]
  feedbackContent: string
  feedbackTime: string | null
  packagePayTime: string | null
  matchedOrderNo: string
  matchedOrderId: string
  matchedAfterSaleId: string
  matchedBuyerId: string
  matchedBuyerNickname: string
  matchedAnchorId: string
  matchedAnchorName: string
  afterSaleStatus: string
  afterSaleReason: string
  afterSaleRefundAmount: number
  afterSaleRefunded: boolean
  source: QualityBadCaseSource
  matchStatus: QualityBadCaseMatchStatus
  confidence: string
  /** 来源直播号 / 平台账号 */
  platformName?: string
}

export interface QualityBadCaseCoverage {
  source: QualityBadCaseSource
  windowDays: number
  startTime: string | null
  endTime: string | null
  lastSyncedAt: string | null
}

export const QUALITY_SUMMARY_TIME_WINDOW_CODE = '1000'
export const QUALITY_DETAIL_TIME_WINDOW_CODE = 30
export const QUALITY_DETAIL_PROBLEM_TYPE = '品质问题'

export const QUALITY_BAD_CASE_REFERER =
  'https://ark.xiaohongshu.com/app-violation/quality-negative-feedback'

export const QUALITY_BAD_CASE_API = {
  summaryList:
    'https://ark.xiaohongshu.com/api/edith/shop/score/item/quality/negative/badcase/list',
  itemDetail: 'https://ark.xiaohongshu.com/api/edith/list/item/bad/case',
  itemIndex: 'https://ark.xiaohongshu.com/api/edith/get/bad/case/item/index/detail',
} as const

export function matchStatusLabel(status: QualityBadCaseMatchStatus): string {
  switch (status) {
    case 'matched_order_and_after_sale':
      return '已匹配订单和售后'
    case 'matched_order_only':
      return '已匹配订单，未匹配售后'
    case 'matched_after_sale_only':
      return '已匹配售后，未匹配订单'
    default:
      return '暂未匹配，需要同步订单'
  }
}

/** 已进入系统订单匹配，可计入核心品退率分子 */
export function isQualityBadCaseOrderMatched(
  c: NormalizedQualityBadCase,
): boolean {
  return isQualityBadCaseMatchStatusMatched(c.matchStatus)
}

export function isQualityBadCaseMatchStatusMatched(
  status: QualityBadCaseMatchStatus | string | undefined,
): boolean {
  return status === 'matched_order_and_after_sale' || status === 'matched_order_only'
}
