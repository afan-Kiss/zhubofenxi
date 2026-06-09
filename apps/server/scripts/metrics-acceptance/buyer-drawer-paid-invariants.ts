/**
 * 买家详情 Drawer 赚到金额通用规则（全量扫描，不硬编码买家/订单号）
 */
import { getJson } from './api-client'
import { logFail, logPass, logSkip, num } from './assertions'
import { resolveOfficialPaidAmountCent } from '../../src/services/resolve-official-paid-amount.service'
import { resolveDisplayEarnedAmountCent } from '../../src/services/buyer-earned-amount.service'
import type { NormalizedOrder } from '../../src/types/analysis'

type BuyerProfileResponse = {
  items?: Array<Record<string, unknown>>
}

type BuyerOrdersResponse = {
  buyerSummary?: Record<string, unknown>
  summary?: Record<string, unknown>
  pagination?: { total: number }
  rows?: Array<Record<string, unknown>>
}

const CANCELLED_OR_UNPAID = /已取消|已关闭|未支付|待付款|待支付|交易关闭/

function mockCancelledHighPriceOrder(): NormalizedOrder {
  return {
    sourceRowIndex: 1,
    orderId: 'x',
    packageId: 'P-test',
    bizOrderId: 'x',
    officialOrderNo: 'P-test',
    displayOrderNo: 'P-test',
    matchOrderId: 'P-test',
    orderTime: null,
    orderTimeText: '',
    monthKey: '',
    buyerId: 'b',
    gmvCent: 9_994_200,
    productAmountCent: 9_994_200,
    receivableAmountCent: 9_994_200,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 0,
    actualSellerReceiveAmountCent: 9_994_200,
    gmvSourceUsed: '',
    amountWarnings: [],
    orderStatusText: '已取消',
    afterSaleStatusText: '',
    reasonText: '',
    isSigned: false,
    isReturned: false,
    isQualityReturn: false,
    actualSigned: false,
    actualSignedAmountCent: 0,
    errors: [],
    raw: {
      payAmount: 99942,
      totalOrderAmount: 99942,
      skus: [{ payAmount: 99942, skuName: '参考图' }],
    },
  }
}

function checkCancelledOrderPaidRules(): void {
  const resolved = resolveOfficialPaidAmountCent(mockCancelledHighPriceOrder())
  if (resolved.cent === 0 && resolved.source !== 'official_actual_pay') {
    logPass(
      'buyer-drawer:rule:cancelled-no-fake-paid',
      `已取消且无 payTime：paid=0 source=${resolved.source}`,
    )
  } else {
    logFail({
      name: 'buyer-drawer:rule:cancelled-no-fake-paid',
      message: '已取消订单不得用商品标价兜底为实付',
      actual: resolved,
    })
  }
}

function rowEarnedCent(r: Record<string, unknown>): number {
  if (r.earnedAmountCent != null && r.earnedAmountCent !== '') {
    return num(r.earnedAmountCent)
  }
  if (r.earnedAmount != null) return Math.round(num(r.earnedAmount) * 100)
  if (r.realDealAmountCent != null) return num(r.realDealAmountCent)
  return 0
}

async function fetchAllBuyerRows(buyerKey: string): Promise<BuyerOrdersResponse> {
  const key = encodeURIComponent(buyerKey)
  const { data } = await getJson<BuyerOrdersResponse>(
    `/api/board/buyer-profile/${key}/orders?page=1&pageSize=500&tab=all`,
  )
  return data
}

