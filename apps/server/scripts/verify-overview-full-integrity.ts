/**
 * 经营总览全链路数据严谨性验收（只读，不改数据库）
 *
 * 用法:
 *   DATE=2026-07-03 npm run verify:overview-full-integrity
 *   DATE=2026-07-02 npm run verify:overview-full-integrity
 *   HAR_DIR=./debug/har DATE=2026-07-03 npm run verify:overview-full-integrity
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { getQualityBadCasesSync } from '../src/services/quality-badcase-store.service'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import {
  buildBoardMetricDetail,
  type BoardMetricKey,
} from '../src/services/board-metric-detail.service'
import {
  calculateBusinessMetrics,
  pickMetricValue,
  viewCountsAsPaidOrder,
  viewCountsAsRefundOrder,
  isQualityRefundOrder,
} from '../src/services/business-metrics.service'
import { buildOrderMetricSets } from '../src/services/order-metric-sets.service'
import {
  explainValidRevenueOrder,
  isValidRevenueOrder,
  sumValidRevenueFromViews,
} from '../src/services/valid-revenue-order.service'
import {
  getBoardScopedViewsForRange,
  getAnchorPerformanceViews,
} from '../src/services/board-scoped-views.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { isEffectiveSignedView } from '../src/services/strict-after-sale-metrics.service'
import { buildBusinessRangeKey, resolveBusinessRange } from '../src/utils/business-range'
import { formatDateTimeShanghai } from '../src/utils/business-timezone'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import {
  loadAndAssignDailyReportLiveSessions,
  type DailyReportLiveSession,
} from '../src/services/daily-report-live-sessions.service'
import { parseDailyReportLiveSessionBounds } from '../src/services/anchor-live-session-order-attribution.service'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { orderLiveRoomMatchesSchedule } from '../src/utils/shop-name-normalize.util'
import {
  loadHarBundle,
  resolveHarDir,
  type HarOrderRow as HarOrderRowBasic,
} from './lib/har-platform-bundle'
import type { AnalyzedOrderView } from '../src/types/analysis'
import type { BoardMetricValueKey } from '../src/services/business-metrics.service'

config({ path: path.resolve(__dirname, '../.env') })

const DATE_ENV = process.env.DATE?.trim() || '2026-07-03'
const HAR_DIR_ENV = process.env.HAR_DIR?.trim()
const FOCUS_VALID_ORDER = 'P798605049367374181'
const FOCUS_EXCLUDED_ORDER = 'P798618403087295271'
const POST_STREAM_GRACE_MS = 30 * 60 * 1000
const LIVE_TIME_TOLERANCE_MS = 2 * 60 * 1000
const AMOUNT_TOLERANCE = 1

const FIXED_20260703 = {
  totalGmv: 13180.9,
  orderCount: 9,
  validSalesAmount: 2017,
  validOrderCount: 1,
} as const

const EXPECTED_HAR_LIVES_20260703 = [
  { label: '拾玉居', start: '2026-07-03 09:24:12', end: '2026-07-03 14:02:19' },
  { label: '和田雅玉早场', start: '2026-07-03 09:29:29', end: '2026-07-03 14:04:18' },
  { label: '和田雅玉下午场', start: '2026-07-03 14:21:09', end: '2026-07-03 17:52:13' },
] as const

const CARD_DRAWER_PAIRS: Array<{
  cardKey: string
  metric: BoardMetricKey
  valueKey: BoardMetricValueKey
  isRate?: boolean
  isCount?: boolean
}> = [
  { cardKey: 'totalGmv', metric: 'gmv', valueKey: 'gmv' },
  { cardKey: 'validSalesAmount', metric: 'effectiveGmv', valueKey: 'effectiveGmv' },
  { cardKey: 'orderCount', metric: 'orderCount', valueKey: 'orderCount', isCount: true },
  { cardKey: 'returnRate', metric: 'returnRate', valueKey: 'returnRate', isRate: true },
  { cardKey: 'qualityReturnCount', metric: 'qualityReturnCount', valueKey: 'qualityReturnCount', isCount: true },
  { cardKey: 'actualSignedAmount', metric: 'actualSignedAmount', valueKey: 'actualSignedAmount' },
  { cardKey: 'signedOrderCount', metric: 'signedCount', valueKey: 'signedCount', isCount: true },
  { cardKey: 'signRate', metric: 'signRate', valueKey: 'signRate', isRate: true },
  { cardKey: 'returnAmount', metric: 'returnAmount', valueKey: 'returnAmount' },
  { cardKey: 'returnCount', metric: 'returnCount', valueKey: 'returnCount', isCount: true },
]

const FORBIDDEN_UI_PHRASES = ['支付金额减退款', '成交减退款', '大额售后', '无大额售后']
const ALLOWED_VALID_SALES_PHRASES = [
  '已完成/已签收，且无在途售后、未成功退款的成交金额',
  '先筛有效成交订单池，再对池内订单成交金额求和，不是支付金额减退款',
]

const failures: string[] = []
const warnings: string[] = []

interface HarOrderRowExt extends HarOrderRowBasic {
  statusDesc: string
  afterSaleStatusDesc: string
  actualSellerReceiveAmount: number
  totalOrderAmount: number
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

function amountClose(a: number, b: number, tol = AMOUNT_TOLERANCE): boolean {
  return Math.abs(diffYuan(a, b)) <= tol
}

function rateClose(a: unknown, b: unknown): boolean {
  const na = a == null || a === '—' ? null : Number(a)
  const nb = b == null || b === '—' ? null : Number(b)
  if (na == null && nb == null) return true
  if (na == null || nb == null) return false
  return Math.abs(na - nb) < 1e-9
}

function countEq(a: unknown, b: unknown): boolean {
  return Math.round(num(a)) === Math.round(num(b))
}

function findViewByOrderNo(views: AnalyzedOrderView[], orderNo: string): AnalyzedOrderView | undefined {
  return dedupeViewsByMetricOrderNo(views).find(
    (v) => (resolveMetricOrderNo(v) || v.orderId) === orderNo,
  )
}

function matchMetricViewsForAudit(views: AnalyzedOrderView[], metric: BoardMetricKey): AnalyzedOrderView[] {
  switch (metric) {
    case 'gmv':
      return views.filter((v) => v.includedInGmv)
    case 'effectiveGmv':
      return dedupeViewsByMetricOrderNo(views.filter((v) => isValidRevenueOrder(v)))
    case 'actualSignedAmount':
    case 'signedCount':
    case 'signRate':
      return views.filter((v) => isEffectiveSignedView(v))
    case 'returnAmount':
    case 'returnCount':
    case 'returnRate':
      return views.filter((v) => viewCountsAsRefundOrder(v))
    case 'qualityReturnCount':
      return dedupeViewsByMetricOrderNo(views.filter((v) => isQualityRefundOrder(v)))
    case 'orderCount':
      return views.filter((v) => viewCountsAsPaidOrder(v))
    default:
      return views
  }
}

function decodeHarContentText(content: { text?: string; encoding?: string }): string {
  const text = content?.text ?? ''
  if (!text.trim()) return ''
  if (content.encoding === 'base64') return Buffer.from(text, 'base64').toString('utf-8')
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

function loadExtendedHarOrders(harDir: string): HarOrderRowExt[] {
  if (!fs.existsSync(harDir)) return []
  const rows: HarOrderRowExt[] = []
  for (const f of fs.readdirSync(harDir).filter((x) => x.endsWith('.har') && x.includes('订单'))) {
    const full = path.join(harDir, f)
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf-8')) as {
        log?: { entries?: Array<{ request?: { url?: string }; response?: { content?: { text?: string; encoding?: string } } }> }
      }
      for (const entry of parsed.log?.entries ?? []) {
        const url = entry.request?.url ?? ''
        if (!url.includes('/api/edith/fulfillment/order/page')) continue
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
            actualPaid: pickNum(pkg, ['actualPaid', 'actual_paid']) ?? 0,
            statusDesc: pickString(pkg, ['statusDesc', 'status_desc']),
            afterSaleStatusDesc: pickString(pkg, ['afterSaleStatusDesc', 'after_sale_status_desc']),
            actualSellerReceiveAmount:
              pickNum(pkg, ['actualSellerReceiveAmount', 'actual_seller_receive_amount']) ?? 0,
            totalOrderAmount: pickNum(pkg, ['totalOrderAmount', 'total_order_amount']) ?? 0,
            sourceFile: f,
            sourceShop: '',
          })
        }
      }
    } catch (err) {
      warn(`HAR 订单文件 ${f} 解析失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return rows
}

function orderDay(row: { paidAt: string; orderedAt: string }): string {
  return (row.paidAt || row.orderedAt).slice(0, 10) || 'unknown'
}

function parseDateTimeMs(text: string): number | null {
  const normalized = text.trim().replace('T', ' ')
  const ms = Date.parse(normalized.includes('+') ? normalized : `${normalized}+08:00`)
  return Number.isFinite(ms) ? ms : null
}

function checkUiCopy(): void {
  section('UI 文案静态检查')
  const overviewPath = path.resolve(__dirname, '../../web/src/pages/board/OverviewTab.tsx')
  const anchorPath = path.resolve(__dirname, '../../web/src/pages/board/AnchorPerformanceTab.tsx')
  for (const filePath of [overviewPath, anchorPath]) {
    if (!fs.existsSync(filePath)) {
      warn(`找不到 ${filePath}`)
      continue
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    const rel = path.basename(filePath)
    for (const phrase of FORBIDDEN_UI_PHRASES) {
      if (content.includes(phrase)) fail(`${rel} 含禁用文案「${phrase}」`)
    }
    if (rel === 'OverviewTab.tsx') {
      if (!content.includes('useState(true)') && !content.match(/moreMetricsOpen.*useState\(true\)/)) {
        fail('OverviewTab moreMetricsOpen 未保持默认 true')
      } else {
        ok('OverviewTab moreMetricsOpen 默认 true')
      }
      const hasAllowed = ALLOWED_VALID_SALES_PHRASES.some((p) => content.includes(p))
      if (!hasAllowed) warn('OverviewTab 未找到推荐的有效成交额 helper 文案')
      else ok('OverviewTab 有效成交额 helper 文案合规')
    }
  }
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
      count += 1
      break
    }
  }
  return count
}

async function checkHarSection(
  dateKey: string,
  views: AnalyzedOrderView[],
  harDir: string,
): Promise<void> {
  section('HAR 原始平台数据辅助核对')
  const bundle = loadHarBundle(harDir)
  for (const w of bundle.warnings) warn(w)

  if (bundle.orders.length === 0 && bundle.lives.length === 0) {
    warn('HAR 无数据或 HAR_DIR 不存在，跳过 HAR 交叉核对')
    return
  }

  const pkgIds = new Set(bundle.orders.map((o) => o.packageId || o.orderId).filter(Boolean))
  const liveIds = new Set(bundle.lives.map((l) => l.liveId).filter(Boolean))
  console.log(`HAR 订单条目: ${bundle.orders.length} / 去重 packageId: ${pkgIds.size}`)
  console.log(`HAR 直播条目: ${bundle.lives.length} / 去重 liveId: ${liveIds.size}`)

  const dayOrders = bundle.orders.filter((o) => orderDay(o) === dateKey)
  const dayPkgIds = new Set(dayOrders.map((o) => o.packageId || o.orderId).filter(Boolean))
  const dayLives = bundle.lives.filter((l) => l.liveStartTime.slice(0, 10) === dateKey)
  console.log(`${dateKey} HAR 订单: ${dayOrders.length} / 去重 ${dayPkgIds.size}`)
  console.log(`${dateKey} HAR 直播: ${dayLives.length}`)

  const extendedOrders = loadExtendedHarOrders(harDir)
  const viewByOrderNo = new Map<string, AnalyzedOrderView>()
  for (const v of dedupeViewsByMetricOrderNo(views)) {
    const orderNo = resolveMetricOrderNo(v) || v.orderId
    if (orderNo) viewByOrderNo.set(orderNo, v)
  }

  const paidOnDate = [...viewByOrderNo.entries()].filter(([, v]) => {
    if (!v.includedInGmv) return false
    const payMs = parseViewPayTimeMs(v)
    const day =
      payMs != null
        ? formatDateTimeShanghai(new Date(payMs)).slice(0, 10)
        : (v.orderTimeText ?? '').slice(0, 10)
    return day === dateKey
  })

  if (paidOnDate.length === 0) {
    warn(`${dateKey} 本地/当前 DB 无该日支付订单，HAR 交叉核对仅作摘要（不代表业务失败）`)
    return
  }

  const dayExtended = extendedOrders.filter((o) => orderDay(o) === dateKey)
  const dedupHar = new Map<string, HarOrderRowExt>()
  for (const row of dayExtended) {
    const key = row.packageId || row.orderId
    if (key) dedupHar.set(key, row)
  }

  for (const [, har] of dedupHar) {
    const packageId = har.packageId || har.orderId
    const view = viewByOrderNo.get(packageId)
    if (!view) {
      fail(`HAR 有订单 ${packageId} 但 DB 无对应记录`)
      continue
    }
  }

  for (const [orderNo] of paidOnDate) {
    if (!dedupHar.has(orderNo) && dayOrders.every((h) => (h.packageId || h.orderId) !== orderNo)) {
      warn(`DB 有支付订单 ${orderNo} 未出现在 HAR（抓包可能不完整）`)
    }
  }

  if (dateKey === '2026-07-03') {
    const har2017 = dedupHar.get(FOCUS_VALID_ORDER) ?? dayExtended.find((o) => (o.packageId || o.orderId) === FOCUS_VALID_ORDER)
    if (har2017) {
      const payOk = har2017.actualPaid === 2017 || Math.abs(har2017.actualPaid - 2017) < 0.01
      const timeOk = (har2017.paidAt || har2017.orderedAt).includes('12:32:40')
      const afterOk = !har2017.afterSaleStatusDesc || har2017.afterSaleStatusDesc === '—' || har2017.afterSaleStatusDesc.includes('无')
      if (payOk && timeOk) ok(`HAR ${FOCUS_VALID_ORDER} ¥2017 @12:32:40`)
      else warn(`HAR ${FOCUS_VALID_ORDER} 字段: paid=${har2017.actualPaid} time=${har2017.paidAt} afterSale=${har2017.afterSaleStatusDesc}`)
      const view = viewByOrderNo.get(FOCUS_VALID_ORDER)
      const ex = view ? explainValidRevenueOrder(view) : null
      if (view?.anchorName === '子杰' && ex?.valid && view.effectiveGmvCent === 201700) {
        ok(`系统 ${FOCUS_VALID_ORDER} 归子杰有效 ¥2017`)
      } else if (view) {
        fail(`${FOCUS_VALID_ORDER} 系统期望子杰/valid/¥2017，实际 anchor=${view.anchorName} valid=${ex?.valid} eff=${view.effectiveGmvCent}`)
      }
    } else {
      warn(`HAR 未包含 ${FOCUS_VALID_ORDER}`)
    }

    const har216 = [...dedupHar.values()].find(
      (o) =>
        (o.packageId || o.orderId) === FOCUS_EXCLUDED_ORDER ||
        (Math.abs(o.actualPaid - 216) < 0.01 && (o.paidAt || o.orderedAt).includes('16:13:24')),
    )
    if (har216) {
      const pid = har216.packageId || har216.orderId
      const view = viewByOrderNo.get(pid)
      const ex = view ? explainValidRevenueOrder(view) : null
      if (view && view.anchorName?.includes('小艺') && ex?.valid === false && view.effectiveGmvCent === 0) {
        ok(`HAR/系统 ${pid} 小艺售后完成有效 ¥0`)
      } else if (view) {
        fail(`${pid} 期望小艺 valid=false eff=0，实际 anchor=${view.anchorName} valid=${ex?.valid}`)
      }
    } else {
      warn(`HAR 未包含 ${FOCUS_EXCLUDED_ORDER} 或 216 元 16:13:24 订单`)
    }

    section('HAR 直播 vs DB 2026-07-03')
    const dayStart = new Date(`${dateKey}T00:00:00+08:00`)
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    const dbSessions = await prisma.xhsRawLiveSession.findMany({
      where: { startTime: { gte: dayStart, lt: dayEnd } },
      select: { liveId: true, startTime: true, endTime: true },
    })
    const harLives = bundle.lives.filter((l) => l.liveStartTime.slice(0, 10) === dateKey)
    for (const expected of EXPECTED_HAR_LIVES_20260703) {
      const harMatch = harLives.find((l) => {
        const startMs = parseDateTimeMs(l.liveStartTime)
        const expMs = parseDateTimeMs(expected.start)
        return startMs != null && expMs != null && Math.abs(startMs - expMs) <= LIVE_TIME_TOLERANCE_MS
      })
      if (!harMatch) {
        warn(`${expected.label} HAR 未找到 ${expected.start}`)
        continue
      }
      const db = dbSessions.find((s) => s.liveId === harMatch.liveId)
      if (!db?.startTime) {
        warn(`${expected.label} DB 缺少 liveId=${harMatch.liveId}`)
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
        warn(`${expected.label} 时间差>2min: HAR ${harMatch.liveStartTime}~${harMatch.liveEndTime} vs DB ${dbStart}~${dbEnd}`)
      } else {
        ok(`${expected.label} HAR/DB 时间一致`)
      }
    }
  }
}

async function checkLastMonthStable(): Promise<void> {
  section('lastMonth 稳定版机制（独立于 custom DATE）')
  const range = resolveBusinessRange('lastMonth')
  await buildAndSetBusinessBoardCache({ preset: 'lastMonth', ...range })
  const local = await executeBoardLocalQuery({ preset: 'lastMonth', ...range })
  const meta = local.overviewMeta
  const needsManualUpdate = meta?.stableVsLatest?.needsManualUpdate ?? false
  console.log(`  needsManualUpdate: ${needsManualUpdate}`)
  console.log(`  stableValidSalesAmount: ${meta?.stableVsLatest?.stableValidSalesAmount ?? '—'}`)
  console.log(`  latestValidSalesAmount: ${meta?.stableVsLatest?.latestValidSalesAmount ?? '—'}`)
  console.log(`  message: ${meta?.stableVsLatest?.message ?? '—'}`)

  const detail = await buildBoardMetricDetail({
    metric: 'effectiveGmv',
    preset: 'lastMonth',
    startDate: range.startDate,
    endDate: range.endDate,
    role: 'super_admin',
    username: 'verify-script',
    overviewStableSnapshot: needsManualUpdate,
  })

  if (needsManualUpdate) {
    if (!meta?.stableVsLatest?.message) fail('lastMonth needsManualUpdate 但缺少提示文案')
    else ok('lastMonth 稳定版差异提示已返回')
    if (!detail.overviewStableWarning) warn('lastMonth 稳定差异场景 metric-detail 缺少 overviewStableWarning')
    else ok('metric-detail 抽屉已标注稳定版/最新重算说明')
  } else {
    ok('lastMonth 当前展示与最新重算一致（或无稳定快照差异）')
  }
}

async function checkPresetBoundaries(): Promise<void> {
  section('日期 preset 边界（上海时间）')
  for (const preset of ['today', 'yesterday', 'thisMonth', 'lastMonth'] as const) {
    const range = resolveBusinessRange(preset)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(range.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(range.endDate)) {
      fail(`${preset} 日期格式无效`)
    } else {
      ok(`${preset}: ${range.startDate} ~ ${range.endDate}`)
    }
  }
}

async function auditDate(dateKey: string): Promise<Record<string, unknown>> {
  section(`经营总览 summary ${dateKey}`)
  await buildAndSetBusinessBoardCache({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })

  const expectedRangeKey = buildBusinessRangeKey('custom', dateKey, dateKey)
  if (local.source !== 'local_db') fail(`source 应为 local_db，实际 ${local.source}`)
  else ok('source=local_db')
  if (local.rangeKey !== expectedRangeKey) {
    fail(`rangeKey 应为 ${expectedRangeKey}，实际 ${local.rangeKey}`)
  } else {
    ok(`rangeKey=${local.rangeKey}`)
  }
  if (local.preset === 'lastMonth' || (local.overviewMeta?.stableSnapshot && dateKey !== local.endDate)) {
    warn('custom 查询不应携带 lastMonth 稳定快照污染')
  }

  const summary = (local.summary ?? {}) as Record<string, unknown>
  const metricsOut = {
    totalGmv: num(summary.totalGmv ?? summary.gmv),
    validSalesAmount: num(summary.validSalesAmount ?? summary.effectiveGmv),
    orderCount: num(summary.orderCount ?? summary.paidOrderCount),
    returnRate: summary.returnRate ?? summary.refundRate ?? null,
    qualityReturnCount: num(summary.qualityReturnCount),
    actualSignedAmount: num(summary.actualSignedAmount),
    signedOrderCount: num(summary.signedOrderCount ?? summary.actualSignedCount),
    signRate: summary.signRate ?? null,
    returnAmount: num(summary.returnAmount ?? summary.refundAmount),
    returnCount: num(summary.returnCount ?? summary.refundOrderCount),
  }

  console.log(`  totalGmv: ¥${metricsOut.totalGmv}`)
  console.log(`  validSalesAmount: ¥${metricsOut.validSalesAmount}`)
  console.log(`  orderCount: ${metricsOut.orderCount}`)
  console.log(`  returnRate: ${metricsOut.returnRate ?? '—'}`)
  console.log(`  qualityReturnCount: ${metricsOut.qualityReturnCount}`)
  console.log(`  actualSignedAmount: ¥${metricsOut.actualSignedAmount}`)
  console.log(`  signedOrderCount: ${metricsOut.signedOrderCount}`)
  console.log(`  signRate: ${metricsOut.signRate ?? '—'}`)
  console.log(`  returnAmount: ¥${metricsOut.returnAmount}`)
  console.log(`  returnCount: ${metricsOut.returnCount}`)

  section(`本地 DB 直接重算 ${dateKey}`)
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
    role: 'super_admin',
    username: 'verify-script',
  })
  const views = filterViewsForCoreMetrics(scoped.views)
  const metrics = calculateBusinessMetrics(views)
  const validPool = sumValidRevenueFromViews(views)
  const sets = buildOrderMetricSets(views, { scope: 'overview-full-integrity' }, getQualityBadCasesSync())

  const direct = {
    totalGmv: metrics.totalGmv,
    validSalesAmount: validPool.validAmountYuan,
    orderCount: metrics.orderCount,
    returnRate: metrics.refundRate,
    qualityReturnCount: metrics.qualityRefundOrderCount,
    actualSignedAmount: metrics.actualSignedAmount,
    signedOrderCount: metrics.signedOrderCount,
    signRate: metrics.signRate,
    returnAmount: metrics.refundAmount,
    returnCount: metrics.refundOrderCount,
    shippedOrderCount: metrics.shippedOrderCount,
  }

  console.log(`  直接重算 totalGmv: ¥${direct.totalGmv}`)
  console.log(`  直接重算 validSalesAmount: ¥${direct.validSalesAmount}`)
  console.log(`  直接重算 orderCount: ${direct.orderCount}`)
  console.log(`  buildOrderMetricSets.paidOrderCount: ${sets.paidOrderCount}`)

  const recalcPairs: Array<[string, number | null, number | null, boolean, boolean]> = [
    ['totalGmv', metricsOut.totalGmv, direct.totalGmv, true, false],
    ['validSalesAmount', metricsOut.validSalesAmount, direct.validSalesAmount, true, false],
    ['orderCount', metricsOut.orderCount, direct.orderCount, false, true],
    ['qualityReturnCount', metricsOut.qualityReturnCount, direct.qualityReturnCount, false, true],
    ['actualSignedAmount', metricsOut.actualSignedAmount, direct.actualSignedAmount, true, false],
    ['signedOrderCount', metricsOut.signedOrderCount, direct.signedOrderCount, false, true],
    ['returnAmount', metricsOut.returnAmount, direct.returnAmount, true, false],
    ['returnCount', metricsOut.returnCount, direct.returnCount, false, true],
  ]

  for (const [name, card, directVal, isAmount, isCount] of recalcPairs) {
    const a = card as number
    const b = directVal as number
    if (isAmount) {
      if (amountClose(a, b)) ok(`summary.${name} = 直接重算 (${a})`)
      else fail(`summary.${name} ¥${a} ≠ 直接重算 ¥${b}`)
    } else if (isCount) {
      if (countEq(a, b)) ok(`summary.${name} = 直接重算 (${a})`)
      else fail(`summary.${name} ${a} ≠ 直接重算 ${b}`)
    }
  }

  if (rateClose(metricsOut.returnRate, direct.returnRate)) ok(`summary.returnRate = 直接重算 (${metricsOut.returnRate})`)
  else fail(`summary.returnRate ${metricsOut.returnRate} ≠ 直接重算 ${direct.returnRate}`)

  if (rateClose(metricsOut.signRate, direct.signRate)) ok(`summary.signRate = 直接重算 (${metricsOut.signRate})`)
  else fail(`summary.signRate ${metricsOut.signRate} ≠ 直接重算 ${direct.signRate}`)

  if (!amountClose(metrics.validSalesAmount, validPool.validAmountYuan)) {
    fail(`calculateBusinessMetrics.validSalesAmount ≠ sumValidRevenueFromViews`)
  } else {
    ok('calculateBusinessMetrics 与 sumValidRevenueFromViews 一致')
  }

  section(`卡片 vs 抽屉 ${dateKey}`)
  for (const pair of CARD_DRAWER_PAIRS) {
    const cardVal =
      pair.cardKey === 'returnRate'
        ? metricsOut.returnRate
        : pair.cardKey === 'signRate'
          ? metricsOut.signRate
          : metricsOut[pair.cardKey as keyof typeof metricsOut]

    const detail = await buildBoardMetricDetail({
      metric: pair.metric,
      preset: 'custom',
      startDate: dateKey,
      endDate: dateKey,
      role: 'super_admin',
      username: 'verify-script',
      page: 1,
      pageSize: 5000,
    })
    const drawerVal = detail.summary?.valueRaw ?? detail.summary?.value

    if (pair.isRate) {
      const emptyRate =
        num(metricsOut.orderCount) === 0 &&
        (cardVal == null || cardVal === '—' || num(cardVal) === 0) &&
        (drawerVal == null || num(drawerVal) === 0)
      if (rateClose(cardVal, drawerVal) || emptyRate) {
        ok(`${pair.metric} 卡片=${cardVal ?? 0} 抽屉=${drawerVal ?? 0}${emptyRate ? '（无支付订单，null/0 等价）' : ''}`)
      } else fail(`${pair.metric} 卡片 ${cardVal} ≠ 抽屉 ${drawerVal}`)
    } else if (pair.isCount) {
      if (countEq(cardVal, drawerVal)) ok(`${pair.metric} 卡片=${cardVal} 抽屉=${drawerVal}`)
      else fail(`${pair.metric} 卡片 ${cardVal} ≠ 抽屉 ${drawerVal}`)
    } else {
      if (amountClose(num(cardVal), num(drawerVal))) ok(`${pair.metric} 卡片=¥${cardVal} 抽屉=¥${drawerVal}`)
      else fail(`${pair.metric} 卡片 ¥${cardVal} ≠ 抽屉 ¥${drawerVal}`)
    }

    const expectedFromTotals = pickMetricValue(metrics, pair.valueKey)
    if (pair.isRate) {
      if (!rateClose(drawerVal, expectedFromTotals)) {
        fail(`${pair.metric} 抽屉 valueRaw ${drawerVal} ≠ pickMetricValue(${expectedFromTotals})`)
      }
    } else if (pair.isCount) {
      if (!countEq(drawerVal, expectedFromTotals)) {
        fail(`${pair.metric} 抽屉 valueRaw ${drawerVal} ≠ pickMetricValue(${expectedFromTotals})`)
      }
    } else if (!amountClose(num(drawerVal), expectedFromTotals)) {
      fail(`${pair.metric} 抽屉 valueRaw ¥${drawerVal} ≠ pickMetricValue ¥${expectedFromTotals}`)
    }
  }

  section(`有效成交额抽屉订单池 ${dateKey}`)
  const effPool = matchMetricViewsForAudit(views, 'effectiveGmv')
  for (const v of effPool) {
    const ex = explainValidRevenueOrder(v)
    if (!ex.valid) {
      const orderNo = resolveMetricOrderNo(v) || v.orderId
      fail(`有效成交池含无效订单 ${orderNo}: ${ex.reason}`)
    }
  }
  if (effPool.length > 0 && effPool.every((v) => explainValidRevenueOrder(v).valid)) {
    ok(`有效成交池 ${effPool.length} 单均为 valid=true`)
  }

  const effDetail = await buildBoardMetricDetail({
    metric: 'effectiveGmv',
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
    role: 'super_admin',
    username: 'verify-script',
    page: 1,
    pageSize: 5000,
  })
  const effMatched = num(effDetail.summary?.matchedOrders)
  if (!countEq(effMatched, direct.shippedOrderCount)) {
    fail(`effectiveGmv matchedOrders ${effMatched} ≠ shippedOrderCount ${direct.shippedOrderCount}`)
  } else {
    ok(`effectiveGmv matchedOrders = ${effMatched}`)
  }

  if (dateKey === '2026-07-03') {
    section('固定验收 2026-07-03')
    if (paidOnDateHasData(metricsOut.orderCount)) {
      if (!amountClose(metricsOut.totalGmv, FIXED_20260703.totalGmv)) {
        fail(`支付金额应为 ¥${FIXED_20260703.totalGmv}，实际 ¥${metricsOut.totalGmv}`)
      } else ok(`支付金额 ¥${metricsOut.totalGmv}`)
      if (!countEq(metricsOut.orderCount, FIXED_20260703.orderCount)) {
        fail(`支付单数应为 ${FIXED_20260703.orderCount}，实际 ${metricsOut.orderCount}`)
      } else ok(`支付单数 ${metricsOut.orderCount}`)
      if (!amountClose(metricsOut.validSalesAmount, FIXED_20260703.validSalesAmount)) {
        fail(`有效成交额应为 ¥${FIXED_20260703.validSalesAmount}，实际 ¥${metricsOut.validSalesAmount}`)
      } else ok(`有效成交额 ¥${metricsOut.validSalesAmount}`)
      if (!countEq(effMatched, FIXED_20260703.validOrderCount)) {
        fail(`有效成交订单应为 ${FIXED_20260703.validOrderCount}，实际 ${effMatched}`)
      } else ok(`有效成交订单 ${effMatched} 单`)

      const rowIds = new Set(
        matchMetricViewsForAudit(views, 'effectiveGmv').map((v) => resolveMetricOrderNo(v) || v.orderId),
      )
      if (rowIds.has(FOCUS_VALID_ORDER)) ok(`${FOCUS_VALID_ORDER} 在有效成交额明细池`)
      else fail(`${FOCUS_VALID_ORDER} 不在有效成交额明细池`)
      if (rowIds.has(FOCUS_EXCLUDED_ORDER)) fail(`${FOCUS_EXCLUDED_ORDER} 不应在有效成交额默认明细`)
      else ok(`${FOCUS_EXCLUDED_ORDER} 不在有效成交额默认明细`)

      const v1 = findViewByOrderNo(views, FOCUS_VALID_ORDER)
      const v2 = findViewByOrderNo(views, FOCUS_EXCLUDED_ORDER)
      if (v1 && explainValidRevenueOrder(v1).valid) ok(`${FOCUS_VALID_ORDER} explain valid=true`)
      else if (v1) fail(`${FOCUS_VALID_ORDER} 应 valid=true`)
      else warn(`${FOCUS_VALID_ORDER} 不在 scoped views（本地 DB 可能无 7/3 数据）`)
      if (v2 && !explainValidRevenueOrder(v2).valid) ok(`${FOCUS_EXCLUDED_ORDER} explain valid=false`)
      else if (v2) fail(`${FOCUS_EXCLUDED_ORDER} 应 valid=false`)
      else warn(`${FOCUS_EXCLUDED_ORDER} 不在 scoped views`)
    } else {
      warn('本地 DB 无 2026-07-03 支付数据，跳过固定值断言（不代表生产失败）')
    }
  }

  section(`下播后30分钟未归属 ${dateKey}`)
  const perfViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const postStream = await detectPostStreamUnassigned(perfViews, dateKey)
  console.log(`  候选: ${postStream}`)
  if (dateKey === '2026-07-03' && paidOnDateHasData(metricsOut.orderCount)) {
    if (postStream !== 0) fail(`2026-07-03 下播后30分钟未归属应为 0，实际 ${postStream}`)
    else ok('下播后30分钟未归属 = 0')
  } else if (postStream === 0) {
    ok('未发现下播后30分钟未归属候选')
  } else {
    warn(`存在 ${postStream} 单下播后30分钟未归属候选`)
  }

  const harDir = resolveHarDir(HAR_DIR_ENV)
  if (fs.existsSync(harDir)) {
    await checkHarSection(dateKey, perfViews, harDir)
  }

  return metricsOut
}

function paidOnDateHasData(orderCount: number): boolean {
  return orderCount > 0
}

async function main(): Promise<void> {
  console.log('[verify:overview-full-integrity] 只读体检，不改数据库')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE_ENV)) {
    fail(`DATE 格式无效: ${DATE_ENV}`)
    process.exit(1)
  }

  await bootstrapQualityBadCaseCache()
  checkUiCopy()
  await checkPresetBoundaries()
  await auditDate(DATE_ENV)
  await checkLastMonthStable()

  section('汇总')
  console.log(`DATE: ${DATE_ENV}`)
  console.log(`warnings: ${warnings.length}`)
  console.log(`failures: ${failures.length}`)
  for (const w of warnings) console.log(`  ⚠ ${w}`)
  for (const f of failures) console.log(`  ✗ ${f}`)

  if (failures.length > 0) {
    console.log('\nverify:overview-full-integrity FAIL')
    process.exit(1)
  }
  console.log('\nverify:overview-full-integrity OK')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
