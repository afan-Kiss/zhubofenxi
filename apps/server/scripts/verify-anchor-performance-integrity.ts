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
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { aggregateAnchorLeaderboard } from '../src/services/board-metrics.service'
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
import { formatDateTimeShanghai } from '../src/utils/business-timezone'
import type { AnalyzedOrderView } from '../src/types/analysis'
import { resolveBusinessRange } from '../src/utils/business-range'

config({ path: path.resolve(__dirname, '../.env') })

const DATE_ENV = process.env.DATE?.trim()
const HAR_DIR = process.env.HAR_DIR?.trim()
const POST_STREAM_GRACE_MS = 30 * 60 * 1000
const LIVE_TIME_TOLERANCE_MS = 2 * 60 * 1000

const failures: string[] = []
const warnings: string[] = []

interface HarOrderRow {
  packageId: string
  orderId: string
  paidAt: string
  orderedAt: string
  statusDesc: string
  afterSaleStatusDesc: string
  actualPaid: number
  actualSellerReceiveAmount: number
  totalOrderAmount: number
  sourceFile: string
}

interface HarLiveRow {
  liveId: string
  liveStartTime: string
  liveEndTime: string
  liveAccountName: string
  sourceShopName: string
  sourceFile: string
}

interface HarFileParseResult {
  fileName: string
  ok: boolean
  orderEndpointCount: number
  liveEndpointCount: number
  orderRowCount: number
  liveRowCount: number
  error?: string
}

interface HarBundle {
  orders: HarOrderRow[]
  lives: HarLiveRow[]
  fileResults: HarFileParseResult[]
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

const EXPECTED_HAR_LIVES_20260703 = [
  { label: '拾玉居', start: '2026-07-03 09:24:12', end: '2026-07-03 14:02:19' },
  { label: '和田雅玉早场', start: '2026-07-03 09:29:29', end: '2026-07-03 14:04:18' },
  { label: '和田雅玉下午场', start: '2026-07-03 14:21:09', end: '2026-07-03 17:52:13' },
] as const

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

function decodeHarContentText(content: { text?: string; encoding?: string }): string {
  const text = content?.text ?? ''
  if (!text.trim()) return ''
  if (content.encoding === 'base64') {
    return Buffer.from(text, 'base64').toString('utf-8')
  }

  const trimmed = text.trim()
  if (
    !trimmed.startsWith('{') &&
    !trimmed.startsWith('[') &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(trimmed.slice(0, 300))
  ) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf-8')
      if (decoded.trim().startsWith('{') || decoded.trim().startsWith('[')) return decoded
    } catch {
      // ignore
    }
  }

  return text
}

function unwrapHarField(v: unknown): unknown {
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    return (v as Record<string, unknown>).value
  }
  return v
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const raw = unwrapHarField(obj[k])
    if (raw != null && String(raw).trim()) return String(raw).trim()
  }
  return ''
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const raw = unwrapHarField(obj[k])
    if (raw == null || raw === '') continue
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return null
}

type HarEntry = {
  request?: { url?: string }
  response?: { content?: { text?: string; encoding?: string } }
}

function readHarEntries(filePath: string): HarEntry[] {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw) as { log?: { entries?: HarEntry[] } }
  return parsed.log?.entries ?? []
}

function parseOrderHarFile(filePath: string): { rows: HarOrderRow[]; orderEndpointCount: number } {
  const base = path.basename(filePath)
  const rows: HarOrderRow[] = []
  let orderEndpointCount = 0
  for (const entry of readHarEntries(filePath)) {
    const url = entry.request?.url ?? ''
    if (!url.includes('/api/edith/fulfillment/order/page')) continue
    orderEndpointCount += 1
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
      rows.push({
        packageId: pickString(pkg, ['packageId', 'package_id']),
        orderId: pickString(pkg, ['orderId', 'order_id']),
        paidAt: pickString(pkg, ['paidAt', 'paid_at', 'payTime']),
        orderedAt: pickString(pkg, ['orderedAt', 'ordered_at', 'orderTime']),
        statusDesc: pickString(pkg, ['statusDesc', 'status_desc']),
        afterSaleStatusDesc: pickString(pkg, ['afterSaleStatusDesc', 'after_sale_status_desc']),
        actualPaid: pickNum(pkg, ['actualPaid', 'actual_paid']) ?? 0,
        actualSellerReceiveAmount:
          pickNum(pkg, ['actualSellerReceiveAmount', 'actual_seller_receive_amount']) ?? 0,
        totalOrderAmount: pickNum(pkg, ['totalOrderAmount', 'total_order_amount']) ?? 0,
        sourceFile: base,
      })
    }
  }
  return { rows, orderEndpointCount }
}

