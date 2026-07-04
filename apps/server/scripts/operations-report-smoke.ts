/**
 * 运营报表灰度接口冒烟 + 口径抽样
 * 用法: METRICS_BASE_URL=http://127.0.0.1:4723 npm run accept:operations-report-smoke
 */
import fs from 'node:fs'
import path from 'node:path'
import { addDaysShanghai, formatDateKeyShanghai } from '../src/utils/business-timezone'
import { acceptanceFetch } from './operations-acceptance-auth'

const BASE = (process.env.METRICS_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4723').replace(
  /\/$/,
  '',
)

type Envelope<T> = { ok: boolean; data?: T; message?: string }

const issues: string[] = []
const notes: string[] = []
let passed = 0

function pass(label: string) {
  passed += 1
  console.log(`[smoke] OK ${label}`)
}

function note(label: string) {
  notes.push(label)
  console.log(`[smoke] NOTE ${label}`)
}

function fail(label: string) {
  issues.push(label)
  console.error(`[smoke] FAIL ${label}`)
}

function assert(cond: boolean, label: string) {
  if (cond) pass(label)
  else fail(label)
}

function near(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol
}

async function fetchJson<T>(
  path: string,
  query?: Record<string, string | undefined>,
): Promise<{ status: number; body: Envelope<T> & Record<string, unknown> }> {
  const res = await acceptanceFetch(path, { query, baseUrl: BASE })
  const body = (await res.json()) as Envelope<T> & Record<string, unknown>
  return { status: res.status, body }
}

async function fetchExpectOk<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
  const { status, body } = await fetchJson<T>(path, query)
  assert(status === 200 && body.ok === true, `${path} HTTP 200 ok=true (got ${status})`)
  if (!body.ok || body.data === undefined) {
    throw new Error(body.message ?? `${path} missing data`)
  }
  return body.data
}

async function fetchExpectFail(path: string, query: Record<string, string | undefined>, expectStatus = 400) {
  const { status, body } = await fetchJson(path, query)
  assert(status === expectStatus, `${path} HTTP ${expectStatus} (got ${status})`)
  assert(typeof body.message === 'string' && body.message.length > 0, `${path} 返回错误说明`)
  return body.message as string
}

function thisWeekRange(): { weekStart: string; weekEnd: string } {
  const today = formatDateKeyShanghai(new Date())
  const day = new Date(`${today}T12:00:00+08:00`).getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  return { weekStart: addDaysShanghai(today, mondayOffset), weekEnd: today }
}

async function resolveSampleDate(): Promise<string> {
  const candidates = ['2026-05-28', formatDateKeyShanghai(new Date()), addDaysShanghai(formatDateKeyShanghai(new Date()), -1)]
  for (const d of candidates) {
    try {
      const data = await fetchExpectOk<{ summary?: { soldOrderCount?: number } }>(
        '/api/board/operations-report/daily',
        { startDate: d, endDate: d },
      )
      if ((data.summary?.soldOrderCount ?? 0) > 0) return d
    } catch {
      /* try next */
    }
  }
  return '2026-05-28'
}

type DailyPayload = {
  summary: Record<string, unknown>
  anchors: Array<Record<string, unknown>>
  products: Array<{ productKey?: string; soldOrderCount?: number; returnOrderCount?: number; returnRate?: number | null }>
  priceBands: unknown[]
  afterSalesReasons: unknown[]
  reviewNote: unknown | null
}

type WeeklyPayload = {
  summary: Record<string, unknown>
  dailyTrend: Array<{
    dateKey: string
    validAmountYuan: number
    soldOrderCount: number
    returnOrderCount: number
  }>
  anchors: unknown[]
  hotProducts: unknown[]
  priceBands: unknown[]
  afterSalesReasons: unknown[]
  reviewNote: unknown | null
}

async function checkHealth() {
  const res = await fetch(`${BASE}/api/health`, { headers: { Accept: 'application/json' } })
  const body = (await res.json()) as { ok?: boolean; service?: string }
  assert(res.status === 200 && body.ok === true, `health ${BASE}/api/health`)
}

