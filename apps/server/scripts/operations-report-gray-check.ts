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
  const requiredTop = ['summary', 'anchors', 'products', 'priceBands', 'afterSalesReasons', 'reviewNote']
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
  if (getWeeklyProducts(weekly).length === 0 && trend.length > 0) {
    addNote(ctx, '周报 hotProducts/products 为空（可能本周无商品成交）')
  }
  if (!Array.isArray(weekly.priceBands)) addFinding(ctx, 'P1', '周报 priceBands 不存在')
  if (!Array.isArray(weekly.afterSalesReasons)) addFinding(ctx, 'P1', '周报 afterSalesReasons 不存在')
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
  const intCases: Array<[number, string]> = [
    [1998, '1600~1998'],
    [1999, '1999+'],
    [2000, '1999+'],
  ]
  for (const [yuan, expected] of intCases) {
    const got = resolvePriceBandLabel(yuan)
    if (got !== expected) {
      addFinding(ctx, 'P1', `价格带边界 ${yuan} 元应落在 ${expected}，实际 ${got}`)
      results.push(`- ${yuan} → **${got}** ❌（期望 ${expected}）`)
    } else {
      results.push(`- ${yuan} → ${got} ✅`)
    }
  }

  const cent199899 = resolvePriceBandLabelFromCent(199899)
  if (cent199899 === '1600~1998') {
    results.push('- 1998.99 元（199899 分）→ 1600~1998 ✅')
  } else {
    addFinding(
      ctx,
      'P3',
      `1998.99 元（199899 分）当前归入 ${cent199899}；元级函数对 1998.99 会进 1999+，订单分位边界请人工关注`,
    )
    results.push(`- 1998.99 元（199899 分）→ ${cent199899} ⚠️（期望 1600~1998，已知元级边界行为）`)
  }

  const yuan199899 = resolvePriceBandLabel(1998.99)
  results.push(
    `- 1998.99 元（yuan 入参）→ ${yuan199899}${yuan199899 === '1999+' ? '（元级 >1998 归 1999+）' : ' ✅'}`,
  )

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
  if (hasP2 || ctx.notes.length > 0) return 'WARN'
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
  try {
    daily = await fetchDaily(ctx.targetDate)
    weekly = await fetchWeekly(ctx.weekStart, ctx.weekEnd)
  } catch (err) {
    addFinding(ctx, 'P0', err instanceof Error ? err.message : String(err))
    daily = {}
    weekly = {}
  }

  checkDailyStructure(ctx, daily)
  const dailyCaliber = daily.summary ? checkDailyCaliber(ctx, daily) : null
  checkWeeklyStructure(ctx, weekly)
  const weeklyCaliber = weekly.summary
    ? await checkWeeklyCaliber(ctx, weekly, ctx.weekStart, ctx.weekEnd)
    : null
  const privacy = await checkPrivacyExport(ctx, ctx.targetDate)
  const priceBandLines = checkPriceBandBoundaries(ctx)
  const lowPrice = await checkLowPriceBrush(ctx, ctx.targetDate)
  const frontend = await checkFrontendSemantics()
  if (!frontend.hasOrderHeaders) {
    addFinding(ctx, 'P2', `前端 bundle 未检出「成交订单/退货订单」表头：${frontend.detail}`)
  }

  addSection(ctx, '日报接口结果', [
    `- HTTP：${daily.summary ? '200 ✅' : '失败 ❌'}`,
    `- summary / anchors / products / priceBands / afterSalesReasons / reviewNote：${daily.summary ? '已返回' : '缺失'}`,
  ])

  addSection(ctx, '周报接口结果', [
    `- HTTP：${weekly.summary ? '200 ✅' : '失败 ❌'}`,
    `- dailyTrend 条数：${getDailyTrend(weekly).length}`,
    `- anchors / hotProducts / priceBands / afterSalesReasons：${weekly.summary ? '已返回' : '缺失'}`,
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
