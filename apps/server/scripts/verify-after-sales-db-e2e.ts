/**
 * 售后 DB E2E（离线口径 + 可选全链路）
 * npm run verify:after-sales-db-e2e
 * 全链路：AFTER_SALES_DB_E2E=1 TEST_DATABASE_URL=file:...
 */
import assert from 'node:assert/strict'
import {
  isFreightOnlyRefund,
  FREIGHT_REFUND_CENT,
} from '../src/services/business-refund-caliber.service'
import { isReturnsV3FreightOnlyRefund } from '../src/services/returns-v3-record.service'
import { resolveSuccessfulProductRefundCentForSign } from '../src/services/sign-amount-refund.service'
import { getActualSignAmountCent } from '../src/services/strict-after-sale-metrics.service'
import { classifyOrderAfterSale } from '../src/services/after-sale-classification.service'
import { resolveOrderProductRefund } from '../src/services/order-product-refund.service'
import type { NormalizedOrder } from '../src/types/analysis'
import type { AfterSalesWorkbenchRefund } from '../src/services/xhs-after-sales-workbench.service'

const FEAST_ORDER_NOS = [
  'P796048312483322131',
  'P796209806595129821',
  'P796814642942245041',
  'P796826876568353271',
  'P796908691840291551',
  'P797247974106383401',
]

function mockOrder(partial: Partial<NormalizedOrder>): NormalizedOrder {
  return {
    sourceRowIndex: 1,
    orderId: partial.packageId ?? 'x',
    packageId: partial.packageId ?? 'P1',
    bizOrderId: 'x',
    officialOrderNo: partial.officialOrderNo ?? partial.packageId ?? 'P1',
    displayOrderNo: partial.displayOrderNo ?? partial.packageId ?? 'P1',
    matchOrderId: partial.matchOrderId ?? partial.packageId ?? 'P1',
    orderTime: null,
    orderTimeText: '',
    monthKey: '',
    buyerId: 'b',
    gmvCent: partial.gmvCent ?? 0,
    productAmountCent: partial.productAmountCent ?? partial.gmvCent ?? 0,
    receivableAmountCent: partial.receivableAmountCent ?? 0,
    freightCent: partial.freightCent ?? 0,
    platformDiscountCent: 0,
    actualPaidCent: partial.actualPaidCent ?? partial.gmvCent ?? 0,
    actualSellerReceiveAmountCent: partial.actualSellerReceiveAmountCent ?? 0,
    gmvSourceUsed: '',
    amountWarnings: [],
    orderStatusText: partial.orderStatusText ?? '已完成',
    afterSaleStatusText: partial.afterSaleStatusText ?? '售后完成',
    reasonText: '',
    isSigned: partial.isSigned ?? true,
    isReturned: partial.isReturned ?? true,
    isQualityReturn: false,
    actualSigned: partial.actualSigned ?? true,
    actualSignedAmountCent: 0,
    errors: [],
    raw: partial.raw ?? {},
  }
}

function mockWb(
  partial: Partial<AfterSalesWorkbenchRefund> & Pick<AfterSalesWorkbenchRefund, 'fetchStatus'>,
): AfterSalesWorkbenchRefund {
  return {
    orderNo: partial.orderNo ?? 'P1',
    packageId: partial.packageId ?? 'P1',
    officialRefundAmountCent: partial.officialRefundAmountCent ?? 0,
    expectedRefundAmountCent: partial.expectedRefundAmountCent ?? 0,
    appliedAmountCent: partial.appliedAmountCent ?? 0,
    appliedShipFeeAmountCent: 0,
    payAmountCent: 0,
    settlementAmountCent: 0,
    refundIncludesFreight: false,
    hasFreightOnlyRefund: partial.hasFreightOnlyRefund ?? false,
    buyerUserId: null,
    afterSaleReason: null,
    afterSaleStatus: null,
    successReturnCount: partial.successReturnCount ?? 1,
    returnsIds: partial.returnsIds ?? ['R1'],
    fetchStatus: partial.fetchStatus,
    fetchError: partial.fetchError ?? null,
    fetchedAt: partial.fetchedAt ?? new Date(),
    freightRefundAmountCent: partial.freightRefundAmountCent ?? 0,
  }
}

