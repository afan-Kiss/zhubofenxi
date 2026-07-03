/**
 * 四店原始数据 vs 2026-07-01 日报对照
 * 用法: npx tsx apps/server/scripts/verify-four-shops-daily-report-0701.ts [dateKey]
 */
import { prisma } from '../src/lib/prisma'
import {
  GOOD_REVIEW_SHOPS,
  getGoodReviewShopName,
  type GoodReviewShopKey,
} from '../src/config/good-review-shops.constants'
import { buildDailyReport } from '../src/services/daily-report.service'
import { resolveDailyReportLiveSessionAssignments } from '../src/services/daily-report-live-sessions.service'
import {
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from '../src/services/board-scoped-views.service'
import {
  countDailyReportOrders,
  sumDailyReportShippedFromViews,
} from '../src/services/daily-report-order.util'
import { resolveDailyReportAnchorsForDate } from '../src/services/anchor-performance-attribution.service'
import { getAnchorConfigSync } from '../src/services/anchor.service'
import { centToYuan } from '../src/utils/money'
import { dedupeViewsByMetricOrderNo } from '../src/services/calc-refund-rate.service'

const dateKey = process.argv[2]?.trim() || '2026-07-01'

type ShopRow = {
  shopKey: GoodReviewShopKey
  shopName: string
  rawLiveRows: number
  rawOrderRows: number
  paidOrderCount: number
  paidGmvYuan: number
  liveSessions: Array<{
    liveId: string
    start: string
    end: string
    durationMinutes: number
    assignedAnchor: string | null
  }>
}

async function countRawOrders(liveAccountId: string): Promise<number> {
  const start = new Date(`${dateKey}T00:00:00+08:00`)
  const end = new Date(`${dateKey}T23:59:59.999+08:00`)
  return prisma.xhsRawOrder.count({
    where: {
      liveAccountId,
      orderTime: { gte: start, lte: end },
    },
  })
}

async function countRawLiveSessions(liveAccountId: string): Promise<number> {
  const start = new Date(`${dateKey}T00:00:00+08:00`)
  const end = new Date(`${dateKey}T23:59:59.999+08:00`)
  return prisma.xhsRawLiveSession.count({
    where: {
      liveAccountId,
      startTime: { gte: start, lte: end },
    },
  })
}

async function main(): Promise<void> {
  console.log(`[verify-four-shops-daily-report] date=${dateKey}`)

  const assignment = await resolveDailyReportLiveSessionAssignments(dateKey)
  const report = await buildDailyReport({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const config = getAnchorConfigSync()
  const reportAnchors = resolveDailyReportAnchorsForDate(config, dateKey)

  const shopRows: ShopRow[] = []
  for (const shop of GOOD_REVIEW_SHOPS) {
    const account = await prisma.platformCredential.findFirst({
      where: { platformName: shop.shopKey, enabled: true },
      select: { id: true },
    })
    const sessions = assignment.allSessions.filter((s) => s.sourceShopCode === shop.shopKey)
    const rawLiveRows = account ? await countRawLiveSessions(account.id) : 0
    const rawOrderRows = account ? await countRawOrders(account.id) : 0
    shopRows.push({
      shopKey: shop.shopKey,
      shopName: getGoodReviewShopName(shop.shopKey),
      rawLiveRows,
      rawOrderRows,
      paidOrderCount: 0,
      paidGmvYuan: 0,
      liveSessions: sessions.map((s) => {
        const assigned = [...assignment.byAnchor.entries()].find(([, list]) =>
          list.some((x) => x.liveId === s.liveId),
        )
        return {
          liveId: s.liveId,
          start: s.actualStartAt,
          end: s.actualEndAt,
          durationMinutes: s.durationMinutes,
          assignedAnchor: assigned?.[0] ?? null,
        }
      }),
    })
  }

  console.log('\n=== 四店原始直播场次 ===')
  for (const row of shopRows) {
    console.log(
      `\n[${row.shopName}] rawLive=${row.rawLiveRows} assigned=${row.liveSessions.length} rawOrders(payDay)=${row.rawOrderRows}`,
    )
    for (const s of row.liveSessions) {
      console.log(
        `  liveId=${s.liveId} ${s.start} ~ ${s.end} (${s.durationMinutes}min) -> ${s.assignedAnchor ?? '未归属'}`,
      )
    }
    if (row.rawLiveRows > 0 && row.liveSessions.length === 0) {
      console.log('  WARN: 库里有 raw 直播但日报未读到场次')
    }
  }

  console.log('\n=== 日报汇总 ===')
  console.log(
    JSON.stringify(
      {
        totalShippedAmountYuan: report.summary.totalShippedAmountYuan,
        totalSoldOrderCount: report.summary.totalSoldOrderCount,
        totalInvalidOrderCount: report.summary.totalInvalidOrderCount,
        unassignedLiveSessionCount: report.summary.unassignedLiveSessionCount,
      },
      null,
      2,
    ),
  )

  console.log('\n=== 日报主播行 vs 业绩视图重算 ===')
  const issues: string[] = []
  let sumShipped = 0
  let sumSold = 0
  for (const anchor of report.anchors) {
    sumShipped += anchor.shippedAmountYuan
    sumSold += anchor.soldOrderCount
    const def = reportAnchors.find((a) => a.anchorName === anchor.anchorName)
    const perf = await getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      def?.anchorId ?? '',
      anchor.anchorName,
    )
    const shipped = sumDailyReportShippedFromViews(perf)
    const counts = countDailyReportOrders(perf)
    const paidCount = dedupeViewsByMetricOrderNo(perf).filter((v) => v.includedInGmv).length
    const paidGmv = Math.round(
      centToYuan(
        dedupeViewsByMetricOrderNo(perf).reduce((s, v) => s + (v.paymentBaseCent ?? 0), 0),
      ),
    )
    const shopSessions = assignment.byAnchor.get(anchor.anchorName) ?? []
    const shopCodes = [...new Set(shopSessions.map((s) => s.sourceShopCode))]
    console.log(
      JSON.stringify(
        {
          anchor: anchor.anchorName,
          reportShop: anchor.shopName,
          reportSchedule: anchor.scheduleTimeRange,
          reportLive: anchor.liveTimeRange,
          reportShipped: anchor.shippedAmountYuan,
          reportSold: anchor.soldOrderCount,
          reportInvalid: anchor.invalidOrderCount,
          recomputedShipped: shipped.shippedAmountYuan,
          recomputedSold: shipped.soldOrderCount,
          recomputedInvalid: counts.invalidOrderCount,
          cardPaidCount: paidCount,
          cardGmv: paidGmv,
          liveShopCodes: shopCodes,
          liveSessionCount: shopSessions.length,
        },
        null,
        2,
      ),
    )
    if (anchor.shippedAmountYuan !== shipped.shippedAmountYuan) {
      issues.push(`${anchor.anchorName} shipped 日报${anchor.shippedAmountYuan} != 重算${shipped.shippedAmountYuan}`)
    }
    if (anchor.soldOrderCount !== shipped.soldOrderCount) {
      issues.push(`${anchor.anchorName} sold 日报${anchor.soldOrderCount} != 重算${shipped.soldOrderCount}`)
    }
    if (anchor.shopName && shopSessions.length > 0) {
      const sessionShop = getGoodReviewShopName(shopSessions[0]!.sourceShopCode)
      if (!anchor.shopName.includes(sessionShop.replace('XY', '').slice(0, 2)) && anchor.shopName !== sessionShop) {
        // loose check - shop name in report should match assigned session shop
        const match = shopSessions.some((s) => getGoodReviewShopName(s.sourceShopCode) === anchor.shopName)
        if (!match) {
          issues.push(`${anchor.anchorName} 日报店铺「${anchor.shopName}」与直播场次店铺不一致`)
        }
      }
    }
  }

  if (sumShipped !== report.summary.totalShippedAmountYuan) {
    issues.push(
      `totalShipped 合计${sumShipped} != summary ${report.summary.totalShippedAmountYuan}`,
    )
  }
  if (sumSold !== report.summary.totalSoldOrderCount) {
    issues.push(`totalSold 合计${sumSold} != summary ${report.summary.totalSoldOrderCount}`)
  }
  if (assignment.unassignedSessions.length > 0) {
    issues.push(`未匹配直播 ${assignment.unassignedSessions.length} 场`)
  }

  console.log('\n=== 四店订单池 vs 日报真实发货（按直播号来源粗分） ===')
  for (const shop of GOOD_REVIEW_SHOPS) {
    const account = await prisma.platformCredential.findFirst({
      where: { platformName: shop.shopKey, enabled: true },
      select: { id: true, displayName: true },
    })
    if (!account) {
      console.log(`${shop.shopKey}: 无官方直播号`)
      continue
    }
    const shopViews = scoped.views.filter((v) => v.liveAccountId === account.id)
    const shipped = sumDailyReportShippedFromViews(shopViews)
    console.log(
      `${getGoodReviewShopName(shop.shopKey)}: 当日视图${shopViews.length}单, 真实发货${shipped.shippedAmountYuan}元/${shipped.soldOrderCount}单`,
    )
  }

  await prisma.$disconnect()

  if (issues.length > 0) {
    console.error('\n[verify-four-shops-daily-report] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exitCode = 1
    return
  }
  console.log('\n[verify-four-shops-daily-report] PASS')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
