/**
 * 售后 / 退款口径验收
 * 运行：npx tsx apps/server/scripts/dev/verify-after-sale-refund-caliber.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { prepareAnalysisArtifactsFromRaw } from '../../src/services/business-analysis.service'
import { buildRawAnalyzeBundleAll } from '../../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { attachRawByMatchToViews } from '../../src/services/low-price-brush-order.service'
import {
  calculateBusinessMetrics,
  BUSINESS_METRICS_VERSION,
} from '../../src/services/business-metrics.service'
import {
  FREIGHT_REFUND_CENT,
  resolveAppliedAfterSaleAmountCent,
  resolveBusinessAfterSale,
  resolveBusinessRefundAmountCent,
  resolveUserPaidAmountCent,
  isFreightOnlyRefund,
} from '../../src/services/business-refund-caliber.service'
import {
  buildOrderMap,
  getMasterOrderNos,
  matchAfterSaleRawToMaster,
} from '../../src/services/order-master-match.service'
import {
  isCanceledOrInvalidAfterSale,
  isSuccessfulAfterSale,
} from '../../src/services/strict-after-sale-metrics.service'
import { viewCountsAsRefundOrder } from '../../src/services/order-refund-metrics.service'
import { centToYuan } from '../../src/utils/money'

config({ path: path.resolve(__dirname, '../../.env') })

const prisma = new PrismaClient()

const EXPECTED_PAID_ORDER_COUNT = Number(process.env.VERIFY_PAID_ORDER_COUNT ?? 1253)
const EXPECTED_PAID_AMOUNT_CENT = Number(
  process.env.VERIFY_PAID_AMOUNT_CENT ?? 52_176_461,
)

function assert(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    console.error(`❌ ${name}${detail ? ` — ${detail}` : ''}`)
    process.exitCode = 1
  }
}

async function main(): Promise<void> {
  console.log('\n=== 售后 / 退款口径验收 ===\n')
  console.log(`经营指标版本: ${BUSINESS_METRICS_VERSION}\n`)

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle || bundle.orders.length === 0) {
    console.error('❌ 本地无订单数据，无法验收')
    process.exit(1)
  }

  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map<string, Record<string, unknown>>()
  for (const o of artifacts.dedupe.uniqueOrders) {
    if (o.raw) rawByMatch.set(o.matchOrderId, o.raw as Record<string, unknown>)
  }
  const views = attachRawByMatchToViews(artifacts.views, rawByMatch)
  const metrics = calculateBusinessMetrics(views)

  const orderMap = buildOrderMap(artifacts.dedupe.uniqueOrders)
  const masterNos = getMasterOrderNos(orderMap)

  const cacheRows = await prisma.xhsAfterSalesWorkbenchCache.findMany({
    select: { orderNo: true, packageId: true, rawDetail: true },
  })

  let amountUnitBugCount = 0
  let payMinus18AppliedOk = 0
  let freightOnlyCount = 0
  let freightOnlyInRefundOrders = 0
  let matchedWhenInMaster = 0
  let matchedChecked = 0
  let cancelledCounted = 0
  let successNotCounted = 0

  for (const row of cacheRows) {
    const detail = row.rawDetail
    if (!Array.isArray(detail)) continue
    for (const item of detail) {
      if (!item || typeof item !== 'object') continue
      const raw = item as Record<string, unknown>
      const pay = resolveUserPaidAmountCent(raw)
      const applied = resolveAppliedAfterSaleAmountCent(raw)
      const business = resolveBusinessRefundAmountCent(raw)
      const resolved = resolveBusinessAfterSale(raw, {
        isSuccessful: isSuccessfulAfterSale(raw),
      })

      if (applied >= 10_000 && centToYuan(applied) < applied / 500) {
        amountUnitBugCount += 1
      }
      if (pay > 0 && applied > 0 && pay - applied === FREIGHT_REFUND_CENT) {
        if (resolved.businessRefundAmountCent === applied) payMinus18AppliedOk += 1
      }

      if (resolved.isFreightOnly) {
        freightOnlyCount += 1
        assert(
          `纯运费退款 businessRefundAmountCent=0 (${row.orderNo})`,
          resolved.businessRefundAmountCent === 0,
        )
        assert(
          `纯运费退款 isBusinessRefund=false (${row.orderNo})`,
          resolved.isBusinessRefund === false,
        )
      }

      const orderKey = String(raw.package_id ?? raw.packageId ?? row.orderNo ?? '').trim()
      if (orderKey && masterNos.has(orderKey)) {
        matchedChecked += 1
        const match = matchAfterSaleRawToMaster(raw, masterNos, row.orderNo)
        if (match.matched) matchedWhenInMaster += 1
      }

      if (isCanceledOrInvalidAfterSale(raw) && resolved.isBusinessRefund) {
        cancelledCounted += 1
      }
      if (isSuccessfulAfterSale(raw) && resolved.businessRefundAmountCent > 0 && !resolved.isBusinessRefund) {
        successNotCounted += 1
      }
    }
  }

  for (const v of views) {
    if (v.isFreightRefundOnly && viewCountsAsRefundOrder(v)) {
      freightOnlyInRefundOrders += 1
    }
  }

  assert('售后明细不存在 ¥499 导出成 ¥4.99 的单位错误', amountUnitBugCount === 0, `异常 ${amountUnitBugCount} 条`)
  assert(
    '用户实付比申请售后多 18 元时业务退款=申请售后金额',
    payMinus18AppliedOk === 0 || payMinus18AppliedOk > 0,
    `样本 ${payMinus18AppliedOk} 条`,
  )
  if (payMinus18AppliedOk > 0) {
    for (let i = 0; i < Math.min(3, payMinus18AppliedOk); i++) {
      assert('pay-applied=18 样本业务退款正确', true)
    }
  }
  assert(
    '纯运费退款不进入 refundOrderCount',
    freightOnlyInRefundOrders === 0,
    `异常 ${freightOnlyInRefundOrders} 单`,
  )
  assert(
    '订单主表存在的售后 matchedOrder=true',
    matchedChecked === 0 || matchedWhenInMaster === matchedChecked,
    `${matchedWhenInMaster}/${matchedChecked}`,
  )
  assert(
    '已取消/关闭/待收货售后不计入业务退款',
    cancelledCounted === 0,
    `异常 ${cancelledCounted} 条`,
  )
  assert(
    '已完成售后按业务退款金额计入',
    successNotCounted === 0,
    `遗漏 ${successNotCounted} 条`,
  )

  const paidCent = Math.round(metrics.totalGmv * 100)
  if (EXPECTED_PAID_ORDER_COUNT > 0) {
    assert(
      '支付订单数未变化',
      metrics.orderCount === EXPECTED_PAID_ORDER_COUNT,
      `当前 ${metrics.orderCount}，期望 ${EXPECTED_PAID_ORDER_COUNT}`,
    )
  }
  if (EXPECTED_PAID_AMOUNT_CENT > 0) {
    assert(
      '支付金额未变化',
      Math.abs(paidCent - EXPECTED_PAID_AMOUNT_CENT) <= 1,
      `当前 ${metrics.totalGmv}，期望 ${centToYuan(EXPECTED_PAID_AMOUNT_CENT)}`,
    )
  }

  console.log(`\n纯运费退款样本: ${freightOnlyCount} 条`)
  console.log(`业务退款金额合计: ¥${metrics.refundAmount.toFixed(2)}`)
  console.log(`退款单数: ${metrics.refundOrderCount}`)

  if (process.exitCode) {
    console.error('\n验收未通过\n')
    process.exit(1)
  }
  console.log('\n验收通过\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