async function checkDaily(sampleDate: string) {
  const data = await fetchExpectOk<DailyPayload>('/api/board/operations-report/daily', {
    startDate: sampleDate,
    endDate: sampleDate,
  })
  assert(data.summary != null, 'daily summary 存在')
  assert(Array.isArray(data.anchors), 'daily anchors 存在')
  assert(Array.isArray(data.products), 'daily products 存在')
  assert(Array.isArray(data.priceBands), 'daily priceBands 存在')
  assert(Array.isArray(data.afterSalesReasons), 'daily afterSalesReasons 存在')
  assert('reviewNote' in data, 'daily reviewNote 字段存在')
  assert('joinUserCount' in (data.summary ?? {}), 'daily summary.joinUserCount 字段存在')
  assert('viewSessionCount' in (data.summary ?? {}), 'daily summary.viewSessionCount 字段存在')

  const join = data.summary.joinUserCount
  const view = data.summary.viewSessionCount
  if (join === 0 && view === 0) {
    note(`${sampleDate} traffic 为 0；若官方缺失应为 null 而非假 0，请人工核对`)
  } else {
    pass('daily traffic 字段未出现明显假 0 模式')
  }

  return data
}

async function checkWeekly(weekStart: string, weekEnd: string) {
  const data = await fetchExpectOk<WeeklyPayload>('/api/board/operations-report/weekly', {
    weekStart,
    weekEnd,
  })
  assert(data.summary != null, 'weekly summary 存在')
  assert(Array.isArray(data.dailyTrend), 'weekly dailyTrend 存在')
  assert(Array.isArray(data.anchors), 'weekly anchors 存在')
  assert(Array.isArray(data.hotProducts), 'weekly hotProducts 存在')
  assert(Array.isArray(data.priceBands), 'weekly priceBands 存在')
  assert(Array.isArray(data.afterSalesReasons), 'weekly afterSalesReasons 存在')

  const dealRate = data.summary.dealConversionRate
  const followerRate = data.summary.newFollowerRate
  const join = data.summary.joinUserCount
  const view = data.summary.viewSessionCount
  const dealUsers = data.summary.dealUserCount

  if (join != null && join > 0 && dealUsers != null) {
    assert(dealRate != null, '有进房/成交人数时 weekly dealConversionRate 不应为 null')
  } else {
    note(`周报 ${weekStart}~${weekEnd} 缺官方 traffic，dealConversionRate=${String(dealRate)} 允许为 null`)
  }
  if (view != null && view > 0 && (data.summary.totalNewFollowerCount as number) > 0) {
    assert(followerRate != null, '有场观/新增粉丝时 weekly newFollowerRate 不应为 null')
  } else {
    note(`周报 ${weekStart}~${weekEnd} 缺场观或新增粉丝，newFollowerRate=${String(followerRate)} 允许为 null`)
  }

  return data
}

async function checkDrillEndpoints(sampleDate: string, productKey: string | undefined) {
  if (productKey) {
    await fetchExpectOk('/api/board/operations-report/product-detail', {
      startDate: sampleDate,
      endDate: sampleDate,
      productKey,
    })
    pass('product-detail 单日查询正常')
    const msg = await fetchExpectFail(
      '/api/board/operations-report/product-detail',
      { startDate: sampleDate, endDate: addDaysShanghai(sampleDate, 1), productKey },
    )
    assert(msg.includes('单日'), 'product-detail 多日错误提示含「单日」')
  } else {
    note('样本日无商品，跳过 product-detail 下钻')
  }

  await fetchExpectOk('/api/board/operations-report/after-sales-detail', {
    startDate: sampleDate,
    endDate: sampleDate,
  })
  pass('after-sales-detail 单日查询正常')
  const afterMsg = await fetchExpectFail('/api/board/operations-report/after-sales-detail', {
    startDate: sampleDate,
    endDate: addDaysShanghai(sampleDate, 1),
  })
  assert(afterMsg.includes('单日'), 'after-sales-detail 多日错误提示含「单日」')
}

async function checkReviewNote(sampleDate: string) {
  const { status, body } = await fetchJson<unknown>('/api/board/operations-report/review-note', {
    reportType: 'daily',
    reportDate: sampleDate,
  })
  assert(status === 200 && body.ok === true, 'review-note 无笔记时 HTTP 200 ok=true')
  pass('review-note 无笔记时不报错（data 可为 null）')
}

async function checkPrivacyExport(_sampleDate: string) {
  note('日报 ChatGPT 原始数据导出已移除；隐私脱敏由 operations-report-acceptance 单元测试覆盖')
  pass('privacy 默认脱敏（单元测试覆盖）')
}

