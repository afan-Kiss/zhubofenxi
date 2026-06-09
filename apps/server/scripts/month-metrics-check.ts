/**
 * 经营指标验收（直连 live-query，按 endDate 当日 23:59:59 截断）
 *
 * 用法:
 *   npx tsx scripts/month-metrics-check.ts 2026-05-01 2026-05-28
 *   npx tsx scripts/month-metrics-check.ts 2026-05-01 2026-05-29
 *   npx tsx scripts/month-metrics-check.ts --both
 */
import path from 'node:path'
import { config } from 'dotenv'
import { fetchLiveRangeAnalysis } from '../src/services/board-live-analysis.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { aggregateAnchorLeaderboard } from '../src/services/board-metrics.service'
import { dedupeOrderCountByOrderNo } from '../src/services/order-master-match.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { viewCountsAsPaidOrder } from '../src/services/business-metrics.service'
import { buildStatRangeMeta } from '../src/utils/stat-range-label'
import { resolveDateRange } from '../src/utils/date-range'

config({ path: path.resolve(__dirname, '../.env') })

const MAY29_PAID_ORDER = 'P795575711113009551'
const MAY29_UNPAID_ORDERS = ['P795574682994194071', 'P795575037798194951'] as const
const ORPHAN_AFTER_SALE = 'P795576476520390821'

interface WindowExpect {
  label: string
  uniqueOrderCount: number
  paidOrderCount: number
  payYuan: number
  mustInclude: string[]
  mustExclude: string[]
}

const WINDOW_EXPECT: Record<string, WindowExpect> = {
  '2026-05-28': {
    label: 'A. 2026-05-01 ~ 2026-05-28（不含 5/29 订单）',
    uniqueOrderCount: 225,
    paidOrderCount: 220,
    payYuan: 262_856.6,
    mustInclude: [],
    mustExclude: [MAY29_PAID_ORDER, ORPHAN_AFTER_SALE, ...MAY29_UNPAID_ORDERS],
  },
  '2026-05-29': {
    label: 'B. 2026-05-01 ~ 2026-05-29（含 5/29 当日订单）',
    uniqueOrderCount: 228,
    paidOrderCount: 221,
    payYuan: 263_673.6,
    mustInclude: [MAY29_PAID_ORDER, ...MAY29_UNPAID_ORDERS],
    mustExclude: [ORPHAN_AFTER_SALE],
  },
}

function near(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol
}

function orderNoInViews(
  views: { displayOrderNo?: string; officialOrderNo?: string; packageId?: string }[],
  no: string,
): boolean {
  return views.some((v) => {
    const candidates = [v.displayOrderNo, v.officialOrderNo, v.packageId].filter(Boolean)
    return candidates.some((c) => c === no || String(c).includes(no))
  })
}

function findUnmatchedOrphan(
  unmatched: Array<{ package_id: string; unmatchedReason?: string }>,
): (typeof unmatched)[number] | undefined {
  return unmatched.find(
    (u) => u.package_id === ORPHAN_AFTER_SALE || u.package_id.includes('795576476520390821'),
  )
}

