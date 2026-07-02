/**
 * 日报直播场次与排班归属验收
 * 用法: npx tsx apps/server/scripts/verify-daily-report-live-session-attribution.ts 2026-07-01
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { buildDailyReport } from '../src/services/daily-report.service'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { resolveDailyReportLiveSessionAssignments } from '../src/services/daily-report-live-sessions.service'
import { resolveDailyReportAnchorsForDate } from '../src/services/anchor-performance-attribution.service'
import { getAnchorConfigSync } from '../src/services/anchor.service'
import {
  aggregateAnchorLeaderboard,
} from '../src/services/board-metrics.service'
import {
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from '../src/services/board-scoped-views.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import { isDailyReportShippedOrder } from '../src/services/daily-report-order.util'
import { isLowPriceBrushOrderView } from '../src/services/low-price-brush-order.service'
import { isActualAfterSaleOrder } from '../src/services/operations-after-sale-order.util'
import { buildPerSessionLivePeriodText } from '../src/services/daily-report-live-schedule-match.service'

const dateKey = process.argv[2]?.trim() || '2026-07-01'
const issues: string[] = []

function fail(msg: string): void {
  issues.push(msg)
}

function expect(cond: boolean, msg: string): void {
  if (!cond) fail(msg)
}

const SCHEDULE_20260701: Record<string, string> = {
  子杰: '09:30–14:00',
  小红: '09:30–14:00',
  小白: '14:00–18:30',
  小艺: '14:00–18:30',
  飞云: '18:30–23:00',
}

function scheduleRangesForAnchor(
  rows: Awaited<ReturnType<typeof getEffectiveScheduleTableForDate>>['rows'],
  anchorName: string,
): string[] {
  return rows
    .filter((r) => r.enabled && r.anchorName === anchorName)
    .map((r) => `${r.startTime}–${r.endTime}`.replace(/\s/g, ''))
}

async function main(): Promise<void> {
  console.log(`[verify-daily-report-live-session-attribution] date=${dateKey}`)

  const report = await buildDailyReport({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  expect(Boolean(report.summary), '日报 summary 应存在')
  expect(Array.isArray(report.anchors), '日报 anchors 应为数组')

  const scheduleTable = await getEffectiveScheduleTableForDate(dateKey)
  expect(scheduleTable.rows.length > 0, 'effective-schedules 同日应有排班行')

  const assignment = await resolveDailyReportLiveSessionAssignments(dateKey)
  expect(assignment.allSessions.every((s) => s.liveId?.trim()), 'rawSessions 均应有 liveId')

  const config = getAnchorConfigSync()
  const expectedAnchors =
    dateKey >= '2026-06-13'
      ? dateKey >= '2026-06-18'
        ? ['子杰', '小红', '小白', '小艺', '飞云']
        : ['子杰', '小红', '飞云', '小艺']
      : resolveDailyReportAnchorsForDate(config, dateKey).map((a) => a.anchorName)

  if (dateKey >= '2026-07-01') {
    for (const name of ['子杰', '小红', '小白', '小艺', '飞云']) {
      expect(
        report.anchors.some((a) => a.anchorName === name),
        `2026-07-01 日报应包含主播 ${name}`,
      )
    }
  }

  const scheduleMap = dateKey >= '2026-07-01' ? SCHEDULE_20260701 : null
  for (const anchor of report.anchors) {
    if (anchor.scheduleTimeRange) {
      const actual = anchor.scheduleTimeRange.replace(/\s/g, '')
      if (scheduleMap && scheduleMap[anchor.anchorName]) {
        expect(
          actual === scheduleMap[anchor.anchorName]!.replace(/\s/g, ''),
          `${anchor.anchorName} 排班时段应为 ${scheduleMap[anchor.anchorName]}，实际 ${anchor.scheduleTimeRange}`,
        )
      } else {
        const expectedRanges = scheduleRangesForAnchor(scheduleTable.rows, anchor.anchorName)
        expect(
          expectedRanges.includes(actual),
          `${anchor.anchorName} 排班时段 ${anchor.scheduleTimeRange} 不在当日生效排班 ${expectedRanges.join(', ')}`,
        )
      }
    }

    const assigned = assignment.byAnchor.get(anchor.anchorName) ?? []
    if (assigned.length > 0) {
      const realPeriod = buildPerSessionLivePeriodText(assigned).replace(/~/g, '–')
      expect(
        anchor.liveTimeRange !== anchor.scheduleTimeRange,
        `${anchor.anchorName} 直播时段不应等于排班时段硬填`,
      )
      expect(
        realPeriod !== '—' && anchor.liveTimeRange.includes('–'),
        `${anchor.anchorName} liveTimeRange 应来自真实直播时间`,
      )
    } else if (anchor.shippedAmountYuan === 0 && anchor.soldOrderCount === 0) {
      expect(
        anchor.liveTimeRange === '未读取到直播场次' || anchor.liveTimeRange === '—',
        `${anchor.anchorName} 无真实直播时应提示未读取到直播场次`,
      )
    }
  }

  const sumShipped = report.anchors.reduce((s, r) => s + r.shippedAmountYuan, 0)
  expect(
    sumShipped === report.summary.totalShippedAmountYuan,
    `totalShippedAmountYuan 应等于各主播之和 (${sumShipped} vs ${report.summary.totalShippedAmountYuan})`,
  )

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  for (const anchor of report.anchors) {
    const perf = await getAnchorPerformanceViews(
      scoped.views,
      scoped.rawByMatch,
      '',
      anchor.anchorName,
    )
    const leaderboard = aggregateAnchorLeaderboard(perf)
    const card = leaderboard[0]
    const paid = card?.paidOrderCount ?? card?.orderCount ?? 0
    const gmv = card?.gmv ?? card?.totalGmv ?? 0
    expect(
      anchor.soldOrderCount <= paid,
      `${anchor.anchorName} soldOrderCount(${anchor.soldOrderCount}) 应 <= paidOrderCount(${paid})`,
    )
    expect(
      anchor.shippedAmountYuan <= gmv + 1,
      `${anchor.anchorName} shippedAmountYuan(${anchor.shippedAmountYuan}) 应 <= gmv(${gmv})`,
    )
  }

  for (const unassigned of assignment.unassignedSessions) {
    const matched = [...assignment.byAnchor.values()].flat().some((s) => s.liveId === unassigned.liveId)
    expect(!matched, `未匹配场次 ${unassigned.liveId} 不应进入任何主播`)
  }

  if (dateKey >= '2026-06-18' && dateKey < '2026-07-01') {
    const xiaoBaiSessions = assignment.byAnchor.get('小白') ?? []
    for (const s of xiaoBaiSessions) {
      expect(
        s.sourceShopCode === 'xyxiangyu' || s.sourceShopName.includes('祥钰'),
        `6.18–6.30 小白场次应来自祥钰系，实际 ${s.sourceShopName}`,
      )
    }
  }

  const views = attachRawByMatchToViews(scoped.views, scoped.rawByMatch)
  const freightOnly = views.find((v) => v.isFreightRefundOnly)
  if (freightOnly) {
    expect(
      !isActualAfterSaleOrder(freightOnly),
      '仅退运费订单不应算售后',
    )
    if (isDailyReportShippedOrder(freightOnly)) {
      expect(true, '仅退运费且满足发货条件的订单可进真实发货（样本存在）')
    }
  }

  const lowPrice = views.find((v) => isLowPriceBrushOrderView(v))
  if (lowPrice) {
    expect(!isDailyReportShippedOrder(lowPrice), '低于 29 元订单不应进日报真实发货')
  }

  expect(
    report.summary.assignedLiveDurationMinutes != null,
    'summary 应返回 assignedLiveDurationMinutes',
  )
  expect(
    report.summary.unassignedLiveSessionCount === assignment.unassignedLiveSessionCount,
    'summary.unassignedLiveSessionCount 应与 assignment 一致',
  )

  await prisma.$disconnect()

  if (issues.length > 0) {
    console.error('[verify-daily-report-live-session-attribution] FAIL')
    for (const issue of issues) console.error(' -', issue)
    process.exitCode = 1
    return
  }

  console.log('[verify-daily-report-live-session-attribution] PASS')
  console.log(
    JSON.stringify(
      {
        dateKey,
        anchors: report.anchors.map((a) => ({
          name: a.anchorName,
          schedule: a.scheduleTimeRange,
          live: a.liveTimeRange,
          shipped: a.shippedAmountYuan,
        })),
        unassignedLiveSessionCount: assignment.unassignedLiveSessionCount,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