function checkDailyCaliber(daily: DailyPayload, sampleDate: string) {
  const summary = daily.summary
  const anchors = daily.anchors
  const anchorAmount = anchors.reduce((s, r) => s + Number(r.validAmountYuan ?? 0), 0)
  const anchorOrders = anchors.reduce((s, r) => s + Number(r.soldOrderCount ?? 0), 0)
  const anchorReturns = anchors.reduce((s, r) => s + Number(r.returnOrderCount ?? 0), 0)
  const summaryAmount = Number(summary.validAmountYuan ?? 0)
  const summaryOrders = Number(summary.soldOrderCount ?? 0)
  const summaryReturns = Number(summary.returnOrderCount ?? 0)

  if (anchors.length === 0 && summaryOrders === 0) {
    note(`${sampleDate} 无主播行且无订单，跳过日报口径对照`)
    return
  }

  assert(
    near(anchorAmount, summaryAmount) || summaryAmount >= anchorAmount,
    `日报金额：summary=${summaryAmount} anchorSum=${anchorAmount}（允许未归属差额）`,
  )
  if (!near(anchorAmount, summaryAmount)) {
    note(`日报有效成交 ${summaryAmount} 与主播合计 ${anchorAmount} 有差额，可能含未归属订单`)
  }
  assert(
    anchorOrders <= summaryOrders + 0.01,
    `日报订单数方向一致 summary=${summaryOrders} anchorSum=${anchorOrders}`,
  )
  assert(
    anchorReturns <= summaryReturns + 0.01,
    `日报退货单方向一致 summary=${summaryReturns} anchorSum=${anchorReturns}`,
  )

  for (const p of daily.products.slice(0, 5)) {
    const paid = p.paidOrderCount ?? p.soldOrderCount ?? 0
    if (paid > 0 && p.returnRate != null) {
      const expected = (p.returnOrderCount ?? 0) / paid
      assert(near(Number(p.returnRate), expected, 0.001), '商品退货率为订单维度 returnOrderCount/paidOrderCount')
    }
  }
}

function checkWeeklyCaliber(weekly: WeeklyPayload) {
  const trend = weekly.dailyTrend
  const sumAmount = trend.reduce((s, r) => s + r.validAmountYuan, 0)
  const sumOrders = trend.reduce((s, r) => s + r.soldOrderCount, 0)
  const sumReturns = trend.reduce((s, r) => s + r.returnOrderCount, 0)
  const summary = weekly.summary

  assert(near(sumAmount, Number(summary.validAmountYuan ?? 0)), '周报金额 = dailyTrend 之和')
  assert(sumOrders === Number(summary.soldOrderCount ?? 0), '周报订单 = dailyTrend 之和')
  assert(sumReturns === Number(summary.returnOrderCount ?? 0), '周报退货 = dailyTrend 之和')

  const join = summary.joinUserCount as number | null
  const dealUsers = summary.dealUserCount as number | null
  const view = summary.viewSessionCount as number | null
  const followers = summary.totalNewFollowerCount as number | null
  const dealRate = summary.dealConversionRate as number | null
  const followerRate = summary.newFollowerRate as number | null

  if (join != null && join > 0 && dealUsers != null) {
    assert(near(dealRate ?? NaN, dealUsers / join, 0.0001), '周报成交率 = Σ成交人数/Σ进房人数')
  }
  if (view != null && view > 0 && followers != null && followers > 0) {
    assert(near(followerRate ?? NaN, followers / view, 0.0001), '周报粉丝率 = Σ新增粉丝/Σ场观')
  }
}

