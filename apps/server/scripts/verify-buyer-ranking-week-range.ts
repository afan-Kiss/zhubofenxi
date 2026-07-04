/**
 * 买家排行周范围验收（Asia/Shanghai 周一到周日）
 * 用法: npm run verify:buyer-ranking-week-range
 */
import {
  lastWeekEndKeyShanghai,
  lastWeekStartKeyShanghai,
  resolveBuyerRankingDateRange,
} from '../src/utils/buyer-ranking-date-range'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'
import { buyerRankingRefundSortRate, type BuyerRankingItem } from '../src/services/buyer-ranking.service'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function shanghaiNoonUtc(year: number, month: number, day: number): Date {
  return new Date(
    Date.parse(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00+08:00`,
    ),
  )
}

function addDayKey(key: string, delta: number): string {
  const ms = Date.parse(`${key}T12:00:00+08:00`) + delta * 86_400_000
  return formatDateKeyShanghai(new Date(ms))
}

function main() {
  const issues: string[] = []

  const fri = shanghaiNoonUtc(2026, 7, 3)
  const thisWeekFri = resolveBuyerRankingDateRange('thisWeek', undefined, undefined, fri)
  assert(
    thisWeekFri.startDate === '2026-06-29' && thisWeekFri.endDate === '2026-07-03',
    `2026-07-03 本周应为 2026-06-29~2026-07-03，实际 ${thisWeekFri.startDate}~${thisWeekFri.endDate}`,
    issues,
  )

  const lastWeekFri = resolveBuyerRankingDateRange('lastWeek', undefined, undefined, fri)
  const expectedLastStart = lastWeekStartKeyShanghai(fri)
  const expectedLastEnd = lastWeekEndKeyShanghai(fri)
  assert(
    lastWeekFri.startDate === expectedLastStart && lastWeekFri.endDate === expectedLastEnd,
    `2026-07-03 上周应为 ${expectedLastStart}~${expectedLastEnd}（周一到周日），实际 ${lastWeekFri.startDate}~${lastWeekFri.endDate}`,
    issues,
  )
  assert(
    lastWeekFri.endDate === addDayKey(expectedLastStart, 6),
    `上周结束日应为上周一+6天（周日），实际 ${lastWeekFri.endDate}`,
    issues,
  )

  const mon = shanghaiNoonUtc(2026, 7, 6)
  const thisWeekMon = resolveBuyerRankingDateRange('thisWeek', undefined, undefined, mon)
  assert(
    thisWeekMon.startDate === '2026-07-06' && thisWeekMon.endDate === '2026-07-06',
    `2026-07-06 本周应为 2026-07-06~2026-07-06，实际 ${thisWeekMon.startDate}~${thisWeekMon.endDate}`,
    issues,
  )

  const lastWeekMon = resolveBuyerRankingDateRange('lastWeek', undefined, undefined, mon)
  assert(
    lastWeekMon.startDate === '2026-06-29' && lastWeekMon.endDate === '2026-07-05',
    `2026-07-06 上周应为 2026-06-29~2026-07-05，实际 ${lastWeekMon.startDate}~${lastWeekMon.endDate}`,
    issues,
  )

  const recent7 = resolveBuyerRankingDateRange('recent7', undefined, undefined, fri)
  assert(
    recent7.startDate === '2026-06-27' && recent7.endDate === '2026-07-03',
    `2026-07-03 recent7 应为 2026-06-27~2026-07-03，实际 ${recent7.startDate}~${recent7.endDate}`,
    issues,
  )
  const recent15 = resolveBuyerRankingDateRange('recent15', undefined, undefined, fri)
  assert(
    recent15.startDate === '2026-06-19' && recent15.endDate === '2026-07-03',
    `2026-07-03 recent15 应为 2026-06-19~2026-07-03，实际 ${recent15.startDate}~${recent15.endDate}`,
    issues,
  )
  const recent30 = resolveBuyerRankingDateRange('recent30', undefined, undefined, fri)
  assert(
    recent30.startDate === '2026-06-04' && recent30.endDate === '2026-07-03',
    `2026-07-03 recent30 应为 2026-06-04~2026-07-03，实际 ${recent30.startDate}~${recent30.endDate}`,
    issues,
  )

  const jul4 = shanghaiNoonUtc(2026, 7, 4)
  const thisMonthJul4 = resolveBuyerRankingDateRange('thisMonth', undefined, undefined, jul4)
  assert(
    thisMonthJul4.startDate === '2026-07-01' && thisMonthJul4.endDate === '2026-07-04',
    `2026-07-04 本月应为 2026-07-01~2026-07-04，实际 ${thisMonthJul4.startDate}~${thisMonthJul4.endDate}`,
    issues,
  )

  const jul31 = shanghaiNoonUtc(2026, 7, 31)
  const thisMonthJul31 = resolveBuyerRankingDateRange('thisMonth', undefined, undefined, jul31)
  assert(
    thisMonthJul31.startDate === '2026-07-01' && thisMonthJul31.endDate === '2026-07-31',
    `2026-07-31 本月应为 2026-07-01~2026-07-31，实际 ${thisMonthJul31.startDate}~${thisMonthJul31.endDate}`,
    issues,
  )

  const lastMonthJul4 = resolveBuyerRankingDateRange('lastMonth', undefined, undefined, jul4)
  assert(
    lastMonthJul4.startDate === '2026-06-01' && lastMonthJul4.endDate === '2026-06-30',
    `2026-07-04 上月应为完整自然月 2026-06-01~2026-06-30，实际 ${lastMonthJul4.startDate}~${lastMonthJul4.endDate}`,
    issues,
  )

  const refundSortBuyers: BuyerRankingItem[] = [
    {
      buyerKey: 'a',
      buyerId: 'a',
      nickname: 'A',
      buyerDisplayName: 'A',
      orderCount: 10,
      signedOrderCount: 0,
      unsignedOrderCount: 0,
      completedOrderCount: 0,
      returnRefundCount: 0,
      refundOnlyCount: 0,
      freightRefundCount: 0,
      afterSaleClosedNoRefundCount: 0,
      afterSaleCount: 0,
      gmv: 0,
      signedAmount: 0,
      productRefundAmount: 0,
      freightRefundAmount: 0,
      actualDealAmount: 0,
      earnedAmount: 0,
      qualityReturnCount: 0,
      refundCount: 2,
      lastOrderTime: '2026-07-01',
      buyerSummary: {
        orderCount: 10,
        paidOrderCount: 10,
        realDealOrderCount: 10,
        refundOrderCount: 2,
        qualityRefundOrderCount: 0,
        returnRefundOrderCount: 0,
        afterSaleOrderCount: 0,
        pendingAfterSaleOrderCount: 0,
        receivableAmountCent: 0,
        payAmountCent: 0,
        refundAmountCent: 0,
        freightRefundAmountCent: 0,
        netDealAmountCent: 0,
        realDealAmountCent: 0,
        displayEarnedAmountCent: 0,
      },
    },
    {
      buyerKey: 'b',
      buyerId: 'b',
      nickname: 'B',
      buyerDisplayName: 'B',
      orderCount: 5,
      signedOrderCount: 0,
      unsignedOrderCount: 0,
      completedOrderCount: 0,
      returnRefundCount: 0,
      refundOnlyCount: 0,
      freightRefundCount: 0,
      afterSaleClosedNoRefundCount: 0,
      afterSaleCount: 0,
      gmv: 0,
      signedAmount: 0,
      productRefundAmount: 0,
      freightRefundAmount: 0,
      actualDealAmount: 0,
      earnedAmount: 0,
      qualityReturnCount: 0,
      refundCount: 2,
      lastOrderTime: '2026-07-01',
      buyerSummary: {
        orderCount: 5,
        paidOrderCount: 5,
        realDealOrderCount: 5,
        refundOrderCount: 2,
        qualityRefundOrderCount: 0,
        returnRefundOrderCount: 0,
        afterSaleOrderCount: 0,
        pendingAfterSaleOrderCount: 0,
        receivableAmountCent: 0,
        payAmountCent: 0,
        refundAmountCent: 0,
        freightRefundAmountCent: 0,
        netDealAmountCent: 0,
        realDealAmountCent: 0,
        displayEarnedAmountCent: 0,
      },
    },
    {
      buyerKey: 'c',
      buyerId: 'c',
      nickname: 'C',
      buyerDisplayName: 'C',
      orderCount: 10,
      signedOrderCount: 0,
      unsignedOrderCount: 0,
      completedOrderCount: 0,
      returnRefundCount: 0,
      refundOnlyCount: 0,
      freightRefundCount: 0,
      afterSaleClosedNoRefundCount: 0,
      afterSaleCount: 0,
      gmv: 0,
      signedAmount: 0,
      productRefundAmount: 0,
      freightRefundAmount: 0,
      actualDealAmount: 0,
      earnedAmount: 0,
      qualityReturnCount: 0,
      refundCount: 0,
      lastOrderTime: '2026-07-01',
      buyerSummary: {
        orderCount: 10,
        paidOrderCount: 0,
        realDealOrderCount: 0,
        refundOrderCount: 1,
        qualityRefundOrderCount: 0,
        returnRefundOrderCount: 0,
        afterSaleOrderCount: 0,
        pendingAfterSaleOrderCount: 0,
        receivableAmountCent: 0,
        payAmountCent: 0,
        refundAmountCent: 0,
        freightRefundAmountCent: 0,
        netDealAmountCent: 0,
        realDealAmountCent: 0,
        displayEarnedAmountCent: 0,
      },
    },
  ]
  assert(buyerRankingRefundSortRate(refundSortBuyers[0]!) === 0.2, 'A 退款率应为 20%', issues)
  assert(buyerRankingRefundSortRate(refundSortBuyers[1]!) === 0.4, 'B 退款率应为 40%', issues)
  assert(buyerRankingRefundSortRate(refundSortBuyers[2]!) === 0, '无支付单时分母为 0 应返回 0 非 NaN', issues)
  const sorted = [...refundSortBuyers].sort(
    (x, y) => buyerRankingRefundSortRate(y) - buyerRankingRefundSortRate(x),
  )
  assert(sorted[0]?.buyerKey === 'b', '退款率排序 B(40%) 应高于 A(20%)', issues)
  assert(sorted[1]?.buyerKey === 'a', '退款率排序 A(20%) 应高于 C(0%)', issues)

  if (issues.length > 0) {
    console.error('[verify:buyer-ranking-week-range] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:buyer-ranking-week-range] PASS')
}

main()
