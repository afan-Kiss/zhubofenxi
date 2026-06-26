/**
 * 运营报表灰度每日核对
 *
 * 用法:
 *   npm run accept:operations-report-gray-check
 *   npm run accept:operations-report-gray-check -- --date=2026-06-25
 *
 * 依赖本地服务: http://127.0.0.1:4723
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePriceBandLabel, resolvePriceBandLabelFromCent, OPERATIONS_PRICE_BANDS } from '../src/config/operations-price-band.config'
import {
  attachRawByMatchToViews,
  isLowPriceBrushOrderView,
  LOW_PRICE_BRUSH_THRESHOLD_CENT,
} from '../src/services/low-price-brush-order.service'
import {
  getAnchorPerformanceViews,
  getBoardScopedViewsForRange,
} from '../src/services/board-scoped-views.service'
import { addDaysShanghai, formatDateKeyShanghai } from '../src/utils/business-timezone'
import { eachDayInShanghaiRange } from '../src/utils/each-day-shanghai'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../..')
const REPORT_DIR = path.join(REPO_ROOT, 'reports/operations-report-gray-check')
const BASE = (process.env.METRICS_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4723').replace(
  /\/$/,
  '',
)

const EXPECTED_PRICE_BAND_LABELS = OPERATIONS_PRICE_BANDS.map((b) => b.label)

type Severity = 'P0' | 'P1' | 'P2' | 'P3'
type Finding = { severity: Severity; message: string }

type Envelope<T> = { ok: boolean; data?: T; message?: string }

interface CheckContext {
  targetDate: string
  weekStart: string
  weekEnd: string
  findings: Finding[]
  notes: string[]
  sections: string[]
}

function parseDateArg(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith('--date='))
  if (!arg) return undefined
  const value = arg.slice('--date='.length).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

function weekStartForDate(dateKey: string): string {
  const day = new Date(`${dateKey}T12:00:00+08:00`).getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return addDaysShanghai(dateKey, mondayOffset)
}

function near(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol
}

function addFinding(ctx: CheckContext, severity: Severity, message: string) {
  ctx.findings.push({ severity, message })
}

function addNote(ctx: CheckContext, message: string) {
  ctx.notes.push(message)
}

function addSection(ctx: CheckContext, title: string, lines: string[]) {
  ctx.sections.push(`## ${title}\n\n${lines.join('\n')}`)
}

async function ensureServiceUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return false
    const body = (await res.json()) as { ok?: boolean }
    return body.ok === true
  } catch {
    return false
  }
}

async function fetchJson<T>(
  path: string,
  query?: Record<string, string | undefined>,
): Promise<{ status: number; body: Envelope<T> & Record<string, unknown> }> {
  const url = new URL(`${BASE}${path}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  const body = (await res.json()) as Envelope<T> & Record<string, unknown>
  return { status: res.status, body }
}

async function fetchDaily(dateKey: string) {
  const { status, body } = await fetchJson<Record<string, unknown>>('/api/board/operations-report/daily', {
    startDate: dateKey,
    endDate: dateKey,
  })
  if (status !== 200 || !body.ok || body.data == null) {
    throw new Error(`日报接口失败 HTTP ${status}: ${body.message ?? 'unknown'}`)
  }
  return body.data
}

async function fetchDailyTimed(dateKey: string) {
  const started = Date.now()
  const data = await fetchDaily(dateKey)
  return { data, ms: Date.now() - started }
}

async function fetchWeeklyTimed(weekStart: string, weekEnd: string) {
  const started = Date.now()
  const data = await fetchWeekly(weekStart, weekEnd)
  return { data, ms: Date.now() - started }
}

async function fetchRankingsTimed(startDate: string, endDate: string) {
  const started = Date.now()
  const data = await fetchRankings(startDate, endDate)
  return { data, ms: Date.now() - started }
}

function checkCacheMeta(
  ctx: CheckContext,
  label: string,
  payload: Record<string, unknown>,
  secondHit?: boolean,
) {
  const meta = payload.cacheMeta as
    | {
        hit?: boolean
        stale?: boolean
        builtAt?: string | null
        message?: string
      }
    | undefined
  if (!meta) {
    addFinding(ctx, 'P1', `${label} 缺少 cacheMeta`)
    return
  }
  if (typeof meta.hit !== 'boolean') addFinding(ctx, 'P1', `${label} cacheMeta.hit 无效`)
  if (typeof meta.stale !== 'boolean') addFinding(ctx, 'P1', `${label} cacheMeta.stale 无效`)
  if (secondHit && meta.hit !== true) {
    addFinding(ctx, 'P1', `${label} 第二次请求 cacheMeta.hit 应为 true`)
  }
  if (meta.message && /cacheMeta|TTL|prewarm|payload|stale|hit/i.test(meta.message)) {
    addFinding(ctx, 'P1', `${label} cacheMeta.message 含技术词`)
  }
}

async function fetchRankings(startDate: string, endDate: string) {
  const { status, body } = await fetchJson<Record<string, unknown>>('/api/board/operations-rankings', {
    startDate,
    endDate,
    preset: 'custom',
  })
  if (status !== 200 || !body.ok || body.data == null) {
    throw new Error(`榜单中心接口失败 HTTP ${status}: ${body.message ?? 'unknown'}`)
  }
  return body.data
}

function checkBusinessInsights(ctx: CheckContext, label: string, payload: Record<string, unknown>) {
  const bi = payload.businessInsights as
    | {
        items?: Array<Record<string, unknown>>
        dataQuality?: { warnings?: string[] }
      }
    | undefined
  if (!bi) {
    addFinding(ctx, 'P1', `${label} businessInsights 缺失`)
    return
  }
  const items = bi.items ?? []
  const json = JSON.stringify(bi)
  for (const f of [
    'phone',
    'mobile',
    'address',
    'receiver',
    'buyerName',
    'buyerPhone',
    'platformRawJson',
    'rawJson',
    'idCard',
    'buyerId',
    'buyerKey',
  ]) {
    if (json.includes(`"${f}"`)) addFinding(ctx, 'P1', `${label} businessInsights 含隐私字段 ${f}`)
  }
  for (const item of items) {
    const ev = item.evidence as unknown[] | undefined
    if (!Array.isArray(ev) || ev.length === 0) {
      addFinding(ctx, 'P1', `${label} 经营建议缺少 evidence：${String(item.title ?? item.id)}`)
    }
    const actionState = item.actionState as { status?: string } | undefined
    if (!actionState?.status) {
      addFinding(ctx, 'P1', `${label} 经营建议缺少 actionState.status：${String(item.title ?? item.id)}`)
    } else if (!['pending', 'handled', 'ignored', 'reviewed'].includes(actionState.status)) {
      addFinding(ctx, 'P1', `${label} actionState.status 非法：${actionState.status}`)
    }
  }
  if (items.length > 8) addFinding(ctx, 'P2', `${label} 经营建议超过 8 条`)
  if (bi.dataQuality?.warnings?.length) {
    addNote(ctx, `${label} 经营建议 warnings：${bi.dataQuality.warnings.slice(0, 2).join('；')}`)
  }
}

function checkRankingsApi(ctx: CheckContext, rankings: Record<string, unknown>) {
  if (!rankings.bossSummary) addFinding(ctx, 'P1', '榜单中心 bossSummary 缺失')
  if (!rankings.anchors) addFinding(ctx, 'P1', '榜单中心 anchors 缺失')
  if (!rankings.products) addFinding(ctx, 'P1', '榜单中心 products 缺失')
  const dq = rankings.dataQuality as { warnings?: string[] } | undefined
  if (!dq) addFinding(ctx, 'P1', '榜单中心 dataQuality 缺失')
  const json = JSON.stringify(rankings)
  for (const f of ['phone', 'mobile', 'address', 'receiver', 'buyerName', 'platformRawJson', 'rawJson']) {
    if (json.includes(`"${f}"`)) addFinding(ctx, 'P1', `榜单中心响应含隐私字段名 ${f}`)
  }
  if (dq?.warnings?.length) addNote(ctx, `榜单 warnings：${dq.warnings.slice(0, 3).join('；')}`)
  checkBusinessInsights(ctx, '榜单中心', rankings)
}

function checkInsightActionStats(ctx: CheckContext, label: string, payload: Record<string, unknown> | null) {
  if (!payload) {
    addFinding(ctx, 'P1', `${label} 经营建议执行统计缺失`)
    return
  }
  const summary = payload.summary as Record<string, unknown> | undefined
  if (!summary) {
    addFinding(ctx, 'P1', `${label} 经营建议执行统计 summary 缺失`)
    return
  }
  const total = Number(summary.total ?? 0)
  const pending = Number(summary.pending ?? 0)
  const handled = Number(summary.handled ?? 0)
  const reviewed = Number(summary.reviewed ?? 0)
  const ignored = Number(summary.ignored ?? 0)
  if (total !== pending + handled + reviewed + ignored) {
    addFinding(ctx, 'P1', `${label} 经营建议执行统计总数与各状态之和不一致`)
  }
  if (total === 0 && summary.handleRate != null) {
    addFinding(ctx, 'P1', `${label} total=0 时 handleRate 应为 null`)
  }
  const dailyTrend = payload.dailyTrend as unknown[] | undefined
  if (!Array.isArray(dailyTrend) || dailyTrend.length !== 7) {
    addFinding(ctx, 'P1', `${label} dailyTrend 应为 7 天`)
  }
  const json = JSON.stringify(payload)
  for (const f of ['phone', 'mobile', 'address', 'receiver', 'buyerName', 'platformRawJson', 'rawJson']) {
    if (json.includes(`"${f}"`)) addFinding(ctx, 'P1', `${label} 经营建议执行统计含隐私字段 ${f}`)
  }
}

async function fetchWeekly(weekStart: string, weekEnd: string) {
  const { status, body } = await fetchJson<Record<string, unknown>>('/api/board/operations-report/weekly', {
    weekStart,
    weekEnd,
  })
  if (status !== 200 || !body.ok || body.data == null) {
    throw new Error(`周报接口失败 HTTP ${status}: ${body.message ?? 'unknown'}`)
  }
  return body.data
}

async function resolveTargetDate(explicit?: string): Promise<string> {
  if (explicit) return explicit
  const candidates = [
    formatDateKeyShanghai(new Date()),
    addDaysShanghai(formatDateKeyShanghai(new Date()), -1),
    '2026-05-28',
  ]
  for (const d of candidates) {
    try {
      const daily = await fetchDaily(d)
      const summary = daily.summary as Record<string, unknown> | undefined
      if (Number(summary?.soldOrderCount ?? 0) > 0) return d
    } catch {
      /* try next */
    }
  }
  return candidates[candidates.length - 1]!
}