async function checkDrawerEarnedAmountRules(items: Array<Record<string, unknown>>): Promise<void> {
  let missingDisplayEarned = 0
  let summaryEarnedMismatch = 0
  let cancelledFakeEarned = 0

  for (const item of items.slice(0, 15)) {
    const buyerKey = String(item.buyerKey ?? '')
    if (!buyerKey) continue

    const summaryRaw = (item.buyerSummary ?? {}) as Record<string, unknown>
    if (summaryRaw.displayEarnedAmountCent == null && summaryRaw.netDealAmountCent == null) {
      missingDisplayEarned += 1
    }

    const itemEarned = resolveDisplayEarnedAmountCent({
      displayEarnedAmountCent: num(summaryRaw.displayEarnedAmountCent),
      netDealAmountCent: num(summaryRaw.netDealAmountCent),
      realDealAmountCent: num(summaryRaw.realDealAmountCent),
    })
    const apiEarned = num(item.displayEarnedAmountCent)
    if (apiEarned > 0 && itemEarned !== apiEarned && summaryRaw.displayEarnedAmountCent != null) {
      missingDisplayEarned += 1
    }

    const data = await fetchAllBuyerRows(buyerKey)
    const rows = data.rows ?? []
    const total = num(data.pagination?.total)
    if (total > rows.length) continue

    const summary = (data.buyerSummary ?? data.summary ?? {}) as Record<string, unknown>
    const headerEarned = resolveDisplayEarnedAmountCent({
      displayEarnedAmountCent: num(summary.displayEarnedAmountCent),
      netDealAmountCent: num(summary.netDealAmountCent),
      realDealAmountCent: num(summary.realDealAmountCent),
    })
    const rowEarnedSum = rows.reduce((s, r) => s + rowEarnedCent(r), 0)
    if (total > 0 && total <= rows.length && rowEarnedSum !== headerEarned) {
      summaryEarnedMismatch += 1
    }

    for (const r of rows) {
      const status = String(r.orderStatusText ?? r.orderStatusLabel ?? r.cardStatusLabel ?? r.orderStatus ?? '')
      const payTime = r.payTime
      const earned = rowEarnedCent(r)
      if (CANCELLED_OR_UNPAID.test(status) && !payTime && earned > 0) {
        cancelledFakeEarned += 1
      }
    }
  }

  if (missingDisplayEarned === 0) {
    logPass(
      'buyer-drawer:rule:display-earned-field',
      'OK 买家排行条目均提供 displayEarnedAmountCent 或 netDealAmountCent',
    )
  } else {
    logFail({
      name: 'buyer-drawer:rule:display-earned-field',
      message: '存在缺少 displayEarnedAmountCent 映射的买家条目',
      actual: missingDisplayEarned,
    })
  }

  if (summaryEarnedMismatch === 0) {
    logPass(
      'buyer-drawer:rule:earned-summary-equals-rows',
      'OK Drawer 顶部赚到金额与订单行 earned 汇总一致',
    )
  } else {
    logFail({
      name: 'buyer-drawer:rule:earned-summary-equals-rows',
      message: 'Drawer 顶部 displayEarnedAmountCent 与订单行 earned 汇总不一致',
      actual: summaryEarnedMismatch,
    })
  }

  if (cancelledFakeEarned === 0) {
    logPass(
      'buyer-drawer:rule:cancelled-zero-earned-rows',
      'OK 已取消/未支付且无 payTime 的订单行赚到金额为 0',
    )
  } else {
    logFail({
      name: 'buyer-drawer:rule:cancelled-zero-earned-rows',
      message: '存在已取消/未支付但 earnedAmountCent>0 的订单行',
      actual: cancelledFakeEarned,
    })
  }
}

export async function checkBuyerDrawerPaidRules(profileReady: boolean): Promise<void> {
  checkCancelledOrderPaidRules()

  if (!profileReady) {
    logSkip('buyer-drawer:rule:api-scan', 'buyer profile 未就绪，跳过 Drawer API 扫描')
    return
  }

  const { data } = await getJson<BuyerProfileResponse>('/api/board/buyer-profile')
  const items = data.items ?? []
  if (items.length === 0) {
    logSkip('buyer-drawer:rule:api-scan', 'profile 无买家')
    return
  }

  await checkDrawerEarnedAmountRules(items)
}