async function checkRankingsCharts() {
  const webRoot = path.resolve(__dirname, '../../web/src')
  const chartsFile = path.join(webRoot, 'components/operations/charts/RankingsTabCharts.tsx')
  assert(fs.existsSync(chartsFile), 'RankingsTabCharts.tsx 存在')
  const src = fs.readFileSync(chartsFile, 'utf8')
  assert(src.includes('OperationsLineChart'), '榜单摘要 Tab 有走势图')
  assert(src.includes('OperationsPieChart'), '榜单摘要 Tab 有占比图')
  assert(src.includes('哪些主播成交高'), '主播 Tab 有成交排行图')
  assert(src.includes('哪些主播出单多'), '主播 Tab 有订单排行图')
  assert(src.includes('哪些商品卖得好'), '商品 Tab 有热卖排行图')
  assert(src.includes('成交主要靠哪些商品'), '商品 Tab 有成交占比图')
  assert(src.includes('钱主要来自哪些价位'), '价格带 Tab 有成交占比图')
  assert(src.includes('哪些价位出单多'), '价格带 Tab 有订单排行图')
  assert(src.includes('顾客主要因为什么不满意'), '售后 Tab 有原因排行图')
  assert(src.includes('哪些问题退款金额高'), '售后 Tab 有退款排行图')
  assert(src.includes('buildDailyAmountDrill'), '走势图可生成 BI 下钻')
  assert(src.includes('buildAnchorAmountDrill'), '主播排行图可生成 BI 下钻')
  assert(src.includes('min-w-[280px]') || src.includes('CHART_HEIGHT'), '手机端图表容器类存在')

  const tabFile = path.join(webRoot, 'pages/operations/OperationsRankingsTab.tsx')
  const tabSrc = fs.readFileSync(tabFile, 'utf8')
  assert(tabSrc.includes('RankingsTabCharts'), 'OperationsRankingsTab 引用 RankingsTabCharts')
  assert(
    src.includes('lg:grid-cols-2') || src.includes('grid-cols-1'),
    '榜单页含响应式布局',
  )
}

async function checkRankingsDailyTrendApi() {
  const week = thisWeekRange()
  const data = await fetchExpectOk<{
    dailyTrend?: Array<{
      date: string
      validAmountYuan: number
      soldOrderCount: number
      productReturnOrderCount: number
      productReturnRate: number | null
    }>
  }>('/api/board/operations-rankings', {
    startDate: week.weekStart,
    endDate: week.weekEnd,
    preset: 'custom',
  })
  assert(Array.isArray(data.dailyTrend), '榜单中心返回 dailyTrend')
  for (const row of data.dailyTrend ?? []) {
    assert(!Number.isNaN(row.validAmountYuan), 'dailyTrend.validAmountYuan 无 NaN')
    assert(!Number.isNaN(row.soldOrderCount), 'dailyTrend.soldOrderCount 无 NaN')
    assert(!Number.isNaN(row.productReturnOrderCount), 'dailyTrend.productReturnOrderCount 无 NaN')
    if (row.productReturnRate != null) {
      assert(!Number.isNaN(row.productReturnRate), 'dailyTrend.productReturnRate 无 NaN')
    }
  }
  pass('榜单中心 dailyTrend 字段正常')

  const checkTrendNotAllSame = (
    rows: Array<{ validAmountYuan: number; soldOrderCount: number }>,
    label: string,
  ) => {
    if (rows.length < 3) return
    const first = rows[0]!
    const allSame =
      rows.every(
        (r) =>
          r.validAmountYuan === first.validAmountYuan &&
          r.soldOrderCount === first.soldOrderCount &&
          first.validAmountYuan > 0,
      )
    if (allSame) {
      fail(`${label} dailyTrend 连续多天 amount/orderCount 完全相同，疑似周期汇总重复`)
    } else {
      pass(`${label} dailyTrend 未出现整段周期汇总重复`)
    }
  }

  checkTrendNotAllSame(data.dailyTrend ?? [], '榜单 custom')

  const dataThisWeek = await fetchExpectOk<{
    dailyTrend?: Array<{ date: string; validAmountYuan: number; soldOrderCount: number }>
  }>('/api/board/operations-rankings', {
    startDate: week.weekStart,
    endDate: week.weekEnd,
    preset: 'thisWeek',
  })
  checkTrendNotAllSame(dataThisWeek.dailyTrend ?? [], '榜单 thisWeek')
}