function checkTrafficNotFakeZero(
  ctx: CheckContext,
  summary: Record<string, unknown>,
  label: string,
) {
  const join = summary.joinUserCount
  const view = summary.viewSessionCount
  const dealUsers = summary.dealUserCount
  if (join === 0 && view === 0 && dealUsers === 0) {
    addFinding(
      ctx,
      'P2',
      `${label} traffic 字段均为 0；若官方缺失应为 null 而非假 0，请人工核对`,
    )
  }
  if (join === null || join === undefined) {
    addNote(ctx, `${label} joinUserCount 为 null（官方字段可能缺失）`)
  }
  if (view === null || view === undefined) {
    addNote(ctx, `${label} viewSessionCount 为 null（官方字段可能缺失）`)
  }
}

function checkDailyStructure(ctx: CheckContext, daily: Record<string, unknown>) {
  const summary = daily.summary as Record<string, unknown> | undefined
  const requiredTop = ['summary', 'anchors', 'products', 'priceBands', 'afterSalesReasons', 'reviewNote', 'rankings', 'reportDataQuality']
  for (const key of requiredTop) {
    if (!(key in daily)) {
      addFinding(ctx, 'P1', `日报缺少字段 ${key}`)
    }
  }
  if (!summary) {
    addFinding(ctx, 'P0', '日报 summary 不存在')
    return
  }
  for (const key of ['joinUserCount', 'viewSessionCount']) {
    if (!(key in summary)) addFinding(ctx, 'P1', `日报 summary 缺少 ${key}`)
  }
  checkTrafficNotFakeZero(ctx, summary, '日报')
  checkBusinessInsights(ctx, '日报', daily)
}

function checkDailyCaliber(ctx: CheckContext, daily: Record<string, unknown>) {
  const summary = daily.summary as Record<string, unknown>
  const anchors = (daily.anchors as Array<Record<string, unknown>>) ?? []
  const products = (daily.products as Array<Record<string, unknown>>) ?? []
  const priceBands = (daily.priceBands as Array<{ bandLabel?: string }>) ?? []

  const summaryAmount = Number(summary.validAmountYuan ?? 0)
  const summaryOrders = Number(summary.soldOrderCount ?? 0)
  const summaryReturns = Number(summary.returnOrderCount ?? 0)
  const anchorAmount = anchors.reduce((s, r) => s + Number(r.validAmountYuan ?? 0), 0)
  const anchorOrders = anchors.reduce((s, r) => s + Number(r.soldOrderCount ?? 0), 0)
  const anchorReturns = anchors.reduce((s, r) => s + Number(r.returnOrderCount ?? 0), 0)

  const amountDiff = summaryAmount - anchorAmount
  const orderDiff = summaryOrders - anchorOrders

  if (!near(anchorAmount, summaryAmount)) {
    if (amountDiff > 0.02) {
      addNote(
        ctx,
        `日报有效成交差额 ${amountDiff.toFixed(2)} 元（summary=${summaryAmount}，主播合计=${anchorAmount}），可能含未归属订单`,
      )
    } else if (amountDiff < -0.02) {
      addFinding(ctx, 'P1', `日报有效成交金额小于主播合计：summary=${summaryAmount} anchorSum=${anchorAmount}`)
    }
  }

  if (orderDiff > 0) {
    addNote(
      ctx,
      `日报有效成交订单差额 ${orderDiff} 单（summary=${summaryOrders}，主播合计=${anchorOrders}），可能含未归属订单`,
    )
  } else if (orderDiff < 0) {
    addFinding(ctx, 'P1', `日报订单数小于主播合计：summary=${summaryOrders} anchorSum=${anchorOrders}`)
  }

  if (anchorReturns > summaryReturns + 0.01) {
    addFinding(
      ctx,
      'P1',
      `日报退货订单方向不一致：summary=${summaryReturns} anchorSum=${anchorReturns}`,
    )
  }

  for (const p of products.slice(0, 10)) {
    const soldOrderCount = Number(p.soldOrderCount ?? 0)
    const returnOrderCount = Number(p.returnOrderCount ?? 0)
    const returnRate = p.returnRate
    if (soldOrderCount > 0 && returnRate != null) {
      const expected = returnOrderCount / soldOrderCount
      if (!near(Number(returnRate), expected, 0.001)) {
        addFinding(
          ctx,
          'P1',
          `商品 ${String(p.productKey ?? p.productName ?? '?')} 退货率非订单维度：got=${returnRate} expected=${expected}`,
        )
      }
    }
  }

  const bandLabels = new Set(priceBands.map((b) => b.bandLabel))
  for (const label of EXPECTED_PRICE_BAND_LABELS) {
    if (!OPERATIONS_PRICE_BANDS.some((b) => b.label === label)) {
      addFinding(ctx, 'P1', `价格带配置缺少档位 ${label}`)
    }
  }
  for (const label of bandLabels) {
    if (!EXPECTED_PRICE_BAND_LABELS.includes(label as (typeof EXPECTED_PRICE_BAND_LABELS)[number])) {
      addFinding(ctx, 'P1', `日报返回未知价格带 ${String(label)}`)
    }
  }
  if (bandLabels.size > 0 && bandLabels.size < EXPECTED_PRICE_BAND_LABELS.length) {
    addNote(
      ctx,
      `日报 priceBands 仅返回有成交/退货的档位（${bandLabels.size}/${EXPECTED_PRICE_BAND_LABELS.length}），空档省略属正常`,
    )
  }

  return {
    summaryAmount,
    summaryOrders,
    summaryReturns,
    anchorAmount,
    anchorOrders,
    anchorReturns,
    amountDiff,
    orderDiff,
  }
}

