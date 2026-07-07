/**
 * 2026-07-04 日报「真实发货」逐单审计（只读，不改库）
 *
 * npm run audit:daily-report-shipped-20260704
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { buildDailyReport } from '../src/services/daily-report.service'
import {
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from '../src/services/board-scoped-views.service'
import { resolveDailyReportAnchorsForDate } from '../src/services/anchor-performance-attribution.service'
import { getAnchorConfigSync } from '../src/services/anchor.service'
import {
  countDailyReportOrders,
  isDailyReportInvalidOrder,
  isDailyReportShippedOrder,
  listDailyReportShippedOrders,
  sumDailyReportShippedFromViews,
} from '../src/services/daily-report-order.util'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { isLowPriceBrushOrderView } from '../src/services/low-price-brush-order.service'
import { isActualAfterSaleOrder } from '../src/services/operations-after-sale-order.util'
import { pickProductName } from '../src/services/order-row-mapper.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { centToYuan } from '../src/utils/money'

config({ path: path.resolve(__dirname, '../.env') })

const AUDIT_DATE = '2026-07-04'

const GOLDEN_SHIPPED: Record<string, number> = {
  子杰: 3,
  小艺: 2,
  飞云: 3,
  小红: 0,
}
const GOLDEN_TOTAL_SHIPPED = 8

type ExclusionCategory =
  | '计入真实发货'
  | '低价'
  | '售后'
  | '关闭取消'
  | '未支付'
  | '金额为0'
  | '其他'

interface OrderAuditLine {
  orderNo: string
  packageId: string
  productTitle: string
  paymentTime: string
  liveAccountName: string
  anchorId: string
  anchorName: string
  scheduleAttributionSource: string
  scheduleAttributionExplain: string
  includedInGmv: boolean
  paymentBaseCent: number
  effectiveGmvCent: number
  orderStatusText: string
  afterSaleStatusText: string
  refundStatusText: string
  isLowPriceBrushOrder: boolean
  isDailyReportInvalidOrder: boolean
  isDailyReportShippedOrder: boolean
  exclusionCategory: ExclusionCategory
  exclusionDetail: string
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function resolveExclusion(v: AnalyzedOrderView): { category: ExclusionCategory; detail: string } {
  if (isDailyReportShippedOrder(v)) {
    return { category: '计入真实发货', detail: '—' }
  }
  if (!v.includedInGmv) {
    return { category: '未支付', detail: 'includedInGmv=false' }
  }
  if (isLowPriceBrushOrderView(v)) {
    return { category: '低价', detail: '低价刷单剔除' }
  }
  const orderStatus = (v.orderStatusText ?? '').trim()
  const closedKeywords = ['已关闭', '交易关闭', '已取消', '交易取消']
  if (closedKeywords.some((k) => orderStatus.includes(k))) {
    return { category: '关闭取消', detail: orderStatus || '订单状态含关闭/取消' }
  }
  if (isActualAfterSaleOrder(v)) {
    const after = (v.afterSaleStatusText ?? v.afterSaleStatusLabel ?? '').trim()
    return { category: '售后', detail: after || '存在售后/退款记录' }
  }
  if ((v.paymentBaseCent ?? 0) <= 0) {
    return { category: '金额为0', detail: `paymentBaseCent=${v.paymentBaseCent ?? 0}` }
  }
  return {
    category: '其他',
    detail: `orderStatus=${orderStatus || '—'} afterSale=${(v.afterSaleStatusText ?? '—')}`,
  }
}

function pickProductTitle(v: AnalyzedOrderView & { raw?: Record<string, unknown> }): string {
  const title = pickProductName(v.raw)
  return title && title !== '—' ? title : '商品名称未同步'
}

function buildOrderLine(v: AnalyzedOrderView & { raw?: Record<string, unknown> }): OrderAuditLine {
  const { category, detail } = resolveExclusion(v)
  return {
    orderNo: resolveMetricOrderNo(v) || String(v.orderId ?? '').trim(),
    packageId: String(v.packageId ?? '').trim(),
    productTitle: pickProductTitle(v),
    paymentTime: v.orderTimeText ?? '—',
    liveAccountName: v.liveAccountName ?? '—',
    anchorId: String(v.anchorId ?? '').trim(),
    anchorName: String(v.anchorName ?? '未归属').trim() || '未归属',
    scheduleAttributionSource: String(v.scheduleAttributionSource ?? v.attributionType ?? '—'),
    scheduleAttributionExplain: String(v.scheduleAttributionExplain ?? v.attributionExplain ?? '—'),
    includedInGmv: Boolean(v.includedInGmv),
    paymentBaseCent: v.paymentBaseCent ?? 0,
    effectiveGmvCent: v.effectiveGmvCent ?? 0,
    orderStatusText: v.orderStatusText ?? '—',
    afterSaleStatusText: String(v.afterSaleStatusText ?? v.afterSaleStatusLabel ?? '—'),
    refundStatusText: String(
      (v as { refundStatusText?: string }).refundStatusText ??
        (v as { refundStatus?: string }).refundStatus ??
        '—',
    ),
    isLowPriceBrushOrder: isLowPriceBrushOrderView(v),
    isDailyReportInvalidOrder: isDailyReportInvalidOrder(v),
    isDailyReportShippedOrder: isDailyReportShippedOrder(v),
    exclusionCategory: category,
    exclusionDetail: detail,
  }
}

function printOrderLine(line: OrderAuditLine, prefix = ''): void {
  console.log(`${prefix}${line.orderNo}`)
  console.log(`  packageId: ${line.packageId || '—'}`)
  console.log(`  productTitle: ${line.productTitle}`)
  console.log(`  paymentTime: ${line.paymentTime}`)
  console.log(`  liveAccountName: ${line.liveAccountName}`)
  console.log(`  anchorId: ${line.anchorId || '—'}  anchorName: ${line.anchorName}`)
  console.log(`  scheduleAttributionSource: ${line.scheduleAttributionSource}`)
  console.log(`  scheduleAttributionExplain: ${line.scheduleAttributionExplain}`)
  console.log(`  includedInGmv: ${line.includedInGmv}`)
  console.log(
    `  paymentBaseCent: ${line.paymentBaseCent} (¥${centToYuan(line.paymentBaseCent).toFixed(2)})`,
  )
  console.log(`  effectiveGmvCent: ${line.effectiveGmvCent}`)
  console.log(`  orderStatusText: ${line.orderStatusText}`)
  console.log(`  afterSaleStatusText: ${line.afterSaleStatusText}`)
  console.log(`  refundStatusText: ${line.refundStatusText}`)
  console.log(`  isLowPriceBrushOrder: ${line.isLowPriceBrushOrder}`)
  console.log(`  isDailyReportInvalidOrder: ${line.isDailyReportInvalidOrder}`)
  console.log(`  isDailyReportShippedOrder: ${line.isDailyReportShippedOrder}`)
  console.log(`  剔除原因: ${line.exclusionCategory}${line.exclusionDetail !== '—' ? ` (${line.exclusionDetail})` : ''}`)
}

function inferDiffReason(line: OrderAuditLine): string {
  if (line.exclusionCategory === '计入真实发货') {
    return `当前计入 ${line.anchorName}（${line.scheduleAttributionSource}）`
  }
  if (line.exclusionCategory === '低价') return '被低价刷单规则剔除'
  if (line.exclusionCategory === '售后') return '被售后/退款规则剔除（isDailyReportInvalidOrder）'
  if (line.exclusionCategory === '关闭取消') return '被关闭/取消状态剔除'
  if (line.exclusionCategory === '未支付') return '未计入 GMV（未支付）'
  if (line.exclusionCategory === '金额为0') return '支付基数为 0'
  return `其他剔除：${line.exclusionDetail}`
}

async function main(): Promise<void> {
  console.log(`audit-daily-report-shipped-20260704`)
  console.log(`审计日期: ${AUDIT_DATE}（只读，不改库）`)

  const report = await buildDailyReport({
    preset: 'custom',
    startDate: AUDIT_DATE,
    endDate: AUDIT_DATE,
  })

  section('1. 当前日报真实发货总览')
  console.log(`真实发货总额: ¥${report.summary.totalShippedAmountYuan.toFixed(2)}`)
  console.log(`真实发货总单数: ${report.summary.totalSoldOrderCount}`)
  console.log(`关闭/退货单: ${report.summary.totalInvalidOrderCount}`)

  section('2. 各主播日报汇总')
  const config = getAnchorConfigSync()
  const reportAnchors = resolveDailyReportAnchorsForDate(config, AUDIT_DATE)
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: AUDIT_DATE,
    endDate: AUDIT_DATE,
  })

  const allPerformanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const allLines: OrderAuditLine[] = []
  const dedupedAll = dedupeViewsByMetricOrderNo(
    attachRawByMatchToViews(allPerformanceViews, scoped.rawByMatch),
  )
  for (const v of dedupedAll) {
    allLines.push(buildOrderLine(v as AnalyzedOrderView & { raw?: Record<string, unknown> }))
  }

  for (const anchor of reportAnchors) {
    const views = await getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      anchor.anchorId,
      anchor.anchorName,
    )
    const recalc = sumDailyReportShippedFromViews(views)
    const invalid = countDailyReportOrders(views).invalidOrderCount
    const shippedLines = listDailyReportShippedOrders(views, anchor.anchorName)
    const invalidLines = dedupeViewsByMetricOrderNo(views)
      .filter((v) => isDailyReportInvalidOrder(v) && v.includedInGmv && !isLowPriceBrushOrderView(v))
      .map((v) => buildOrderLine(attachRawByMatchToViews([v], scoped.rawByMatch)[0]!))

    const reportRow = report.anchors.find((r) => r.anchorName === anchor.anchorName)

    console.log(`\n--- ${anchor.anchorName} ---`)
    console.log(`soldOrderCount: ${reportRow?.soldOrderCount ?? recalc.soldOrderCount}`)
    console.log(`shippedAmountYuan: ¥${(reportRow?.shippedAmountYuan ?? recalc.shippedAmountYuan).toFixed(2)}`)
    console.log(`invalidOrderCount: ${reportRow?.invalidOrderCount ?? invalid}`)

    console.log('shippedOrders:')
    if (shippedLines.length === 0) console.log('  （无）')
    for (const line of shippedLines) {
      console.log(`  ✓ ${line.orderNo} ¥${line.amountYuan.toFixed(2)} ${line.productTitle}`)
    }

    console.log('invalidOrders（关闭/退货，未计入真实发货）:')
    if (invalidLines.length === 0) console.log('  （无）')
    for (const line of invalidLines) {
      printOrderLine(line, '  ')
    }
  }

  section('3. 全店逐单明细（remap 后 performanceViews，按 P 单去重）')
  if (allLines.length === 0) {
    console.log('（当日无订单视图，请确认数据库是否有 2026-07-04 支付订单）')
  }
  for (const line of allLines) {
    printOrderLine(line)
  }

  section('4. 与固定黄金值对比')
  console.log('黄金值（verify 脚本 FIXED_20260704，尚未修改）:')
  for (const [name, expected] of Object.entries(GOLDEN_SHIPPED)) {
    console.log(`  ${name}: ${expected}`)
  }
  console.log(`  全店: ${GOLDEN_TOTAL_SHIPPED}`)

  const actualByAnchor = new Map<string, number>()
  let actualTotal = 0
  for (const anchor of reportAnchors) {
    const row = report.anchors.find((r) => r.anchorName === anchor.anchorName)
    const actual = row?.soldOrderCount ?? 0
    actualByAnchor.set(anchor.anchorName, actual)
    actualTotal += actual
  }
  actualTotal = report.summary.totalSoldOrderCount

  console.log('\n当前系统实际:')
  for (const [name, expected] of Object.entries(GOLDEN_SHIPPED)) {
    const actual = actualByAnchor.get(name) ?? 0
    const delta = actual - expected
    const mark = delta === 0 ? '✓' : '✗'
    console.log(`  ${mark} ${name}: 期望 ${expected}，实际 ${actual}，差 ${delta >= 0 ? '+' : ''}${delta}`)
  }
  const totalDelta = actualTotal - GOLDEN_TOTAL_SHIPPED
  console.log(
    `  ${totalDelta === 0 ? '✓' : '✗'} 全店: 期望 ${GOLDEN_TOTAL_SHIPPED}，实际 ${actualTotal}，差 ${totalDelta >= 0 ? '+' : ''}${totalDelta}`,
  )

  section('5. 差异逐单分析（不修改黄金值，仅解释）')

  for (const [anchorName, expected] of Object.entries(GOLDEN_SHIPPED)) {
    const actual = actualByAnchor.get(anchorName) ?? 0
    const deficit = expected - actual
    if (deficit <= 0) continue
    console.log(`\n【${anchorName} 少 ${deficit} 单】可能原因：`)

    const shippedForAnchor = allLines.filter(
      (l) => l.isDailyReportShippedOrder && l.anchorName === anchorName,
    )
    console.log(`  当前计入 ${anchorName} 的真实发货 ${shippedForAnchor.length} 单:`)
    for (const line of shippedForAnchor) {
      console.log(`    - ${line.orderNo} ¥${centToYuan(line.paymentBaseCent).toFixed(2)} (${line.scheduleAttributionSource})`)
    }

    const excludedCandidates = allLines.filter(
      (l) =>
        !l.isDailyReportShippedOrder &&
        l.includedInGmv &&
        !l.isLowPriceBrushOrder &&
        l.exclusionCategory !== '未支付',
    )
    if (excludedCandidates.length > 0) {
      console.log(`  当日支付池内被剔除的订单（可能导致黄金值偏高）:`)
      for (const line of excludedCandidates) {
        console.log(`    - ${line.orderNo} → ${inferDiffReason(line)}`)
      }
    }

    const onOtherAnchors = allLines.filter(
      (l) => l.isDailyReportShippedOrder && l.anchorName !== anchorName,
    )
    if (onOtherAnchors.length > 0) {
      console.log(`  当前计入其他主播的真实发货（可能因归属变化从 ${anchorName} 挪走）:`)
      for (const line of onOtherAnchors) {
        console.log(
          `    - ${line.orderNo} → ${line.anchorName} (${line.scheduleAttributionSource}: ${line.scheduleAttributionExplain.slice(0, 80)})`,
        )
      }
    }

    console.log(
      `  结论提示: 若剔除单数 + 归属挪走单数 ≥ ${deficit}，差异可能来自规则/归属变更；若仍对不上，需人工对照 HAR/平台原始单号更新黄金值。`,
    )
  }

  if (totalDelta > 0) {
    console.log(`\n【全店少 ${totalDelta} 单】汇总:`)
    const shippedAll = allLines.filter((l) => l.isDailyReportShippedOrder)
    console.log(`  当前真实发货 ${shippedAll.length} 单:`)
    for (const line of shippedAll) {
      console.log(`    - ${line.orderNo} ${line.anchorName} ¥${centToYuan(line.paymentBaseCent).toFixed(2)}`)
    }
    const excluded = allLines.filter((l) => !l.isDailyReportShippedOrder && l.includedInGmv)
    if (excluded.length > 0) {
      console.log(`  支付池内未计入真实发货 ${excluded.length} 单:`)
      for (const line of excluded) {
        console.log(`    - ${line.orderNo} ${line.anchorName} → ${inferDiffReason(line)}`)
      }
    }
  }

  section('6. 审计完成')
  console.log('本脚本未修改数据库与黄金常量。请结合上方逐单字段人工判断。')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