async function runWindow(startDate: string, endDate: string) {
  const range = resolveDateRange('custom', startDate, endDate)
  const meta = buildStatRangeMeta(startDate, endDate)
  const expect = WINDOW_EXPECT[endDate] ?? null

  const r = await fetchLiveRangeAnalysis({
    startDate,
    endDate,
    requestId: `month-check-${endDate}-${Date.now()}`,
  })
  const views = r.views
  const m = calculateBusinessMetrics(views)
  const anchors = aggregateAnchorLeaderboard(views)
  const unmatched = r.bundle.unmatchedAfterSaleRecords ?? []
  const orderNos = views.map((v) => resolveMetricOrderNo(v)).filter(Boolean)
  const uniqueOrderCount = dedupeOrderCountByOrderNo(orderNos)
  const orphanUnmatched = findUnmatchedOrphan(unmatched)
  const paidViews = views.filter(viewCountsAsPaidOrder)
  const orphanInPaid = paidViews.some((v) => orderNoInViews([v], ORPHAN_AFTER_SALE))
  const orphanInAnchors = anchors.some((a) => {
    const anchorViews = views.filter((v) => v.anchorName === a.anchorName)
    return orderNoInViews(anchorViews, ORPHAN_AFTER_SALE)
  })

  const includeChecks = Object.fromEntries(
    (expect?.mustInclude ?? []).map((no) => [no, orderNoInViews(views, no)]),
  )
  const excludeChecks = Object.fromEntries(
    (expect?.mustExclude ?? []).map((no) => [no, !orderNoInViews(views, no)]),
  )

  const hardAssertions: Record<string, boolean> = {
    orphan_not_in_mainOrders: !orderNoInViews(views, ORPHAN_AFTER_SALE),
    orphan_not_in_paidOrders: !orphanInPaid,
    orphan_not_in_anchorMetrics: !orphanInAnchors,
    orphan_in_unmatchedAfterSaleRecords: Boolean(orphanUnmatched),
    orphan_unmatchedReason:
      !orphanUnmatched ||
      orphanUnmatched.unmatchedReason === 'not_found_in_order_master' ||
      orphanUnmatched.unmatchedReason === 'after_sale_only_pseudo_order',
    no_after_sale_source_in_mainOrders: !(r.bundle.orders ?? []).some(
      (o) => o.sourceType === 'after_sale',
    ),
    no_pseudo_orphan_in_paymentBaseCent: !views.some(
      (v) =>
        orderNoInViews([v], ORPHAN_AFTER_SALE) &&
        Number(v.paymentBaseCent ?? 0) > 0,
    ),
    p795576_never_in_mainOrders: !orderNoInViews(views, ORPHAN_AFTER_SALE),
  }

  const checks: Record<string, boolean> = { ...hardAssertions }
  if (expect) {
    checks.uniqueOrderCount = uniqueOrderCount === expect.uniqueOrderCount
    checks.paidOrderCount = m.orderCount === expect.paidOrderCount
    checks.payYuan = near(m.totalGmv, expect.payYuan)
    if (endDate === '2026-05-29') {
      checks.may29_unique_228 = uniqueOrderCount === 228
      checks.may29_paid_221 = m.orderCount === 221
      checks.may29_pay_263673_60 = near(m.totalGmv, 263_673.6)
    }
    for (const [k, v] of Object.entries(includeChecks)) checks[`include_${k}`] = v
    for (const [k, v] of Object.entries(excludeChecks)) checks[`exclude_${k}`] = v
  }

  return {
    window: expect?.label ?? `自定义 ${startDate} ~ ${endDate}`,
    query: {
      startDate: range.startDate,
      endDate: range.endDate,
      queryStartTime: meta.queryStartTime,
      queryEndTime: meta.queryEndTime,
      endTimeMs: range.endTimeMs,
      includesTodayRealtime: meta.includesTodayRealtime,
    },
    fieldCaliber: {
      payAmount: meta.payAmountTimeField,
      masterOrders: meta.masterOrderTimeField,
      afterSale: meta.afterSaleTimeField,
    },
    fetchMeta: r.bundle.fetchMeta,
    actual: {
      viewRows: views.length,
      uniqueOrderCount,
      paidOrderCount: m.orderCount,
      payYuan: m.totalGmv,
    },
    expected: expect,
    orphanAfterSale: {
      orderNo: ORPHAN_AFTER_SALE,
      inMainOrders: orderNoInViews(views, ORPHAN_AFTER_SALE),
      inPaidOrders: orphanInPaid,
      inAnchorMetrics: orphanInAnchors,
      inUnmatched: Boolean(orphanUnmatched),
      unmatchedReason: orphanUnmatched?.unmatchedReason ?? null,
      explanation: orphanUnmatched?.explanation ?? null,
    },
    checks,
    ok: expect ? Object.values(checks).every(Boolean) : null,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const both = args.includes('--both')
  const filtered = args.filter((a) => a !== '--both')

  const windows: Array<[string, string]> = both
    ? [
        ['2026-05-01', '2026-05-28'],
        ['2026-05-01', '2026-05-29'],
      ]
    : [[filtered[0] ?? '2026-05-01', filtered[1] ?? '2026-05-28']]

  const results = []
  for (const [start, end] of windows) {
    results.push(await runWindow(start, end))
  }

  console.log(JSON.stringify({ results }, null, 2))
  process.exit(results.some((r) => r.ok === false) ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
