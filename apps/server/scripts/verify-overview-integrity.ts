/**
 * 经营总览发布阻断验收：独立临时 SQLite + 确定性 fixture，不依赖业务库黄金样本。
 *
 * 公式（业务日 DAY，金额元）：
 *   线上正常签收 P_OV_NORMAL_1000     = 1000（主播A，无退款，非品退）
 *   线上部分退款 P_OV_PARTIAL_600      = 600（主播A，退款100，非品退）
 *   线上品退     P_OV_QUALITY_400      = 400（主播B，售后原因「质量问题」→品退）
 *   线上未归属   P_OV_UNASSIGNED_300   = 300（无时段规则命中 → 未归属）
 *   线下成交     OFF-…-OVBUYOUT        = 800（主播A，备注含「买断」，非品退）
 *
 *   总 GMV      = 1000+600+400+300+800 = 3100
 *   线上 GMV    = 2300
 *   线下 GMV    = 800
 *   未归属 GMV  = 300（仅未归属线上单；总览 summary 用未 remap 口径）
 *   退款金额    = 100
 *   退款单数    = 1
 *   品退单数    = 1（仅质量问题线上单；线下买断不计入）
 *
 * npm run verify:overview-integrity
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { shanghaiYesterdayDateKey } from '../src/utils/anchor-effective-date.util'
import { addDaysShanghai } from '../src/utils/business-timezone'

const serverRoot = path.resolve(__dirname, '..')
const require = createRequire(__filename)

const ANCHOR_A = '__TEST_OVERVIEW_ANCHOR_A__'
const ANCHOR_B = '__TEST_OVERVIEW_ANCHOR_B__'
const BUYER_A = '__TEST_OVERVIEW_BUYER_A__'
const SHOP = '__TEST_OVERVIEW_SHOP__'
const LIVE_ID = 'test-live-overview-1'

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  const r = spawnSync(cmd, args, { cwd: serverRoot, env, encoding: 'utf8', shell: true })
  if (r.status !== 0) {
    console.error(r.stdout)
    console.error(r.stderr)
    throw new Error(`${cmd} failed`)
  }
}

function shanghaiPayIso(dateKey: string, hm: string): string {
  return `${dateKey} ${hm}:00`
}

function buildOrderRaw(params: {
  packageId: string
  payDate: string
  payHm: string
  amountYuan: number
  buyerId?: string
  statusDesc?: string
  afterSaleStatus?: string
}): Record<string, unknown> {
  const pay = shanghaiPayIso(params.payDate, params.payHm)
  return {
    packageId: params.packageId,
    orderId: params.packageId,
    paidAt: pay,
    payTime: pay,
    paymentTime: pay,
    createTime: pay,
    orderedAt: pay,
    sellerName: SHOP,
    shopName: SHOP,
    liveAccountName: SHOP,
    // 勿写 nickName：会被 extractOrderAnchorFields 当成主播名
    userId: params.buyerId ?? BUYER_A,
    buyerId: params.buyerId ?? BUYER_A,
    actualPaid: params.amountYuan,
    totalGoodsPayAmount: params.amountYuan,
    statusDesc: params.statusDesc ?? '已完成',
    afterSaleStatus: params.afterSaleStatus ?? '无售后',
    skus: [
      {
        skuName: 'overview-fixture-sku',
        skuId: 'sku-ov-1',
        quantity: 1,
        price: params.amountYuan,
      },
    ],
  }
}

async function main() {
  const DAY = shanghaiYesterdayDateKey()
  // 线下 GMV 生效日 2026-07-14：若「昨天」早于生效日则固定用生效日
  const day =
    DAY >= '2026-07-14' ? DAY : '2026-07-14'
  const dayFrom = addDaysShanghai(day, -7)

  console.log('verify:overview-integrity（临时库 fixture，不连业务库）')
  console.log(`  DAY=${day}\n`)
  console.log('原脚本真实数据依赖（已迁至 diagnose:overview-golden-samples）：')
  console.log('  DATE 默认 2026-07-03；FOCUS P798605049367374181 / P798618403087295271')
  console.log('  有效成交额黄金值 ¥2017、有效成交单数=1；依赖本地业务库同步与缓存\n')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhubo-overview-'))
  const dbPath = path.join(dir, 'overview.db')
  const dbUrl = `file:${dbPath.replace(/\\/g, '/')}`
  process.env.DATABASE_URL = dbUrl
  process.env.OFFLINE_DEAL_SKIP_CACHE_INVALIDATE = '1'
  const env = { ...process.env, DATABASE_URL: dbUrl }

  try {
    run('npx', ['prisma', 'migrate', 'deploy'], env)
    run('npx', ['prisma', 'generate'], env)

    for (const key of Object.keys(require.cache)) {
      if (
        key.includes(`${path.sep}apps${path.sep}server${path.sep}src${path.sep}`) ||
        key.includes('@prisma')
      ) {
        delete require.cache[key]
      }
    }

    const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client')
    const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })

    const { refreshAnchorConfigCache } = await import('../src/services/anchor.service')
    const { clearScheduleAttributionCache } = await import(
      '../src/services/anchor-schedule-attribution.service'
    )
    const { clearCanonicalAttributionCache } = await import(
      '../src/services/canonical-order-attribution.service'
    )
    const {
      buildAndSetBusinessBoardCache,
      invalidateBusinessBoardCache,
    } = await import('../src/services/business-cache.service')
    const { executeBoardLocalQuery } = await import('../src/services/board-local-query.service')
    const { saveWorkbenchCache } = await import('../src/services/xhs-after-sales-workbench.service')
    const { viewCountsAsQualityRefund } = await import(
      '../src/services/quality-refund-resolution.service'
    )
    const { isOfflineDealView, offlineDealToAnalyzedView, splitGmvByDealSource } = await import(
      '../src/services/offline-deal.service'
    )
    const { calculateBusinessMetrics } = await import('../src/services/business-metrics.service')
    const { getBoardScopedViewsForRange } = await import('../src/services/board-scoped-views.service')
    const { filterViewsForCoreMetrics } = await import('../src/services/metrics-exclusion.service')
    const { mapViewToBoardOrderRow } = await import('../src/services/order-row-mapper.service')

    try {
      const anchorA = await prisma.anchor.create({
        data: {
          name: ANCHOR_A,
          color: '#111111',
          enabled: true,
          attributionMode: 'schedule',
          effectiveFrom: dayFrom,
          sortOrder: 1,
        },
      })
      const anchorB = await prisma.anchor.create({
        data: {
          name: ANCHOR_B,
          color: '#222222',
          enabled: true,
          attributionMode: 'schedule',
          effectiveFrom: dayFrom,
          sortOrder: 2,
        },
      })

      // 时段规则：A=00:00–12:00，B=14:00–18:00；12:00–14:00 与 18:00 后为未归属窗口
      await prisma.anchorTimeRule.create({
        data: {
          anchorId: anchorA.id,
          startTime: '00:00',
          endTime: '12:00',
          enabled: true,
          sortOrder: 1,
        },
      })
      await prisma.anchorTimeRule.create({
        data: {
          anchorId: anchorB.id,
          startTime: '14:00',
          endTime: '18:00',
          enabled: true,
          sortOrder: 2,
        },
      })

      const orders = [
        {
          packageId: 'P_OV_NORMAL_1000',
          payHm: '10:00',
          amountYuan: 1000,
          statusDesc: '已完成',
        },
        {
          packageId: 'P_OV_PARTIAL_600',
          payHm: '11:00',
          amountYuan: 600,
          statusDesc: '已完成',
          afterSaleStatus: '退款成功',
        },
        {
          packageId: 'P_OV_QUALITY_400',
          payHm: '15:00',
          amountYuan: 400,
          statusDesc: '已完成',
          afterSaleStatus: '售后完成',
        },
        {
          packageId: 'P_OV_UNASSIGNED_300',
          payHm: '20:30',
          amountYuan: 300,
          statusDesc: '已完成',
        },
      ] as const

      for (const o of orders) {
        const raw = buildOrderRaw({
          packageId: o.packageId,
          payDate: day,
          payHm: o.payHm,
          amountYuan: o.amountYuan,
          statusDesc: o.statusDesc,
          afterSaleStatus: 'afterSaleStatus' in o ? o.afterSaleStatus : '无售后',
        })
        await prisma.xhsRawOrder.create({
          data: {
            packageId: o.packageId,
            orderId: o.packageId,
            liveAccountId: LIVE_ID,
            liveAccountName: SHOP,
            orderTime: new Date(`${day}T${o.payHm}:00+08:00`),
            paymentTime: new Date(`${day}T${o.payHm}:00+08:00`),
            displayOrderNo: o.packageId,
            gmvCent: Math.round(o.amountYuan * 100),
            buyerId: BUYER_A,
            rawJson: raw as object,
          },
        })
      }

      // 部分退款 100 元（非品退原因）
      await saveWorkbenchCache(
        {
          liveAccountId: LIVE_ID,
          orderNo: 'P_OV_PARTIAL_600',
          packageId: 'P_OV_PARTIAL_600',
          officialRefundAmountCent: 10000,
          freightRefundAmountCent: 0,
          expectedRefundAmountCent: 10000,
          appliedAmountCent: 10000,
          appliedShipFeeAmountCent: 0,
          payAmountCent: 60000,
          settlementAmountCent: 0,
          refundIncludesFreight: false,
          hasFreightOnlyRefund: false,
          buyerUserId: BUYER_A,
          afterSaleReason: '多拍/拍错/不想要',
          afterSaleStatus: '退款成功',
          successReturnCount: 1,
          returnsIds: ['R_OV_PARTIAL'],
          hasReturnRefund: false,
          hasRefundOnly: true,
          returnRefundCount: 0,
          refundOnlyCount: 1,
          afterSaleType: 'refund_only',
          classificationSource: 'fixture',
          fetchStatus: 'success',
          fetchError: null,
          fetchedAt: new Date(),
        },
        LIVE_ID,
      )

      // 品退：质量问题
      await saveWorkbenchCache(
        {
          liveAccountId: LIVE_ID,
          orderNo: 'P_OV_QUALITY_400',
          packageId: 'P_OV_QUALITY_400',
          officialRefundAmountCent: 0,
          freightRefundAmountCent: 0,
          expectedRefundAmountCent: 0,
          appliedAmountCent: 0,
          appliedShipFeeAmountCent: 0,
          payAmountCent: 40000,
          settlementAmountCent: 0,
          refundIncludesFreight: false,
          hasFreightOnlyRefund: false,
          buyerUserId: BUYER_A,
          afterSaleReason: '质量问题',
          afterSaleStatus: '售后完成',
          successReturnCount: 1,
          returnsIds: ['R_OV_QUALITY'],
          hasReturnRefund: true,
          hasRefundOnly: false,
          returnRefundCount: 1,
          refundOnlyCount: 0,
          afterSaleType: 'return_refund',
          classificationSource: 'fixture',
          fetchStatus: 'success',
          fetchError: null,
          fetchedAt: new Date(),
        },
        LIVE_ID,
      )

      const offlineKey = `OFF-${day.replace(/-/g, '')}-OVBUYOUT`
      const offlineDeal = await prisma.offlineDeal.create({
        data: {
          dealKey: offlineKey,
          externalKey: `ext-${offlineKey}`,
          amountCent: 80000,
          refundCent: 0,
          dealAt: new Date(`${day}T16:00:00.000+08:00`),
          status: 'confirmed',
          anchorId: anchorA.id,
          anchorName: ANCHOR_A,
          customerLabel: BUYER_A,
          note: '线下成交买断',
          createdBy: 'verify-overview',
          updatedBy: 'verify-overview',
        },
      })

      await refreshAnchorConfigCache()
      clearScheduleAttributionCache()
      clearCanonicalAttributionCache()
      invalidateBusinessBoardCache()

      await buildAndSetBusinessBoardCache({
        preset: 'custom',
        startDate: day,
        endDate: day,
      })

      const local = await executeBoardLocalQuery({
        preset: 'custom',
        startDate: day,
        endDate: day,
      })
      assert.equal(local.source, 'local_db')
      const summary = (local.summary ?? {}) as Record<string, unknown>

      const totalGmv = Number(summary.totalGmv ?? summary.gmv ?? 0)
      const onlineGmv = Number(summary.onlineGmv ?? 0)
      const offlineGmv = Number(summary.offlineGmv ?? 0)
      const unassignedGmv = Number(summary.unassignedGmv ?? 0)
      const refundAmount = Number(summary.returnAmount ?? summary.productRefundAmount ?? 0)
      const refundOrderCount = Number(summary.returnCount ?? 0)
      const qualityReturnCount = Number(summary.qualityReturnCount ?? 0)
      const returnRefundCount = Number(summary.returnRefundCount ?? 0)
      const refundOnlyCount = Number(summary.refundOnlyCount ?? 0)

      console.log('总览 summary:')
      console.log(`  totalGmv=${totalGmv} online=${onlineGmv} offline=${offlineGmv} unassigned=${unassignedGmv}`)
      console.log(
        `  refundAmount=${refundAmount} refundOrders=${refundOrderCount} quality=${qualityReturnCount} returnRefund=${returnRefundCount} refundOnly=${refundOnlyCount}`,
      )

      assert.equal(Number(totalGmv.toFixed(2)), 3100, '总 GMV=3100')
      assert.equal(Number(onlineGmv.toFixed(2)), 2300, '线上 GMV=2300')
      assert.equal(Number(offlineGmv.toFixed(2)), 800, '线下 GMV=800')
      assert.equal(Number(unassignedGmv.toFixed(2)), 300, '未归属 GMV=300')
      assert.equal(Number(refundAmount.toFixed(2)), 100, '退款金额=100')
      assert.equal(qualityReturnCount, 1, '品退单数=1')
      assert.ok(refundOrderCount >= 1 && refundOrderCount <= 2, `退款单数应在1–2，实际 ${refundOrderCount}`)
      assert.equal(refundOnlyCount, 1, '仅退款单数=1（部分退款单）')
      assert.ok(returnRefundCount <= 1, '退货退款单数不含线下')

      const scoped = await getBoardScopedViewsForRange({
        preset: 'custom',
        startDate: day,
        endDate: day,
        role: 'super_admin',
        username: 'verify-overview',
      })
      const views = filterViewsForCoreMetrics(scoped.views)
      const unassignedHit = views.find(
        (v) =>
          v.displayOrderNo === 'P_OV_UNASSIGNED_300' &&
          (!v.anchorName?.trim() || v.anchorName.trim() === '未归属'),
      )
      assert.ok(unassignedHit, 'P_OV_UNASSIGNED_300 remapped 后应为未归属')
      assert.equal(unassignedHit!.paymentBaseCent, 30000)
      const offlineView = views.find((v) => isOfflineDealView(v))
      assert.ok(offlineView, '应含线下成交视图')
      assert.equal(viewCountsAsQualityRefund(offlineView!), false, '线下买断不得计入品退')
      assert.equal(offlineView!.reasonText || '', '', '线下 reasonText 须为空')
      assert.equal(
        (offlineView as { offlineDealNote?: string }).offlineDealNote,
        '线下成交买断',
      )

      const metrics = calculateBusinessMetrics(views)
      assert.equal(metrics.qualityRefundOrderCount, 1)
      assert.equal(Number(metrics.totalGmv.toFixed(2)), 3100)

      const split = splitGmvByDealSource(views)
      assert.equal(Number(split.offlineGmv.toFixed(2)), 800)

      const row = mapViewToBoardOrderRow(offlineView!)
      assert.equal(row.isQualityReturn, false)
      assert.equal(row.qualityVerifyDisplayLabel, '—')
      assert.equal(row.qualityAttributionAnchorName, null)
      assert.equal(row.offlineDealNote, '线下成交买断')

      const fromDeal = offlineDealToAnalyzedView(offlineDeal)
      assert.equal(isOfflineDealView(fromDeal), true)
      assert.equal(viewCountsAsQualityRefund(fromDeal), false)

      console.log('\n✓ 经过 Prisma → 分析视图 → 经营缓存 → executeBoardLocalQuery → summary/DTO')
      console.log('verify:overview-integrity OK')
    } finally {
      await prisma.$disconnect()
    }
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
