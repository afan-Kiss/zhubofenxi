/**
 * 运营日报字段只读核对（单日）
 * 用法: tsx apps/server/scripts/verify-daily-report-fields.ts --date=2026-07-03
 */
import path from 'node:path'
import { config } from 'dotenv'
import { buildDailyOperationsReport } from '../src/services/daily-operations-report.service'
import { sumNewFollowersByLiveAccountForRange, aggregateAnchorLiveSessionTraffic } from '../src/services/anchor-live-sessions.service'
import {
  loadAndAssignDailyReportLiveSessions,
  sumUniqueDailyReportLiveDurationMinutes,
} from '../src/services/daily-report-live-sessions.service'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { getBoardScopedViewsForRange } from '../src/services/board-scoped-views.service'
import { sumValidRevenueFromViews } from '../src/services/valid-revenue-order.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { addDaysShanghai, formatDateKeyShanghai } from '../src/utils/business-timezone'
import { prisma } from '../src/lib/prisma'

config({ path: path.resolve(__dirname, '../.env') })

function parseDate(): string {
  const arg = process.argv.find((a) => a.startsWith('--date='))
  if (arg) {
    const d = arg.slice('--date='.length).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  }
  return addDaysShanghai(formatDateKeyShanghai(new Date()), -1)
}

function num(v: unknown): number {
  return Number(v ?? 0)
}

