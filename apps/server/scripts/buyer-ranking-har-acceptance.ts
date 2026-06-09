/**
 * 买家排行 HAR 字段回归（读取本地 debug/buyer-ranking-har/1.har，不提交 Git）
 *
 * 本脚本用 HAR 中的真实记录验证「通用规则」，样本仅作 fixture：
 * - 含 reason=700004 / 退运费 → 验证纯运费退款规则
 * - 含 return_type=5 未发货仅退款 → 验证未发货仅退款识别
 * - 含 user_id 字段 → 验证售后可按官方 ID 关联（非昵称）
 *
 * npx tsx apps/server/scripts/buyer-ranking-har-acceptance.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { aggregateWorkbenchRefund } from '../src/services/xhs-after-sales-workbench.service'
import {
  isReturnsV3FreightOnlyRefund,
  isReturnsV3UnshippedRefundOnly,
  pickReturnsV3BuyerUserId,
  splitReturnsV3RefundCent,
} from '../src/services/returns-v3-record.service'
import { classifyOrderAfterSale } from '../src/services/after-sale-classification.service'
import { resolveOrderProductRefund } from '../src/services/order-product-refund.service'
import type { NormalizedOrder } from '../src/types/analysis'
import {
  isRefundRankingBuyer,
  isSpendRankingBuyer,
} from '../src/services/buyer-ranking-tab-filters'
import type { BuyerRankingItem } from '../src/services/buyer-ranking.service'

const HAR_PATH = path.resolve(process.cwd(), 'debug/buyer-ranking-har/1.har')

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

function loadHarRecords(): Record<string, unknown>[] {
  if (!fs.existsSync(HAR_PATH)) {
    console.log(`[buyer-ranking-har] SKIP: 未找到 ${HAR_PATH}`)
    process.exit(0)
  }
  const har = JSON.parse(fs.readFileSync(HAR_PATH, 'utf8')) as {
    log: { entries: Array<{ request: { url: string }; response: { content: { text?: string } } }> }
  }
  const records: Record<string, unknown>[] = []
  for (const e of har.log.entries) {
    if (!e.request.url.includes('returns/v3')) continue
    const text = e.response.content.text ?? ''
    if (!text) continue
    let body: { data?: { after_sales?: unknown[] } }
    try {
      body = JSON.parse(text)
    } catch {
      continue
    }
    const list = body.data?.after_sales
    if (!Array.isArray(list)) continue
    for (const row of list) {
      if (row && typeof row === 'object') records.push(row as Record<string, unknown>)
    }
  }
  assert(records.length > 0, 'HAR 中无 returns/v3 记录')
  return records
}

function mockOrder(partial: Partial<NormalizedOrder>): NormalizedOrder {
  return {
    sourceRowIndex: 1,
    orderId: 'x',
    packageId: partial.packageId ?? 'P1',
    bizOrderId: 'x',
    officialOrderNo: partial.officialOrderNo ?? partial.packageId ?? 'P1',
    displayOrderNo: partial.displayOrderNo ?? partial.packageId ?? 'P1',
    matchOrderId: partial.matchOrderId ?? partial.packageId ?? 'P1',
    orderTime: null,
    orderTimeText: '',
    monthKey: '',
    buyerId: partial.buyerId ?? 'b',
    gmvCent: partial.gmvCent ?? 0,
    productAmountCent: partial.productAmountCent ?? partial.gmvCent ?? 0,
    receivableAmountCent: partial.receivableAmountCent ?? 0,
    freightCent: partial.freightCent ?? 0,
    platformDiscountCent: 0,
    actualPaidCent: partial.actualPaidCent ?? 0,
    actualSellerReceiveAmountCent: partial.actualSellerReceiveAmountCent ?? 0,
    gmvSourceUsed: '',
    amountWarnings: [],
    orderStatusText: partial.orderStatusText ?? '',
    afterSaleStatusText: partial.afterSaleStatusText ?? '',
    reasonText: '',
    isSigned: false,
    isReturned: partial.isReturned ?? false,
    isQualityReturn: false,
    actualSigned: false,
    actualSignedAmountCent: 0,
    errors: [],
    raw: partial.raw ?? {},
  }
}

function main(): void {
  const records = loadHarRecords()
  console.log(`[buyer-ranking-har] 加载 ${records.length} 条 returns/v3 记录`)

  const freightRec = records.find((r) => isReturnsV3FreightOnlyRefund(r))
  assert(Boolean(freightRec), 'HAR 应含纯运费退记录')
  const freightSplit = splitReturnsV3RefundCent(freightRec!)
  assert(freightSplit.isFreightOnly, '纯运费 split.isFreightOnly')
  assert(freightSplit.productRefundCent === 0, '纯运费 product=0')
  assert(freightSplit.freightRefundCent > 0, '纯运费 freight>0')
  console.log('OK 纯运费识别')

  const unshipped = records.find((r) => isReturnsV3UnshippedRefundOnly(r))
  assert(Boolean(unshipped), 'HAR 应含未发货仅退款记录')
  console.log('OK 未发货仅退款')

  const withUserId = records.filter((r) => pickReturnsV3BuyerUserId(r).length > 0)
  assert(withUserId.length > 0, 'HAR 应含 user_id 字段（售后按官方 ID 聚合，非昵称）')
  console.log(`OK 买家 user_id 聚合（${withUserId.length} 条含 user_id）`)

  const pkg = String(freightRec!.package_id ?? freightRec!.delivery_package_id)
  const agg = aggregateWorkbenchRefund([freightRec!], pkg)
  assert(agg.freightRefundAmountCent > 0, 'aggregate 运费>0')
  if (agg.hasFreightOnlyRefund) {
    const order = mockOrder({
      packageId: pkg,
      displayOrderNo: pkg,
      receivableAmountCent: agg.payAmountCent,
      actualSellerReceiveAmountCent: agg.payAmountCent,
      isReturned: true,
      afterSaleStatusText: '退款成功',
    })
    const cls = classifyOrderAfterSale(order, agg.officialRefundAmountCent, {
      afterSaleReasonText: agg.afterSaleReason,
      workbenchFreightRefundCent: agg.freightRefundAmountCent,
      workbenchHasFreightOnly: agg.hasFreightOnlyRefund,
    })
    assert(cls.isFreightRefundOnly, 'classify 纯运费')
    const resolved = resolveOrderProductRefund(order, cls, 0, {
      ...agg,
      fetchStatus: 'success',
      fetchError: null,
      fetchedAt: new Date(),
    })
    assert(resolved.productRefundAmountCent === 0, 'resolve product=0')
    assert(resolved.freightRefundAmountCent > 0, 'resolve freight>0')

    const spendItem = {
      buyerSummary: {
        netDealAmountCent: 100000,
        refundAmountCent: 0,
        refundOrderCount: 0,
        qualityRefundOrderCount: 0,
        receivableAmountCent: 0,
        payAmountCent: 0,
        orderCount: 1,
        paidOrderCount: 1,
        pendingAfterSaleOrderCount: 0,
      },
      actualDealAmount: 1000,
      freightRefundAmount: resolved.freightRefundAmountCent / 100,
      gmv: 1000,
      productRefundAmount: 0,
      refundCount: 0,
    } as BuyerRankingItem
    assert(!isRefundRankingBuyer(spendItem), '纯运费不进退款排行')
    assert(isSpendRankingBuyer(spendItem), '有 netDeal 仍可进消费排行')
  }

  console.log('[buyer-ranking-har] PASS')
}

main()
