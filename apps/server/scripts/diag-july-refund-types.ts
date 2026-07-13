/**
 * 诊断指定日期范围内退款类型分类与品退计数
 * 用法: npx tsx scripts/diag-july-refund-types.ts [start] [end]
 */
import { getBoardScopedViewsForRange } from '../src/services/board-scoped-views.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { buildOrderMetricSets } from '../src/services/order-metric-sets.service'
import { LOCAL_VIEWER_USER } from '../src/constants/local-viewer'
import { viewCountsAsRefundOrder } from '../src/services/order-refund-metrics.service'
import { getQualityBadCasesSync } from '../src/services/quality-badcase-store.service'

const startDate = process.argv[2] ?? '2026-07-01'
const endDate = process.argv[3] ?? '2026-07-13'

async function main() {
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate,
    endDate,
    role: LOCAL_VIEWER_USER.role,
    username: LOCAL_VIEWER_USER.username,
  })
  const core = filterViewsForCoreMetrics(scoped.views)
  const metrics = calculateBusinessMetrics(core, { scope: 'diag-july-refund' })
  const sets = buildOrderMetricSets(core, { scope: 'diag-july-refund' })

  const bySource: Record<string, number> = {}
  const unknownSamples: Array<{
    orderNo: string
    anchor: string
    status: string
    afterSale: string
    refundCent: number
    source: string
  }> = []
  const returnSamples: Array<{ orderNo: string; anchor: string; source: string; status: string }> = []

  for (const v of core) {
    if (!viewCountsAsRefundOrder(v)) continue
    const src = v.returnRefundClassificationSource ?? 'none'
    bySource[src] = (bySource[src] ?? 0) + 1
    if (v.isReturnRefundOrder && returnSamples.length < 8) {
      returnSamples.push({
        orderNo: v.displayOrderNo ?? v.orderNo ?? '',
        anchor: v.anchorName ?? '',
        source: src,
        status: [v.orderStatusText, v.afterSaleStatusText].filter(Boolean).join(' | '),
      })
    }
    if (v.isRefundTypeUnknown && unknownSamples.length < 8) {
      unknownSamples.push({
        orderNo: v.displayOrderNo ?? v.orderNo ?? '',
        anchor: v.anchorName ?? '',
        status: v.orderStatusText ?? '',
        afterSale: v.afterSaleStatusText ?? '',
        refundCent: v.productRefundAmountCent ?? 0,
        source: src,
      })
    }
  }

  const qualityViews = core.filter((v) => v.isQualityReturn)
  const officialCases = getQualityBadCasesSync()

  console.log(
    JSON.stringify(
      {
        range: { startDate, endDate },
        paid: metrics.orderCount,
        refundOrders: metrics.refundOrderCount,
        returnRefund: metrics.returnOrderCount,
        refundOnly: metrics.refundOnlyOrderCount,
        unknown: metrics.unknownRefundTypeOrderCount,
        quality: metrics.qualityRefundOrderCount,
        incomplete: metrics.returnRefundTypeIncomplete,
        metricSets: {
          return: sets.returnOrderCount,
          refundOnly: sets.refundOnlyOrderCount,
          unknown: sets.unknownRefundTypeOrderCount,
        },
        classificationSource: bySource,
        qualityOrders: qualityViews.map((v) => ({
          orderNo: v.displayOrderNo ?? v.orderNo,
          anchor: v.anchorName,
          source: v.qualityMainSource ?? v.qualitySource,
          verify: v.qualityVerifyStatus,
          reason: v.officialReasonText ?? v.afterSaleReasonText,
        })),
        officialBadCaseCount: officialCases.length,
        returnSamples,
        unknownSamples,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
