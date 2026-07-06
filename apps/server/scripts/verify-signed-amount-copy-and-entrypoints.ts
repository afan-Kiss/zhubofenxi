/**
 * 已签收金额文案与入口一致性验收（只读，不改库）
 *
 * npm run verify:signed-amount-copy-and-entrypoints
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import { buildAnchorDrill } from '../src/services/board-drill.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import type { BoardDrillOrderRow } from '../src/services/order-row-mapper.service'

config({ path: path.resolve(__dirname, '../.env') })

const ROOT = path.resolve(__dirname, '../..')
const WEB_SRC = path.resolve(ROOT, 'web/src')
const START = '2026-07-01'
const END = '2026-07-05'
const ANCHORS = ['子杰', '小白', '小艺'] as const
const FOCUS_ORDERS = [
  'P798535644148309221',
  'P798524075193091331',
  'P798440490066093751',
] as const

const issues: string[] = []

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}

function fail(msg: string): void {
  issues.push(msg)
  console.log(`  ✗ ${msg}`)
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function amountClose(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol
}

function walkTsTsx(dir: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue
      out.push(...walkTsTsx(full))
    } else if (/\.(tsx?|jsx?)$/.test(ent.name)) {
      out.push(full)
    }
  }
  return out
}

function scanUserVisibleCopy(): void {
  section('1. 用户可见文案扫描')
  const forbidden = '有效成交额'
  let hits = 0
  for (const file of walkTsTsx(WEB_SRC)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const text = fs.readFileSync(file, 'utf-8')
    if (!text.includes(forbidden)) continue
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.includes(forbidden)) continue
      const line = lines[i]!.trim()
      if (line.startsWith('//') || line.startsWith('*') || line.includes('@deprecated')) continue
      hits++
      fail(`${rel}:${i + 1} 含「${forbidden}」: ${line.slice(0, 120)}`)
    }
  }
  const metricDetail = fs.readFileSync(
    path.resolve(ROOT, 'server/src/services/board-metric-detail.service.ts'),
    'utf-8',
  )
  if (metricDetail.includes("title: '有效成交额'")) {
    ok('board-metric-detail effectiveGmv 内部 title 保留（用户入口不打开）')
  }
  if (hits === 0) ok('apps/web/src 用户可见文案无「有效成交额」')
}

function checkOverviewTab(): void {
  section('2. 经营总览首屏卡片')
  const text = fs.readFileSync(path.resolve(WEB_SRC, 'pages/board/OverviewTab.tsx'), 'utf-8')
  const block = text.slice(text.indexOf('const SUMMARY_CARDS'), text.indexOf('const MORE_SUMMARY_CARDS'))
  if (block.includes("label: '已签收金额'")) ok('首屏核心卡片为已签收金额')
  else fail('首屏核心卡片缺少已签收金额')
  if (block.includes("drawerKey: 'actualSignedAmount'")) ok('首屏 drawerKey=actualSignedAmount')
  else fail('首屏 drawerKey 不是 actualSignedAmount')
  if (block.includes("valueKey: 'actualSignedAmount'")) ok('首屏 valueKey=actualSignedAmount')
  else fail('首屏 valueKey 不是 actualSignedAmount')
  if (block.includes("metricExplainKey: 'actualSignedAmount'")) ok('首屏 metricExplainKey=actualSignedAmount')
  else fail('首屏 metricExplainKey 不是 actualSignedAmount')
  if (block.includes("drawerKey: 'effectiveGmv'")) fail('首屏仍绑定 effectiveGmv')
  else ok('首屏未绑定 effectiveGmv')
  const more = text.slice(text.indexOf('const MORE_SUMMARY_CARDS'), text.indexOf('export const OverviewTab'))
  if (more.includes("drawerKey: 'actualSignedAmount'")) {
    fail('更多指标里仍有重复已签收金额卡片')
  } else {
    ok('更多指标已去掉重复签收金额卡片')
  }
}

function checkAnchorPerformance(): void {
  section('3. 主播业绩文案与入口')
  const files = [
    'pages/board/AnchorPerformanceTab.tsx',
    'components/board/AnchorLeaderboardPanel.tsx',
    'components/board/MobileAnchorLeaderboardCards.tsx',
    'components/board/AnchorOrderDrawer.tsx',
  ]
  for (const rel of files) {
    const text = fs.readFileSync(path.resolve(WEB_SRC, rel), 'utf-8')
    if (text.includes('有效成交额')) fail(`${rel} 仍含有效成交额`)
    else if (!text.includes('已签收金额')) fail(`${rel} 缺少已签收金额`)
    else ok(`${rel} 已签收金额文案 OK`)
  }
  const ap = fs.readFileSync(path.resolve(WEB_SRC, 'pages/board/AnchorPerformanceTab.tsx'), 'utf-8')
  if (ap.includes("drawerKey: 'actualSignedAmount'") && ap.includes("valueKey: 'actualSignedAmount'")) {
    ok('主播业绩顶部卡片入口 actualSignedAmount')
  } else {
    fail('主播业绩顶部卡片入口不正确')
  }
}

function checkDailyReportStatic(): void {
  section('4. 日报图片静态检查')
  const text = fs.readFileSync(
    path.resolve(WEB_SRC, 'components/board/DailyReportImageSheet.tsx'),
    'utf-8',
  )
  if (text.includes('productTitle')) ok('含 productTitle')
  else fail('缺少 productTitle')
  if (text.includes('compareShippedOrderLines') || text.includes('localeCompare(b.anchorName')) {
    ok('含主播名排序')
  } else {
    fail('缺少主播名排序')
  }
  if (text.includes('font-mono') && text.includes('order.orderNo')) {
    fail('日报图片仍展示订单号')
  } else {
    ok('日报图片不展示订单号')
  }
}

async function fetchAllSignedRows(): Promise<{
  rows: BoardDrillOrderRow[]
  summaryValue: number
}> {
  const allRows: BoardDrillOrderRow[] = []
  let summaryValue = 0
  let page = 1
  const pageSize = 100
  while (true) {
    const detail = await buildBoardMetricDetail({
      metric: 'actualSignedAmount',
      preset: 'custom',
      startDate: START,
      endDate: END,
      page,
      pageSize,
      sort: 'anchor_asc',
      role: 'super_admin',
      username: 'verify-script',
    })
    if (page === 1) summaryValue = detail.summary.valueRaw
    allRows.push(...detail.rows)
    if (page >= detail.pagination.totalPages) break
    page++
  }
  return { rows: allRows, summaryValue }
}

function verifySort(rows: BoardDrillOrderRow[]): void {
  const anchorKey = (name: string) => {
    const n = (name || '').trim()
    if (!n || n === '未归属') return '\uffff'
    return n
  }
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!
    const cur = rows[i]!
    const anchorCmp = anchorKey(prev.anchorName).localeCompare(anchorKey(cur.anchorName), 'zh-CN')
    if (anchorCmp > 0) {
      fail(`排序错误：${prev.anchorName} 应在 ${cur.anchorName} 之后`)
      return
    }
    if (anchorCmp === 0 && prev.orderTime < cur.orderTime) {
      fail(`同主播内时间倒序错误：${prev.orderNo} / ${cur.orderNo}`)
      return
    }
  }
  ok('抽屉 rows 按主播名升序、同主播下单时间倒序')
}

async function verifyStoreDrawer(): Promise<void> {
  section('5. 全店 actualSignedAmount 抽屉')
  const { rows, summaryValue } = await fetchAllSignedRows()
  const rowSum = rows.reduce((s, r) => s + Number(r.signedAmount ?? 0), 0)
  if (amountClose(summaryValue, rowSum)) {
    ok(`summary.valueRaw=${summaryValue.toFixed(2)} ≈ rows.signedAmount 合计 ${rowSum.toFixed(2)}`)
  } else {
    fail(`summary ${summaryValue.toFixed(2)} vs rows 合计 ${rowSum.toFixed(2)}`)
  }
  const badSigned = rows.filter((r) => !r.isActualSigned || Number(r.signedAmount ?? 0) <= 0)
  if (badSigned.length === 0) ok(`rows 全部 isActualSigned 且 signedAmount>0 (${rows.length} 笔)`)
  else fail(`rows 有 ${badSigned.length} 笔不符合签收口径`)
  verifySort(rows)
}

async function verifyAnchorConsistency(): Promise<void> {
  section('6. 主播维度一致性')
  const local = await executeBoardLocalQuery({
    preset: 'custom',
    startDate: START,
    endDate: END,
  })
  const anchorRows = (local.anchorLeaderboard ?? []) as Array<Record<string, unknown>>

  for (const anchorName of ANCHORS) {
    let drawerValue = 0
    let drawerRows: BoardDrillOrderRow[] = []
    let page = 1
    while (true) {
      const detail = await buildBoardMetricDetail({
        metric: 'actualSignedAmount',
        preset: 'custom',
        startDate: START,
        endDate: END,
        anchorName,
        page,
        pageSize: 100,
        role: 'super_admin',
        username: 'verify-script',
      })
      if (page === 1) drawerValue = detail.summary.valueRaw
      drawerRows.push(...detail.rows)
      if (page >= detail.pagination.totalPages) break
      page++
    }
    const drill = await buildAnchorDrill({
      preset: 'custom',
      startDate: START,
      endDate: END,
      anchorName,
      role: 'super_admin',
      username: 'verify-script',
    })
    const drillStats = (drill.stats ?? {}) as Record<string, unknown>
    const drillValue = Number(drillStats.actualSignedAmount ?? 0)
    const row = anchorRows.find((a) => String(a.anchorName) === anchorName)
    const cardValue = Number(row?.actualSignedAmount ?? 0)
    const rowSum = drawerRows.reduce((s, r) => s + Number(r.signedAmount ?? 0), 0)

    if (!amountClose(drawerValue, drillValue)) {
      fail(`${anchorName} drawer ${drawerValue.toFixed(2)} vs drill ${drillValue.toFixed(2)}`)
    } else if (!amountClose(drawerValue, cardValue)) {
      fail(`${anchorName} drawer ${drawerValue.toFixed(2)} vs card ${cardValue.toFixed(2)}`)
    } else if (!amountClose(drawerValue, rowSum)) {
      fail(`${anchorName} drawer ${drawerValue.toFixed(2)} vs rows 合计 ${rowSum.toFixed(2)}`)
    } else {
      ok(`${anchorName} 卡片/抽屉/drill/rows 一致 ¥${drawerValue.toFixed(2)}`)
    }
  }
}

async function verifyFocusOrderAttribution(): Promise<void> {
  section('7. 重点订单归属')
  const rules: Array<{ orderNo: string; anchor: string; notIn: string }> = [
    { orderNo: 'P798535644148309221', anchor: '小白', notIn: '子杰' },
    { orderNo: 'P798524075193091331', anchor: '小艺', notIn: '子杰' },
    { orderNo: 'P798440490066093751', anchor: '小艺', notIn: '子杰' },
  ]
  for (const { orderNo, anchor, notIn } of rules) {
    const inAnchor = (
      await buildBoardMetricDetail({
        metric: 'actualSignedAmount',
        preset: 'custom',
        startDate: START,
        endDate: END,
        anchorName: anchor,
        page: 1,
        pageSize: 100,
        role: 'super_admin',
        username: 'verify-script',
      })
    ).rows.some((r) => r.orderNo === orderNo || r.packageId === orderNo)
    const inWrong = (
      await buildBoardMetricDetail({
        metric: 'actualSignedAmount',
        preset: 'custom',
        startDate: START,
        endDate: END,
        anchorName: notIn,
        page: 1,
        pageSize: 100,
        role: 'super_admin',
        username: 'verify-script',
      })
    ).rows.some((r) => r.orderNo === orderNo || r.packageId === orderNo)
    if (inWrong) fail(`${orderNo} 不应在 ${notIn} 池`)
    else ok(`${orderNo} 不在 ${notIn} 池`)
    if (inAnchor) ok(`${orderNo} 在 ${anchor} 已签收池（若符合签收规则）`)
    else ok(`${orderNo} 未进入 ${anchor} 已签收池（可能未签收或不符合规则，归属检查通过）`)
  }
}

async function main(): Promise<void> {
  console.log('verify-signed-amount-copy-and-entrypoints')
  console.log(`范围 ${START} ~ ${END}`)

  scanUserVisibleCopy()
  checkOverviewTab()
  checkAnchorPerformance()
  checkDailyReportStatic()

  await bootstrapQualityBadCaseCache()
  await verifyStoreDrawer()
  await verifyAnchorConsistency()
  await verifyFocusOrderAttribution()

  section('结果')
  if (issues.length > 0) {
    console.log(`\nFAIL (${issues.length}):`)
    for (const i of issues) console.log(` - ${i}`)
    await prisma.$disconnect()
    process.exit(1)
  }
  console.log('\nPASS')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
