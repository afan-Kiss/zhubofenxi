/**
 * 自定义日期范围与计算口径验收
 * 用法: npm run verify:custom-date-range
 */
import { resolveDateRange } from '../src/utils/date-range'
import {
  addDaysShanghai,
  formatDateKeyShanghai,
  thisWeekStartKeyShanghai,
  weekdayIsoShanghai,
} from '../src/utils/business-timezone'
import { buildScheduleBounds, isPayTimeInSchedule } from '../src/utils/anchor-schedule-time.util'
import { lookupWorkbenchRefund } from '../src/utils/live-account-cache-key.util'
import { mergeWorkbenchRefundMaps } from '../src/services/xhs-after-sales-workbench.service'
import {
  classifyAnchorPocketOrder,
} from '../src/services/anchor-pocket-order.service'
import {
  buildAnchorAuditExportPayload,
  countAnchorAuditExportOrders,
  getAnchorAuditExportMeta,
} from '../src/services/anchor-audit-export.service'
import { buildAnchorPocketSummary } from '../src/services/anchor-pocket-revenue.service'
import { resolveViewRefundAmountCent } from '../src/services/order-refund-metrics.service'
import { clearScheduleAttributionCache } from '../src/services/anchor-schedule-attribution.service'
import type { AnalyzedOrderView } from '../src/types/analysis'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function makeView(partial: Partial<AnalyzedOrderView>): AnalyzedOrderView {
  return {
    orderId: 'o1',
    packageId: 'p1',
    bizOrderId: 'b1',
    displayOrderNo: 'P1',
    officialOrderNo: 'P1',
    matchOrderId: 'm1',
    orderTimeText: '2026-06-20 10:00:00',
    buyerId: 'u1',
    anchorId: 'a1',
    anchorName: '子杰',
    liveAccountName: 'XY祥钰珠宝',
    attributionType: 'time_rule',
    gmvCent: 5000,
    productAmountCent: 5000,
    receivableAmountCent: 5000,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: 5000,
    actualSellerReceiveAmountCent: 5000,
    actualSignedAmountCent: 5000,
    orderStatusText: '已完成',
    afterSaleStatusText: '无售后',
    isSigned: true,
    isReturned: false,
    isActualSigned: true,
    isQualityReturn: false,
    returnAmountCent: 0,
    productRefundAmountCent: 0,
    freightRefundAmountCent: 0,
    realAfterSaleAmountCent: 0,
    isFreightRefundOnly: false,
    afterSaleClosedNoRefund: false,
    isReturnRefund: false,
    isRefundOnly: false,
    isRealProductRefund: false,
    afterSaleCategory: '',
    afterSaleStatusLabel: '',
    afterSaleDisplayType: '',
    isSizeMismatch: false,
    reasonText: '',
    effectiveGmvCent: 5000,
    paymentBaseCent: 5000,
    paymentBaseSource: 'test',
    includedInGmv: true,
    countsForSigned: true,
    countsForGrossProfit: true,
    gmvExcludeReason: null,
    isEffectiveSigned: true,
    ...partial,
  }
}

function runDateBoundaryTests(issues: string[]): void {
  const today = formatDateKeyShanghai(new Date())
  const yesterday = addDaysShanghai(today, -1)

  const single = resolveDateRange('custom', today, today)
  assert(single.startDate === today && single.endDate === today, '单日 custom 键正确', issues)

  const crossMonth = resolveDateRange('custom', '2026-05-28', '2026-06-05')
  assert(crossMonth.startDate === '2026-05-28', '跨月起始正确', issues)
  assert(crossMonth.endDate === '2026-06-05', '跨月结束正确', issues)

  const includesToday = resolveDateRange('custom', addDaysShanghai(today, -3), today)
  assert(includesToday.endDate === today, '包含今天', issues)

  const includesYesterday = resolveDateRange('custom', yesterday, today)
  assert(includesYesterday.startDate === yesterday, '包含昨天', issues)

  const rangeJun = resolveDateRange('custom', '2026-06-01', '2026-06-30')
  const startMs = Date.parse('2026-06-01T00:00:00+08:00')
  const endMs = Date.parse('2026-06-30T23:59:59.999+08:00')
  const nextDayMs = Date.parse('2026-07-01T00:00:00+08:00')
  const inRange = (payMs: number) =>
    payMs >= rangeJun.startTimeMs && payMs <= rangeJun.endTimeMs

  assert(inRange(startMs), 'startDate 00:00 订单应包含', issues)
  assert(inRange(endMs), 'endDate 23:59:59.999 订单应包含', issues)
  assert(!inRange(nextDayMs), 'endDate 次日 00:00 不应包含', issues)
  assert(rangeJun.startTimeMs === startMs, 'startTimeMs 为上海 00:00', issues)
  assert(rangeJun.endTimeMs === endMs, 'endTimeMs 为上海 23:59:59.999', issues)
  assert(nextDayMs > rangeJun.endTimeMs, 'endExclusive 边界外', issues)
}