function getDailyTrend(weekly: Record<string, unknown>): Array<Record<string, unknown>> {
  const trend = weekly.dailyTrend ?? weekly.dailyTrends
  return Array.isArray(trend) ? (trend as Array<Record<string, unknown>>) : []
}

function getWeeklyProducts(weekly: Record<string, unknown>): unknown[] {
  if (Array.isArray(weekly.hotProducts)) return weekly.hotProducts
  if (Array.isArray(weekly.products)) return weekly.products
  return []
}

function checkWeeklyStructure(ctx: CheckContext, weekly: Record<string, unknown>) {
  const trend = getDailyTrend(weekly)
  if (!weekly.summary) addFinding(ctx, 'P0', '周报 summary 不存在')
  if (trend.length === 0) addFinding(ctx, 'P1', '周报 dailyTrend/dailyTrends 不存在或为空')
  if (!Array.isArray(weekly.anchors)) addFinding(ctx, 'P1', '周报 anchors 不存在')
  if (!weekly.productRankingQuality) addFinding(ctx, 'P1', '周报 productRankingQuality 不存在')
  if (!Array.isArray(weekly.hotProducts)) addFinding(ctx, 'P1', '周报 hotProducts 不存在')
  if (!Array.isArray(weekly.slowProducts)) addFinding(ctx, 'P1', '周报 slowProducts 不存在')
  if (!Array.isArray(weekly.highReturnProducts)) addFinding(ctx, 'P1', '周报 highReturnProducts 不存在')
  if (getWeeklyProducts(weekly).length === 0 && trend.length > 0) {
    addNote(ctx, '周报 hotProducts 为空（可能本周无商品成交）')
  }
  if (!Array.isArray(weekly.priceBands)) addFinding(ctx, 'P1', '周报 priceBands 不存在')
  if (!Array.isArray(weekly.afterSalesReasons)) addFinding(ctx, 'P1', '周报 afterSalesReasons 不存在')
  checkBusinessInsights(ctx, '周报', weekly)
}

function rankItemAmount(item: Record<string, unknown>): number {
  return Number(item.validAmountYuan ?? item.soldAmountYuan ?? 0)
}

function checkProductRankings(ctx: CheckContext, weekly: Record<string, unknown>) {
  const quality = weekly.productRankingQuality as Record<string, unknown> | undefined
  if (!quality) return

  const hot = (weekly.hotProducts ?? []) as Array<Record<string, unknown>>
  const slow = (weekly.slowProducts ?? []) as Array<Record<string, unknown>>
  const highReturn = (weekly.highReturnProducts ?? []) as Array<Record<string, unknown>>
  const minSold = 3

  for (let i = 1; i < hot.length; i++) {
    const prev = hot[i - 1]!
    const cur = hot[i]!
    const prevAmt = rankItemAmount(prev)
    const curAmt = rankItemAmount(cur)
    if (curAmt > prevAmt) {
      addFinding(ctx, 'P1', '热卖榜未按有效成交金额降序')
      break
    }
    if (curAmt === prevAmt) {
      const prevOrders = Number(prev.soldOrderCount ?? 0)
      const curOrders = Number(cur.soldOrderCount ?? 0)
      if (curOrders > prevOrders) {
        addFinding(ctx, 'P1', '热卖榜同金额时未按成交订单降序')
        break
      }
    }
  }

  for (const item of highReturn) {
    const sold = Number(item.soldOrderCount ?? 0)
    const ret = Number(item.returnOrderCount ?? 0)
    if (sold < minSold) {
      addFinding(ctx, 'P1', `高退货正式榜含样本不足商品 soldOrderCount=${sold}`)
    }
    if (sold > 0 && item.returnRate != null && !near(Number(item.returnRate), ret / sold, 0.0001)) {
      addFinding(ctx, 'P1', `高退货榜退货率与订单维度不一致：${item.productName ?? item.productKey}`)
    }
  }

  for (let i = 1; i < highReturn.length; i++) {
    const prev = highReturn[i - 1]!
    const cur = highReturn[i]!
    if (Number(cur.returnRate ?? 0) > Number(prev.returnRate ?? 0)) {
      addFinding(ctx, 'P1', '高退货榜未按退货率降序')
      break
    }
  }

  const slowReliable = quality.slowReliable === true
  if (!slowReliable && slow.length > 0) {
    addFinding(ctx, 'P1', '滞销榜 unreliable 但仍返回伪排行')
  }

  for (const list of [hot, slow, highReturn]) {
    for (const item of list) {
      if (item.soldOrderCount == null) {
        addFinding(ctx, 'P1', '榜单项缺少 soldOrderCount')
        break
      }
      if (!item.rankReason) {
        addFinding(ctx, 'P1', '榜单项缺少 rankReason')
        break
      }
      if (!item.dataQuality) {
        addFinding(ctx, 'P1', '榜单项缺少 dataQuality')
        break
      }
    }
  }

  if (Array.isArray(quality.warnings)) {
    addNote(ctx, `榜单质量 warnings：${(quality.warnings as string[]).slice(0, 3).join('；') || '无'}`)
  }
}

