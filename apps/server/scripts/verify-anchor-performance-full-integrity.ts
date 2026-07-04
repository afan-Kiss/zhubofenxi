/**
 * 主播业绩全链路数据严谨性 + BI 下钻验收（只读）
 *
 * DATE=2026-07-03 npm run verify:anchor-performance-full-integrity
 * HAR_DIR=./debug/har DATE=2026-07-03 npm run verify:anchor-performance-full-integrity
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { aggregateAnchorLeaderboard } from '../src/services/board-metrics.service'
import {
  getBoardScopedViewsForRange,
  getAnchorPerformanceViews,
} from '../src/services/board-scoped-views.service'
import { buildAnchorDrill, buildAnchorQualityRefundDrill } from '../src/services/board-drill.service'
import { buildDailyOperationsReport } from '../src/services/daily-operations-report.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { explainValidRevenueOrder, isValidRevenueOrder } from '../src/services/valid-revenue-order.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import {
  loadAndAssignDailyReportLiveSessions,
  type DailyReportLiveSession,
} from '../src/services/daily-report-live-sessions.service'
import { parseDailyReportLiveSessionBounds } from '../src/services/anchor-live-session-order-attribution.service'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { orderLiveRoomMatchesSchedule } from '../src/utils/shop-name-normalize.util'
import { formatDateTimeShanghai } from '../src/utils/business-timezone'
import {
  decodeHarContentText,
  loadHarBundle,
  resolveHarDir,
  shopFromHarFilename,
} from './lib/har-platform-bundle'
import type { AnalyzedOrderView } from '../src/types/analysis'
import type { AnchorTrend } from '../src/services/anchor-card-trend.service'

config({ path: path.resolve(__dirname, '../.env') })

const DATE_ENV = process.env.DATE?.trim() || '2026-07-03'
const HAR_DIR_ENV = process.env.HAR_DIR?.trim()
const POST_STREAM_GRACE_MS = 30 * 60 * 1000

const FIXED_20260703_TOTAL = {
  totalGmv: 13180.9,
  orderCount: 9,
  validSalesAmount: 2017,
  validOrderCount: 1,
  postStreamUnassigned: 0,
} as const

const FIXED_20260703_ANCHORS: Record<
  string,
  { gmv: number; valid: number; orderCount: number; allDrawer?: number; signedDrawer?: number }
> = {
  子杰: { gmv: 7130.9, valid: 2017, orderCount: 5, allDrawer: 5, signedDrawer: 1 },
  飞云: { gmv: 5834, valid: 0, orderCount: 3, allDrawer: 3 },
  小艺: { gmv: 216, valid: 0, orderCount: 1, allDrawer: 1 },
  小红: { gmv: 0, valid: 0, orderCount: 0 },
  小白: { gmv: 0, valid: 0, orderCount: 0 },
}

const FORBIDDEN_UI = ['支付金额减退款', '成交减退款', '大额售后', '无大额售后', '实时接口数据']

const failures: string[] = []
const warnings: string[] = []

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function fail(msg: string): void {
  failures.push(msg)
  console.log(`✗ FAIL: ${msg}`)
}

function warn(msg: string): void {
  warnings.push(msg)
  console.log(`⚠ ${msg}`)
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

function num(v: unknown): number {
  return Number(v ?? 0)
}

function diffYuan(a: number, b: number): number {
  return Math.round((a - b) * 100) / 100
}

function amountClose(a: number, b: number, tol = 1): boolean {
  return Math.abs(diffYuan(a, b)) <= tol
}

function countEq(a: unknown, b: unknown): boolean {
  return Math.round(num(a)) === Math.round(num(b))
}

function rateClose(a: unknown, b: unknown): boolean {
  const na = a == null || a === '—' ? null : Number(a)
  const nb = b == null || b === '—' ? null : Number(b)
  if (na == null && nb == null) return true
  if (na == null || nb == null) return false
  return Math.abs(na - nb) < 1e-9
}

function rowMetric(row: Record<string, unknown>) {
  return {
    anchorName: String(row.anchorName ?? ''),
    gmv: num(row.totalGmv ?? row.gmv),
    valid: num(row.validSalesAmount ?? row.effectiveGmv),
    paidCount: num(row.orderCount ?? row.paidOrderCount),
    refundCount: num(row.returnCount ?? row.refundOrderCount),
    refundAmount: num(row.returnAmount ?? row.refundAmount),
    refundRate: row.returnRate ?? row.refundRate,
    qualityCount: num(row.qualityReturnCount),
    signedAmount: num(row.actualSignedAmount),
    signedCount: num(row.signedOrderCount ?? row.actualSignedCount),
    signRate: row.signRate,
    liveTimeRange: String(row.liveTimeRange ?? '—'),
    livePeriodText: String(row.livePeriodText ?? '—'),
    scheduleTimeRange: String(row.scheduleTimeRange ?? row.scheduledPeriodText ?? '—'),
  }
}

function findLeaderboardRow(
  rows: Array<Record<string, unknown>>,
  name: string,
): Record<string, unknown> | undefined {
  return rows.find((r) => String(r.anchorName ?? '') === name)
}

async function detectPostStreamUnassigned(views: AnalyzedOrderView[], dateKey: string): Promise<number> {
  const scheduleTable = await getEffectiveScheduleTableForDate(dateKey)
  const assignment = await loadAndAssignDailyReportLiveSessions({
    reportDate: dateKey,
    startDate: dateKey,
    endDate: dateKey,
    scheduleRows: scheduleTable.rows,
  })
  const allSessions: Array<DailyReportLiveSession & { anchorName: string }> = []
  for (const [anchorName, sessions] of assignment.byAnchor.entries()) {
    for (const s of sessions) allSessions.push(Object.assign({}, s, { anchorName }))
  }
  let count = 0
  for (const v of dedupeViewsByMetricOrderNo(views).filter((x) => x.attributionType === 'unassigned')) {
    const payMs = parseViewPayTimeMs(v)
    if (payMs == null) continue
    const liveAccountName = (v.liveAccountName ?? '').trim()
    if (!liveAccountName) continue
    const matching = allSessions.filter((s) =>
      orderLiveRoomMatchesSchedule(liveAccountName, s.sourceShopName, s.liveAccountName),
    )
    for (const s of matching) {
      const bounds = parseDailyReportLiveSessionBounds(s)
      if (!bounds) continue
      if (payMs >= bounds.startMs && payMs <= bounds.endMs) continue
      if (payMs < bounds.endMs) continue
      if (payMs - bounds.endMs > POST_STREAM_GRACE_MS) continue
      const nextStarted = matching.some((other) => {
        const ob = parseDailyReportLiveSessionBounds(other)
        return ob && ob.startMs > bounds.endMs && ob.startMs <= payMs
      })
      if (nextStarted) continue
      count += 1
      break
    }
  }
  return count
}

function checkUiCopy(): void {
  section('前端 UI/文案静态检查')
  const files = [
    path.resolve(__dirname, '../../web/src/pages/board/AnchorPerformanceTab.tsx'),
    path.resolve(__dirname, '../../web/src/components/board/AnchorOrderDrawer.tsx'),
    path.resolve(__dirname, '../../web/src/components/board/AnchorLeaderboardPanel.tsx'),
    path.resolve(__dirname, '../../web/src/components/board/AnchorTrendChart.tsx'),
  ]
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      warn(`找不到 ${path.basename(filePath)}`)
      continue
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    for (const phrase of FORBIDDEN_UI) {
      if (content.includes(phrase)) fail(`${path.basename(filePath)} 含禁用文案「${phrase}」`)
    }
  }
  ok('主播业绩相关页面未发现禁用文案')
}

function loadExtendedHarOrders(harDir: string): Array<{
  packageId: string
  paidAt: string
  orderedAt: string
  actualPaid: number
  sourceShop: string
  afterSaleStatusDesc: string
}> {
  if (!fs.existsSync(harDir)) return []
  const rows: Array<{
    packageId: string
    paidAt: string
    orderedAt: string
    actualPaid: number
    sourceShop: string
    afterSaleStatusDesc: string
  }> = []
  for (const f of fs.readdirSync(harDir).filter((x) => x.endsWith('.har') && x.includes('订单'))) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(harDir, f), 'utf-8')) as {
        log?: { entries?: Array<{ request?: { url?: string }; response?: { content?: { text?: string; encoding?: string } } }> }
      }
      const shop = shopFromHarFilename(f)
      for (const entry of parsed.log?.entries ?? []) {
        if (!(entry.request?.url ?? '').includes('/api/edith/fulfillment/order/page')) continue
        const text = decodeHarContentText(entry.response?.content ?? {})
        if (!text) continue
        let body: Record<string, unknown>
        try {
          body = JSON.parse(text) as Record<string, unknown>
        } catch {
          continue
        }
        const data = (body.data ?? body) as Record<string, unknown>
        const packages = (data.packages ?? data.list ?? data.records ?? []) as Record<string, unknown>[]
        for (const pkg of packages) {
          const pick = (keys: string[]) => {
            for (const k of keys) {
              const raw = pkg[k]
              const v = raw && typeof raw === 'object' && 'value' in (raw as object) ? (raw as { value: unknown }).value : raw
              if (v != null && String(v).trim()) return String(v).trim()
            }
            return ''
          }
          rows.push({
            packageId: pick(['packageId', 'package_id']),
            paidAt: pick(['paidAt', 'paid_at', 'payTime']),
            orderedAt: pick(['orderedAt', 'ordered_at', 'orderTime']),
            actualPaid: Number(pick(['actualPaid', 'actual_paid']) || 0),
            afterSaleStatusDesc: pick(['afterSaleStatusDesc', 'after_sale_status_desc']),
            sourceShop: shop,
          })
        }
      }
    } catch (err) {
      warn(`HAR 订单 ${f}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return rows
}

async function auditDate(dateKey: string): Promise<void> {
  section(`基础数据 ${dateKey}`)
  const orderTotal = await prisma.xhsRawOrder.count()
  const liveTotal = await prisma.xhsRawLiveSession.count()
  const credTotal = await prisma.platformCredential.count()
  const userTotal = await prisma.user.count()
  console.log(`XhsRawOrder: ${orderTotal}`)
  console.log(`XhsRawLiveSession: ${liveTotal}`)
  console.log(`PlatformCredential: ${credTotal}`)
  console.log(`User: ${userTotal}`)

  await bootstrapQualityBadCaseCache()
  await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })

  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
    role: 'super_admin',
    username: 'verify-script',
  })
  const performanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const manualLeaderboard = aggregateAnchorLeaderboard(performanceViews)
  const paidOnDay = dedupeViewsByMetricOrderNo(performanceViews).filter((v) => {
    if (!v.includedInGmv) return false
    const payMs = parseViewPayTimeMs(v)
    const day =
      payMs != null
        ? formatDateTimeShanghai(new Date(payMs)).slice(0, 10)
        : (v.orderTimeText ?? '').slice(0, 10)
    return day === dateKey
  })
  const dayStart = new Date(`${dateKey}T00:00:00+08:00`)
  const dayEnd = new Date(dayStart.getTime() + 86400000)
  const liveOnDay = await prisma.xhsRawLiveSession.count({
    where: { startTime: { gte: dayStart, lt: dayEnd } },
  })
  const scheduleTable = await getEffectiveScheduleTableForDate(dateKey)
  console.log(`当日支付订单(归属视图): ${paidOnDay.length}`)
  console.log(`当日直播场次(DB): ${liveOnDay}`)
  console.log(`当日有效排班行: ${scheduleTable.rows.length}`)

  section(`主播业绩 summary ${dateKey}`)
  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
    role: 'super_admin',
    username: 'verify-script',
  })
  const apSummary = (local.anchorPerformanceSummary ?? local.summary ?? {}) as Record<string, unknown>
  const overview = (local.summary ?? {}) as Record<string, unknown>
  const leaderboard = (local.anchorLeaderboard ?? []) as Array<Record<string, unknown>>

  let cardsGmv = 0
  let cardsCount = 0
  let cardsValid = 0
  let cardsRefundAmt = 0
  let cardsRefundCnt = 0
  let cardsQuality = 0
  const unassigned = findLeaderboardRow(leaderboard, '未归属')
  const unassignedGmv = unassigned ? num(unassigned.totalGmv ?? unassigned.gmv) : 0
  const unassignedCount = unassigned ? num(unassigned.orderCount ?? unassigned.paidOrderCount) : 0

  for (const row of leaderboard) {
    const m = rowMetric(row)
    console.log(
      `  ${m.anchorName}: 支付 ¥${m.gmv} 有效 ¥${m.valid} ${m.paidCount}单 退款单 ${m.refundCount} 品退 ${m.qualityCount}` +
        ` 实际 ${m.liveTimeRange} 归属 ${m.livePeriodText} 排班 ${m.scheduleTimeRange}`,
    )
    cardsGmv += m.gmv
    cardsCount += m.paidCount
    cardsValid += m.valid
    cardsRefundAmt += m.refundAmount
    cardsRefundCnt += m.refundCount
    cardsQuality += m.qualityCount
  }

  const apGmv = num(apSummary.totalGmv ?? apSummary.gmv)
  const apCount = num(apSummary.orderCount ?? apSummary.paidOrderCount)
  const apValid = num(apSummary.validSalesAmount ?? apSummary.effectiveGmv)
  console.log(`anchorPerformanceSummary: 支付 ¥${apGmv} / ${apCount}单 有效 ¥${apValid}`)
  console.log(`未归属: ¥${unassignedGmv} / ${unassignedCount}单`)

  if (amountClose(apGmv, cardsGmv) && countEq(apCount, cardsCount)) {
    ok('anchorPerformanceSummary = 主播行合计(含未归属)')
  } else {
    fail(`summary ¥${apGmv}/${apCount} vs 卡片 ¥${cardsGmv}/${cardsCount}`)
  }
  if (amountClose(apValid, cardsValid)) ok('有效成交额主播行合计一致')
  else fail(`有效成交 summary ¥${apValid} vs 卡片 ¥${cardsValid}`)

  section(`后端手工重算 vs anchorLeaderboard ${dateKey}`)
  for (const manual of manualLeaderboard) {
    const apiRow = leaderboard.find((r) => String(r.anchorName) === manual.anchorName)
    if (!apiRow) {
      if (manual.orderCount > 0 || manual.totalGmv > 0) {
        fail(`手工榜有 ${manual.anchorName} 但 API 榜缺失`)
      }
      continue
    }
    const m = rowMetric(apiRow)
    const pairs: Array<[string, number, number, boolean]> = [
      ['gmv', m.gmv, manual.totalGmv, true],
      ['valid', m.valid, manual.validSalesAmount ?? manual.effectiveGmv ?? 0, true],
      ['orderCount', m.paidCount, manual.orderCount, false],
      ['quality', m.qualityCount, manual.qualityReturnCount ?? 0, false],
    ]
    for (const [label, apiVal, manualVal, isAmt] of pairs) {
      const okMatch = isAmt ? amountClose(apiVal, manualVal) : countEq(apiVal, manualVal)
      if (!okMatch) fail(`${manual.anchorName} API vs 手工 ${label}: ${apiVal} vs ${manualVal}`)
    }
  }
  ok('aggregateAnchorLeaderboard 与 API 榜逐项对齐')

  section(`主播行 vs 抽屉 stats + 默认全部订单 ${dateKey}`)
  for (const row of leaderboard) {
    const m = rowMetric(row)
    if (m.anchorName === '未归属' && m.paidCount === 0) continue

    const drillAll = await buildAnchorDrill({
      preset: 'custom',
      startDate: dateKey,
      endDate: dateKey,
      anchorId: String(row.anchorId ?? ''),
      anchorName: m.anchorName,
      statusType: 'all',
      page: 1,
      pageSize: 5000,
      role: 'super_admin',
      username: 'verify-script',
    })
    const stats = drillAll.stats as Record<string, unknown> | null
    if (!stats) continue

    const mismatches: string[] = []
    if (!amountClose(m.gmv, num(stats.totalGmv ?? stats.gmv))) {
      mismatches.push(`gmv ${m.gmv} vs ${num(stats.totalGmv ?? stats.gmv)}`)
    }
    if (!amountClose(m.valid, num(stats.validSalesAmount ?? stats.effectiveGmv))) {
      mismatches.push(`valid ${m.valid} vs ${num(stats.validSalesAmount ?? stats.effectiveGmv)}`)
    }
    if (!countEq(m.paidCount, stats.orderCount ?? stats.paidOrderCount)) {
      mismatches.push(`paid ${m.paidCount} vs ${num(stats.orderCount ?? stats.paidOrderCount)}`)
    }
    if (!countEq(m.refundCount, stats.returnCount ?? stats.refundOrderCount)) {
      mismatches.push(`refundCnt ${m.refundCount} vs ${num(stats.returnCount ?? stats.refundOrderCount)}`)
    }
    if (!countEq(m.qualityCount, stats.qualityReturnCount)) {
      mismatches.push(`quality ${m.qualityCount} vs ${num(stats.qualityReturnCount)}`)
    }
    if (mismatches.length > 0) {
      fail(`${m.anchorName} 行 vs 抽屉 stats: ${mismatches.join('; ')}`)
    } else {
      ok(`${m.anchorName} 行与抽屉 stats 一致`)
    }

    const defaultTotal = drillAll.pagination.total
    if (!countEq(defaultTotal, m.paidCount)) {
      fail(`${m.anchorName} 默认全部订单抽屉 ${defaultTotal} 单 ≠ 行支付单数 ${m.paidCount}`)
    } else {
      ok(`${m.anchorName} 默认全部订单抽屉 = ${defaultTotal} 单`)
    }

    const firstTab = drillAll.tabs?.[0]?.key
    if (firstTab !== 'all') fail(`${m.anchorName} 抽屉 tabs 首项应为 all，实际 ${firstTab}`)
    if (drillAll.tabs?.some((t) => t.key === 'all')) ok(`${m.anchorName} 抽屉含「全部订单」tab`)

    const drillSigned = await buildAnchorDrill({
      preset: 'custom',
      startDate: dateKey,
      endDate: dateKey,
      anchorId: String(row.anchorId ?? ''),
      anchorName: m.anchorName,
      statusType: 'signed',
      page: 1,
      pageSize: 5000,
      role: 'super_admin',
      username: 'verify-script',
    })
    console.log(`    ${m.anchorName} 实际签收 tab: ${drillSigned.pagination.total} 单`)

    if (m.qualityCount > 0) {
      const qDrill = await buildAnchorQualityRefundDrill({
        preset: 'custom',
        startDate: dateKey,
        endDate: dateKey,
        anchorId: String(row.anchorId ?? ''),
        anchorName: m.anchorName,
        page: 1,
        pageSize: 5000,
        role: 'super_admin',
        username: 'verify-script',
      })
      if (!countEq(m.qualityCount, qDrill.pagination.total)) {
        fail(`${m.anchorName} 品退行 ${m.qualityCount} vs 品退抽屉 ${qDrill.pagination.total}`)
      } else {
        ok(`${m.anchorName} 品退行与品退抽屉一致 (${m.qualityCount})`)
      }
    }

    const trend = row.trend as AnchorTrend | undefined
    if (trend?.points?.length) {
      const trendGmv = trend.points.reduce((s, p) => s + num(p.value), 0)
      const trendOrders = trend.points.reduce((s, p) => s + num(p.orderCount), 0)
      if (!amountClose(trendGmv, m.gmv)) {
        fail(`${m.anchorName} trend合计 ¥${trendGmv} ≠ 行支付 ¥${m.gmv}`)
      } else {
        ok(`${m.anchorName} trend合计与支付金额一致`)
      }
      if (trendOrders !== m.paidCount) {
        warn(`${m.anchorName} trend orderCount=${trendOrders} vs paidCount=${m.paidCount}`)
      }
      const title = String(trend.title ?? '')
      if (title.includes('有效成交') && !title.includes('支付')) {
        fail(`${m.anchorName} 趋势图标题误导: ${title}`)
      } else if (title.includes('支付')) {
        ok(`${m.anchorName} 趋势图标题: ${title}`)
      }
    }
  }

  section(`经营总览交叉核对 ${dateKey}`)
  const pairsOverview: Array<[string, number, number, boolean]> = [
    ['totalGmv', num(overview.totalGmv ?? overview.gmv), apGmv, true],
    ['orderCount', num(overview.orderCount ?? overview.paidOrderCount), apCount, false],
    ['validSalesAmount', num(overview.validSalesAmount ?? overview.effectiveGmv), apValid, true],
    ['qualityReturnCount', num(overview.qualityReturnCount), cardsQuality, false],
  ]
  for (const [label, ov, ap, isAmt] of pairsOverview) {
    const match = isAmt ? amountClose(ov, ap) : countEq(ov, ap)
    if (match) ok(`经营总览 ${label} = 主播业绩 (${ov})`)
    else fail(`经营总览 ${label} ¥${ov} vs 主播业绩 ${ap}`)
  }

  section(`运营日报交叉核对 ${dateKey}`)
  try {
    const report = await buildDailyOperationsReport({
      preset: 'custom',
      startDate: dateKey,
      endDate: dateKey,
      role: 'super_admin',
      username: 'verify-script',
    })
    const drPaid = report.summary.paidOrderCount
    const drValid = report.summary.validAmountYuan
    if (countEq(drPaid, apCount)) ok(`运营日报 paidOrderCount ${drPaid} = 主播业绩 ${apCount}`)
    else fail(`运营日报 paidOrderCount ${drPaid} vs 主播业绩 ${apCount}`)
    if (amountClose(drValid, apValid)) ok(`运营日报 validAmountYuan = 主播业绩有效成交`)
    else fail(`运营日报 valid ¥${drValid} vs 主播 ¥${apValid}`)
    if (report.summary.unassignedValidOrderCount > 0) {
      warn(`运营日报: ${report.summary.unassignedValidOrderCount} 单有效成交未归属`)
    }
  } catch (err) {
    warn(`运营日报构建跳过: ${err instanceof Error ? err.message : String(err)}`)
  }

  section(`下播后30分钟未归属 ${dateKey}`)
  const postStream = await detectPostStreamUnassigned(performanceViews, dateKey)
  console.log(`  候选: ${postStream}`)
  if (dateKey === '2026-07-03' && paidOnDay.length > 0) {
    if (postStream !== FIXED_20260703_TOTAL.postStreamUnassigned) {
      fail(`下播后30分钟未归属应为 ${FIXED_20260703_TOTAL.postStreamUnassigned}，实际 ${postStream}`)
    } else {
      ok('下播后30分钟未归属 = 0')
    }
  }

  if (dateKey === '2026-07-03' && paidOnDay.length > 0) {
    section('固定验收 2026-07-03')
    if (!amountClose(apGmv, FIXED_20260703_TOTAL.totalGmv)) {
      fail(`总计支付应为 ¥${FIXED_20260703_TOTAL.totalGmv}，实际 ¥${apGmv}`)
    } else ok(`总计支付 ¥${apGmv}`)
    if (!countEq(apCount, FIXED_20260703_TOTAL.orderCount)) {
      fail(`总计支付单数应为 ${FIXED_20260703_TOTAL.orderCount}，实际 ${apCount}`)
    } else ok(`总计 ${apCount} 单`)
    if (!amountClose(apValid, FIXED_20260703_TOTAL.validSalesAmount)) {
      fail(`总计有效成交应为 ¥${FIXED_20260703_TOTAL.validSalesAmount}`)
    } else ok(`总计有效 ¥${apValid}`)

    for (const [name, exp] of Object.entries(FIXED_20260703_ANCHORS)) {
      const row = findLeaderboardRow(leaderboard, name)
      if (!row) {
        fail(`缺少主播行 ${name}`)
        continue
      }
      const m = rowMetric(row)
      if (!amountClose(m.gmv, exp.gmv)) fail(`${name} 支付应为 ¥${exp.gmv}，实际 ¥${m.gmv}`)
      else ok(`${name} 支付 ¥${m.gmv}`)
      if (!countEq(m.paidCount, exp.orderCount)) fail(`${name} 单数应为 ${exp.orderCount}`)
      if (!amountClose(m.valid, exp.valid)) fail(`${name} 有效应为 ¥${exp.valid}`)
    }

    const ziJie = findLeaderboardRow(leaderboard, '子杰')
    if (ziJie) {
      const drill = await buildAnchorDrill({
        preset: 'custom',
        startDate: dateKey,
        endDate: dateKey,
        anchorName: '子杰',
        statusType: 'all',
        page: 1,
        pageSize: 5000,
        role: 'super_admin',
        username: 'verify-script',
      })
      if (countEq(drill.pagination.total, 5)) ok('子杰默认全部订单抽屉 5 单')
      else fail(`子杰默认抽屉应为 5 单，实际 ${drill.pagination.total}`)
      const signed = await buildAnchorDrill({
        preset: 'custom',
        startDate: dateKey,
        endDate: dateKey,
        anchorName: '子杰',
        statusType: 'signed',
        page: 1,
        pageSize: 5000,
        role: 'super_admin',
        username: 'verify-script',
      })
      if (countEq(signed.pagination.total, 1)) ok('子杰实际签收 tab 1 单')
      else fail(`子杰签收 tab 应为 1 单，实际 ${signed.pagination.total}`)
    }

    const focusValid = dedupeViewsByMetricOrderNo(performanceViews).find(
      (v) => (resolveMetricOrderNo(v) || v.orderId) === 'P798605049367374181',
    )
    if (focusValid?.anchorName === '子杰' && explainValidRevenueOrder(focusValid).valid) {
      ok('P798605049367374181 在子杰有效成交池')
    } else if (focusValid) {
      fail('P798605049367374181 应归子杰且 valid=true')
    }

    const focusExcluded = dedupeViewsByMetricOrderNo(performanceViews).find(
      (v) => (resolveMetricOrderNo(v) || v.orderId) === 'P798618403087295271',
    )
    if (focusExcluded && !explainValidRevenueOrder(focusExcluded).valid) {
      ok('P798618403087295271 不计入有效成交')
    } else if (focusExcluded) {
      fail('P798618403087295271 应 valid=false')
    }
  } else if (dateKey === '2026-07-03') {
    warn('本地 DB 无 2026-07-03 支付数据，跳过固定值断言')
  }

  const harDir = resolveHarDir(HAR_DIR_ENV)
  if (fs.existsSync(harDir)) {
    section(`HAR 核对 ${dateKey}`)
    const bundle = loadHarBundle(harDir)
    for (const w of bundle.warnings) warn(w)
    const extOrders = loadExtendedHarOrders(harDir)
    const dayHar = extOrders.filter((o) => (o.paidAt || o.orderedAt).slice(0, 10) === dateKey)
    const shiyuju = dayHar.filter((o) => o.sourceShop.includes('拾玉居'))
    const hetian = dayHar.filter((o) => o.sourceShop.includes('和田雅玉'))
    const shiyujuGmv = Math.round(shiyuju.reduce((s, o) => s + o.actualPaid, 0) * 100) / 100
    console.log(`HAR 拾玉居 ${dateKey}: ${shiyuju.length} 单 ¥${shiyujuGmv}`)
    console.log(`HAR 和田雅玉 ${dateKey}: ${hetian.length} 单`)

    if (dateKey === '2026-07-03' && paidOnDay.length > 0) {
      if (shiyuju.length === 5 && amountClose(shiyujuGmv, 7130.9)) {
        ok('HAR 拾玉居早场 5 单 ¥7,130.90 与子杰一致')
      } else if (shiyuju.length > 0) {
        warn(`HAR 拾玉居 ${shiyuju.length} 单 ¥${shiyujuGmv}（期望 5 单 ¥7130.90）`)
      }
      if (hetian.length === 1 && Math.abs(hetian[0]?.actualPaid - 216) < 0.01) {
        ok('HAR 和田雅玉 1 单 ¥216 与小艺一致')
      } else if (hetian.length > 0) {
        warn(`HAR 和田雅玉 ${hetian.length} 单`)
      }
    } else if (dateKey === '2026-07-03') {
      warn('本地无 7/3 DB 数据，HAR 仅摘要')
    }
  }
}

async function main(): Promise<void> {
  console.log('[verify:anchor-performance-full-integrity] 只读体检，不改数据库')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE_ENV)) {
    fail(`DATE 格式无效: ${DATE_ENV}`)
    process.exit(1)
  }

  checkUiCopy()
  await auditDate(DATE_ENV)

  section('汇总')
  console.log(`DATE: ${DATE_ENV}`)
  console.log(`warnings: ${warnings.length}`)
  console.log(`failures: ${failures.length}`)
  for (const w of warnings) console.log(`  ⚠ ${w}`)
  for (const f of failures) console.log(`  ✗ ${f}`)

  if (failures.length > 0) {
    console.log('\nverify:anchor-performance-full-integrity FAIL')
    process.exit(1)
  }
  console.log('\nverify:anchor-performance-full-integrity OK')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