function parseLiveHarFile(filePath: string): { rows: HarLiveRow[]; liveEndpointCount: number } {
  const base = path.basename(filePath)
  const rows: HarLiveRow[] = []
  let liveEndpointCount = 0
  for (const entry of readHarEntries(filePath)) {
    const url = entry.request?.url ?? ''
    if (!url.includes('sellerLiveDetailData')) continue
    liveEndpointCount += 1
    const text = decodeHarContentText(entry.response?.content ?? {})
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
          sourceFile: base,
        })
      }
    }
  }
  return { rows, liveEndpointCount }
}

function resolveHarDir(harDirEnv?: string): string {
  if (harDirEnv?.trim()) {
    const trimmed = harDirEnv.trim()
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed)
  }
  return path.resolve(process.cwd(), 'debug/har')
}

function loadHarBundle(harDir: string): HarBundle {
  const fileResults: HarFileParseResult[] = []
  let orders: HarOrderRow[] = []
  let lives: HarLiveRow[] = []

  if (!fs.existsSync(harDir)) {
    warn(`HAR_DIR 不存在: ${harDir}`)
    return { orders, lives, fileResults }
  }

  const files = fs.readdirSync(harDir).filter((f) => f.endsWith('.har')).sort()
  for (const f of files) {
    const full = path.join(harDir, f)
    const result: HarFileParseResult = {
      fileName: f,
      ok: true,
      orderEndpointCount: 0,
      liveEndpointCount: 0,
      orderRowCount: 0,
      liveRowCount: 0,
    }
    try {
      if (f.includes('订单')) {
        const parsed = parseOrderHarFile(full)
        result.orderEndpointCount = parsed.orderEndpointCount
        result.orderRowCount = parsed.rows.length
        orders = orders.concat(parsed.rows)
      }
      if (f.includes('直播')) {
        const parsed = parseLiveHarFile(full)
        result.liveEndpointCount = parsed.liveEndpointCount
        result.liveRowCount = parsed.rows.length
        lives = lives.concat(parsed.rows)
      }
    } catch (err) {
      result.ok = false
      result.error = err instanceof Error ? err.message : String(err)
      warn(`HAR 文件损坏或未完整导出，已跳过：${f}`)
    }
    fileResults.push(result)
  }

  return { orders, lives, fileResults }
}

function orderDay(row: HarOrderRow): string {
  const paid = row.paidAt || row.orderedAt
  return paid.slice(0, 10) || 'unknown'
}

function printHarSummary(bundle: HarBundle, dateKey?: string): void {
  section('HAR 解析摘要')

  for (const file of bundle.fileResults) {
    const status = file.ok ? '成功' : '跳过'
    console.log(
      `  文件 ${file.fileName}: ${status} | order endpoints=${file.orderEndpointCount} live endpoints=${file.liveEndpointCount} | 订单条数=${file.orderRowCount} 直播条数=${file.liveRowCount}`,
    )
    if (file.error) console.log(`    原因: ${file.error}`)
  }

  if (bundle.orders.length === 0 && bundle.lives.length === 0) {
    console.log('未读取到 HAR 数据（可设置 HAR_DIR 指向含 .har 文件的目录）')
    return
  }

  const pkgIds = new Set(bundle.orders.map((o) => o.packageId || o.orderId).filter(Boolean))
  const liveIds = new Set(bundle.lives.map((l) => l.liveId).filter(Boolean))

  console.log(`HAR 订单条目: ${bundle.orders.length}`)
  console.log(`按 packageId 去重: ${pkgIds.size}`)
  console.log(`HAR 直播条目: ${bundle.lives.length}`)
  console.log(`按 liveId 去重: ${liveIds.size}`)

  const paidByDate = new Map<string, number>()
  for (const o of bundle.orders) {
    const day = orderDay(o)
    paidByDate.set(day, (paidByDate.get(day) ?? 0) + 1)
  }
  console.log('paidAt 日期分布:')
  for (const [day, count] of [...paidByDate.entries()].sort()) {
    console.log(`  ${day}: ${count}`)
  }

  const liveByDate = new Map<string, number>()
  for (const l of bundle.lives) {
    const day = l.liveStartTime.slice(0, 10) || 'unknown'
    liveByDate.set(day, (liveByDate.get(day) ?? 0) + 1)
  }
  console.log('liveStartTime 日期分布:')
  for (const [day, count] of [...liveByDate.entries()].sort()) {
    console.log(`  ${day}: ${count}`)
  }

  if (dateKey) {
    const dayOrders = bundle.orders.filter((o) => orderDay(o) === dateKey)
    const dayPkgIds = new Set(dayOrders.map((o) => o.packageId || o.orderId).filter(Boolean))
    const dayLives = bundle.lives.filter((l) => l.liveStartTime.slice(0, 10) === dateKey)
    const dayLiveIds = new Set(dayLives.map((l) => l.liveId).filter(Boolean))
    console.log(`${dateKey} HAR 订单条目: ${dayOrders.length} / 去重 ${dayPkgIds.size}`)
    console.log(`${dateKey} HAR 直播条目: ${dayLives.length} / 去重 liveId ${dayLiveIds.size}`)
  }
}