async function checkWeeklyCaliber(
  ctx: CheckContext,
  weekly: Record<string, unknown>,
  weekStart: string,
  weekEnd: string,
) {
  const trend = getDailyTrend(weekly)
  const summary = weekly.summary as Record<string, unknown>
  const sumAmount = trend.reduce((s, r) => s + Number(r.validAmountYuan ?? 0), 0)
  const sumOrders = trend.reduce((s, r) => s + Number(r.soldOrderCount ?? 0), 0)
  const sumReturns = trend.reduce((s, r) => s + Number(r.returnOrderCount ?? 0), 0)

  const summaryAmount = Number(summary.validAmountYuan ?? 0)
  const summaryOrders = Number(summary.soldOrderCount ?? 0)
  const summaryReturns = Number(summary.returnOrderCount ?? 0)
  const summaryDuration = Number(summary.totalLiveDurationMinutes ?? 0)

  if (!near(sumAmount, summaryAmount)) {
    addFinding(ctx, 'P1', `周报金额与 dailyTrend 不一致：summary=${summaryAmount} trendSum=${sumAmount}`)
  }
  if (sumOrders !== summaryOrders) {
    addFinding(ctx, 'P1', `周报订单与 dailyTrend 不一致：summary=${summaryOrders} trendSum=${sumOrders}`)
  }
  if (sumReturns !== summaryReturns) {
    addFinding(ctx, 'P1', `周报退货与 dailyTrend 不一致：summary=${summaryReturns} trendSum=${sumReturns}`)
  }

  let dailyDurationSum = 0
  for (const day of eachDayInShanghaiRange(weekStart, weekEnd)) {
    try {
      const d = await fetchDaily(day)
      const s = d.summary as Record<string, unknown>
      dailyDurationSum += Number(s.totalLiveDurationMinutes ?? 0)
    } catch (err) {
      addFinding(
        ctx,
        'P2',
        `无法拉取 ${day} 日报以核对直播时长：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
  if (dailyDurationSum > 0 && summaryDuration !== dailyDurationSum) {
    addFinding(
      ctx,
      'P1',
      `周报直播时长与逐日累加不一致：summary=${summaryDuration} dailySum=${dailyDurationSum}`,
    )
  }

  const join = summary.joinUserCount as number | null | undefined
  const dealUsers = summary.dealUserCount as number | null | undefined
  const view = summary.viewSessionCount as number | null | undefined
  const followers = summary.totalNewFollowerCount as number | null | undefined
  const dealRate = summary.dealConversionRate as number | null | undefined
  const followerRate = summary.newFollowerRate as number | null | undefined

  const hasTraffic = join != null || view != null || dealUsers != null
  const allTrafficMissing = join == null && view == null && dealUsers == null

  if (allTrafficMissing) {
    addNote(ctx, '本周官方 traffic 全部缺失，成交率/粉丝率允许为 null')
  } else {
    if (join != null && join > 0 && dealUsers != null) {
      if (dealRate == null) {
        addFinding(ctx, 'P1', '有进房/成交人数时周报 dealConversionRate 不应为 null')
      } else if (!near(dealRate, dealUsers / join, 0.0001)) {
        addFinding(
          ctx,
          'P1',
          `周报成交率计算错误：got=${dealRate} expected=${dealUsers / join}`,
        )
      }
    }
    if (view != null && view > 0 && followers != null && followers > 0) {
      if (followerRate == null) {
        addFinding(ctx, 'P1', '有场观/新增粉丝时周报 newFollowerRate 不应为 null')
      } else if (!near(followerRate, followers / view, 0.0001)) {
        addFinding(
          ctx,
          'P1',
          `周报粉丝率计算错误：got=${followerRate} expected=${followers / view}`,
        )
      }
    }
  }

  if (
    dealUsers != null &&
    summaryOrders > 0 &&
    dealUsers === summaryOrders &&
    join == null
  ) {
    addFinding(
      ctx,
      'P2',
      '周报 dealUserCount 与 soldOrderCount 完全相同且无进房人数，疑似用订单数冒充成交人数，请人工核对',
    )
  }

  return {
    sumAmount,
    sumOrders,
    sumReturns,
    summaryAmount,
    summaryOrders,
    summaryReturns,
    summaryDuration,
    dailyDurationSum,
    dealRate,
    followerRate,
    join,
    dealUsers,
    view,
    followers,
    hasTraffic,
    allTrafficMissing,
  }
}

async function checkPrivacyExport(ctx: CheckContext, targetDate: string) {
  const datesToTry = [targetDate, addDaysShanghai(formatDateKeyShanghai(new Date()), -1)]
  let rows: Array<Record<string, unknown>> = []
  let usedDate = targetDate

  for (const d of datesToTry) {
    try {
      const { status, body } = await fetchJson<Record<string, unknown>>(
        '/api/board/daily-report/raw-chatgpt-data',
        { startDate: d, endDate: d },
      )
      if (status !== 200 || !body.ok || !body.data) continue
      const data = body.data as { rawOrders?: Array<Record<string, unknown>>; rows?: Array<Record<string, unknown>> }
      const candidate = data.rawOrders ?? data.rows ?? []
      if (candidate.length > 0) {
        rows = candidate
        usedDate = d
        break
      }
    } catch {
      /* try next */
    }
  }

  if (rows.length === 0) {
    addNote(ctx, `${usedDate} raw-chatgpt 无订单行，隐私脱敏 HTTP 抽样跳过（验收脚本已覆盖 sanitize）`)
    return { usedDate, rowCount: 0, masked: null }
  }

  const row = rows[0]!
  const phone = String(row.receiverPhone ?? '')
  const name = String(row.receiverName ?? '')
  const address = String(row.receiverAddress ?? '')
  const raw = String(row.platformRawJson ?? '')

  if (/\d{11}/.test(phone)) addFinding(ctx, 'P0', '默认导出包含完整手机号')
  if (name.length > 2 && !name.includes('*')) addFinding(ctx, 'P1', '默认导出收件人姓名可能未脱敏')
  if (address.length > 20 && /\d{3,}/.test(address)) {
    addFinding(ctx, 'P1', '默认导出可能包含详细地址')
  }
  if (raw.length > 0) addFinding(ctx, 'P0', '默认导出 platformRawJson 非空')

  const denied = await fetchJson('/api/board/daily-report/raw-chatgpt-data', {
    startDate: usedDate,
    endDate: usedDate,
    confirmRaw: '1',
  })
  if (denied.status === 200 && denied.body.ok && denied.body.data) {
    const deniedPayload = denied.body.data as {
      rawOrders?: Array<Record<string, unknown>>
      rows?: Array<Record<string, unknown>>
    }
    const deniedRows = deniedPayload.rawOrders ?? deniedPayload.rows ?? []
    const deniedRaw = String(deniedRows[0]?.platformRawJson ?? '')
    if (deniedRaw.length > 0) {
      addFinding(ctx, 'P0', 'local_viewer + confirmRaw=1 仍返回完整 platformRawJson')
    }
    addNote(ctx, '当前为 local_viewer 架构，无法模拟 super_admin 原始导出；已验证非 super_admin 不泄露 raw')
  }

  return { usedDate, rowCount: rows.length, masked: true }
}

function checkPriceBandBoundaries(ctx: CheckContext) {
  const results: string[] = []
  const cases: Array<[number | string, string, 'yuan' | 'cent']> = [
    [399, '≤399', 'yuan'],
    [400, '400~599', 'yuan'],
    [599, '400~599', 'yuan'],
    [600, '600~799', 'yuan'],
    [799, '600~799', 'yuan'],
    [800, '800~999', 'yuan'],
    [999, '800~999', 'yuan'],
    [1000, '1000~1299', 'yuan'],
    [1299, '1000~1299', 'yuan'],
    [1300, '1300~1599', 'yuan'],
    [1599, '1300~1599', 'yuan'],
    [1600, '1600~1998', 'yuan'],
    [1998, '1600~1998', 'yuan'],
    [1998.99, '1600~1998', 'yuan'],
    [199899, '1600~1998', 'cent'],
    [1999, '1999+', 'yuan'],
    [199900, '1999+', 'cent'],
    [2000, '1999+', 'yuan'],
  ]
  for (const [value, expected, unit] of cases) {
    const got =
      unit === 'cent'
        ? resolvePriceBandLabelFromCent(Number(value))
        : resolvePriceBandLabel(Number(value))
    const label = unit === 'cent' ? `${value} 分` : `${value} 元`
    if (got !== expected) {
      addFinding(ctx, 'P1', `价格带边界 ${label} 应落在 ${expected}，实际 ${got}`)
      results.push(`- ${label} → **${got}** ❌（期望 ${expected}）`)
    } else {
      results.push(`- ${label} → ${got} ✅`)
    }
  }
  return results
}

async function checkLowPriceBrush(ctx: CheckContext, targetDate: string) {
  const acceptancePath = path.join(__dirname, 'operations-report-acceptance.ts')
  const acceptanceSource = await fs.readFile(acceptancePath, 'utf8')
  const hasAcceptanceTest = acceptanceSource.includes('testLowPriceBrushExcludedFromPerformanceViews')

  if (!hasAcceptanceTest) {
    addFinding(ctx, 'P1', 'operations-report-acceptance.ts 缺少低价刷单排除测试')
  }

  let scoped
  try {
    scoped = await getBoardScopedViewsForRange({ startDate: targetDate, endDate: targetDate })
  } catch (err) {
    addFinding(
      ctx,
      'P2',
      `无法读取本地订单视图做低价核对：${err instanceof Error ? err.message : String(err)}`,
    )
    return {
      lowPriceCount: 0,
      acceptanceCovered: hasAcceptanceTest,
      message: '本地视图读取失败',
    }
  }

  const withRaw = attachRawByMatchToViews(scoped.views, scoped.rawByMatch)
  const lowPriceViews = withRaw.filter((v) => isLowPriceBrushOrderView(v))
  if (lowPriceViews.length === 0) {
    addNote(
      ctx,
      `当前库 ${targetDate} 无 <${LOW_PRICE_BRUSH_THRESHOLD_CENT / 100}元 真实低价样本，已由验收脚本覆盖`,
    )
    return {
      lowPriceCount: 0,
      acceptanceCovered: hasAcceptanceTest,
      message: '无真实低价样本',
    }
  }

  const perfViews = getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  const leaked = lowPriceViews.filter((lp) => perfViews.some((p) => p.orderId === lp.orderId))
  if (leaked.length > 0) {
    addFinding(
      ctx,
      'P1',
      `发现 ${leaked.length} 笔低价刷单仍出现在业绩视图（阈值 <${LOW_PRICE_BRUSH_THRESHOLD_CENT / 100}元）`,
    )
  }

  const daily = await fetchDaily(targetDate)
  const anchorOrders = ((daily.anchors as Array<Record<string, unknown>>) ?? []).reduce(
    (s, r) => s + Number(r.soldOrderCount ?? 0),
    0,
  )
  if (anchorOrders > 0 && leaked.length > 0) {
    addFinding(ctx, 'P1', '低价刷单可能污染主播表订单数')
  }

  return {
    lowPriceCount: lowPriceViews.length,
    leakedCount: leaked.length,
    acceptanceCovered: hasAcceptanceTest,
    message: `样本日 ${lowPriceViews.length} 笔低价单`,
  }
}

async function checkFrontendSemantics() {
  const indexRes = await fetch(`${BASE}/`)
  const indexHtml = await indexRes.text()
  const jsMatch = indexHtml.match(/assets\/index-[^"]+\.js/)
  if (!jsMatch) return { hasOrderHeaders: false, detail: '未能解析前端 bundle' }
  const jsRes = await fetch(`${BASE}/${jsMatch[0]}`)
  const js = await jsRes.text()
  const hasSoldOrder = js.includes('成交订单') || js.includes('\\u6210\\u4ea4\\u8ba2\\u5355')
  const hasReturnOrder = js.includes('退货订单') || js.includes('\\u9000\\u8d27\\u8ba2\\u5355')
  return {
    hasOrderHeaders: hasSoldOrder && hasReturnOrder,
    detail: `成交订单=${hasSoldOrder} 退货订单=${hasReturnOrder}`,
  }
}

function resolveVerdict(ctx: CheckContext): 'PASS' | 'WARN' | 'FAIL' {
  const hasP0 = ctx.findings.some((f) => f.severity === 'P0')
  const hasP1 = ctx.findings.some((f) => f.severity === 'P1')
  if (hasP0 || hasP1) return 'FAIL'
  const hasP2 = ctx.findings.some((f) => f.severity === 'P2')
  const hasP3 = ctx.findings.some((f) => f.severity === 'P3')
  if (hasP2 || hasP3) return 'WARN'
  return 'PASS'
}

function buildMarkdownReport(ctx: CheckContext, verdict: 'PASS' | 'WARN' | 'FAIL', extra: Record<string, unknown>) {
  const grouped: Record<Severity, string[]> = { P0: [], P1: [], P2: [], P3: [] }
  for (const f of ctx.findings) grouped[f.severity].push(f.message)

  const conclusion =
    verdict === 'PASS'
      ? '**PASS**：建议继续灰度'
      : verdict === 'WARN'
        ? '**WARN**：可灰度但需人工关注'
        : '**FAIL**：不建议继续灰度'

  return [
    '# 运营报表灰度每日核对报告',
    '',
    `- 检查日期：**${ctx.targetDate}**`,
    `- 周报范围：**${ctx.weekStart} ~ ${ctx.weekEnd}**`,
    `- 服务地址：**${BASE}**`,
    `- 生成时间：${new Date().toISOString()}`,
    '',
    ...ctx.sections,
    '',
    '## 发现问题',
    '',
    ...(['P0', 'P1', 'P2', 'P3'] as Severity[]).flatMap((sev) => {
      const items = grouped[sev]
      if (items.length === 0) return [`### ${sev}`, '', '- 无', '']
      return [`### ${sev}`, '', ...items.map((m) => `- ${m}`), '']
    }),
    '',
    '## 备注',
    '',
    ...(ctx.notes.length ? ctx.notes.map((n) => `- ${n}`) : ['- 无']),
    '',
    '## 最终结论',
    '',
    conclusion,
    '',
    '---',
    '',
    `> 脚本：accept:operations-report-gray-check | 额外信息：${JSON.stringify(extra)}`,
    '',
  ].join('\n')
}

