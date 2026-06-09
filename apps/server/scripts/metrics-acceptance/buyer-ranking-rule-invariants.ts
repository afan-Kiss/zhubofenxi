/**
 * 买家排行通用规则断言（扫描全量 profile，不按昵称/buyerId/packageId 过滤）
 *
 * 回归样本（简序Studio / 李玲 / 一闪一闪小星星 / 腾棋）仅用于 HAR 脚本验证，
 * 本文件只验证通用不变量，适用于任意买家。
 */
import { getJson } from './api-client'
import { logFail, logPass, logSkip, num } from './assertions'
import {
  isRefundRankingBuyer,
  isSpendRankingBuyer,
} from '../../src/services/buyer-ranking-tab-filters'
import { isHighValueBuyer } from '../../src/services/buyer-ranking-classification'
import { resolveDisplayEarnedAmountCent } from '../../src/services/buyer-earned-amount.service'
import { isStaleBuyerRankingKey } from '../../src/services/buyer-identity.service'
import { classifyAfterSaleRecord } from '../../src/services/classify-after-sale-record.service'
import type { BuyerRankingItem } from '../../src/services/buyer-ranking.service'

type BuyerProfileResponse = {
  rebuilding?: boolean
  items?: Array<Record<string, unknown>>
}

function toRankingItem(row: Record<string, unknown>): BuyerRankingItem {
  const summary = (row.buyerSummary ?? {}) as BuyerRankingItem['buyerSummary']
  return {
    buyerKey: String(row.buyerKey ?? ''),
    buyerId: String(row.buyerId ?? row.buyerKey ?? ''),
    nickname: String(row.nickname ?? row.buyerDisplayName ?? ''),
    orderCount: num(row.orderCount),
    signedOrderCount: num(row.signedOrderCount),
    unsignedOrderCount: num(row.unsignedOrderCount),
    completedOrderCount: num(row.completedOrderCount),
    returnRefundCount: num(row.returnRefundCount),
    refundOnlyCount: num(row.refundOnlyCount),
    freightRefundCount: num(row.freightRefundCount),
    afterSaleClosedNoRefundCount: num(row.afterSaleClosedNoRefundCount),
    gmv: num(row.gmv),
    signedAmount: num(row.signedAmount),
    productRefundAmount: num(row.productRefundAmount),
    freightRefundAmount: num(row.freightRefundAmount),
    actualDealAmount: num(row.actualDealAmount),
    earnedAmount: num(row.earnedAmount),
    displayEarnedAmountCent: num(row.displayEarnedAmountCent),
    qualityReturnCount: num(row.qualityReturnCount),
    refundRelatedOrderCount: num(row.refundRelatedOrderCount),
    refundTimes: num(row.refundTimes),
    sizeMismatchCount: num(row.sizeMismatchCount),
    lastOrderTime: String(row.lastOrderTime ?? '—'),
    customerTags: [],
    customerTag: '—',
    isBlacklisted: false,
    suggestion: '—',
    riskScore: num(row.riskScore),
    buyerSummary: summary,
  }
}

function summaryOf(row: Record<string, unknown>): Record<string, unknown> {
  return (row.buyerSummary ?? {}) as Record<string, unknown>
}

/** 规则 1：纯运费退款 — classifyAfterSaleRecord 合成记录（不依赖 HAR/样本 ID） */
function checkFreightOnlyClassificationRules(): void {
  const freightRec = {
    reason: 700004,
    reason_name_zh: '退运费',
    refund_fee: 18,
    refund_status: 2,
    refund_status_name: '退款成功',
    status_name: '已完成',
    refund_only_delivery_status: 1,
  }
  const c = classifyAfterSaleRecord(freightRec, { orderFreightCent: 1800 })
  if (
    c.isFreightOnlyRefund &&
    c.productRefundAmountCent === 0 &&
    c.freightRefundAmountCent === 1800 &&
    !c.isProductRefund
  ) {
    logPass(
      'buyer-ranking:rule:freight-classify',
      '纯运费：product=0 freight=refund_fee',
    )
  } else {
    logFail({
      name: 'buyer-ranking:rule:freight-classify',
      message: 'classifyAfterSaleRecord 纯运费规则失败',
      actual: c,
    })
  }
}

