/** 经营看板顶部卡片口径说明（仅前端展示，不改统计逻辑） */
export type BoardMetricExplainKey =
  | 'totalGmv'
  | 'validSalesAmount'
  | 'actualSignedAmount'
  | 'returnAmount'
  | 'orderCount'
  | 'signedOrderCount'
  | 'returnCount'
  | 'qualityReturnCount'
  | 'returnRate'
  | 'signRate'
  | 'qualityReturnRate'
  | 'highValueCount'
  | 'repurchaseCount'
  | 'refundCustomerCount'
  | 'qualityHeavyCount'
  | 'buyerRankingSample'
  | 'earnedAmount'

export const METRIC_EXPLAIN: Record<BoardMetricExplainKey, string> = {
  totalGmv:
    '本期销售额[GMV]：统计本期有支付时间的已支付订单实付金额汇总。已退款订单仍计入 GMV，退款金额与退款订单数另行统计。',
  validSalesAmount:
    '与运营报表同一口径：仅统计已完成/已签收、无在途售后且未成功退款的订单成交金额；先筛订单池再求和，不是支付减退款。',
  actualSignedAmount:
    '实际签收金额：统计本期已签收/已完成、且符合实际签收售后准入规则的订单，按 actualSignAmountCent 汇总。不是 GMV 减退款。',
  returnAmount:
    '退款金额：统计本期订单匹配到的真实商品退款金额汇总，纯运费补偿不计入。',
  orderCount: '本期总订单数：统计本期有支付时间的已支付订单数，按 P 订单号去重。',
  signedOrderCount:
    '实际签收订单数：统计本期实际签收的订单数，按 P 订单号去重。签收率 = 实际签收订单数 ÷ 本期总订单数。',
  returnCount: '退款订单数：统计本期发生退款/售后的订单数，按 P 订单号去重。退款率 = 退款订单数 ÷ 本期总订单数。',
  qualityReturnCount:
    '品退订单数：统计官方品质负反馈命中且匹配订单主表，或售后明确商品质量问题的订单数，按 P 单号去重。明细区分官方品退与售后疑似品退。',
  returnRate: '退款率 = 退款订单数 ÷ 本期总订单数（后端 summary.returnRate，前端不自行计算）。',
  signRate: '签收率 = 实际签收订单数 ÷ 本期总订单数（后端 summary.signRate，前端不自行计算）。',
  qualityReturnRate:
    '品退率 = 品退订单数 ÷ 支付订单数。数据来源：官方品质负反馈接口 + 售后接口交叉印证。官方接口当前覆盖近 30 天，超出范围使用历史缓存和售后原因辅助识别。',
  highValueCount:
    '满足当前高价值客户规则的客户数量，规则以后端返回的 highValueCustomerDefinition 为准。',
  repurchaseCount:
    '同一买家 ID 历史下单次数 ≥ 2 的客户数量。复购客户数基于已排除低价刷单订单后的历史样本统计。',
  refundCustomerCount:
    '历史累计存在成功退款或售后记录的客户数量。退款客户数基于已排除低价刷单订单后的历史样本统计。',
  qualityHeavyCount:
    '历史累计存在商品问题类售后记录的客户数量。品退客户数基于已排除低价刷单订单后的历史样本统计。',
  buyerRankingSample:
    '按支付时间统计，客户按买家ID去重。支付基数低于 ¥29.00 的低价刷单订单已自动排除。品退数据优先来自官方品质负反馈接口，并与售后接口交叉印证。复购/退款/品退客户数均基于排除低价刷单后的历史样本统计。',
  earnedAmount:
    '赚到金额 = 客户最终留下的真实成交金额。只统计已完成/已签收且未成功商品退款的订单。已取消、已关闭、未支付、未发货仅退款、商品全退订单不计入。纯运费退款不影响赚到金额。该金额不是利润，不扣成本。',
}

export function getMetricExplain(key: BoardMetricExplainKey): string {
  return METRIC_EXPLAIN[key] ?? ''
}
