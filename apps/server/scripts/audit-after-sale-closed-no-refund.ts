/**
 * 扫描「售后关闭且无退款」订单在各口径下的状态（只读）
 *
 * npm run audit:after-sale-closed-no-refund
 *
 * 业务说明（当前 intentional）：
 * - 有效成交：售后关闭且无退款 → 仍可能计入 validRevenue
 * - 日报真实发货：只要 isActualAfterSaleOrder → 计入 invalid，不计真实发货
 */
import path from 'node:path'
import { config } from 'dotenv'
import { addDaysShanghai, formatDateKeyShanghai } from '../src/utils/business-timezone'
import { getBoardScopedViewsForRange } from '../src/services/board-scoped-views.service'
import { getAnchorPerformanceViews } from '../src/services/board-scoped-views.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { dedupeValidRevenueViewsByOrderNoBestValue, explainValidRevenueOrder, isValidRevenueOrder, resolveValidRevenueRefundAmountCent } from '../src/services/valid-revenue-order.service'
import {
  isDailyReportInvalidOrder,
  isDailyReportShippedOrder,
} from '../src/services/daily-report-order.util'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'

config({ path: path.resolve(__dirname, '../.env') })

const DAYS = Number(process.env.DAYS?.trim() || 30)
const AFTER_SALE_CLOSED_RE = /售后关闭|退款关闭|关闭.*无退款/

async function main(): Promise<void> {
  const endDate = formatDateKeyShanghai(new Date())
  const startDate = addDaysShanghai(endDate, -(DAYS - 1))

  console.log('audit-after-sale-closed-no-refund')
  console.log(`扫描 ${startDate} ~ ${endDate}（${DAYS} 天）\n`)

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate,
    endDate,
    role: 'super_admin',
    username: 'verify-script',
  })
  const coreViews = filterViewsForCoreMetrics(scoped.views)
  const withRaw = attachRawByMatchToViews(coreViews, scoped.rawByMatch)
  const deduped = dedupeValidRevenueViewsByOrderNoBestValue(withRaw)

  const hits: Array<{
    orderNo: string
    orderStatus: string
    afterSale: string
    refundCent: number
    valid: boolean
    shipped: boolean
    invalid: boolean
    signed: boolean
    reason: string
  }> = []

  for (const v of deduped) {
    const afterSale = String(v.afterSaleStatusText ?? v.afterSaleStatusLabel ?? '').trim()
    if (!AFTER_SALE_CLOSED_RE.test(afterSale)) continue
    const refundCent = resolveValidRevenueRefundAmountCent(v)
    if (refundCent > 0) continue
    const orderStatus = String(v.orderStatusText ?? '').trim()
    if (!/已完成|已签收/.test(orderStatus)) continue

    const explain = explainValidRevenueOrder(v)
    hits.push({
      orderNo: resolveMetricOrderNo(v) || v.orderId,
      orderStatus,
      afterSale,
      refundCent,
      valid: isValidRevenueOrder(v),
      shipped: isDailyReportShippedOrder(v),
      invalid: isDailyReportInvalidOrder(v),
      signed: isEffectiveSignedView(v),
      reason: explain.reason,
    })
  }

  console.log(`命中 ${hits.length} 单（售后关闭/退款关闭 + 退款金额0 + 已签收/已完成）\n`)

  if (hits.length === 0) {
    console.log('无样本，审计完成')
    return
  }

  let validButNotShipped = 0
  for (const h of hits.slice(0, 20)) {
    console.log(`${h.orderNo}`)
    console.log(`  orderStatus: ${h.orderStatus}`)
    console.log(`  afterSale: ${h.afterSale}`)
    console.log(`  validRevenue: ${h.valid} (${h.reason})`)
    console.log(`  dailyReportShipped: ${h.shipped}`)
    console.log(`  invalidOrder: ${h.invalid}`)
    console.log(`  actualSigned: ${h.signed}`)
    if (h.valid && !h.shipped) validButNotShipped++
  }
  if (hits.length > 20) console.log(`… 另有 ${hits.length - 20} 单`)

  console.log('\n=== 口径结论 ===')
  console.log(
    `有效成交=true 但真实发货=false：${validButNotShipped} 单（当前规则：进过售后流程即剔除真实发货）`,
  )
  console.log(
    '若业务决定「售后关闭无退款=留下来了」应计入真实发货，需单独变更 isDailyReportInvalidOrder 规则。',
  )
  console.log('\naudit 完成（未改库、未改黄金值）')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
