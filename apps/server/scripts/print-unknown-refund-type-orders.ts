/**
 * 打印「退款类型待确认」订单明细，供人工核对分类规则。
 *
 * 默认范围 = 数据健康「滚动30天（延迟15天）」同一口径。
 *
 * 用法:
 *   npx tsx scripts/print-unknown-refund-type-orders.ts
 *   npx tsx scripts/print-unknown-refund-type-orders.ts 2026-06-01 2026-06-30
 *   OUTPUT=json npx tsx scripts/print-unknown-refund-type-orders.ts
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { centToYuan } from '../src/utils/money'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { loadBoardArtifactsForRange } from '../src/services/board-metrics.service'
import { buildOrderMetricSets } from '../src/services/order-metric-sets.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { resolveRollingDataHealthCloseRange } from '../src/services/rolling-data-health-close.service'
import { viewCountsAsRefundOrder } from '../src/services/order-refund-metrics.service'
import { buildRawAnalyzeBundle } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { normalizeAfterSaleRecord } from '../src/services/xhs-after-sales-range.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function lookupScopedAfterSaleRecords(
  rawMap: Map<string, Record<string, unknown>[]>,
  liveAccountId: string | undefined | null,
  orderNo: string,
): Record<string, unknown>[] {
  const no = orderNo.trim()
  if (!no) return []
  const accountId = liveAccountId?.trim() || 'legacy'
  return rawMap.get(`${accountId}::${no}`) ?? rawMap.get(no) ?? []
}

type AfterSaleSnippet = {
  returnType: string | null
  returnTypeName: string | null
  statusName: string | null
  refundStatusName: string | null
  reason: string | null
  refunded: boolean | null
  refundFeeYuan: number | null
}

function summarizeAfterSaleRecords(records: Record<string, unknown>[]): AfterSaleSnippet[] {
  const out: AfterSaleSnippet[] = []
  for (const rec of records) {
    const norm = normalizeAfterSaleRecord(rec)
    if (!norm) continue
    out.push({
      returnType: norm.returnType || null,
      returnTypeName: norm.returnTypeName || null,
      statusName: norm.statusName || null,
      refundStatusName: norm.refundStatusName || null,
      reason: norm.reason || null,
      refunded: norm.refunded,
      refundFeeYuan:
        norm.refunded && rec.refund_fee != null
          ? Number(rec.refund_fee)
          : rec.refund_fee != null
            ? Number(rec.refund_fee)
            : null,
    })
  }
  return out
}

function pickAfterSaleRecords(
  rawMap: Map<string, Record<string, unknown>[]>,
  liveAccountId: string,
  orderNo: string,
): Record<string, unknown>[] {
  return lookupScopedAfterSaleRecords(rawMap, liveAccountId, orderNo)
}

async function main() {
  const rolling = resolveRollingDataHealthCloseRange()
  const startDate = process.argv[2] ?? rolling.startDate
  const endDate = process.argv[3] ?? rolling.endDate
  const outputMode = (process.env.OUTPUT ?? 'both').toLowerCase()

  const { range, views } = await loadBoardArtifactsForRange('custom', startDate, endDate)
  const bundle = await buildRawAnalyzeBundle(range)
  const rawAfterSalesByOrderNo = bundle?.rawAfterSalesByOrderNo ?? new Map<string, Record<string, unknown>[]>()

  const core = filterViewsForCoreMetrics(views)
  const deduped = dedupeViewsByMetricOrderNo(core)
  const metrics = calculateBusinessMetrics(deduped, { scope: 'print-unknown-refund-type' })
  const sets = buildOrderMetricSets(deduped, { scope: 'print-unknown-refund-type' })

  const rows: Array<Record<string, unknown>> = []
  const seen = new Set<string>()

  for (const v of deduped) {
    if (!viewCountsAsRefundOrder(v)) continue
    if (!v.isRefundTypeUnknown) continue
    const orderNo = resolveMetricOrderNo(v)
    if (!orderNo || seen.has(orderNo)) continue
    seen.add(orderNo)

    const rawRecords = pickAfterSaleRecords(rawAfterSalesByOrderNo, v.liveAccountId, orderNo)
    const afterSaleSnippets = summarizeAfterSaleRecords(rawRecords)

    rows.push({
      orderNo,
      anchorName: v.anchorName ?? '—',
      liveAccountName: v.liveAccountName ?? '—',
      liveAccountId: v.liveAccountId ?? '—',
      orderTimeText: v.orderTimeText ?? '—',
      orderStatusText: v.orderStatusText ?? '—',
      afterSaleStatusText: v.afterSaleStatusText ?? '—',
      afterSaleStatusLabel: v.afterSaleStatusLabel ?? '—',
      afterSaleDisplayType: v.afterSaleDisplayType ?? '—',
      refundAmountYuan: centToYuan(v.productRefundAmountCent ?? 0),
      productRefundAmountCent: v.productRefundAmountCent ?? 0,
      returnRefundClassificationSource: v.returnRefundClassificationSource ?? 'unknown',
      isReturnRefundOrder: Boolean(v.isReturnRefundOrder),
      isRefundOnlyOrder: Boolean(v.isRefundOnlyOrder),
      hasReturnRefundApplication: Boolean(v.hasReturnRefundApplication),
      afterSaleCancelled: Boolean(v.afterSaleCancelled),
      afterSaleRecordCount: rawRecords.length,
      afterSaleRecords: afterSaleSnippets,
      afterSaleRecordMissing: rawRecords.length === 0,
    })
  }

  rows.sort((a, b) => String(a.orderNo).localeCompare(String(b.orderNo), 'zh-CN'))

  const summary = {
    range: {
      startDate,
      endDate,
      label: rolling.dataRangeLabel,
    },
    paidOrderCount: metrics.orderCount,
    refundOrderCount: metrics.refundOrderCount,
    unknownRefundTypeOrderCount: metrics.unknownRefundTypeOrderCount,
    metricSetsUnknown: sets.unknownRefundTypeOrderCount,
    printedCount: rows.length,
    missingAfterSaleDetailCount: rows.filter((r) => r.afterSaleRecordMissing).length,
    classificationSourceBreakdown: rows.reduce<Record<string, number>>((acc, row) => {
      const key = String(row.returnRefundClassificationSource ?? 'unknown')
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {}),
  }

  const payload = { summary, orders: rows }
  const outJson = path.resolve(__dirname, '../../../deploy/aliyun/_unknown-refund-type-orders.json')

  if (outputMode === 'json' || outputMode === 'both') {
    await fs.writeFile(outJson, JSON.stringify(payload, null, 2), 'utf8')
    console.log(`JSON 已写入: ${outJson}`)
  }

  if (outputMode === 'table' || outputMode === 'both') {
    console.log('\n=== 退款类型待确认 订单明细 ===')
    console.log(`范围: ${startDate} ~ ${endDate}`)
    console.log(
      `合计: ${summary.printedCount} 单（指标统计 ${summary.unknownRefundTypeOrderCount} 单；无售后明细 ${summary.missingAfterSaleDetailCount} 单）`,
    )
    console.log('分类来源分布:', JSON.stringify(summary.classificationSourceBreakdown))
    console.log('')

    let i = 0
    for (const row of rows) {
      i += 1
      const recSummary =
        (row.afterSaleRecords as AfterSaleSnippet[]).length > 0
          ? (row.afterSaleRecords as AfterSaleSnippet[])
              .map(
                (r) =>
                  `[type=${r.returnType ?? '—'}/${r.returnTypeName ?? '—'} status=${r.statusName ?? '—'} refund=${r.refundStatusName ?? '—'} fee=${r.refundFeeYuan ?? '—'} reason=${r.reason ?? '—'}]`,
              )
              .join(' ')
          : '（无售后原始记录）'

      console.log(
        [
          String(i).padStart(3, ' '),
          String(row.orderNo),
          String(row.anchorName),
          String(row.liveAccountName),
          String(row.orderTimeText),
          `订单:${row.orderStatusText}`,
          `售后:${row.afterSaleStatusText}`,
          `退款¥${row.refundAmountYuan}`,
          `来源:${row.returnRefundClassificationSource}`,
          recSummary,
        ].join(' | '),
      )
    }
  }

  console.log('\nDONE')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