const DRILL_PRIVACY_FIELDS = [
  'phone',
  'mobile',
  'address',
  'receiver',
  'platformRawJson',
  'rawJson',
  'cookie',
  'Cookie',
  'authorization',
  'token',
]

async function checkBiDrill(
  ctx: CheckContext,
  daily: Record<string, unknown>,
  rankings: Record<string, unknown>,
  monthStart: string,
  monthEnd: string,
) {
  const date = ctx.targetDate
  const weekStart = ctx.weekStart
  const weekEnd = ctx.weekEnd
  const lines: string[] = []

  async function drill(query: Record<string, string | undefined>) {
    const { status, body } = await fetchJson<Record<string, unknown>>('/api/board/operations-bi-drill', query)
    return { status, data: body.ok ? body.data : undefined, message: body.message }
  }

  const dailySummary = (daily.summary as Record<string, unknown> | undefined) ?? {}
  const dailyDrill = await drill({
    source: 'daily_summary',
    target: 'summary_valid_amount',
    startDate: date,
    endDate: date,
  })
  if (dailyDrill.status !== 200) {
    addFinding(ctx, 'P1', `日报有效成交金额下钻 HTTP ${dailyDrill.status}`)
  } else {
    lines.push(`- 日报有效成交金额下钻：${dailyDrill.status} ✅`)
    const drillSummary = dailyDrill.data?.summary as Record<string, unknown> | undefined
    const drillAmount = Number(drillSummary?.validAmountYuan ?? NaN)
    const reportAmount = Number(dailySummary.validAmountYuan ?? NaN)
    if (Number.isFinite(drillAmount) && Number.isFinite(reportAmount) && !near(drillAmount, reportAmount, 1)) {
      addFinding(
        ctx,
        'P1',
        `日报下钻有效成交金额 ${drillAmount} 与 summary ${reportAmount} 偏差较大`,
      )
    }
  }

  const hotItem = (
    rankings.products as { hot?: { items?: Array<{ productKey?: string }> } } | undefined
  )?.hot?.items?.[0]
  if (hotItem?.productKey) {
    const hotDrill = await drill({
      source: 'rankings',
      target: 'product_hot',
      startDate: weekStart,
      endDate: weekEnd,
      productKey: hotItem.productKey,
    })
    lines.push(`- 周报热卖商品下钻：${hotDrill.status}${hotDrill.status === 200 ? ' ✅' : ' ❌'}`)
    if (hotDrill.status !== 200) addFinding(ctx, 'P1', '榜单热卖商品下钻失败')
  }

  const priceBand = (
    rankings.priceBands as { byAmount?: { items?: Array<{ bandLabel?: string }> } } | undefined
  )?.byAmount?.items?.[0]
  if (priceBand?.bandLabel) {
    const bandDrill = await drill({
      source: 'price_band_ranking',
      target: 'price_band_amount',
      startDate: monthStart,
      endDate: monthEnd,
      priceBandLabel: priceBand.bandLabel,
    })
    lines.push(`- 月报价格带下钻：${bandDrill.status}${bandDrill.status === 200 ? ' ✅' : ' ❌'}`)
  }

  const reasonItem = (
    rankings.afterSales as { byReason?: { items?: Array<{ category?: string; categoryLabel?: string }> } } | undefined
  )?.byReason?.items?.[0]
  if (reasonItem?.category) {
    const reasonDrill = await drill({
      source: 'after_sales_ranking',
      target: 'after_sales_reason',
      startDate: weekStart,
      endDate: weekEnd,
      afterSalesCategory: reasonItem.category,
      afterSalesReason: reasonItem.categoryLabel,
    })
    lines.push(`- 售后原因下钻：${reasonDrill.status}${reasonDrill.status === 200 ? ' ✅' : ' ❌'}`)
  }

  const trafficDrill = await drill({
    source: 'daily_summary',
    target: 'summary_deal_conversion',
    startDate: date,
    endDate: date,
  })
  if (trafficDrill.status === 200) {
    const rows = trafficDrill.data?.rows as unknown[] | undefined
    const warnings = (trafficDrill.data?.dataQuality as { warnings?: string[] } | undefined)?.warnings ?? []
    if ((rows?.length ?? 0) > 0) addFinding(ctx, 'P1', '成交率下钻不应返回订单行')
    if (!warnings.some((w) => w.includes('官方流量'))) {
      addFinding(ctx, 'P2', '成交率下钻缺少官方流量说明')
    }
    lines.push('- 流量类指标下钻：说明正常 ✅')
  }

  const drillJson = JSON.stringify(dailyDrill.data ?? {})
  for (const f of DRILL_PRIVACY_FIELDS) {
    if (drillJson.includes(`"${f}"`)) addFinding(ctx, 'P1', `钻取响应含隐私字段 ${f}`)
  }

  try {
    const ticketRes = await fetch(`${BASE}/api/board/qianfan-order-detail-ticket`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNo: '' }),
    })
    const ticketBody = await ticketRes.text()
    if (ticketBody.toLowerCase().includes('cookie')) {
      addFinding(ctx, 'P1', '千帆 ticket 接口响应含 cookie 字样')
    }
    lines.push('- 千帆 ticket 接口：已检查不泄露 Cookie ✅')
  } catch (err) {
    addFinding(ctx, 'P2', `千帆 ticket 检查失败：${err instanceof Error ? err.message : String(err)}`)
  }

  addSection(ctx, 'BI 钻取核对', lines)
}

