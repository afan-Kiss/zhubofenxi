/**
 * 2026-05-28 黄金口径审计：列出计入/未计入支付与退款的订单明细
 *
 * 用法: npx tsx apps/server/scripts/metrics-acceptance/debug-2026-05-28.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { PrismaClient } from '@prisma/client'
import { resolveDateRange } from '../../src/utils/date-range'
import { buildRawAnalyzeBundle } from '../../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../../src/services/business-analysis.service'
import {
  calculateBusinessMetrics,
  viewCountsAsPaidOrder,
} from '../../src/services/business-metrics.service'
import { resolveMetricOrderNo } from '../../src/services/calc-refund-rate.service'
import {
  aggregateRefundAmountCentByOrderNo,
  resolveViewRefundAmountCent,
  viewCountsAsRefundOrder,
} from '../../src/services/order-refund-metrics.service'
import { viewCountsAsQualityRefund } from '../../src/services/quality-refund-resolution.service'
import { centToYuan } from '../../src/utils/money'
import { OFFICIAL_GMV_ACCEPT_20260528 } from '../../src/services/board-metrics-debug.service'
import { executeBoardLocalQuery } from '../../src/services/board-local-query.service'
import { refreshAnchorConfigCache } from '../../src/services/anchor.service'
import { bootstrapQualityBadCaseCache } from '../../src/services/quality-badcase-store.service'

config({ path: path.resolve(__dirname, '../../.env') })

const DATE = OFFICIAL_GMV_ACCEPT_20260528.date

function refundTimeSource(rec: Record<string, unknown>): string {
  for (const k of [
    'refund_ok_time',
    'refundOkTime',
    'refund_time',
    'refundTime',
    'update_at',
    'updateAt',
    'create_time',
    'createTime',
  ]) {
    if (rec[k] != null && rec[k] !== '' && rec[k] !== 0) return k
  }
  return 'unknown'
}

async function main(): Promise<void> {
  await refreshAnchorConfigCache()
  await bootstrapQualityBadCaseCache()
  const prisma = new PrismaClient()
  const range = resolveDateRange('custom', DATE, DATE)

  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: DATE,
    endDate: DATE,
  })
  const summary = local.summary as Record<string, unknown>
  console.log('\n=== local-data API summary ===')
  console.log({
    totalGmv: summary.totalGmv,
    orderCount: summary.orderCount,
    periodOrderCount: summary.periodOrderCount,
    returnAmount: summary.returnAmount,
    qualityReturnCount: summary.qualityReturnCount,
    ordersTotal: local.ordersTotal,
  })

  const bundle = await buildRawAnalyzeBundle(range)
  if (!bundle) {
    console.log('无订单 bundle')
    await prisma.$disconnect()
    return
  }

  const art = prepareAnalysisArtifactsFromRaw(bundle, { statRange: range })
  const views = art.views
  const m = calculateBusinessMetrics(views)
  const { totalCent: refundCent, byOrderNo: refundByNo } =
    aggregateRefundAmountCentByOrderNo(views)

  console.log('\n=== pipeline metrics ===')
  console.log({
    bundleOrders: bundle.orders.length,
    viewRows: views.length,
    paidOrderCount: m.orderCount,
    totalGmv: m.totalGmv,
    refundAmount: m.refundAmount,
    refundCent,
    qualityReturnCount: m.qualityRefundOrderCount,
  })

  console.log('\n=== 主播小计（计入支付）===')
  const paidRows = views.filter(viewCountsAsPaidOrder)
  const byAnchor = new Map<string, { count: number; amount: number }>()
  for (const v of paidRows) {
    const name = v.anchorName?.trim() || '未归属'
    const cur = byAnchor.get(name) ?? { count: 0, amount: 0 }
    cur.count += 1
    cur.amount += v.paymentBaseCent / 100
    byAnchor.set(name, cur)
  }
  for (const [name, sub] of [...byAnchor.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log({ anchorName: name, paidOrders: sub.count, paidAmount: sub.amount })
  }

  console.log('\n=== 计入支付金额的订单 ===')
  for (const v of paidRows.sort((a, b) => resolveMetricOrderNo(a).localeCompare(resolveMetricOrderNo(b)))) {
    const no = resolveMetricOrderNo(v)
    const refund = resolveViewRefundAmountCent(v)
    console.log(
      JSON.stringify({
        orderNo: no,
        displayOrderNo: v.displayOrderNo,
        payTime: v.orderTimeText,
        orderStatus: v.orderStatusText,
        paidAmount: centToYuan(v.paymentBaseCent),
        refundAmount: centToYuan(refund),
        afterSaleStatus: v.afterSaleStatusText,
        afterSaleReason: v.afterSaleReasonText ?? v.reasonText,
        anchorName: v.anchorName,
        liveAccountName: v.liveAccountName,
        includedInPaidAmount: v.includedInGmv,
        includedInPaidOrderCount: v.includedInGmv,
        includedInRefundAmount: refund > 0,
        includeReason: v.includedInGmv ? '有支付时间且已支付' : v.gmvExcludeReason,
        excludeReason: v.includedInGmv ? null : v.gmvExcludeReason,
        isQualityReturn: viewCountsAsQualityRefund(v),
      }),
    )
  }

  console.log('\n=== 退款金额组成（按订单）===')
  for (const [no, cent] of [...refundByNo.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const v = views.find((x) => resolveMetricOrderNo(x) === no)
    console.log(
      JSON.stringify({
        orderNo: no,
        refundAmount: centToYuan(cent),
        payTime: v?.orderTimeText,
        afterSaleStatus: v?.afterSaleStatusText,
      }),
    )
  }

  console.log('\n=== 售后记录退款时间字段抽样 ===')
  let shown = 0
  for (const [key, records] of bundle.rawAfterSalesByOrderNo?.entries() ?? []) {
    if (shown >= 15) break
    for (const rec of records) {
      if (!viewCountsAsRefundOrder(views.find((v) => key.includes(resolveMetricOrderNo(v) ?? ''))!)) continue
      console.log(
        JSON.stringify({
          orderKey: key,
          refundTimeField: refundTimeSource(rec),
          refundTimeValue:
            rec.refund_ok_time ?? rec.refund_time ?? rec.update_at ?? rec.create_time,
          refundFee: rec.refund_fee ?? rec.refundFee,
          status: rec.refund_status_name ?? rec.status,
        }),
      )
      shown++
      break
    }
  }

  const qc = await prisma.qualityBadCase.count()
  const qcMatched = await prisma.qualityBadCase.count({
    where: { matchStatus: { in: ['matched_order_only', 'matched_order_and_after_sale'] } },
  })
  console.log('\n=== 品退库 ===')
  console.log({ qualityBadCaseTotal: qc, qualityBadCaseMatched: qcMatched })

  const month = await executeBoardLocalQuery({
    preset: 'thisMonth',
    startDate: '2026-05-01',
    endDate: '2026-05-30',
  })
  const ms = month.summary as Record<string, unknown>
  console.log('\n=== thisMonth quality ===')
  console.log({
    qualityReturnCount: ms.qualityReturnCount,
    startDate: month.startDate,
    endDate: month.endDate,
  })

  console.log('\n=== 官方黄金期望（固定快照，非 live 全天）===')
  console.log({
    paidAmount: centToYuan(OFFICIAL_GMV_ACCEPT_20260528.paidAmountCent),
    paidOrders: OFFICIAL_GMV_ACCEPT_20260528.paidOrderCount,
    refundAmount: centToYuan(OFFICIAL_GMV_ACCEPT_20260528.refundAmountCent),
  })

  const zijie = byAnchor.get('子杰')
  const feiyun = byAnchor.get('飞云')
  console.log('\n=== live 与旧黄金快照差异说明 ===')
  console.log({
    livePaidOrders: paidRows.length,
    livePaidAmount: m.totalGmv,
    liveRefundAmount: m.refundAmount,
    goldenSnapshotPaidOrders: OFFICIAL_GMV_ACCEPT_20260528.paidOrderCount,
    goldenSnapshotPaidAmount: centToYuan(OFFICIAL_GMV_ACCEPT_20260528.paidAmountCent),
    goldenSnapshotRefundAmount: centToYuan(OFFICIAL_GMV_ACCEPT_20260528.refundAmountCent),
    zijieSubtotal: zijie ?? null,
    feiyunSubtotal: feiyun ?? null,
    note: '子杰小计与旧黄金快照一致；飞云晚间订单与当日新增退款导致 live 全天高于快照。固定快照验收请用 npm run test:metrics:golden',
  })

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