function findShanghaiMondayOnOrBefore(dateKey: string): string {
  let cursor = dateKey
  for (let i = 0; i < 7; i++) {
    if (weekdayIsoShanghai(cursor) === 1) return cursor
    cursor = addDaysShanghai(cursor, -1)
  }
  return dateKey
}

function runThisWeekTests(issues: string[]): void {
  const mondayKey = findShanghaiMondayOnOrBefore('2026-06-16')
  assert(weekdayIsoShanghai(mondayKey) === 1, `${mondayKey} 应为上海周一`, issues)
  const monStart = thisWeekStartKeyShanghai(new Date(Date.parse(`${mondayKey}T00:00:00+08:00`)))
  assert(monStart === mondayKey, '上海周一 00:00 本周应从当周一开始', issues)

  const sundayKey = addDaysShanghai(mondayKey, 6)
  assert(weekdayIsoShanghai(sundayKey) === 7, `${sundayKey} 应为上海周日`, issues)
  const sunStart = thisWeekStartKeyShanghai(new Date(Date.parse(`${sundayKey}T23:59:59+08:00`)))
  assert(sunStart === mondayKey, '上海周日 23:59 本周仍从周一开始', issues)

  const utcShanghaiMondayMidnight = new Date(Date.parse(`${mondayKey}T00:00:00+08:00`))
  assert(formatDateKeyShanghai(utcShanghaiMondayMidnight) === mondayKey, '上海周一 00:00 日期键', issues)
  const weekFromUtc = thisWeekStartKeyShanghai(utcShanghaiMondayMidnight)
  assert(weekFromUtc === mondayKey, 'UTC/上海不一致点本周起始正确', issues)

  const thisWeek = resolveDateRange('thisWeek')
  assert(thisWeek.startDate === thisWeekStartKeyShanghai(), 'thisWeek preset 与 helper 一致', issues)
  assert(thisWeek.endDate === formatDateKeyShanghai(new Date()), 'thisWeek end 为今天', issues)

  const today = resolveDateRange('today')
  const yest = resolveDateRange('yesterday')
  const month = resolveDateRange('thisMonth')
  assert(today.startDate === today.endDate, 'today 单日', issues)
  assert(yest.startDate === addDaysShanghai(formatDateKeyShanghai(new Date()), -1), 'yesterday', issues)
  assert(month.endDate >= month.startDate, 'thisMonth 有效', issues)
}

function runScheduleBoundaryTests(issues: string[]): void {
  const pay1430 = Date.parse('2026-06-20T14:30:00+08:00')
  const pay1429 = Date.parse('2026-06-20T14:29:59+08:00')
  const pay1800 = Date.parse('2026-06-20T18:00:00+08:00')
  const { startAt: xbStart, endAt: xbEnd } = buildScheduleBounds('2026-06-20', '14:30', '18:00')

  assert(isPayTimeInSchedule(pay1430, xbStart, xbEnd), '14:30 命中排班', issues)
  assert(!isPayTimeInSchedule(pay1429, xbStart, xbEnd), '14:29 不重复命中', issues)
  assert(!isPayTimeInSchedule(pay1800, xbStart, xbEnd), '18:00 左闭右开不命中', issues)
}

function runRefundAxisTests(issues: string[]): void {
  const pocketView = makeView({
    paymentBaseCent: 10000,
    productRefundAmountCent: 3000,
    statRangeRefundAmountCent: 0,
    orderStatusText: '已完成',
    afterSaleStatusText: '退款成功',
  })
  const boardView = makeView({
    paymentBaseCent: 10000,
    productRefundAmountCent: 0,
    statRangeRefundAmountCent: 3000,
    orderStatusText: '已完成',
    afterSaleStatusText: '退款成功',
  })
  const pocketLine = classifyAnchorPocketOrder({
    view: pocketView,
    shopName: 'XY祥钰珠宝',
    sessionName: '早场',
  })
  assert(
    (pocketLine?.refundFinishedAmountCent ?? 0) === 3000,
    '实际到账按订单累计退款扣减',
    issues,
  )
  assert(
    resolveViewRefundAmountCent(boardView) === 3000,
    '经营看板退款可来自 statRangeRefundAmountCent',
    issues,
  )
  assert(
    resolveViewRefundAmountCent(pocketView) >= 3000,
    '同一订单退款金额可被两种口径读取',
    issues,
  )
}