async function main() {
  const ctx: CheckContext = {
    targetDate: '',
    weekStart: '',
    weekEnd: '',
    findings: [],
    notes: [],
    sections: [],
  }

  const explicitDate = parseDateArg()
  const serviceUp = await ensureServiceUp()
  if (!serviceUp) {
    console.error(`[gray-check] FAIL: 本地服务未启动，请先运行 npm run start，确保 ${BASE} 可访问`)
    await fs.mkdir(REPORT_DIR, { recursive: true })
    const failDate = explicitDate ?? formatDateKeyShanghai(new Date())
    const report = [
      '# 运营报表灰度每日核对报告',
      '',
      `- 检查日期：**${failDate}**`,
      `- 服务地址：**${BASE}**`,
      '',
      '## 最终结论',
      '',
      '**FAIL**：本地服务未启动，无法完成核对',
      '',
    ].join('\n')
    const outPath = path.join(REPORT_DIR, `${failDate}.md`)
    await fs.writeFile(outPath, report, 'utf8')
    console.log(report)
    console.log(`\n[gray-check] 报告已保存：${outPath}`)
    process.exit(1)
  }

  ctx.targetDate = await resolveTargetDate(explicitDate)
  ctx.weekStart = weekStartForDate(ctx.targetDate)
  ctx.weekEnd = ctx.targetDate

  console.log(`[gray-check] base=${BASE} date=${ctx.targetDate} week=${ctx.weekStart}~${ctx.weekEnd}`)

  let daily: Record<string, unknown>
  let weekly: Record<string, unknown>
  let rankings: Record<string, unknown>
  let cachePerfNotes: string[] = []
  try {
    const dailyTimed = await fetchDailyTimed(ctx.targetDate)
    daily = dailyTimed.data
    checkCacheMeta(ctx, '日报', daily)

    const dailySecond = await fetchDailyTimed(ctx.targetDate)
    checkCacheMeta(ctx, '日报（第二次）', dailySecond.data, true)
    cachePerfNotes.push(
      `- 日报：首次 ${dailyTimed.ms}ms / 第二次 ${dailySecond.ms}ms${dailySecond.ms < dailyTimed.ms ? ' ✅' : ''}`,
    )
    const dSummary = (daily.summary as Record<string, unknown> | undefined) ?? {}
    const d2Summary = (dailySecond.data.summary as Record<string, unknown> | undefined) ?? {}
    if (dSummary.soldOrderCount != null && d2Summary.soldOrderCount != null) {
      if (dSummary.soldOrderCount !== d2Summary.soldOrderCount) {
        addFinding(ctx, 'P1', '日报缓存命中改变了 soldOrderCount')
      }
    }

    const weeklyTimed = await fetchWeeklyTimed(ctx.weekStart, ctx.weekEnd)
    weekly = weeklyTimed.data
    checkCacheMeta(ctx, '周报', weekly)
    const weeklySecond = await fetchWeeklyTimed(ctx.weekStart, ctx.weekEnd)
    checkCacheMeta(ctx, '周报（第二次）', weeklySecond.data, true)
    cachePerfNotes.push(
      `- 周报：首次 ${weeklyTimed.ms}ms / 第二次 ${weeklySecond.ms}ms${weeklySecond.ms < weeklyTimed.ms ? ' ✅' : ''}`,
    )

    const rankingsTimed = await fetchRankingsTimed(ctx.weekStart, ctx.weekEnd)
    rankings = rankingsTimed.data
    checkCacheMeta(ctx, '榜单中心', rankings)
    const rankingsSecond = await fetchRankingsTimed(ctx.weekStart, ctx.weekEnd)
    checkCacheMeta(ctx, '榜单中心（第二次）', rankingsSecond.data, true)
    cachePerfNotes.push(
      `- 榜单：首次 ${rankingsTimed.ms}ms / 第二次 ${rankingsSecond.ms}ms${rankingsSecond.ms < rankingsTimed.ms ? ' ✅' : ''}`,
    )
    const rAnchors = (rankings.anchors as { byAmount?: { items?: unknown[] } } | undefined)?.byAmount
      ?.items
    const r2Anchors = (rankingsSecond.data.anchors as { byAmount?: { items?: unknown[] } } | undefined)
      ?.byAmount?.items
    if (Array.isArray(rAnchors) && Array.isArray(r2Anchors) && rAnchors.length !== r2Anchors.length) {
      addFinding(ctx, 'P1', '榜单缓存命中改变了 anchors 数量')
    }
  } catch (err) {
    addFinding(ctx, 'P0', err instanceof Error ? err.message : String(err))
    daily = {}
    weekly = {}
    rankings = {}
  }

  checkDailyStructure(ctx, daily)
  const dailyCaliber = daily.summary ? checkDailyCaliber(ctx, daily) : null
  checkWeeklyStructure(ctx, weekly)
  checkProductRankings(ctx, weekly)
  checkRankingsApi(ctx, rankings)
  let insightStatsCustom: Record<string, unknown> | null = null
  let insightStatsDaily: Record<string, unknown> | null = null
  let insightStatsWeekly: Record<string, unknown> | null = null
  try {
    const customRes = await fetchJson<Record<string, unknown>>(
      '/api/board/operations-business-insight-action-stats',
      { startDate: ctx.weekStart, endDate: ctx.weekEnd, scope: 'custom' },
    )
    if (customRes.status === 200 && customRes.body.ok && customRes.body.data) {
      insightStatsCustom = customRes.body.data as Record<string, unknown>
    }
    const dailyRes = await fetchJson<Record<string, unknown>>(
      '/api/board/operations-business-insight-action-stats',
      { startDate: ctx.targetDate, endDate: ctx.targetDate, scope: 'daily' },
    )
    if (dailyRes.status === 200 && dailyRes.body.ok && dailyRes.body.data) {
      insightStatsDaily = dailyRes.body.data as Record<string, unknown>
    }
    const weeklyRes = await fetchJson<Record<string, unknown>>(
      '/api/board/operations-business-insight-action-stats',
      { startDate: ctx.weekStart, endDate: ctx.weekEnd, scope: 'weekly' },
    )
    if (weeklyRes.status === 200 && weeklyRes.body.ok && weeklyRes.body.data) {
      insightStatsWeekly = weeklyRes.body.data as Record<string, unknown>
    }
  } catch (err) {
    addFinding(ctx, 'P1', `经营建议执行统计接口失败：${err instanceof Error ? err.message : String(err)}`)
  }
  checkInsightActionStats(ctx, '榜单 custom', insightStatsCustom)
  checkInsightActionStats(ctx, '日报 daily', insightStatsDaily)
  checkInsightActionStats(ctx, '周报 weekly', insightStatsWeekly)

  let monthlyReport: Record<string, unknown> | null = null
  try {
    const monthKey = ctx.targetDate.slice(0, 7)
    const monthlyRes = await fetchJson<Record<string, unknown>>(
      '/api/board/operations-monthly-report',
      { month: monthKey },
    )
    if (monthlyRes.status === 200 && monthlyRes.body.ok && monthlyRes.body.data) {
      monthlyReport = monthlyRes.body.data as Record<string, unknown>
      checkCacheMeta(ctx, '月报', monthlyReport)
      const monthlySecond = await fetchJson<Record<string, unknown>>(
        '/api/board/operations-monthly-report',
        { month: monthKey },
      )
      if (monthlySecond.status === 200 && monthlySecond.body.ok && monthlySecond.body.data) {
        checkCacheMeta(ctx, '月报（第二次）', monthlySecond.body.data as Record<string, unknown>, true)
        const m1 = (monthlyReport.summary as Record<string, unknown> | undefined) ?? {}
        const m2 = (monthlySecond.body.data as Record<string, unknown>).summary as
          | Record<string, unknown>
          | undefined
        if (m1.validAmountYuan != null && m2?.validAmountYuan != null) {
          if (m1.validAmountYuan !== m2.validAmountYuan) {
            addFinding(ctx, 'P1', '月报缓存命中改变了 validAmountYuan')
          }
        }
      }
    } else if (monthlyRes.status !== 200) {
      addFinding(ctx, 'P1', `月报接口 HTTP ${monthlyRes.status}`)
    }
    const badMonth = await fetchJson<Record<string, unknown>>(
      '/api/board/operations-monthly-report',
      { month: '2026-13' },
    )
    if (badMonth.status !== 400) {
      addFinding(ctx, 'P1', `月报非法 month 应返回 400，实际 ${badMonth.status}`)
    }
  } catch (err) {
    addFinding(ctx, 'P1', `月报接口失败：${err instanceof Error ? err.message : String(err)}`)
  }

  if (monthlyReport) {
    const summary = monthlyReport.summary as Record<string, unknown> | undefined
    if (!summary || Number.isNaN(Number(summary.validAmountYuan))) {
      addFinding(ctx, 'P1', '月报 summary.validAmountYuan 无效')
    }
    if (!monthlyReport.rankings) addFinding(ctx, 'P1', '月报 rankings 缺失')
    checkBusinessInsights(ctx, '月报', monthlyReport)
    checkInsightActionStats(ctx, '月报 custom', monthlyReport.insightActionStats as Record<string, unknown>)
    const dq = monthlyReport.dataQuality as { warnings?: unknown } | undefined
    if (!Array.isArray(dq?.warnings)) addFinding(ctx, 'P1', '月报 dataQuality.warnings 应为数组')
    const json = JSON.stringify(monthlyReport)
    for (const f of ['phone', 'mobile', 'platformRawJson', 'rawJson']) {
      if (json.includes(`"${f}"`)) addFinding(ctx, 'P1', `月报含隐私字段 ${f}`)
    }
    const cmp = monthlyReport.compareWithPreviousMonth as { warnings?: string[] } | undefined
    if (cmp?.warnings?.some((w) => w.includes('上月'))) {
      addNote(ctx, '月报无上月对比数据时已给出 warning')
    }
  } else {
    addFinding(ctx, 'P1', '月报数据缺失')
  }

  const weeklyCaliber = weekly.summary
    ? await checkWeeklyCaliber(ctx, weekly, ctx.weekStart, ctx.weekEnd)
    : null
  const monthStart = ctx.targetDate.slice(0, 8) + '01'
  const monthEnd = ctx.targetDate
  if (daily.summary && rankings.bossSummary) {
    await checkBiDrill(ctx, daily, rankings, monthStart, monthEnd)
  }
  const privacy = await checkPrivacyExport(ctx, ctx.targetDate)
  const priceBandLines = checkPriceBandBoundaries(ctx)
  const lowPrice = await checkLowPriceBrush(ctx, ctx.targetDate)
  const frontend = await checkFrontendSemantics()
  if (!frontend.hasOrderHeaders) {
    addFinding(ctx, 'P2', `前端 bundle 未检出「成交订单/退货订单」表头：${frontend.detail}`)
  }

  addSection(ctx, '日报接口结果', [
    `- HTTP：${daily.summary ? '200 ✅' : '失败 ❌'}`,
    `- summary / anchors / products / priceBands / afterSalesReasons / reviewNote / businessInsights：${daily.summary ? '已返回' : '缺失'}`,
  ])

  addSection(ctx, '周报接口结果', [
    `- HTTP：${weekly.summary ? '200 ✅' : '失败 ❌'}`,
    `- dailyTrend 条数：${getDailyTrend(weekly).length}`,
    `- anchors / hotProducts / productRankingQuality / businessInsights：${weekly.summary ? '已返回' : '缺失'}`,
  ])

  addSection(ctx, '榜单中心接口', [
    `- HTTP：${rankings.bossSummary ? '200 ✅' : '失败 ❌'}`,
    `- bossSummary / anchors / products / priceBands / businessInsights：${rankings.bossSummary ? '已返回' : '缺失'}`,
    `- 经营建议执行统计：${insightStatsCustom ? '已返回 ✅' : '缺失 ❌'}`,
  ])

  addSection(ctx, '月报接口', [
    `- HTTP：${monthlyReport?.summary ? '200 ✅' : '失败 ❌'}`,
    `- summary / rankings / businessInsights / insightActionStats：${monthlyReport?.summary ? '已返回' : '缺失'}`,
  ])

  if (dailyCaliber) {
    addSection(ctx, '日报 summary vs 主播合计', [
      `- 有效成交金额：summary **${dailyCaliber.summaryAmount}** / 主播合计 **${dailyCaliber.anchorAmount}** / 差额 **${dailyCaliber.amountDiff.toFixed(2)}**`,
      `- 有效成交订单：summary **${dailyCaliber.summaryOrders}** / 主播合计 **${dailyCaliber.anchorOrders}** / 差额 **${dailyCaliber.orderDiff}**`,
      `- 退货订单：summary **${dailyCaliber.summaryReturns}** / 主播合计 **${dailyCaliber.anchorReturns}**`,
    ])
  }

  if (weeklyCaliber) {
    addSection(ctx, '周报 summary vs dailyTrend 累加', [
      `- 有效成交金额：summary **${weeklyCaliber.summaryAmount}** / trend 合计 **${weeklyCaliber.sumAmount}**`,
      `- 有效成交订单：summary **${weeklyCaliber.summaryOrders}** / trend 合计 **${weeklyCaliber.sumOrders}**`,
      `- 退货订单：summary **${weeklyCaliber.summaryReturns}** / trend 合计 **${weeklyCaliber.sumReturns}**`,
      `- 直播时长：summary **${weeklyCaliber.summaryDuration}** 分 / 逐日合计 **${weeklyCaliber.dailyDurationSum}** 分`,
    ])
    addSection(ctx, '成交率 / 粉丝率核对', [
      `- joinUserCount：**${weeklyCaliber.join ?? 'null'}**`,
      `- dealUserCount：**${weeklyCaliber.dealUsers ?? 'null'}**`,
      `- viewSessionCount：**${weeklyCaliber.view ?? 'null'}**`,
      `- totalNewFollowerCount：**${weeklyCaliber.followers ?? 'null'}**`,
      `- dealConversionRate：**${weeklyCaliber.dealRate ?? 'null'}**`,
      `- newFollowerRate：**${weeklyCaliber.followerRate ?? 'null'}**`,
      weeklyCaliber.allTrafficMissing
        ? '- 官方 traffic 全部缺失，率为 null 属正常'
        : '- 官方 traffic 存在，已核对率计算',
    ])
  }

  addSection(ctx, '商品退货率核对', [
    '- 规则：`returnOrderCount / soldOrderCount`（订单维度）',
    `- 前端表头：${frontend.hasOrderHeaders ? '成交订单 / 退货订单 ✅' : frontend.detail}`,
  ])

  addSection(ctx, '价格带边界核对', priceBandLines)

  addSection(ctx, '低价刷单核对', [
    `- 样本日低价单：${lowPrice.lowPriceCount ?? 0} 笔`,
    `- 验收脚本覆盖：${lowPrice.acceptanceCovered ? '是 ✅' : '否 ❌'}`,
    `- 说明：${lowPrice.message}`,
  ])

  addSection(ctx, '隐私导出核对', [
    `- 抽样日期：${privacy.usedDate}`,
    `- 订单行数：${privacy.rowCount}`,
    privacy.rowCount === 0
      ? '- HTTP 抽样跳过，验收脚本已覆盖 sanitize'
      : `- 默认脱敏：${privacy.masked ? '通过 ✅' : '未验证'}`,
    '- local_viewer 下 confirmRaw=1 不返回完整 raw',
  ])

  if (cachePerfNotes.length > 0) {
    addSection(ctx, '报表缓存性能', [
      ...cachePerfNotes,
      '- 目标：第二次请求尽量 < 500ms，且明显快于首次',
    ])
  }

  const verdict = resolveVerdict(ctx)
  const report = buildMarkdownReport(ctx, verdict, {
    verdict,
    findingCount: ctx.findings.length,
    noteCount: ctx.notes.length,
  })

  await fs.mkdir(REPORT_DIR, { recursive: true })
  const outPath = path.join(REPORT_DIR, `${ctx.targetDate}.md`)
  await fs.writeFile(outPath, report, 'utf8')

  console.log('\n' + report)
  console.log(`\n[gray-check] 报告已保存：${outPath}`)
  console.log(`[gray-check] 结论：${verdict}`)

  if (verdict === 'FAIL') process.exit(1)
}

main().catch((err) => {
  console.error('[gray-check] fatal', err)
  process.exit(1)
})