/** 规则 2：未发货仅退款 — 合成记录 */
function checkUnshippedRefundClassificationRules(): void {
  const rec = {
    return_type: 5,
    return_type_name: '未发货仅退款',
    refund_fee: 317,
    refund_status: 2,
    refund_status_name: '退款成功',
    status_name: '已完成',
  }
  const c = classifyAfterSaleRecord(rec)
  if (c.isProductRefund && c.isUnshippedRefundOnly && c.productRefundAmountCent === 31700) {
    logPass('buyer-ranking:rule:unshipped-classify', '未发货仅退款计入 productRefund')
  } else {
    logFail({
      name: 'buyer-ranking:rule:unshipped-classify',
      message: 'classifyAfterSaleRecord 未发货仅退款规则失败',
      actual: c,
    })
  }
}

/** 规则 3：售后中 / 已取消 — 合成记录 */
function checkPendingAndCancelledClassificationRules(): void {
  const pending = classifyAfterSaleRecord({
    status_name: '待收货',
    refund_fee: 0,
  })
  const cancelled = classifyAfterSaleRecord({
    status_name: '已取消',
    refund_fee: 0,
  })
  const okPending =
    pending.isAfterSalePending &&
    pending.productRefundAmountCent === 0 &&
    !pending.isProductRefund
  const okCancelled =
    cancelled.isAfterSaleCancelledOrClosed &&
    cancelled.productRefundAmountCent === 0 &&
    !cancelled.isProductRefund
  if (okPending && okCancelled) {
    logPass(
      'buyer-ranking:rule:pending-cancel-classify',
      '售后中/已取消不计入成功退款',
    )
  } else {
    logFail({
      name: 'buyer-ranking:rule:pending-cancel-classify',
      message: '售后中或已取消不应产生 productRefund',
      actual: { pending, cancelled },
    })
  }
}