function near(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function warn(msg: string): void {
  console.log(`  ⚠ ${msg}`)
}

function fail(msg: string): void {
  console.log(`  ✗ FAIL: ${msg}`)
}

async function main(): Promise<void> {
  const dateKey = parseDate()
  console.log(`[verify-daily-report-fields] 日期 ${dateKey}（只读）\n`)

  const report = await buildDailyOperationsReport({
    startDate: dateKey,
    endDate: dateKey,
    role: 'super_admin',
    username: 'verify-script',
  })
  const s = report.summary

  console.log('=== 日报展示值 ===')
  console.log(`有效成交: ¥${s.validAmountYuan} (${s.soldOrderCount} 单)`)
  console.log(`无效/刷单: ${s.invalidOrderCount} 单`)
  console.log(`退货: ${s.returnOrderCount} 单 (${((s.returnOrderRate ?? 0) * 100).toFixed(2)}%)`)
  console.log(`场观: ${s.viewSessionCount ?? '—'}`)
  console.log(`进房: ${s.joinUserCount ?? '—'}`)
  console.log(`成交人数: ${s.dealUserCount ?? '—'}`)
  console.log(`平均在线: ${s.avgOnlineUserCount ?? '—'}`)
  console.log(`平均停留(秒): ${s.avgViewDurationSeconds ?? '—'}`)
  console.log(`新增粉丝合计: ${s.totalNewFollowerCount}`)
  console.log(`粉丝率: ${s.newFollowerRate != null ? (s.newFollowerRate * 100).toFixed(2) + '%' : '—'}`)
  console.log(`直播时长(分): ${s.totalLiveDurationMinutes}`)
  console.log(`每小时成交: ¥${s.hourlyAmountYuan ?? '—'}`)
  console.log(`客单价: ¥${s.avgOrderAmountYuan ?? '—'}`)
  if (s.liveRoomNewFollowers.length > 0) {
    console.log('各直播号新增粉丝:')
    for (const r of s.liveRoomNewFollowers) {
      console.log(`  ${r.liveAccountName}: ${r.newFollowerCount}`)
    }
  }

  const failures: string[] = []

  console.log('\n=== 新增粉丝交叉核对 ===')
  const followersByAccount = await sumNewFollowersByLiveAccountForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const recalcFollowers = followersByAccount.reduce((sum, r) => sum + r.newFollowerCount, 0)
  console.log(`  日报 totalNewFollowerCount: ${s.totalNewFollowerCount}`)
  console.log(`  原始场次重算合计: ${recalcFollowers}`)
  for (const r of followersByAccount) {
    const reportRow = s.liveRoomNewFollowers.find((x) => x.liveAccountName === r.liveAccountName)
    const reportVal = reportRow?.newFollowerCount ?? 0
    if (reportVal !== r.newFollowerCount) {
      fail(`${r.liveAccountName} 新增粉丝不一致：日报=${reportVal} 原始=${r.newFollowerCount}`)
      failures.push('follower-by-account')
    } else {
      ok(`${r.liveAccountName}: ${r.newFollowerCount}`)
    }
  }
  if (recalcFollowers !== s.totalNewFollowerCount) {
    fail(`新增粉丝合计不一致：日报=${s.totalNewFollowerCount} 重算=${recalcFollowers}`)
    failures.push('follower-total')
  } else {
    ok(`新增粉丝合计一致 (${recalcFollowers})`)
  }

  console.log('\n=== 流量指标交叉核对（排班归属场次） ===')
  const scheduleTable = await getEffectiveScheduleTableForDate(dateKey)
  const liveAssignment = await loadAndAssignDailyReportLiveSessions({
    reportDate: dateKey,
    startDate: dateKey,
    endDate: dateKey,
    scheduleRows: scheduleTable.rows,
  })
  const trafficRecalc = aggregateAnchorLiveSessionTraffic(liveAssignment.allSessions)
  const durationRecalc = sumUniqueDailyReportLiveDurationMinutes(liveAssignment.allSessions)

  const trafficPairs: Array<[string, number | null, number | null]> = [
    ['viewSessionCount', s.viewSessionCount, trafficRecalc.viewSessionCount],
    ['joinUserCount', s.joinUserCount, trafficRecalc.joinUserCount],
    ['dealUserCount', s.dealUserCount, trafficRecalc.dealUserCount],
    ['newFollowerCount(排班场次)', s.totalNewFollowerCount, trafficRecalc.newFollowerCount],
  ]
  for (const [label, reportVal, recalcVal] of trafficPairs) {
    if (reportVal == null && recalcVal == null) {
      warn(`${label}: 双方均为空`)
      continue
    }
    if ((reportVal ?? 0) === (recalcVal ?? 0)) {
      ok(`${label}: ${reportVal ?? recalcVal ?? 0}`)
      continue
    }
    if (label.startsWith('newFollowerCount')) {
      // 日报 summary 新增粉丝来自全量原始场次；排班场次汇总可能不含未匹配场次
      warn(`${label}: 日报=${reportVal} 排班场次=${recalcVal}（若差值为未匹配排班的场次属正常）`)
    } else {
      fail(`${label}: 日报=${reportVal ?? '—'} 重算=${recalcVal ?? '—'}`)
      failures.push(label)
    }
  }

  if (s.newFollowerRate != null && s.viewSessionCount != null && s.viewSessionCount > 0) {
    const expectedRate = s.totalNewFollowerCount / s.viewSessionCount
    if (near(s.newFollowerRate, expectedRate, 0.0001)) {
      ok(`粉丝率 = 新增粉丝/场观 (${(s.newFollowerRate * 100).toFixed(2)}%)`)
    } else {
      fail(`粉丝率不一致：日报=${s.newFollowerRate} 期望=${expectedRate}`)
      failures.push('follower-rate')
    }
  }

  if (durationRecalc === s.totalLiveDurationMinutes) {
    ok(`直播时长一致: ${durationRecalc} 分钟`)
  } else {
    fail(`直播时长不一致：日报=${s.totalLiveDurationMinutes} 重算=${durationRecalc}`)
    failures.push('duration')
  }

  console.log('\n=== 有效成交交叉核对 ===')
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const coreViews = filterViewsForCoreMetrics(scoped.views)
  const dayViews = coreViews.filter((v) => {
    const t = v.payTime ?? v.orderTime
    if (!t) return false
    const key = formatDateKeyShanghai(new Date(t))
    return key === dateKey
  })
  const boardMetrics = calculateBusinessMetrics(dayViews)
  const validFromViews = sumValidRevenueFromViews(dayViews)
  const anchorValidSum = report.anchors.reduce((sum, r) => sum + r.validAmountYuan, 0)
  const anchorOrderSum = report.anchors.reduce((sum, r) => sum + r.soldOrderCount, 0)

  console.log(`  日报 summary 有效成交: ¥${s.validAmountYuan}`)
  console.log(`  主播行合计: ¥${anchorValidSum.toFixed(2)}`)
  console.log(`  当日订单 validRevenue: ¥${validFromViews.validAmountYuan.toFixed(2)}`)
  console.log(`  经营指标 validSalesAmount: ¥${boardMetrics.validSalesAmount}`)

  if (near(anchorValidSum, s.validAmountYuan)) {
    ok('summary 有效成交 = 主播行合计')
  } else if (s.validAmountYuan >= anchorValidSum) {
    warn(
      `summary 比主播合计多 ¥${(s.validAmountYuan - anchorValidSum).toFixed(2)}（可能含未归属订单）`,
    )
  } else {
    fail(`summary 有效成交小于主播合计`)
    failures.push('valid-amount')
  }

  if (near(validFromViews.validAmountYuan, s.validAmountYuan, 1)) {
    ok('summary 有效成交 ≈ 当日订单 validRevenue')
  } else {
    warn(
      `当日 validRevenue ¥${validFromViews.validAmountYuan.toFixed(2)} vs 日报 ¥${s.validAmountYuan}（排班/归属口径可能不同）`,
    )
  }

  console.log('\n=== 主播行新增粉丝明细 ===')
  for (const a of report.anchors) {
    if (
      a.validAmountYuan > 0 ||
      a.soldOrderCount > 0 ||
      (a.newFollowerCount ?? 0) > 0 ||
      (a.viewSessionCount ?? 0) > 0
    ) {
      console.log(
        `  ${a.anchorName}: 有效¥${a.validAmountYuan} ${a.soldOrderCount}单 | 场观${a.viewSessionCount ?? '—'} 进房${a.joinUserCount ?? '—'} 新增粉丝${a.newFollowerCount ?? '—'} 时长${a.liveDurationMinutes}分`,
      )
    }
  }

  console.log('\n=== 原始直播场次粉丝字段抽样 ===')
  let sessionCount = 0
  for (const sess of liveAssignment.allSessions.slice(0, 12)) {
    if (sess.newFollowerCount != null || sess.viewSessionCount != null) {
      sessionCount++
      console.log(
        `  ${sess.liveAccountName ?? sess.sourceShopName ?? '—'} | liveId=${sess.liveId?.slice(0, 24) ?? '—'} | 场观${sess.viewSessionCount ?? '—'} 进房${sess.joinUserCount ?? '—'} 粉丝${sess.newFollowerCount ?? '—'} | ${sess.startTime}~${sess.endTime}`,
      )
    }
  }
  if (sessionCount === 0) {
    warn('排班归属场次无流量/粉丝原始字段（可能千帆未返回或场次未同步）')
  }

  console.log('\n=== 汇总 ===')
  if (failures.length === 0) {
    console.log('verify-daily-report-fields OK')
  } else {
    console.log(`verify-daily-report-fields FAIL (${failures.length} 项)`)
    process.exit(1)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
