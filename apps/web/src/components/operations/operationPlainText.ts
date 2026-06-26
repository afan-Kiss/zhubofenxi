import type { RankingConfidence } from '../../pages/operations/operationsReportTypes'

/** 用户可见文案：把内部字段名换成大白话 */

export const PLAIN = {
  dataQualityTitle: '数据是否靠谱',
  dataReminder: '数据提醒',
  basis: '依据',
  rankReason: '上榜原因',
  confidence: '把握程度',
  actionStatus: '处理状态',
  businessInsights: '经营建议',
  sampleTooSmall: '样本太少，只能先参考，别直接下结论',
  insufficientData: '数据不够，暂时不能可靠判断',
  noInsights: '暂无足够可靠的数据生成经营建议。',
  noNextMonthActions: '暂无足够可靠的数据生成下月重点动作。',
  insightStatsNote:
    '这里统计的是已经被点过处理/忽略/复盘的建议；没点过的建议不算进去。',
  dealRateMissing: '缺少官方成交人数，暂时算不出成交率。',
  highReturnHint: '退货偏高，建议先看看商品描述、圈口说明和质检。',
  riskIntro: '这些不是一定有问题，但值得优先看一眼。',
  validAmount: '有效成交金额',
  soldOrders: '成交订单数',
  soldCount: '成交件数',
  buyerCount: '成交买家数',
  productReturnRate: '商品退货率',
  followerRate: '涨粉率',
  dealRate: '成交率',
  comparePrev: '比上期',
  monthlyOverviewHint: '本月一共卖了多少钱、出了多少单、退货压力大不大、流量和成交有没有跟上。',
  compareHint: '比上个月多卖了/少卖了多少钱，订单是涨了还是掉了，退货有没有变严重。',
  anchorAmountHint: '这个榜看的是谁本月成交金额高。',
  anchorHourlyHint: '这个榜看的是谁在有直播时长的情况下卖得更快。',
  anchorDealHint: '这个榜只在官方流量数据完整时展示，避免拿订单数冒充成交人数。',
  hotProductHint: '热卖商品：这个月卖得最多、成交金额最高的商品。',
  highReturnProductHint:
    '高退货商品：这些商品需要复查描述、实物、圈口说明和主播话术。',
  slowProductHint:
    '主推没卖动：只有维护了主推商品池，系统才会判断；没有主推池就不乱说滞销。',
  priceBandHint: '看这个月钱主要是从哪个价位段来的。',
  priceBandGoodHint: '如果一个价格带成交多、退货低，下个月可以优先备货和排品。',
  afterSalesHint: '看顾客为什么退、为什么不满意，方便下个月提前避坑。',
} as const

export const CONFIDENCE_LABEL: Record<RankingConfidence, string> = {
  high: '把握大',
  medium: '把握一般',
  low: '把握小',
  insufficient: '数据不够',
}

export const ACTION_STATUS_LABEL = {
  pending: '待处理',
  handled: '已处理',
  ignored: '已忽略',
  reviewed: '已复盘',
} as const

export function formatChangePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value}%`
}

export function humanizeWarning(text: string): string {
  return text
    .replace(/sampleTooSmall/gi, PLAIN.sampleTooSmall)
    .replace(/insufficient_data/gi, PLAIN.insufficientData)
    .replace(/dataQuality/gi, PLAIN.dataQualityTitle)
    .replace(/businessInsights/gi, PLAIN.businessInsights)
    .replace(/Ranking Quality Warning/gi, PLAIN.dataReminder)
}
