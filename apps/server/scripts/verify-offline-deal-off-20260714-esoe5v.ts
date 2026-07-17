/**
 * 真实案例 OFF-20260714-ESOE5V 验收（只读业务库；不存在则用同结构 fixture）
 * npm run verify:offline-deal-off-20260714-esoe5v
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import {
  isOfflineDealView,
  offlineDealToAnalyzedView,
  splitGmvByDealSource,
} from '../src/services/offline-deal.service'
import {
  resolveQualityRefundInfo,
  viewCountsAsQualityRefund,
} from '../src/services/quality-refund-resolution.service'
import { resolveBuyerOrderQualityRefund } from '../src/services/buyer-order-standard.service'
import {
  calculateBusinessMetrics,
  buildBlacklistedBuyerIds,
  isQualityRefundOrder,
} from '../src/services/business-metrics.service'
import { mapViewToBoardOrderRow } from '../src/services/order-row-mapper.service'
import { shouldFetchAfterSalesWorkbench, shouldFetchInputFromView } from '../src/services/after-sales-fetch-decision.service'
import { buildLiveAccountOrderQueries } from '../src/utils/live-account-cache-key.util'

function isQianfanOrderDetailAvailable(orderNo: string | null | undefined): boolean {
  const trimmed = orderNo?.trim() ?? ''
  if (!trimmed || trimmed === '—') return false
  if (/^OFF-/i.test(trimmed) || /^offline:/i.test(trimmed)) return false
  return true
}

config({ path: path.resolve(__dirname, '../.env') })

const REAL_KEY = 'OFF-20260714-ESOE5V'
const FIXTURE_KEY = 'OFF-20260714-TESTESOE5V'
const FIXTURE_ANCHOR = '__TEST_OFFLINE_ANCHOR__'

function assertCase(
  view: ReturnType<typeof offlineDealToAnalyzedView>,
  label: string,
): void {
  console.log(`\n=== ${label} ===`)
  assert.equal(isOfflineDealView(view), true)
  assert.equal(viewCountsAsQualityRefund(view), false)
  assert.equal(isQualityRefundOrder(view), false)
  assert.equal(resolveBuyerOrderQualityRefund(view).isQualityRefund, false)

  const qi = resolveQualityRefundInfo({ view })
  assert.equal(qi.isQualityRefund, false)
  assert.equal(qi.qualityVerifyStatus, 'none')
  assert.equal(qi.suspectedQualityRefund, false)
  assert.equal(qi.verifyDisplayLabel, '—')
  assert.equal(qi.qualityReasonText || '', '')

  const metrics = calculateBusinessMetrics([view])
  assert.equal(Number(metrics.totalGmv.toFixed(2)), 800)
  assert.equal(Number(metrics.actualSignedAmount.toFixed(2)), 800)
  assert.equal(Number(metrics.refundAmount.toFixed(2)), 0)
  assert.equal(metrics.refundOrderCount, 0)
  assert.equal(metrics.qualityRefundOrderCount, 0)
  assert.equal(metrics.returnOrderCount, 0)
  assert.equal(metrics.refundOnlyOrderCount, 0)

  const split = splitGmvByDealSource([view])
  assert.equal(Number(split.onlineGmv.toFixed(2)), 0)
  assert.equal(Number(split.offlineGmv.toFixed(2)), 800)

  const row = mapViewToBoardOrderRow(view)
  assert.equal(row.isQualityReturn, false)
  assert.equal(row.qualityVerifyStatus, 'none')
  assert.equal(row.qualityVerifyDisplayLabel, '—')
  assert.ok(!row.qualitySourceLabel || row.qualitySourceLabel === '—')
  assert.equal(row.qualityAttributionAnchorName, null)
  assert.ok(
    (row.offlineDealNote || '').includes('买断') ||
      (view.offlineDealNote || '').includes('买断'),
  )

  // 品退归属主播仅在 isQualityReturn 时展示
  assert.equal(row.isQualityReturn === true, false)

  const fetchInput = shouldFetchInputFromView(view)
  assert.equal(shouldFetchAfterSalesWorkbench(fetchInput), false)
  assert.equal(
    buildLiveAccountOrderQueries([
      {
        displayOrderNo: view.displayOrderNo,
        officialOrderNo: view.officialOrderNo,
        liveAccountId: view.liveAccountId,
        dealSource: view.dealSource,
        sourceType: view.sourceType,
        offlineDealKey: view.offlineDealKey,
        raw: view.raw as Record<string, unknown>,
      },
    ]).length,
    0,
  )

  assert.equal(
    isQianfanOrderDetailAvailable(view.displayOrderNo),
    false,
    '线下成交不得开放千帆详情',
  )

  const bl = buildBlacklistedBuyerIds([view])
  assert.equal(bl.size, 0)

  console.log(`✓ GMV=800 offlineGmv=800 signed=800 refund=0 quality=0`)
  console.log(`✓ 非品退 / 无售后查询 / 无千帆详情 / 备注可展示`)
}

async function main(): Promise<void> {
  console.log('verify:offline-deal-off-20260714-esoe5v')

  const real = await prisma.offlineDeal.findFirst({
    where: { dealKey: REAL_KEY, deletedAt: null },
  })

  if (real) {
    console.log(`本地存在真实记录 ${REAL_KEY}`)
    assert.equal(real.amountCent, 80000)
    assert.equal(real.refundCent, 0)
    assert.ok((real.note || '').includes('买断'))
    const view = offlineDealToAnalyzedView(real)
    assertCase(view, `真实订单 ${REAL_KEY}`)
  } else {
    console.log('真实记录不存在，已使用同结构 fixture 完成验收')
    const dealAt = new Date('2026-07-14T19:24:00.000+08:00')
    const view = offlineDealToAnalyzedView({
      id: 'fixture-esoe5v',
      dealKey: FIXTURE_KEY,
      amountCent: 80000,
      refundCent: 0,
      dealAt,
      status: 'confirmed',
      anchorId: 'fixture-offline-anchor',
      anchorName: FIXTURE_ANCHOR,
      customerLabel: 'zq8366',
      note: 'zq8366线下成交买断',
      createdBy: 'verify',
      updatedBy: 'verify',
      updatedAt: dealAt,
    })
    assert.equal(view.displayOrderNo, FIXTURE_KEY)
    assertCase(view, `同结构 fixture ${FIXTURE_KEY}`)
  }

  console.log('\nverify:offline-deal-off-20260714-esoe5v OK')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
