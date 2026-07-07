/**
 * 2026-07-03 有效成交单 P798605049367374181 完整判断链审计（只读，不改库）
 *
 * npm run audit:anchor-valid-order-20260703
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import {
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from '../src/services/board-scoped-views.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { explainValidRevenueOrder, isValidRevenueOrder } from '../src/services/valid-revenue-order.service'
import { isLowPriceBrushOrderView } from '../src/services/low-price-brush-order.service'
import {
  ensureManualAnchorOverrideCache,
  resolveManualAnchorOverrideForView,
} from '../src/services/order-anchor-manual-override.service'
import { pickProductName } from '../src/services/order-row-mapper.service'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { centToYuan } from '../src/utils/money'

config({ path: path.resolve(__dirname, '../.env') })

const AUDIT_DATE = '2026-07-03'
const TARGET_ORDER = 'P798605049367374181'
const EXPECTED_ANCHOR = '子杰'

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function findViewByOrderNo(views: AnalyzedOrderView[], orderNo: string): AnalyzedOrderView | undefined {
  const bare = orderNo.replace(/^P/, '')
  return views.find(
    (v) =>
      v.orderId === orderNo ||
      v.packageId === orderNo ||
      v.matchOrderId === orderNo ||
      v.orderId === bare ||
      v.packageId === bare ||
      v.matchOrderId === bare ||
      (resolveMetricOrderNo(v) || v.orderId) === orderNo,
  )
}

function inferConclusion(params: {
  view: AnalyzedOrderView | undefined
  inPerformanceViews: boolean
  valid: boolean
  anchorName: string
  lowPrice: boolean
}): string {
  const { view, inPerformanceViews, valid, anchorName, lowPrice } = params
  if (!view) {
    return '订单不在当日 scoped views（本地库无数据或支付日不匹配）→ 需在生产环境复验'
  }
  if (lowPrice) {
    return '被低价刷单规则剔除 → 若测试期望 valid=true，则断言可能旧了或低价阈值需核对'
  }
  if (anchorName !== EXPECTED_ANCHOR && inPerformanceViews) {
    return `归属为 ${anchorName} 而非期望 ${EXPECTED_ANCHOR} → 归属规则变化或断言旧了`
  }
  if (!valid) {
    const reason = explainValidRevenueOrder(view).reason
    if (/售后|退款|关闭|取消/.test(reason)) {
      return `有效成交=false（${reason}）→ 售后状态变化导致断言过期（非代码 BUG）`
    }
    return `有效成交=false（${reason}）→ 需对照平台原始状态判断是断言旧了还是规则变更`
  }
  if (valid && anchorName === EXPECTED_ANCHOR && inPerformanceViews) {
    return '当前归属与有效成交均符合测试断言 → 断言应 PASS（若 verify 仍 FAIL，查 dedupe/视图链路）'
  }
  return '部分字段与断言不一致 → 需人工对照 HAR/平台原始单'
}

async function main(): Promise<void> {
  console.log('audit-anchor-valid-order-20260703')
  console.log(`审计日期: ${AUDIT_DATE}`)
  console.log(`目标订单: ${TARGET_ORDER}`)
  console.log('只读，不改库\n')

  await bootstrapQualityBadCaseCache()
  await ensureManualAnchorOverrideCache()

  const rawRows = await prisma.xhsRawOrder.findMany({
    where: {
      OR: [
        { orderId: TARGET_ORDER },
        { packageId: TARGET_ORDER },
        { orderId: TARGET_ORDER.replace(/^P/, '') },
      ],
    },
    take: 3,
  })
  const rawRow = rawRows[0] ?? null

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: AUDIT_DATE,
    endDate: AUDIT_DATE,
  })
  const withRaw = attachRawByMatchToViews(scoped.views, scoped.rawByMatch)
  const performanceViews = await getAnchorPerformanceViews(withRaw, scoped.rawByMatch)
  const deduped = dedupeViewsByMetricOrderNo(performanceViews)
  const view = findViewByOrderNo(deduped, TARGET_ORDER)
  const viewWithRaw = view
    ? (attachRawByMatchToViews([view], scoped.rawByMatch)[0] as AnalyzedOrderView & {
        raw?: Record<string, unknown>
      })
    : undefined

  const manualOverride = view ? resolveManualAnchorOverrideForView(view) : null
  const validExplain = view ? explainValidRevenueOrder(view) : null
  const lowPrice = view ? isLowPriceBrushOrderView(view) : false
  const inPerformanceViews = Boolean(view)

  section('1. orderNo / packageId / productTitle')
  console.log(`orderNo: ${TARGET_ORDER}`)
  console.log(`packageId: ${view?.packageId ?? rawRow?.packageId ?? '—'}`)
  const productTitle = viewWithRaw?.raw
    ? pickProductName(viewWithRaw.raw)
    : rawRow?.rawJson
      ? pickProductName(rawRow.rawJson as Record<string, unknown>)
      : '—'
  console.log(`productTitle: ${productTitle}`)

  section('2. paymentTime / orderTimeText')
  console.log(`paymentTime: ${view?.orderTimeText ?? '—'}`)
  console.log(`orderTimeText: ${view?.orderTimeText ?? '—'}`)
  if (rawRow?.orderTime) {
    console.log(`rawRow.orderTime: ${rawRow.orderTime.toISOString()}`)
  }

  section('3. liveAccountName')
  console.log(view?.liveAccountName ?? rawRow?.liveAccountName ?? '—')

  section('4. anchorId / anchorName')
  console.log(`anchorId: ${view?.anchorId ?? '—'}`)
  console.log(`anchorName: ${view?.anchorName ?? '—'}`)

  section('5. scheduleAttributionSource')
  console.log(view?.scheduleAttributionSource ?? view?.attributionType ?? '—')

  section('6. scheduleAttributionExplain')
  console.log(view?.scheduleAttributionExplain ?? view?.attributionExplain ?? '—')

  section('7. manual_override 是否命中')
  if (manualOverride) {
    console.log(`命中 manual_override → ${manualOverride.anchorName} (${manualOverride.anchorId})`)
    console.log(JSON.stringify(manualOverride, null, 2))
  } else {
    console.log('未命中 manual_override')
  }

  section('8. includedInGmv')
  console.log(view?.includedInGmv ?? '—')

  section('9. effectiveGmvCent')
  console.log(view?.effectiveGmvCent ?? '—')

  section('10. paymentBaseCent')
  const paymentBaseCent = view?.paymentBaseCent ?? 0
  console.log(`${paymentBaseCent} (¥${centToYuan(paymentBaseCent).toFixed(2)})`)

  section('11. orderStatusText')
  console.log(view?.orderStatusText ?? '—')

  section('12. afterSaleStatusText')
  console.log(view?.afterSaleStatusText ?? view?.afterSaleStatusLabel ?? '—')

  section('13. refundStatusText')
  console.log(
    (view as { refundStatusText?: string })?.refundStatusText ??
      (view as { refundStatus?: string })?.refundStatus ??
      '—',
  )

  section('14. isValidRevenueOrder')
  console.log(view ? isValidRevenueOrder(view) : '—')

  section('15. explainValidRevenueOrder reason')
  if (validExplain) {
    console.log(`valid: ${validExplain.valid}`)
    console.log(`reason: ${validExplain.reason}`)
  } else {
    console.log('—（订单不在视图）')
  }

  section('16. 是否被低价过滤')
  console.log(lowPrice ? '是（isLowPriceBrushOrderView=true）' : '否')

  section('17. 是否在 getAnchorPerformanceViews 里')
  console.log(inPerformanceViews ? '是' : '否')

  section('18. 当前归属主播')
  console.log(view?.anchorName ?? '—')

  section('19. 测试断言期望主播')
  console.log(EXPECTED_ANCHOR)
  console.log('（verify:anchor-performance-full-integrity 期望 valid=true 且 anchorName=子杰）')

  section('20. 结论')
  const conclusion = inferConclusion({
    view,
    inPerformanceViews,
    valid: validExplain?.valid ?? false,
    anchorName: String(view?.anchorName ?? ''),
    lowPrice,
  })
  console.log(conclusion)

  if (!rawRow && !view) {
    console.log('\n⚠ 本地库无此订单数据，请在生产环境运行本脚本获取完整判断链')
    process.exit(0)
  }

  console.log('\naudit-anchor-valid-order-20260703 完成')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