/** 规则 4–6：扫描全量 buyer profile 不变量 */
async function checkProfileInvariants(items: Array<Record<string, unknown>>): Promise<void> {
  let noRealDealInSpend = 0
  let freightOnlyInRefundRank = 0
  let productFreightPolluted = 0
  let staleBuyerKeys = 0
  let freightOnlyWithRefundOrders = 0
  let missingEarnedField = 0
  let realDealZeroButEarnedPositive = 0

  for (const row of items) {
    const summary = summaryOf(row)
    const productCent = num(summary.refundAmountCent)
    const freightCent = num(summary.freightRefundAmountCent)
    const realDealCent = num(summary.realDealAmountCent)
    const earnedCent = resolveDisplayEarnedAmountCent({
      displayEarnedAmountCent: num(summary.displayEarnedAmountCent),
      netDealAmountCent: num(summary.netDealAmountCent),
      realDealAmountCent: realDealCent,
    })
    const refundOrders = num(summary.refundOrderCount)
    const buyerKey = String(row.buyerKey ?? '')
    const nickname = String(row.nickname ?? row.buyerDisplayName ?? '')
    const item = toRankingItem(row)

    if (summary.displayEarnedAmountCent == null && summary.netDealAmountCent == null) {
      missingEarnedField += 1
    }
    if (realDealCent <= 0 && earnedCent > 0) {
      realDealZeroButEarnedPositive += 1
    }

    if (realDealCent <= 0 && (isSpendRankingBuyer(item) || isHighValueBuyer(item))) {
      noRealDealInSpend += 1
    }

    if (freightCent > 0 && productCent === 0) {
      if (isRefundRankingBuyer(item)) freightOnlyInRefundRank += 1
      if (refundOrders > 0) freightOnlyWithRefundOrders += 1
    }

    if (freightCent > 0 && productCent > 0 && productCent === freightCent) {
      productFreightPolluted += 1
    }

    if (isStaleBuyerRankingKey(buyerKey, nickname)) {
      staleBuyerKeys += 1
    }
  }

  if (noRealDealInSpend === 0) {
    logPass(
      'buyer-ranking:rule:no-real-deal-not-spend',
      `OK 全量 ${items.length} 买家：realDeal=0 未进消费/高价值`,
    )
  } else {
    logFail({
      name: 'buyer-ranking:rule:no-real-deal-not-spend',
      message: '存在 realDealAmount=0 仍进入消费排行或高价值客户的买家',
      actual: noRealDealInSpend,
      hint: '检查 resolveBuyerOrderBusinessMetrics / isSpendRankingBuyer',
    })
  }

  if (freightOnlyInRefundRank === 0) {
    logPass(
      'buyer-ranking:rule:freight-not-refund-rank',
      'OK 纯运费买家未进入退款排行',
    )
  } else {
    logFail({
      name: 'buyer-ranking:rule:freight-not-refund-rank',
      message: '存在仅运费退款仍进入退款排行的买家',
      actual: freightOnlyInRefundRank,
    })
  }

  if (freightOnlyWithRefundOrders === 0) {
    logPass(
      'buyer-ranking:rule:freight-no-refund-order-count',
      'OK 纯运费未增加 refundOrderCount',
    )
  } else {
    logFail({
      name: 'buyer-ranking:rule:freight-no-refund-order-count',
      message: '存在纯运费退款但 refundOrderCount>0 的买家',
      actual: freightOnlyWithRefundOrders,
    })
  }

  if (productFreightPolluted === 0) {
    logPass(
      'buyer-ranking:rule:product-excludes-freight',
      'OK 商品退款金额未与运费退款混淆',
    )
  } else {
    logFail({
      name: 'buyer-ranking:rule:product-excludes-freight',
      message: '存在 productRefund=freight 污染',
      actual: productFreightPolluted,
    })
  }

  if (staleBuyerKeys === 0) {
    logPass(
      'buyer-ranking:rule:official-buyer-key',
      'OK 全量买家均使用官方 buyerKey（非裸昵称主键）',
    )
  } else {
    logFail({
      name: 'buyer-ranking:rule:official-buyer-key',
      message: '存在以裸昵称/nick: 作为主聚合键的买家',
      actual: staleBuyerKeys,
      hint: '检查 resolveBuyerIdentity 优先级',
    })
  }

  if (missingEarnedField === 0) {
    logPass(
      'buyer-ranking:rule:display-earned-field',
      `OK 全量 ${items.length} 买家均提供 displayEarnedAmountCent 或 netDealAmountCent`,
    )
  } else {
    logFail({
      name: 'buyer-ranking:rule:display-earned-field',
      message: '存在缺少 displayEarnedAmountCent 映射的买家',
      actual: missingEarnedField,
    })
  }

  if (realDealZeroButEarnedPositive === 0) {
    logPass(
      'buyer-ranking:rule:real-deal-zero-earned-zero',
      'OK realDealAmount=0 的买家赚到金额也为 0',
    )
  } else {
    logFail({
      name: 'buyer-ranking:rule:real-deal-zero-earned-zero',
      message: '存在 realDeal=0 但 displayEarnedAmountCent>0 的买家',
      actual: realDealZeroButEarnedPositive,
    })
  }
}

export async function checkBuyerRankingRuleInvariants(profileReady: boolean): Promise<void> {
  checkFreightOnlyClassificationRules()
  checkUnshippedRefundClassificationRules()
  checkPendingAndCancelledClassificationRules()

  if (!profileReady) {
    logSkip('buyer-ranking:rule:profile-scan', 'buyer profile 未就绪，跳过全量扫描')
    return
  }

  const { data } = await getJson<BuyerProfileResponse>('/api/board/buyer-profile')
  const items = data.items ?? []
  if (items.length === 0) {
    logSkip('buyer-ranking:rule:profile-scan', 'profile 无买家条目')
    return
  }

  await checkProfileInvariants(items)
}