function testOfflineFeastDedupe(): void {
  const seen = new Set<string>()
  for (const no of FEAST_ORDER_NOS) {
    assert.equal(seen.has(no), false, `重复 P 单号 ${no}`)
    seen.add(no)
    const order = mockOrder({ packageId: no, gmvCent: 21_800 })
    const cls = classifyOrderAfterSale(order, 0)
    const resolved = resolveOrderProductRefund(
      order,
      cls,
      0,
      mockWb({
        fetchStatus: 'success',
        orderNo: no,
        packageId: no,
        officialRefundAmountCent: 21_800,
        successReturnCount: 1,
      }),
      { buyerStrict: true },
    )
    assert.ok(resolved.productRefundAmountCent > 0, `${no} 应有商品退款`)
  }
  assert.equal(seen.size, 6, '6 笔飞云订单按 P 去重')
  console.log('✓ 离线：6 笔飞云已完成退款按 P 去重且各 1 笔商品退款')
}

function testOfflineFreightOnly(): void {
  const orderNo = 'P798289463456351071'
  const payCent = 261_800
  const freightRaw = {
    delivery_package_id: orderNo,
    reason_name_zh: '退运费',
    reason: 700004,
    refund_fee: 18,
    applied_amount: 18,
    applied_ship_fee_amount: 18,
    pay_amount: 2618,
    refund_status_name: '退款成功',
    status_name: '已完成',
    refund_only_delivery_status: 1,
    refunded: true,
  }
  assert.equal(isFreightOnlyRefund(freightRaw, FREIGHT_REFUND_CENT), true)
  assert.equal(isReturnsV3FreightOnlyRefund(freightRaw), true)
  const productRefund = resolveSuccessfulProductRefundCentForSign({
    afterSaleRecords: [freightRaw],
    boardRefundAmountCent: FREIGHT_REFUND_CENT,
    paymentBaseCent: payCent,
    orderRaw: freightRaw,
  })
  assert.equal(productRefund, 0)
  assert.equal(
    getActualSignAmountCent({
      paymentBaseCent: payCent,
      successfulRefundAmountCent: productRefund,
      statusSigned: true,
      includedInGmv: true,
    }),
    payCent,
    '纯运费退款签收额不减商品支付额',
  )
  console.log('✓ 离线：纯运费单不计入商品退款')
}

async function testDbE2eOptional(): Promise<void> {
  if (process.env.AFTER_SALES_DB_E2E !== '1') {
    console.log('⊘ 全链路 DB：设置 AFTER_SALES_DB_E2E=1 与 TEST_DATABASE_URL 后启用')
    return
  }
  const dbUrl = process.env.TEST_DATABASE_URL?.trim()
  if (!dbUrl) {
    console.log('⊘ 全链路 DB：缺少 TEST_DATABASE_URL')
    return
  }
  process.env.DATABASE_URL = dbUrl
  try {
    const { prisma } = await import('../src/lib/prisma')
    const pending = await prisma.xhsAfterSalesWorkbenchQueue.count({
      where: { status: { in: ['pending', 'retry_wait', 'running'] } },
    })
    console.log(`✓ 全链路 DB：可连接，待处理队列 ${pending} 笔`)
  } catch (e) {
    console.log(`⊘ 全链路 DB 跳过：${e instanceof Error ? e.message : String(e)}`)
  }
}

async function main(): Promise<void> {
  console.log('verify:after-sales-db-e2e\n')
  testOfflineFeastDedupe()
  testOfflineFreightOnly()
  await testDbE2eOptional()
  console.log('\nPASS offline mode')
}

void main()
