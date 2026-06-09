import { OFFICIAL_GMV_ACCEPT_20260528 } from '../../src/services/board-metrics-debug.service'

export { OFFICIAL_GMV_ACCEPT_20260528 }

/** 金额比较允许误差（元） */
export const MONEY_TOLERANCE_YUAN = 0.01

export const GOLDEN_DATE = OFFICIAL_GMV_ACCEPT_20260528.date

export const GOLDEN_EXPECTATIONS = {
  paidAmountYuan: OFFICIAL_GMV_ACCEPT_20260528.paidAmountCent / 100,
  paidOrderCount: OFFICIAL_GMV_ACCEPT_20260528.paidOrderCount,
  refundAmountYuan: OFFICIAL_GMV_ACCEPT_20260528.refundAmountCent / 100,
} as const

export const ANCHOR_NAMES = ['子杰', '飞云'] as const

export type AnchorName = (typeof ANCHOR_NAMES)[number]

/** 买家排行 summary 卡片 ↔ summary-drill 映射 */
export const BUYER_SUMMARY_CHECKS = [
  { summaryKey: 'highValue', summaryField: 'highValueCount', label: '高价值客户' },
  { summaryKey: 'repurchase', summaryField: 'repurchaseCount', label: '复购客户' },
  { summaryKey: 'refund', summaryField: 'refundCount', label: '退款客户' },
  { summaryKey: 'qualityHeavy', summaryField: 'qualityHeavyCount', label: '品退客户' },
] as const