function parseDateTimeMs(text: string): number | null {
  const normalized = text.trim().replace('T', ' ')
  const ms = Date.parse(normalized.includes('+') ? normalized : `${normalized}+08:00`)
  return Number.isFinite(ms) ? ms : null
}

function dedupeHarOrders(orders: HarOrderRow[]): HarOrderRow[] {
  const map = new Map<string, HarOrderRow>()
  for (const row of orders) {
    const key = row.packageId || row.orderId
    if (!key) continue
    map.set(key, row)
  }
  return [...map.values()]
}

function dedupeHarLives(lives: HarLiveRow[]): HarLiveRow[] {
  const map = new Map<string, HarLiveRow>()
  for (const row of lives) {
    if (!row.liveId) continue
    map.set(row.liveId, row)
  }
  return [...map.values()]
}

async function crossCheckHarLiveVsDb(dateKey: string, harLives: HarLiveRow[]): Promise<void> {
  section(`HAR 直播 vs DB ${dateKey}`)
  const dayLives = dedupeHarLives(harLives.filter((l) => l.liveStartTime.slice(0, 10) === dateKey))

  const dayStart = new Date(`${dateKey}T00:00:00+08:00`)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const dbSessions = await prisma.xhsRawLiveSession.findMany({
    where: { startTime: { gte: dayStart, lt: dayEnd } },
    select: { liveId: true, startTime: true, endTime: true, liveAccountName: true, liveName: true },
  })
  const dbByLiveId = new Map<string, (typeof dbSessions)[0]>()
  for (const s of dbSessions) {
    if (s.liveId) dbByLiveId.set(s.liveId, s)
  }

  for (const expected of EXPECTED_HAR_LIVES_20260703) {
    const harMatch = dayLives.find((l) => {
      const startMs = parseDateTimeMs(l.liveStartTime)
      const expStartMs = parseDateTimeMs(expected.start)
      return startMs != null && expStartMs != null && Math.abs(startMs - expStartMs) <= LIVE_TIME_TOLERANCE_MS
    })

    if (!harMatch) {
      fail(`${expected.label} HAR 未找到 ${expected.start}~${expected.end}`)
      continue
    }

    const db = dbByLiveId.get(harMatch.liveId)
    if (!db || !db.startTime) {
      fail(`${expected.label} 系统缺少 liveId=${harMatch.liveId}`)
      continue
    }

    const dbStart = formatDateTimeShanghai(db.startTime)
    const dbEnd = db.endTime ? formatDateTimeShanghai(db.endTime) : '—'
    const startDiff = Math.abs((parseDateTimeMs(dbStart) ?? 0) - (parseDateTimeMs(harMatch.liveStartTime) ?? 0))
    const endDiff =
      db.endTime && harMatch.liveEndTime
        ? Math.abs((parseDateTimeMs(dbEnd) ?? 0) - (parseDateTimeMs(harMatch.liveEndTime) ?? 0))
        : 0

    if (startDiff > LIVE_TIME_TOLERANCE_MS || endDiff > LIVE_TIME_TOLERANCE_MS) {
      fail(
        `${expected.label} 时间差超过2分钟: HAR ${harMatch.liveStartTime}~${harMatch.liveEndTime} vs DB ${dbStart}~${dbEnd}`,
      )
    } else {
      ok(`${expected.label} liveId=${harMatch.liveId} HAR/DB 时间一致 (${harMatch.liveStartTime}~${harMatch.liveEndTime})`)
    }
  }
}