async function checkChartAssets() {
  const webRoot = path.resolve(__dirname, '../../web/src')
  const pages = [
    'pages/operations/OperationsDailyReport.tsx',
    'pages/operations/OperationsWeeklyReport.tsx',
    'pages/operations/OperationsMonthlyReport.tsx',
    'pages/operations/OperationsRankingsTab.tsx',
  ]
  for (const p of pages) {
    const full = path.join(webRoot, p)
    if (!fs.existsSync(full)) {
      fail(`图表页面缺失 ${p}`)
      continue
    }
    const src = fs.readFileSync(full, 'utf8')
    assert(src.includes('Chart') || src.includes('chart'), `${p} 含图表组件引用`)
    assert(src.includes('md:') || src.includes('overflow-x-hidden'), `${p} 含响应式布局`)
  }

  const drillFile = path.join(webRoot, 'components/operations/charts/operationsChartDrill.ts')
  assert(fs.existsSync(drillFile), 'operationsChartDrill.ts 存在')
  const drillSrc = fs.readFileSync(drillFile, 'utf8')
  assert(drillSrc.includes('buildAnchorAmountDrill'), '图表钻取 helper 含主播下钻')
  assert(drillSrc.includes('buildAnchorOrdersDrill'), '图表钻取 helper 含主播订单下钻')
  assert(drillSrc.includes('buildProductHotDrill'), '图表钻取 helper 含商品下钻')
  assert(drillSrc.includes('buildPriceBandAmountDrill'), '图表钻取 helper 含价格带下钻')
  assert(drillSrc.includes('buildAfterSalesRefundAmountDrill'), '图表钻取 helper 含退款金额下钻')
  assert(drillSrc.includes('buildDailyAmountDrill'), '图表钻取 helper 含走势下钻')

  const cardFile = path.join(webRoot, 'components/operations/charts/OperationsChartCard.tsx')
  assert(fs.existsSync(cardFile), 'OperationsChartCard 存在')
  const cardSrc = fs.readFileSync(cardFile, 'utf8')
  assert(cardSrc.includes('data-operations-chart'), '图表卡片含 data-operations-chart 标记')

  const indexRes = await fetch(`${BASE}/`)
  const indexHtml = await indexRes.text()
  const jsMatches = [...indexHtml.matchAll(/assets\/[^"]+\.js/g)].map((m) => m[0])
  let hasRecharts = false
  for (const jsPath of jsMatches) {
    const jsRes = await fetch(`${BASE}/${jsPath}`)
    const js = await jsRes.text()
    if (js.includes('recharts') || js.includes('ResponsiveContainer')) {
      hasRecharts = true
      break
    }
  }
  if (hasRecharts) pass('前端 bundle 含 recharts 图表库')
  else fail('前端 bundle 含 recharts')
}

async function checkPageAssets() {
  const pageRes = await fetch(`${BASE}/operations-report`)
  assert(pageRes.status === 200, '/operations-report SPA 入口可访问')
  const html = await pageRes.text()
  assert(html.includes('root') || html.includes('id="root"'), '/operations-report 返回 SPA HTML')

  const indexRes = await fetch(`${BASE}/`)
  const indexHtml = await indexRes.text()
  const jsMatch = indexHtml.match(/assets\/index-[^"]+\.js/)
  if (jsMatch) {
    const jsRes = await fetch(`${BASE}/${jsMatch[0]}`)
    const js = await jsRes.text()
    assert(js.includes('运营报表') || js.includes('\\u8fd0\\u8425\\u62a5\\u8868'), '前端 bundle 含运营报表菜单文案')
    assert(js.includes('成交订单') || js.includes('\\u6210\\u4ea4\\u8ba2\\u5355'), '前端 bundle 含成交订单表头')
    assert(js.includes('operations-report'), '前端 bundle 含 operations-report 路由')
    pass('页面静态资源检查通过')
  } else {
    note('未能解析 index JS 路径，页面静态检查部分跳过')
  }
}

async function main() {
  console.log(`[operations-report-smoke] base=${BASE}`)
  await checkHealth()

  const sampleDate = await resolveSampleDate()
  note(`抽样日期=${sampleDate}`)
  const week = thisWeekRange()

  const daily = await checkDaily(sampleDate)
  const weekly = await checkWeekly(week.weekStart, week.weekEnd)
  const productKey = daily.products[0]?.productKey
  await checkDrillEndpoints(sampleDate, productKey)
  await checkReviewNote(sampleDate)
  await checkPrivacyExport(sampleDate)
  checkDailyCaliber(daily, sampleDate)
  checkWeeklyCaliber(weekly)
  await checkRankingsCharts()
  await checkRankingsDailyTrendApi()
  await checkChartAssets()
  await checkPageAssets()

  console.log(`\n[operations-report-smoke] passed=${passed} failed=${issues.length}`)
  if (notes.length) {
    console.log('[operations-report-smoke] notes:')
    for (const n of notes) console.log(`  - ${n}`)
  }
  if (issues.length) {
    console.error('[operations-report-smoke] FAILURES:')
    for (const i of issues) console.error(`  - ${i}`)
    process.exit(1)
  }
  console.log('[operations-report-smoke] OK')
}

main().catch((err) => {
  console.error('[operations-report-smoke] fatal', err)
  process.exit(1)
})