function runWorkbenchMultiShopTests(issues: string[]): void {
  const shared = 'PDATE001'
  const map = mergeWorkbenchRefundMaps(
    new Map([
      [
        `acc-a::${shared}`,
        {
          liveAccountId: 'acc-a',
          orderNo: shared,
          fetchStatus: 'success' as const,
          officialRefundAmountCent: 1111,
          successReturnCount: 1,
        },
      ],
      [
        `acc-b::${shared}`,
        {
          liveAccountId: 'acc-b',
          orderNo: shared,
          fetchStatus: 'success' as const,
          officialRefundAmountCent: 2222,
          successReturnCount: 1,
        },
      ],
    ]),
  )
  assert(
    lookupWorkbenchRefund(map, 'acc-a', shared)?.officialRefundAmountCent === 1111,
    '多店同号 A 不串',
    issues,
  )
  assert(
    lookupWorkbenchRefund(map, 'acc-b', shared)?.officialRefundAmountCent === 2222,
    '多店同号 B 不串',
    issues,
  )
}

async function runIntegrationTests(issues: string[]): Promise<void> {
  const today = formatDateKeyShanghai(new Date())
  const startDate = addDaysShanghai(today, -7)

  clearScheduleAttributionCache()

  try {
    const pocket1 = await buildAnchorPocketSummary({
      startDate,
      endDate: today,
      preset: 'custom',
    })
    clearScheduleAttributionCache()
    const pocket2 = await buildAnchorPocketSummary({
      startDate,
      endDate: today,
      preset: 'custom',
    })
    assert(pocket1.ok === true && pocket2.ok === true, '改排班缓存清空后可重复计算 pocket', issues)

    const payload = await buildAnchorAuditExportPayload({ startDate, endDate: today })
    const meta = await getAnchorAuditExportMeta({ startDate, endDate: today })
    const countHelper = await countAnchorAuditExportOrders({ startDate, endDate: today })

    assert(
      meta.orderCountInRange === payload.normalizedOrders.length,
      `meta 订单数 ${meta.orderCountInRange} = 导出 ${payload.normalizedOrders.length}`,
      issues,
    )
    assert(
      countHelper === payload.normalizedOrders.length,
      'countHelper 与导出一致',
      issues,
    )

    const exportTotal = payload.summaryByAnchor.reduce(
      (s, r) => s + Number((r as { actualPocketAmount: number }).actualPocketAmount ?? 0),
      0,
    )
    const pocketTotal = pocket2.anchors.reduce((s, r) => s + r.actualPocketAmount, 0)
    assert(
      Math.abs(exportTotal - pocketTotal) < 0.02,
      `导出汇总 ${exportTotal} ≈ pocket ${pocketTotal}`,
      issues,
    )

    console.log('\n[verify:custom-date-range] 对账摘要')
    console.log(`  范围: ${startDate} ~ ${today}`)
    console.log(`  导出订单数: ${payload.normalizedOrders.length}`)
    console.log(`  meta 订单数: ${meta.orderCountInRange}`)
    console.log(`  导出实际到账合计: ${exportTotal.toFixed(2)}`)
    console.log(`  pocket 实际到账合计: ${pocketTotal.toFixed(2)}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('ENOENT') || msg.includes('数据库') || msg.includes('no such table')) {
      console.log('[verify:custom-date-range] 跳过 DB 集成（本地空库）')
    } else {
      issues.push(`集成测试失败: ${msg}`)
    }
  }
}

async function run(): Promise<void> {
  const issues: string[] = []

  runDateBoundaryTests(issues)
  runThisWeekTests(issues)
  runScheduleBoundaryTests(issues)
  runRefundAxisTests(issues)
  runWorkbenchMultiShopTests(issues)
  await runIntegrationTests(issues)

  if (issues.length) {
    console.error('verify:custom-date-range FAILED')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('verify:custom-date-range OK')
}

void run()