async function crossCheckHarOrdersVsDb(
  dateKey: string,
  harOrders: HarOrderRow[],
  performanceViews: AnalyzedOrderView[],
): Promise<void> {
  section(`HAR 订单 vs DB ${dateKey}`)
  const dayOrders = dedupeHarOrders(harOrders.filter((o) => orderDay(o) === dateKey))
  const viewByOrderNo = new Map<string, AnalyzedOrderView>()
  for (const v of dedupeViewsByMetricOrderNo(performanceViews)) {
    const orderNo = resolveMetricOrderNo(v) || v.orderId
    if (orderNo) viewByOrderNo.set(orderNo, v)
  }

  for (const har of dayOrders) {
    const packageId = har.packageId || har.orderId
    const view = viewByOrderNo.get(packageId)
    const exists = Boolean(view)
    const anchor = view?.anchorName?.trim() || '—'
    const ex = view ? explainValidRevenueOrder(view) : null
    const validYuan = view ? (view.effectiveGmvCent / 100).toFixed(2) : '—'
    console.log(
      `  ${packageId} paidAt=${har.paidAt || har.orderedAt} status=${har.statusDesc || '—'} afterSale=${har.afterSaleStatusDesc || '—'}` +
        ` actualPaid=${har.actualPaid} receive=${har.actualSellerReceiveAmount} total=${har.totalOrderAmount}`,
    )
    console.log(
      `    DB存在=${exists ? '是' : '否'} 归属=${anchor} 有效成交=¥${validYuan} reason=${ex?.reason ?? '—'}`,
    )
    if (!exists) {
      fail(`HAR 订单 ${packageId} 在系统中不存在`)
    }
  }

  const focus2017 = dayOrders.find((o) => (o.packageId || o.orderId) === 'P798605049367374181')
  if (focus2017) {
    const view = viewByOrderNo.get('P798605049367374181')
    const ex = view ? explainValidRevenueOrder(view) : null
    const validOk = view && view.anchorName === '子杰' && ex?.valid === true && view.effectiveGmvCent === 201700
    if (validOk) {
      ok('P798605049367374181 归子杰且有效成交 ¥2017')
    } else {
      fail(
        `P798605049367374181 期望归子杰有效¥2017，实际 anchor=${view?.anchorName ?? '—'} valid=${ex?.valid ?? false} eff=${view?.effectiveGmvCent ?? 0}`,
      )
    }
  } else {
    warn('HAR 未包含 P798605049367374181（可能 HAR 翻页未抓全）')
  }

  const focus216 = dayOrders.find((o) => {
    const pid = o.packageId || o.orderId
    return Math.abs(o.actualPaid - 216) < 0.01 || (o.paidAt.includes('16:13:24') && Math.abs(o.actualPaid - 216) < 0.01)
  })
  if (focus216) {
    const pid = focus216.packageId || focus216.orderId
    const view = viewByOrderNo.get(pid)
    const ex = view ? explainValidRevenueOrder(view) : null
    const refundOk =
      view &&
      (view.anchorName === '小艺' || view.anchorName?.includes('小艺')) &&
      ex?.valid === false &&
      view.effectiveGmvCent === 0
    if (refundOk) {
      ok(`${pid} 归小艺，售后完成，有效成交 ¥0`)
    } else {
      fail(
        `${pid} 期望归小艺有效¥0，实际 anchor=${view?.anchorName ?? '—'} valid=${ex?.valid ?? false} eff=${view?.effectiveGmvCent ?? 0} reason=${ex?.reason ?? '—'}`,
      )
    }
  } else {
    warn('HAR 未包含 216 元小艺订单（和田雅玉 16:13:24）')
  }

  const missingInHar = [...viewByOrderNo.entries()].filter(([orderNo, view]) => {
    if (!view.includedInGmv) return false
    const payMs = parseViewPayTimeMs(view)
    const day =
      payMs != null
        ? formatDateTimeShanghai(new Date(payMs)).slice(0, 10)
        : (view.orderTimeText ?? '').slice(0, 10)
    if (day !== dateKey) return false
    return !dayOrders.some((h) => (h.packageId || h.orderId) === orderNo)
  })
  if (missingInHar.length > 0) {
    warn(`系统有 ${missingInHar.length} 单 ${dateKey} 支付订单未出现在 HAR（HAR 抓包可能不完整）`)
    for (const [orderNo, view] of missingInHar.slice(0, 10)) {
      console.log(
        `    仅 DB: ${orderNo} pay=${view.orderTimeText} anchor=${view.anchorName} ¥${(view.paymentBaseCent / 100).toFixed(2)}`,
      )
    }
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
  harBundle?: HarBundle
}): Promise<PostStreamCandidate[]> {
  const { label, preset, startDate, endDate, harBundle } = params
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

  if (harBundle && fs.existsSync(resolveHarDir(HAR_DIR)) && startDate === endDate) {
    const paidViews = dedupeViewsByMetricOrderNo(performanceViews).filter((v) => v.includedInGmv === true)
    if (paidViews.length === 0) {
      warn(
        `${startDate} 本地 DB 无该日支付订单，跳过 HAR vs DB 交叉核对（HAR 解析摘要仍有效；请用已同步至该日的库验收）`,
      )
    } else {
      await crossCheckHarLiveVsDb(startDate, harBundle.lives)
      await crossCheckHarOrdersVsDb(startDate, harBundle.orders, performanceViews)
    }
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

  const harDir = resolveHarDir(HAR_DIR)
  const harBundle = loadHarBundle(harDir)
  printHarSummary(harBundle, DATE_ENV)

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
    const found = await checkDateRange({ ...r, harBundle })
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
