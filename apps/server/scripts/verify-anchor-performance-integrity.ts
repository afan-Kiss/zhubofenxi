/**
 * 主播业绩统计准确性只读体检
 * 用法: npm run verify:anchor-performance-integrity
 *       DATE=2026-07-03 npm run verify:anchor-performance-integrity
 *       HAR_DIR=./debug/har DATE=2026-07-03 npm run verify:anchor-performance-integrity
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import {
  buildAndSetBusinessBoardCache,
} from '../src/services/business-cache.service'
import {
  aggregateAnchorLeaderboard,
} from '../src/services/board-metrics.service'
import {
  getBoardScopedViewsForRange,
  getAnchorPerformanceViews,
} from '../src/services/board-scoped-views.service'
import { buildAnchorDrill } from '../src/services/board-drill.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { explainValidRevenueOrder } from '../src/services/valid-revenue-order.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import {
  loadAndAssignDailyReportLiveSessions,
  type DailyReportLiveSession,
} from '../src/services/daily-report-live-sessions.service'
import { parseDailyReportLiveSessionBounds } from '../src/services/anchor-live-session-order-attribution.service'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { orderLiveRoomMatchesSchedule } from '../src/utils/shop-name-normalize.util'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { resolveBusinessRange } from '../src/utils/business-range'

config({ path: path.resolve(__dirname, '../.env') })

const DATE_ENV = process.env.DATE?.trim()
const HAR_DIR = process.env.HAR_DIR?.trim()
const POST_STREAM_GRACE_MS = 30 * 60 * 1000

const failures: string[] = []
const warnings: string[] = []

interface HarOrderRow {
  packageId: string
  orderId: string
  paidAt: string
  orderedAt: string
  updatedAt: string
  status: string
  statusDesc: string
  afterSaleStatus: string
  afterSaleStatusDesc: string
  firstAfterSaleStatus: string
  secondAfterSaleStatus: string
  actualPaid: number
  actualSellerReceiveAmount: number
  totalOrderAmount: number
  sellerId: string
  userId: string
  skuSummary: string
  sourceFile: string
}

interface HarLiveRow {
  liveId: string
  liveStartTime: string
  liveEndTime: string
  liveAccountName: string
  sourceShopName: string
  liveViewSessionCnt: number | null
  serverLiveViewUserNum: number | null
  liveFollowUserNum: number | null
  newFollowUserNum: number | null
  followUserNum: number | null
  dealUserNum: number | null
  dealGoodsCnt: number | null
  avgOnlineUserCnt: number | null
  avgViewDuration: number | null
  sourceFile: string
}

interface PostStreamCandidate {
  orderNo: string
  packageId: string
  liveAccountName: string
  paidAt: string
  nearestLiveStart: string
  nearestLiveEnd: string
  minutesAfterEnd: number
  currentAnchor: string
  suggestedAnchor: string
}

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

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k]
    if (v == null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

function parseHarJson(filePath: string): { entries: Array<{ request: { url: string }; response: { content: { text?: string } } }> } {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw) as { log?: { entries?: unknown[] } }
  return { entries: (parsed.log?.entries ?? []) as Array<{ request: { url: string }; response: { content: { text?: string } } }> }
}

function parseOrderHarFile(filePath: string): HarOrderRow[] {
  const base = path.basename(filePath)
  const rows: HarOrderRow[] = []
  for (const entry of parseHarJson(filePath).entries) {
    const url = entry.request?.url ?? ''
    if (!url.includes('/api/edith/fulfillment/order/page')) continue
    const text = entry.response?.content?.text
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
      const skus = Array.isArray(pkg.skus) ? pkg.skus : []
      const skuSummary = skus
        .slice(0, 2)
        .map((s) => pickString(s as Record<string, unknown>, ['skuName', 'displayName', 'name']))
        .filter(Boolean)
        .join(' / ')
      rows.push({
        packageId: pickString(pkg, ['packageId', 'package_id']),
        orderId: pickString(pkg, ['orderId', 'order_id']),
        paidAt: pickString(pkg, ['paidAt', 'paid_at', 'payTime']),
        orderedAt: pickString(pkg, ['orderedAt', 'ordered_at', 'orderTime']),
        updatedAt: pickString(pkg, ['updatedAt', 'updated_at']),
        status: pickString(pkg, ['status']),
        statusDesc: pickString(pkg, ['statusDesc', 'status_desc']),
        afterSaleStatus: pickString(pkg, ['afterSaleStatus', 'after_sale_status']),
        afterSaleStatusDesc: pickString(pkg, ['afterSaleStatusDesc', 'after_sale_status_desc']),
        firstAfterSaleStatus: pickString(pkg, ['firstAfterSaleStatus']),
        secondAfterSaleStatus: pickString(pkg, ['secondAfterSaleStatus']),
        actualPaid: pickNum(pkg, ['actualPaid', 'actual_paid']) ?? 0,
        actualSellerReceiveAmount:
          pickNum(pkg, ['actualSellerReceiveAmount', 'actual_seller_receive_amount']) ?? 0,
        totalOrderAmount: pickNum(pkg, ['totalOrderAmount', 'total_order_amount']) ?? 0,
        sellerId: pickString(pkg, ['sellerId', 'seller_id']),
        userId: pickString(pkg, ['userId', 'user_id']),
        skuSummary,
        sourceFile: base,
      })
    }
  }
  return rows
}

function parseLiveHarFile(filePath: string): HarLiveRow[] {
  const base = path.basename(filePath)
  const rows: HarLiveRow[] = []
  for (const entry of parseHarJson(filePath).entries) {
    const url = entry.request?.url ?? ''
    if (!url.includes('sellerLiveDetailData')) continue
    const text = entry.response?.content?.text
    if (!text) continue
    let body: Record<string, unknown>
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    const dataArr = (body.data ?? []) as unknown[]
    for (const block of dataArr) {
      if (!block || typeof block !== 'object') continue
      const rec = block as Record<string, unknown>
      const inner = (rec.data ?? []) as unknown[]
      for (const item of inner) {
        if (!item || typeof item !== 'object') continue
        const d = item as Record<string, unknown>
        rows.push({
          liveId: pickString(d, ['liveId', 'live_id']),
          liveStartTime: pickString(d, ['liveStartTime', 'live_start_time', 'startTime']),
          liveEndTime: pickString(d, ['liveEndTime', 'live_end_time', 'endTime']),
          liveAccountName: pickString(d, [
            'liveAccountName',
            'liveName',
            'nickName',
            'live_account_name',
          ]),
          sourceShopName: pickString(d, ['sourceShopName', 'shopName', 'sellerName']),
          liveViewSessionCnt: pickNum(d, ['liveViewSessionCnt', 'viewSessionCnt']),
          serverLiveViewUserNum: pickNum(d, ['serverLiveViewUserNum', 'joinUserNum']),
          liveFollowUserNum: pickNum(d, ['liveFollowUserNum']),
          newFollowUserNum: pickNum(d, ['newFollowUserNum', 'newFollowerCount']),
          followUserNum: pickNum(d, ['followUserNum']),
          dealUserNum: pickNum(d, ['dealUserNum', 'dealUserCount']),
          dealGoodsCnt: pickNum(d, ['dealGoodsCnt']),
          avgOnlineUserCnt: pickNum(d, ['avgOnlineUserCnt', 'avgOnlineUserCount']),
          avgViewDuration: pickNum(d, ['avgViewDuration', 'avgViewDurationSeconds']),
          sourceFile: base,
        })
      }
    }
  }
  return rows
}

function loadHarBundle(harDir: string): {
  orders: HarOrderRow[]
  lives: HarLiveRow[]
} {
  if (!fs.existsSync(harDir)) {
    warn(`HAR_DIR 不存在: ${harDir}`)
    return { orders: [], lives: [] }
  }
  const files = fs.readdirSync(harDir).filter((f) => f.endsWith('.har'))
  let orders: HarOrderRow[] = []
  let lives: HarLiveRow[] = []
  for (const f of files) {
    const full = path.join(harDir, f)
    if (f.includes('订单')) orders = orders.concat(parseOrderHarFile(full))
    if (f.includes('直播')) lives = lives.concat(parseLiveHarFile(full))
  }
  return { orders, lives }
}

function printHarSummary(orders: HarOrderRow[], lives: HarLiveRow[], dateKey?: string): void {
  section('HAR 解析摘要')
  if (orders.length === 0 && lives.length === 0) {
    console.log('未读取到 HAR 数据（可设置 HAR_DIR 指向含 .har 文件的目录）')
    return
  }
  const pkgIds = new Set(orders.map((o) => o.packageId || o.orderId).filter(Boolean))
  console.log(`HAR 订单条目: ${orders.length}`)
  console.log(`按 packageId 去重: ${pkgIds.size}`)
  const byDate = new Map<string, number>()
  for (const o of orders) {
    const paid = o.paidAt || o.orderedAt
    const day = paid.slice(0, 10) || 'unknown'
    byDate.set(day, (byDate.get(day) ?? 0) + 1)
  }
  console.log('paidAt 日期分布:')
  for (const [day, count] of [...byDate.entries()].sort()) {
    console.log(`  ${day}: ${count}`)
  }
  console.log(`HAR 直播场次: ${lives.length}`)
  for (const live of lives.slice(0, 20)) {
    console.log(
      `  ${live.liveAccountName || live.sourceShopName} ${live.liveStartTime}~${live.liveEndTime}` +
        ` 场观=${live.liveViewSessionCnt ?? '—'} 进房=${live.serverLiveViewUserNum ?? '—'}` +
        ` 新增粉丝=${live.newFollowUserNum ?? live.liveFollowUserNum ?? '—'}`,
    )
  }
  if (dateKey && lives.length > 0) {
    section(`HAR 直播 vs 系统 ${dateKey}`)
    console.log('（仅辅助核对实际开播时间，不用于归属还原）')
  }
}

function rowMetric(row: Record<string, unknown>) {
  return {
    gmv: num(row.totalGmv ?? row.gmv),
    valid: num(row.validSalesAmount ?? row.effectiveGmv),
    paidCount: num(row.paidOrderCount ?? row.orderCount),
    refundCount: num(row.returnCount ?? row.refundOrderCount),
    refundRate: row.returnRate ?? row.refundRate,
    qualityCount: num(row.qualityReturnCount),
    anchorName: String(row.anchorName ?? ''),
    liveTimeRange: String(row.liveTimeRange ?? '—'),
    livePeriodText: String(row.livePeriodText ?? '—'),
    scheduleTimeRange: String(row.scheduleTimeRange ?? row.scheduledPeriodText ?? '—'),
  }
}

async function checkDateRange(params: {
  label: string
  preset: string
  startDate: string
  endDate: string
}): Promise<PostStreamCandidate[]> {
  const { label, preset, startDate, endDate } = params
  section(`范围 ${label} (${startDate}~${endDate})`)

  await buildAndSetBusinessBoardCache({ preset, startDate, endDate })
  const local = await executeBoardLocalQuery({
    preset: preset as import('../src/services/board-live-query.service').BoardLiveQueryPreset,
    startDate,
    endDate,
  })

  const summary = (local.anchorPerformanceSummary ?? local.summary ?? {}) as Record<string, unknown>
  const leaderboard = (local.anchorLeaderboard ?? []) as Array<Record<string, unknown>>

  const scoped = await getBoardScopedViewsForRange({ preset: 'custom', startDate, endDate })
  const performanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const manualLeaderboard = aggregateAnchorLeaderboard(performanceViews)

  console.log(`anchorPerformanceSummary 支付 ¥${num(summary.totalGmv ?? summary.gmv)} / ${num(summary.orderCount ?? summary.paidOrderCount)} 单`)
  console.log(`performanceViews: ${performanceViews.length} 条`)

  let cardsGmv = 0
  let cardsCount = 0
  for (const row of leaderboard) {
    const m = rowMetric(row)
    console.log(
      `  主播 ${m.anchorName}: 支付 ¥${m.gmv} 有效 ¥${m.valid} 单数 ${m.paidCount} 退货单 ${m.refundCount} 品退 ${m.qualityCount}` +
        ` 实际 ${m.liveTimeRange} 归属 ${m.livePeriodText} 排班 ${m.scheduleTimeRange}`,
    )

    const manualRow = manualLeaderboard.find((a) => a.anchorName === m.anchorName)
    if (manualRow) {
      if (Math.abs(diffYuan(m.gmv, manualRow.totalGmv)) > 1) {
        fail(`${label} ${m.anchorName} leaderboard gmv=${m.gmv} ≠ 手工=${manualRow.totalGmv}`)
      }
      if (m.paidCount !== manualRow.orderCount) {
        fail(`${label} ${m.anchorName} paidCount=${m.paidCount} ≠ 手工=${manualRow.orderCount}`)
      }
    }

    cardsGmv += m.gmv
    cardsCount += m.paidCount

    const trend = row.trend as { points?: Array<{ value: number; orderCount: number }> } | undefined
    if (trend?.points?.length) {
      const trendGmv = trend.points.reduce((s, p) => s + num(p.value), 0)
      const trendOrders = trend.points.reduce((s, p) => s + num(p.orderCount), 0)
      if (Math.abs(diffYuan(trendGmv, m.gmv)) > 1) {
        fail(`${label} ${m.anchorName} trend合计 ¥${trendGmv} ≠ 行支付 ¥${m.gmv}`)
      } else {
        ok(`${label} ${m.anchorName} trend合计与支付金额一致`)
      }
      if (trendOrders !== m.paidCount) {
        warn(`${label} ${m.anchorName} trend orderCount=${trendOrders} vs paidCount=${m.paidCount}`)
      }
      const trendTitle = String((trend as { title?: string }).title ?? '')
      if (trendTitle && !trendTitle.includes('支付')) {
        warn(`${label} ${m.anchorName} trend.title="${trendTitle}" 应标明支付金额走势`)
      }
    }

    if (m.anchorName !== '未归属') {
      await checkAnchorDrawer({ label, preset, startDate, endDate, row, performanceViews })
    }
  }

  const topGmv = num(summary.totalGmv ?? summary.gmv)
  const topCount = num(summary.orderCount ?? summary.paidOrderCount)
  if (Math.abs(diffYuan(topGmv, cardsGmv)) > 1 || topCount !== cardsCount) {
    fail(
      `${label} 主播合计+未归属 vs summary: 卡片 ¥${cardsGmv}/${cardsCount} vs 顶部 ¥${topGmv}/${topCount}`,
    )
  } else {
    ok(`${label} 主播卡片合计与 anchorPerformanceSummary 一致`)
  }

  const postStream = await detectPostStreamUnassigned(performanceViews, startDate)
  if (postStream.length > 0) {
    section(`${label} 下播后30分钟内支付但未归属 (${postStream.length})`)
    for (const c of postStream.slice(0, 20)) {
      console.log(
        `  ${c.orderNo} ${c.liveAccountName} paid=${c.paidAt} live=${c.nearestLiveStart}~${c.nearestLiveEnd}` +
          ` +${c.minutesAfterEnd.toFixed(1)}min 当前=${c.currentAnchor} 建议=${c.suggestedAnchor}`,
      )
    }
    warn(`${label} 存在 ${postStream.length} 单下播后30分钟内支付但未归属（见上方列表，暂不自动改归属）`)
  } else {
    ok(`${label} 未发现下播后30分钟内未归属订单`)
  }

  return postStream
}

async function checkAnchorDrawer(params: {
  label: string
  preset: string
  startDate: string
  endDate: string
  row: Record<string, unknown>
  performanceViews: AnalyzedOrderView[]
}): Promise<void> {
  const m = rowMetric(params.row)
  const drill = await buildAnchorDrill({
    preset: params.preset,
    startDate: params.startDate,
    endDate: params.endDate,
    anchorId: String(params.row.anchorId ?? ''),
    anchorName: m.anchorName,
    page: 1,
    pageSize: 5000,
    role: 'super_admin',
    username: 'verify-script',
  })

  const stats = drill.stats
  if (!stats) return

  const rowGmv = m.gmv
  const drawerGmv = num(stats.totalGmv ?? stats.gmv)
  const rowValid = m.valid
  const drawerValid = num(stats.validSalesAmount ?? stats.effectiveGmv)
  const rowPaid = m.paidCount
  const drawerPaid = num(stats.orderCount ?? stats.paidOrderCount)
  const rowRefund = m.refundCount
  const drawerRefund = num(stats.returnCount ?? stats.refundOrderCount)
  const rowQuality = m.qualityCount
  const drawerQuality = num(stats.qualityReturnCount)

  let drawerPayCent = 0
  let drawerPaidN = 0
  for (const r of drill.rows ?? []) {
    drawerPayCent += Math.round(num(r.payAmount) * 100)
    if (num(r.payAmount) > 0) drawerPaidN += 1
  }

  const mismatches: string[] = []
  if (Math.abs(diffYuan(rowGmv, drawerGmv)) > 1) mismatches.push(`gmv row=${rowGmv} stats=${drawerGmv}`)
  if (Math.abs(diffYuan(rowValid, drawerValid)) > 1) mismatches.push(`valid row=${rowValid} stats=${drawerValid}`)
  if (rowPaid !== drawerPaid) mismatches.push(`paid row=${rowPaid} stats=${drawerPaid}`)
  if (rowRefund !== drawerRefund) mismatches.push(`refund row=${rowRefund} stats=${drawerRefund}`)

  if (mismatches.length > 0) {
    fail(`${params.label} ${m.anchorName} 主播行 vs 抽屉 stats: ${mismatches.join('; ')}`)
    const anchorViews = params.performanceViews.filter((v) => v.anchorName === m.anchorName)
    for (const v of dedupeViewsByMetricOrderNo(anchorViews).slice(0, 5)) {
      const ex = explainValidRevenueOrder(v)
      console.log(
        `    样例 ${resolveMetricOrderNo(v) || v.orderId} pay=${v.orderTimeText} live=${v.liveAccountName}` +
          ` anchor=${v.anchorName} payCent=${v.paymentBaseCent} eff=${v.effectiveGmvCent} valid=${ex.valid} ${ex.reason}`,
      )
    }
  } else {
    ok(`${params.label} ${m.anchorName} 主播行与抽屉 stats 一致`)
  }
}

async function detectPostStreamUnassigned(
  views: AnalyzedOrderView[],
  dateKey: string,
): Promise<PostStreamCandidate[]> {
  const scheduleTable = await getEffectiveScheduleTableForDate(dateKey)
  const assignment = await loadAndAssignDailyReportLiveSessions({
    reportDate: dateKey,
    startDate: dateKey,
    endDate: dateKey,
    scheduleRows: scheduleTable.rows,
  })

  const allSessions: Array<DailyReportLiveSession & { anchorName: string }> = []
  for (const [anchorName, sessions] of assignment.byAnchor.entries()) {
    for (const s of sessions) {
      allSessions.push(Object.assign({}, s, { anchorName }))
    }
  }

  const candidates: PostStreamCandidate[] = []
  const deduped = dedupeViewsByMetricOrderNo(views).filter((v) => v.attributionType === 'unassigned')

  for (const v of deduped) {
    const payMs = parseViewPayTimeMs(v)
    if (payMs == null) continue
    const liveAccountName = (v.liveAccountName ?? '').trim()
    if (!liveAccountName) continue

    const matching = allSessions.filter((s) =>
      orderLiveRoomMatchesSchedule(liveAccountName, s.sourceShopName, s.liveAccountName),
    )
    if (matching.length === 0) continue

    let nearest: (typeof matching)[0] | null = null
    let nearestEndMs = -1
    for (const s of matching) {
      const bounds = parseDailyReportLiveSessionBounds(s)
      if (!bounds) continue
      if (payMs >= bounds.startMs && payMs <= bounds.endMs) continue
      if (payMs < bounds.endMs) continue
      const afterMs = payMs - bounds.endMs
      if (afterMs > POST_STREAM_GRACE_MS) continue
      const nextStarted = matching.some((other) => {
        const ob = parseDailyReportLiveSessionBounds(other)
        return ob && ob.startMs > bounds.endMs && ob.startMs <= payMs
      })
      if (nextStarted) continue
      if (bounds.endMs > nearestEndMs) {
        nearestEndMs = bounds.endMs
        nearest = s
      }
    }

    if (!nearest) continue
    const bounds = parseDailyReportLiveSessionBounds(nearest)!
    candidates.push({
      orderNo: resolveMetricOrderNo(v) || v.orderId,
      packageId: v.orderId,
      liveAccountName,
      paidAt: v.orderTimeText,
      nearestLiveStart: nearest.startTime,
      nearestLiveEnd: nearest.endTime,
      minutesAfterEnd: (payMs - bounds.endMs) / 60_000,
      currentAnchor: v.anchorName?.trim() || '未归属',
      suggestedAnchor: nearest.anchorName,
    })
  }
  return candidates
}

async function main(): Promise<void> {
  console.log('[verify:anchor-performance-integrity] 只读体检，不改数据库')
  await bootstrapQualityBadCaseCache()

  section('数据基础')
  console.log(`XhsRawOrder: ${await prisma.xhsRawOrder.count()}`)
  console.log(`XhsRawLiveSession: ${await prisma.xhsRawLiveSession.count()}`)

  const harDir = HAR_DIR ? path.resolve(process.cwd(), HAR_DIR) : path.resolve(process.cwd(), 'debug/har')
  const har = loadHarBundle(harDir)
  printHarSummary(har.orders, har.lives, DATE_ENV)

  const ranges: Array<{ label: string; preset: string; startDate: string; endDate: string }> = []
  if (DATE_ENV && /^\d{4}-\d{2}-\d{2}$/.test(DATE_ENV)) {
    ranges.push({ label: `custom-${DATE_ENV}`, preset: 'custom', startDate: DATE_ENV, endDate: DATE_ENV })
  } else {
    for (const preset of ['yesterday', 'today'] as const) {
      const r = resolveBusinessRange(preset)
      ranges.push({ label: preset, preset, startDate: r.startDate, endDate: r.endDate })
    }
  }

  const allPostStream: PostStreamCandidate[] = []
  for (const r of ranges) {
    const found = await checkDateRange(r)
    allPostStream.push(...found)
  }

  section('汇总')
  console.log(`warnings: ${warnings.length}`)
  console.log(`failures: ${failures.length}`)
  console.log(`下播后30分钟未归属候选: ${allPostStream.length}`)
  for (const w of warnings) console.log(`  ⚠ ${w}`)
  for (const f of failures) console.log(`  ✗ ${f}`)

  if (failures.length > 0) {
    console.log('\nverify:anchor-performance-integrity FAIL')
    process.exit(1)
  }
  console.log('\nverify:anchor-performance-integrity OK')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
