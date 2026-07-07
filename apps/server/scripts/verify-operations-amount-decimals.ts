/**
 * 商品榜 / 价位带金额小数验收：保留两位小数，合计与有效成交差异 <= 0.01
 *
 * npm run verify:operations-amount-decimals
 */
import path from 'node:path'
import { config } from 'dotenv'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { buildOperationsProductAnalysis } from '../src/services/operations-product-analysis.service'
import { buildOperationsPriceBandAnalysis } from '../src/services/operations-price-band.service'
import { sumValidRevenueFromViews } from '../src/services/valid-revenue-order.service'
import { centToYuan } from '../src/utils/money'
import { roundMoneyYuan } from '../src/services/daily-report-order.util'

config({ path: path.resolve(__dirname, '../.env') })

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string): void {
  console.error(`  ✗ FAIL: ${msg}`)
}

function mockValidView(params: {
  orderId: string
  effectiveGmvCent: number
  paymentBaseCent?: number
  productName?: string
  itemId?: string
}): AnalyzedOrderView {
  return {
    orderId: params.orderId,
    matchOrderId: params.orderId,
    displayOrderNo: params.orderId,
    officialOrderNo: params.orderId,
    packageId: params.orderId,
    bizOrderId: params.orderId,
    includedInGmv: true,
    effectiveGmvCent: params.effectiveGmvCent,
    paymentBaseCent: params.paymentBaseCent ?? params.effectiveGmvCent,
    orderStatusText: '已完成',
    afterSaleStatusText: '',
    buyerId: `buyer-${params.orderId}`,
    buyerKey: `buyer-${params.orderId}`,
    anchorName: '子杰',
    anchorId: 'anchor-1',
    orderTimeText: '2026-06-01 10:00:00',
    attributionType: 'schedule',
    gmvCent: params.effectiveGmvCent,
    productAmountCent: params.effectiveGmvCent,
    receivableAmountCent: params.effectiveGmvCent,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: params.effectiveGmvCent,
    actualSellerReceiveAmountCent: params.effectiveGmvCent,
    actualSignedAmountCent: params.effectiveGmvCent,
    isSigned: true,
    isReturned: false,
    isActualSigned: true,
    isQualityReturn: false,
    returnAmountCent: 0,
    productRefundAmountCent: 0,
    raw: {
      itemId: params.itemId ?? `item-${params.orderId}`,
      productName: params.productName ?? '测试商品',
      skuName: '默认',
      quantity: 1,
    },
  } as AnalyzedOrderView
}

async function main(): Promise<void> {
  console.log('verify-operations-amount-decimals\n')
  let failures = 0

  const views = [
    mockValidView({ orderId: 'P-DEC-001', effectiveGmvCent: 10050, productName: '小数商品A' }),
    mockValidView({ orderId: 'P-DEC-002', effectiveGmvCent: 9999, productName: '小数商品B' }),
    mockValidView({ orderId: 'P-DEC-003', effectiveGmvCent: 10000, productName: '整数商品C' }),
    mockValidView({ orderId: 'P-DEC-004', effectiveGmvCent: 1, productName: '分位商品D' }),
  ]
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const v of views) {
    rawByMatch.set(v.matchOrderId, (v as { raw?: Record<string, unknown> }).raw ?? {})
  }

  const validTotalYuan = roundMoneyYuan(centToYuan(sumValidRevenueFromViews(views).validAmountCent))

  console.log('=== 1. 商品榜金额保留两位小数 ===')
  const products = await buildOperationsProductAnalysis(views, rawByMatch)
  const productSum = roundMoneyYuan(products.reduce((s, p) => s + p.soldAmountYuan, 0))

  for (const p of products) {
    const cents = Math.round(p.soldAmountYuan * 100)
    if (Math.abs(p.soldAmountYuan * 100 - cents) > 1e-6) {
      fail(`${p.productName} soldAmountYuan=${p.soldAmountYuan} 非两位小数`)
      failures++
    }
  }
  if (products.find((p) => p.productName === '小数商品A')?.soldAmountYuan !== 100.5) {
    fail('小数商品A 应为 100.50 元')
    failures++
  } else {
    ok('10050 分 → soldAmountYuan=100.5')
  }
  if (products.find((p) => p.productName === '整数商品C')?.soldAmountYuan !== 100) {
    fail('整数商品C 应为 100 元')
    failures++
  } else {
    ok('整数金额样例仍为 100 元')
  }
  if (Math.abs(productSum - validTotalYuan) > 0.01) {
    fail(`商品榜合计 ${productSum} 与有效成交 ${validTotalYuan} 差异 > 0.01`)
    failures++
  } else {
    ok(`商品榜合计 ${productSum} ≈ 有效成交 ${validTotalYuan}`)
  }

  console.log('\n=== 2. 价位带金额保留两位小数 ===')
  const bands = buildOperationsPriceBandAnalysis(views)
  const bandSum = roundMoneyYuan(bands.reduce((s, b) => s + b.amountYuan, 0))

  for (const b of bands) {
    const cents = Math.round(b.amountYuan * 100)
    if (Math.abs(b.amountYuan * 100 - cents) > 1e-6) {
      fail(`${b.bandLabel} amountYuan=${b.amountYuan} 非两位小数`)
      failures++
    }
    if (b.avgOrderAmountYuan != null) {
      const avgCents = Math.round(b.avgOrderAmountYuan * 100)
      if (Math.abs(b.avgOrderAmountYuan * 100 - avgCents) > 1e-6) {
        fail(`${b.bandLabel} avgOrderAmountYuan=${b.avgOrderAmountYuan} 非两位小数`)
        failures++
      }
    }
  }
  if (Math.abs(bandSum - validTotalYuan) > 0.01) {
    fail(`价位带合计 ${bandSum} 与有效成交 ${validTotalYuan} 差异 > 0.01`)
    failures++
  } else {
    ok(`价位带合计 ${bandSum} ≈ 有效成交 ${validTotalYuan}`)
  }

  console.log('\n=== 3. 不再提前 round 到整数元 ===')
  const fractional = products.find((p) => p.productName === '小数商品B')
  if (fractional?.soldAmountYuan === 100) {
    fail('9999 分被 round 成 100 整数元')
    failures++
  } else if (fractional?.soldAmountYuan === 99.99) {
    ok('9999 分 → soldAmountYuan=99.99（非整数）')
  } else {
    fail(`9999 分 soldAmountYuan=${fractional?.soldAmountYuan}`)
    failures++
  }

  if (failures > 0) {
    console.log(`\nFAIL (${failures} 项)`)
    process.exit(1)
  }
  console.log('\nPASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
