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
    '统计本期有支付时间的订单实付金额。已支付后退款/取消的订单仍计入支付金额，退款另行统计。',
  validSalesAmount:
    '统计本期已支付订单的有效成交金额，已扣除当期有效成功退款，不含运费补偿类售后。',
  actualSignedAmount:
    '统计本期已签收/已完成订单中，无售后、售后已取消，或成功商品退款不超过 ¥20.00 的净签收金额。纯运费补偿不计入退款。',
  returnAmount:
    '统计本期订单主表中，已匹配成功售后的退款金额。表外售后不计入主指标。',
  orderCount: '统计本期有支付时间的订单数，按 P 订单号去重。',
  signedOrderCount:
    '统计本期已签收/已完成，且无售后、售后已取消，或商品退款不超过 ¥20.00 的订单数，按 P 订单号去重。',
  returnCount: '统计本期发生退款/售后的订单数，按 P 订单号去重。',
  qualityReturnCount:
    '统计当前范围内命中官方品质负反馈明细或售后商品问题逻辑的唯一 P 单号数量。数据来源：官方品质负反馈接口 + 售后接口交叉印证。',
  returnRate: '退款率 = 退款单数 ÷ 支付订单数。',
  signRate: '签收率 = 签收单数 ÷ 支付订单数。',
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
    '按支付时间统计，客户按买家ID去重。单价低于 ¥20.00 的低价刷单订单已自动排除。品退数据优先来自官方品质负反馈接口，并与售后接口交叉印证。复购/退款/品退客户数均基于排除低价刷单后的历史样本统计。',
  earnedAmount:
    '赚到金额 = 客户最终留下的真实成交金额。只统计已完成/已签收且未成功商品退款的订单。已取消、已关闭、未支付、未发货仅退款、商品全退订单不计入。纯运费退款不影响赚到金额。该金额不是利润，不扣成本。',
}

export function getMetricExplain(key: BoardMetricExplainKey): string {
  return METRIC_EXPLAIN[key] ?? ''
}
