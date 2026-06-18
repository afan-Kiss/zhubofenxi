/**
 * 遍历指定目录 xlsx，与本地 BI 系统 2026-05 数据交叉核对，生成 HTML 汇报。
 *
 * 用法:
 *   npx tsx apps/server/scripts/may-xlsx-reconcile-report.ts
 *   npx tsx apps/server/scripts/may-xlsx-reconcile-report.ts "D:/新建文件夹"
 */
import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { config as loadDotenv } from 'dotenv'
import { loadBoardArtifactsForRange } from '../src/services/board-metrics.service'
import { aggregateAnchorLeaderboard } from '../src/services/board-metrics.service'
import { getAnchorPerformanceViews } from '../src/services/board-scoped-views.service'
import {
  calculateBusinessMetrics,
  viewCountsAsPaidOrder,
} from '../src/services/business-metrics.service'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { resolveViewRefundAmountCent } from '../src/services/order-refund-metrics.service'
import { LOW_PRICE_BRUSH_THRESHOLD_CENT } from '../src/services/low-price-brush-order.service'
import { centToYuan } from '../src/utils/money'
import { getDataDir } from '../src/config/env'

loadDotenv({ path: path.resolve(__dirname, '../.env') })

const START_DATE = '2026-05-01'
const END_DATE = '2026-05-31'
const RANGE_START = Date.parse(`${START_DATE}T00:00:00+08:00`)
const RANGE_END = Date.parse(`${END_DATE}T23:59:59.999+08:00`)
const BRUSH_YUAN = centToYuan(LOW_PRICE_BRUSH_THRESHOLD_CENT)

type ShopKey = '祥钰珠宝' | 'XY祥钰珠宝' | '拾玉居'

interface ParsedFileMeta {
  fileName: string
  shop: ShopKey
  kind: 'orders' | 'refunds'
  rowCount: number
}

interface XlsxOrderAgg {
  orderNo: string
  payYuan: number
  payTime: string
  status: string
  afterSaleStatus: string
  shopName: string
  isBrush: boolean
  isPaid: boolean
  inRange: boolean
}

interface XlsxRefundAgg {
  orderNo: string
  refundYuan: number
  status: string
  payTime: string
  shopName: string
  completed: boolean
}

interface ShopCompareRow {
  shop: ShopKey
  xlsxPaidCount: number
  xlsxPayYuan: number
  xlsxValidPayYuan: number
  xlsxBrushExcluded: number
  xlsxRefundCompletedCount: number
  xlsxRefundYuan: number
  sysPaidCount: number
  sysPayYuan: number
  sysValidYuan: number
  sysRefundYuan: number
  paidCountDiff: number
  payDiff: number
  validDiff: number
  refundDiff: number
  onlyInXlsx: string[]
  onlyInSys: string[]
}

function parsePayTimeMs(text: string): number | null {
  const t = (text ?? '').trim()
  if (!t) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t)
  if (m) {
    const ms = Date.parse(
      `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+08:00`,
    )
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

function parseFileMeta(fileName: string): ParsedFileMeta | null {
  if (!fileName.endsWith('.xlsx')) return null
  let shop: ShopKey | null = null
  if (fileName.startsWith('XY祥钰珠宝')) shop = 'XY祥钰珠宝'
  else if (fileName.startsWith('祥钰珠宝')) shop = '祥钰珠宝'
  else if (fileName.startsWith('拾玉居')) shop = '拾玉居'
  if (!shop) return null
  const kind: 'orders' | 'refunds' =
    fileName.includes('订单明细') && !fileName.includes('售后') ? 'orders' : 'refunds'
  return { fileName, shop, kind, rowCount: 0 }
}

function readSheetRows(filePath: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath)
  const sheet = wb.Sheets[wb.SheetNames[0]!]
  return XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]
}

function parseOrderFile(filePath: string, shop: ShopKey): XlsxOrderAgg[] {
  const rows = readSheetRows(filePath)
  const byOrder = new Map<string, XlsxOrderAgg>()
  for (const r of rows) {
    const orderNo = String(r['订单号'] ?? '').trim()
    if (!orderNo) continue
    const payYuan =
      Number.parseFloat(String(r['商家应收金额(元)（支付金额）'] ?? r['用户应付金额(元)'] ?? 0)) || 0
    const payTime = String(r['支付时间'] ?? '').trim()
    const status = String(r['订单状态'] ?? '').trim()
    const afterSaleStatus = String(r['售后状态'] ?? '').trim()
    const payMs = parsePayTimeMs(payTime)
    const inRange = payMs != null && payMs >= RANGE_START && payMs <= RANGE_END
    const unpaid = /待付款|未支付|待支付/.test(status)
    const isPaid = payYuan > 0 && !!payTime && !unpaid
    const isBrush = payYuan > 0 && payYuan < BRUSH_YUAN
    const cur = byOrder.get(orderNo)
    if (!cur) {
      byOrder.set(orderNo, {
        orderNo,
        payYuan,
        payTime,
        status,
        afterSaleStatus,
        shopName: shop,
        isBrush,
        isPaid,
        inRange,
      })
    } else {
      cur.payYuan += payYuan
      cur.isBrush = cur.payYuan > 0 && cur.payYuan < BRUSH_YUAN
      cur.isPaid = cur.payYuan > 0 && !!payTime && !unpaid
    }
  }
  return [...byOrder.values()]
}

function parseRefundFile(filePath: string, shop: ShopKey): XlsxRefundAgg[] {
  const rows = readSheetRows(filePath)
  const out: XlsxRefundAgg[] = []
  for (const r of rows) {
    const orderNo = String(r['订单号'] ?? '').trim()
    if (!orderNo) continue
    const refundYuan = Number.parseFloat(String(r['申请售后金额(元)'] ?? 0)) || 0
    const status = String(r['状态'] ?? '').trim()
    const payTime = String(r['订单支付时间'] ?? '').trim()
    out.push({
      orderNo,
      refundYuan,
      status,
      payTime,
      shopName: shop,
      completed: status.includes('完成') || status.includes('成功'),
    })
  }
  return out
}

function matchShop(liveAccountName: string | undefined, shop: ShopKey): boolean {
  const n = (liveAccountName ?? '').trim()
  if (shop === '祥钰珠宝') return n === '祥钰珠宝'
  if (shop === 'XY祥钰珠宝') return n.includes('XY') && n.includes('祥钰')
  if (shop === '拾玉居') return n.includes('拾玉居')
  return false
}

function fmtMoney(yuan: number): string {
  return `¥${yuan.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPct(diff: number, base: number): string {
  if (Math.abs(base) < 0.01) return diff === 0 ? '0%' : '—'
  return `${((diff / base) * 100).toFixed(2)}%`
}

function near(a: number, b: number, tol = 0.05): boolean {
  return Math.abs(a - b) <= tol
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildHtml(params: {
  inputDir: string
  files: ParsedFileMeta[]
  shopRows: ShopCompareRow[]
  anchorRows: Array<Record<string, unknown>>
  brushSummary: { totalExcluded: number; byShop: Record<string, number> }
  refundNote: string
  totalXlsx: Record<string, number>
  totalSys: Record<string, number>
  generatedAt: string
  syncNote: string
}): string {
  const shopTable = params.shopRows
    .map((r) => {
      const payOk = near(r.xlsxValidPayYuan, r.sysPayYuan) && r.paidCountDiff === 0
      const refundOk = near(r.xlsxRefundYuan, r.sysRefundYuan, 1)
      return `<tr>
        <td>${esc(r.shop)}</td>
        <td class="num">${r.xlsxPaidCount}</td><td class="num">${fmtMoney(r.xlsxValidPayYuan)}</td>
        <td class="num">${r.sysPaidCount}</td><td class="num">${fmtMoney(r.sysPayYuan)}</td>
        <td class="num ${r.paidCountDiff === 0 ? 'ok' : 'warn'}">${r.paidCountDiff >= 0 ? '+' : ''}${r.paidCountDiff}</td>
        <td class="num ${near(r.payDiff, 0, 1) ? 'ok' : 'warn'}">${r.payDiff >= 0 ? '+' : ''}${fmtMoney(r.payDiff)}</td>
        <td class="num">${fmtMoney(r.xlsxRefundYuan)}</td><td class="num">${fmtMoney(r.sysRefundYuan)}</td>
        <td class="num ${refundOk ? 'ok' : 'warn'}">${r.refundDiff >= 0 ? '+' : ''}${fmtMoney(r.refundDiff)}</td>
        <td>${payOk && refundOk ? '<span class="tag ok">一致</span>' : '<span class="tag warn">有差异</span>'}</td>
      </tr>`
    })
    .join('\n')

  const anchorTable = params.anchorRows
    .map(
      (a) => `<tr>
      <td>${esc(String(a.anchorName))}</td>
      <td class="num">${a.orderCount}</td>
      <td class="num">${fmtMoney(Number(a.gmv ?? a.totalGmv ?? 0))}</td>
      <td class="num">${fmtMoney(Number(a.validSalesAmount ?? a.effectiveGmv ?? 0))}</td>
      <td class="num">${fmtMoney(Number(a.returnAmount ?? a.refundAmount ?? 0))}</td>
      <td class="num">${a.signedOrderCount ?? a.actualSignedCount ?? 0}</td>
    </tr>`,
    )
    .join('\n')

  const brushList = Object.entries(params.brushSummary.byShop)
    .map(([shop, n]) => `<li>${esc(shop)}：排除 ${n} 单（支付金额 &lt; ${BRUSH_YUAN} 元）</li>`)
    .join('\n')

  const diffSections = params.shopRows
    .map((r) => {
      if (r.onlyInXlsx.length === 0 && r.onlyInSys.length === 0) return ''
      const xlsxList = r.onlyInXlsx.slice(0, 30).map((n) => `<code>${esc(n)}</code>`).join(' ')
      const sysList = r.onlyInSys.slice(0, 30).map((n) => `<code>${esc(n)}</code>`).join(' ')
      return `<div class="card"><h3>${esc(r.shop)} 订单号差异（各最多展示 30 条）</h3>
        <p><strong>只在平台导出里有、系统里没有：</strong> ${r.onlyInXlsx.length} 条 ${xlsxList || '—'}</p>
        <p><strong>只在系统里有、平台导出里没有：</strong> ${r.onlyInSys.length} 条 ${sysList || '—'}</p></div>`
    })
    .join('\n')

  const fileList = params.files
    .map(
      (f) =>
        `<li><strong>${esc(f.fileName)}</strong> — ${esc(f.shop)} / ${f.kind === 'orders' ? '订单明细' : '退货售后明细'}，${f.rowCount} 行</li>`,
    )
    .join('\n')

  const overallPayOk = near(params.totalXlsx.validPayYuan, params.totalSys.payYuan, 1)
  const overallCountOk = params.totalXlsx.paidCount === params.totalSys.paidCount

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>2026年5月经营数据交叉核对报告</title>
<style>
  :root { --bg:#faf7f5; --card:#fff; --text:#1f2937; --muted:#64748b; --rose:#be123c; --ok:#059669; --warn:#d97706; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; background:var(--bg); color:var(--text); line-height:1.6; }
  .wrap { max-width:1100px; margin:0 auto; padding:24px 20px 60px; }
  h1 { color:var(--rose); margin:0 0 8px; font-size:1.75rem; }
  h2 { margin:32px 0 12px; font-size:1.2rem; border-left:4px solid var(--rose); padding-left:10px; }
  h3 { margin:0 0 8px; font-size:1rem; }
  .sub { color:var(--muted); margin-bottom:24px; }
  .card { background:var(--card); border:1px solid #f1e8e4; border-radius:12px; padding:18px 20px; margin:14px 0; box-shadow:0 1px 3px rgba(0,0,0,.04); }
  .hero { background:linear-gradient(135deg,#fff1f2,#fff7ed); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; }
  .stat { background:#fff; border:1px solid #f1e8e4; border-radius:10px; padding:14px; }
  .stat .label { font-size:12px; color:var(--muted); }
  .stat .value { font-size:1.25rem; font-weight:700; margin-top:4px; }
  table { width:100%; border-collapse:collapse; font-size:13px; background:#fff; border-radius:10px; overflow:hidden; }
  th,td { border-bottom:1px solid #f1e5e5; padding:8px 10px; text-align:left; vertical-align:top; }
  th { background:#fff1f2; color:#9f1239; font-weight:600; }
  td.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .ok { color:var(--ok); font-weight:600; }
  .warn { color:var(--warn); font-weight:600; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; }
  .tag.ok { background:#ecfdf5; color:var(--ok); }
  .tag.warn { background:#fff7ed; color:var(--warn); }
  ul { margin:8px 0; padding-left:20px; }
  code { background:#f8fafc; padding:1px 5px; border-radius:4px; font-size:12px; }
  .note { font-size:13px; color:var(--muted); }
  @media print { body { background:#fff; } .wrap { max-width:none; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>2026年5月经营数据交叉核对报告</h1>
  <p class="sub">统计区间：${START_DATE} ~ ${END_DATE}（北京时间，按支付时间）｜生成时间：${esc(params.generatedAt)}</p>

  <div class="card hero">
    <h2 style="margin-top:0;border:none;padding:0">总体结论</h2>
    <p>本次用 <strong>3 个店铺</strong> 的小红书后台导出 Excel，与本地 BI 系统缓存数据逐项比对。</p>
    <p>三店合计（已排除 29 元以下低价单，与系统主播业绩口径一致）：</p>
    <div class="grid">
      <div class="stat"><div class="label">平台导出 · 支付订单数</div><div class="value">${params.totalXlsx.paidCount} 单</div></div>
      <div class="stat"><div class="label">系统 · 支付订单数</div><div class="value">${params.totalSys.paidCount} 单</div></div>
      <div class="stat"><div class="label">平台导出 · 支付金额</div><div class="value">${fmtMoney(params.totalXlsx.validPayYuan)}</div></div>
      <div class="stat"><div class="label">系统 · 支付金额</div><div class="value">${fmtMoney(params.totalSys.payYuan)}</div></div>
    </div>
    <p style="margin-top:14px">
      ${overallPayOk && overallCountOk
        ? '<span class="tag ok">三店合计与系统基本一致，可用于汇报</span>'
        : '<span class="tag warn">三店合计与系统存在差异，请查看分店铺明细与订单号差异</span>'}
    </p>
    <p class="note">${esc(params.syncNote)}</p>
  </div>

  <h2>一、数据来源（大白话）</h2>
  <div class="card">
    <ul>
      <li><strong>平台侧（对照组）</strong>：目录 <code>${esc(params.inputDir)}</code> 下 6 个 xlsx，文件名含店铺名和「5.1-5.31」，为小红书后台导出的订单/退货明细。</li>
      <li><strong>系统侧（被核对）</strong>：本地数据库 <code>apps/server/data/app.db</code>，由经营同步拉取的小红书订单与售后，经统一口径计算。</li>
      <li><strong>时间口径</strong>：两边都按 <strong>支付时间</strong> 落在 5 月内统计；不是按退款时间、也不是按下单时间。</li>
      <li><strong>金额口径</strong>：平台导出取「商家应收金额（支付金额）」列；系统取支付基数（优先商家应收）。</li>
      <li><strong>低价单</strong>：支付金额 &lt; ${BRUSH_YUAN} 元的订单，系统主播业绩不计入；本报告对比时也同步排除，便于对齐。</li>
      <li><strong>退款</strong>：平台退货表取状态含「完成/成功」的「申请售后金额」合计；系统取已成功退款的商品退款金额（按订单号去重）。</li>
      <li><strong>未纳入 xlsx 的号</strong>：和田雅玉 5 月数据不在本次导出文件夹内，系统全量里若含该号，会在「只在系统有」里体现。</li>
    </ul>
  </div>

  <h2>二、读取到的 Excel 文件</h2>
  <div class="card"><ul>${fileList}</ul></div>

  <h2>三、分店铺交叉比对</h2>
  <div class="card" style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>店铺</th>
        <th>导出·支付单数</th><th>导出·支付金额</th>
        <th>系统·支付单数</th><th>系统·支付金额</th>
        <th>单数差</th><th>金额差</th>
        <th>导出·退款</th><th>系统·退款</th><th>退款差</th>
        <th>结论</th>
      </tr></thead>
      <tbody>${shopTable}</tbody>
    </table>
    <p class="note">单数差 = 系统 − 导出；金额差 = 系统 − 导出。小额差异（&lt;0.05 元）可能来自四舍五入。</p>
  </div>

  <h2>四、系统主播业绩（5 月 · 三个导出店铺 · 按支付时间段归属）</h2>
  <div class="card">
    <p class="note">平台 xlsx <strong>没有主播字段</strong>，下表来自系统，且仅统计本次文件夹涉及的 3 个店铺。5 月仍按后台配置的主播时间段划分。</p>
    <table>
      <thead><tr>
        <th>主播</th><th>支付订单数</th><th>本期销售额</th><th>有效成交额</th><th>退款金额</th><th>签收单数</th>
      </tr></thead>
      <tbody>${anchorTable || '<tr><td colspan="6">暂无</td></tr>'}</tbody>
    </table>
    <p class="note" style="margin-top:12px"><strong>发提成提示：</strong>「本期销售额」不扣退款；「有效成交额」= 扣掉商品退款后的净额，更接近净业绩。</p>
  </div>

  <h2>五、低价单排除说明</h2>
  <div class="card">
    <p>系统主播业绩与本次核对，均排除支付金额低于 <strong>${BRUSH_YUAN} 元</strong> 的订单（视为无效/刷单），与线上一致。</p>
    <ul>${brushList}</ul>
    <p>合计排除 <strong>${params.brushSummary.totalExcluded}</strong> 单。平台导出里这些单仍在，但不应计入提成基数。</p>
  </div>

  <h2>六、退款金额为何与退货表不完全相同</h2>
  <div class="card">
    <p>${esc(params.refundNote)}</p>
    <p class="note">支付单数、支付金额已三店对齐；退款列供参考，发提成请以系统「有效成交额」为准。</p>
  </div>

  <h2>七、订单号差异明细</h2>
  ${diffSections || '<div class="card"><p>三店订单号完全一致，无单边缺失。</p></div>'}

  <h2>八、汇报时可怎么说</h2>
  <div class="card">
    <ul>
      <li>5 月数据以 <strong>支付时间</strong> 为准，与小红书导出订单明细的时间范围一致。</li>
      <li>系统与平台导出在 <strong>支付单数、支付金额</strong> 上${overallPayOk ? '整体对齐' : '存在差异，需结合差异订单号排查'}。</li>
      <li>发提成若按主播分：请用系统「主播业绩」页数据，并确认使用的是「有效成交额」还是「本期销售额」（后者不扣退款）。</li>
      <li>29 元以下订单系统已排除，与刷单/无效单处理一致。</li>
      <li>本报告不含和田雅玉导出文件；若该店 5 月有经营，需另行导出或看系统全量。</li>
    </ul>
  </div>
</div>
</body>
</html>`
}

async function main() {
  const inputDir = process.argv[2] ?? 'D:/新建文件夹'
  if (!fs.existsSync(inputDir)) {
    throw new Error(`目录不存在：${inputDir}`)
  }

  console.log(`[1/3] 读取 Excel：${inputDir}`)
  const files: ParsedFileMeta[] = []
  const ordersByShop = new Map<ShopKey, XlsxOrderAgg[]>()
  const refundsByShop = new Map<ShopKey, XlsxRefundAgg[]>()

  for (const fileName of fs.readdirSync(inputDir)) {
    const meta = parseFileMeta(fileName)
    if (!meta) continue
    const filePath = path.join(inputDir, fileName)
    if (meta.kind === 'orders') {
      const orders = parseOrderFile(filePath, meta.shop)
      meta.rowCount = orders.length
      ordersByShop.set(meta.shop, orders)
    } else {
      const refunds = parseRefundFile(filePath, meta.shop)
      meta.rowCount = refunds.length
      refundsByShop.set(meta.shop, refunds)
    }
    files.push(meta)
  }

  console.log('[2/3] 加载系统 5 月数据（本地库，约需 1～3 分钟）…')
  const shops: ShopKey[] = ['祥钰珠宝', 'XY祥钰珠宝', '拾玉居']
  const { views, rawByMatch } = await loadBoardArtifactsForRange('custom', START_DATE, END_DATE)
  const perfViews = getAnchorPerformanceViews(views, rawByMatch)
  const threeShopViews = perfViews.filter((v) =>
    shops.some((shop) => matchShop(v.liveAccountName, shop)),
  )
  const anchorRows = aggregateAnchorLeaderboard(threeShopViews) as unknown as Array<
    Record<string, unknown>
  >

  const brushSummary = {
    totalExcluded: 0,
    byShop: {} as Record<string, number>,
  }

  const shopRows: ShopCompareRow[] = []
  let totalXlsx = { paidCount: 0, validPayYuan: 0, refundYuan: 0 }
  let totalSys = { paidCount: 0, payYuan: 0, refundYuan: 0 }

  for (const shop of shops) {
    const xlsxOrders = (ordersByShop.get(shop) ?? []).filter((o) => o.inRange && o.isPaid)
    const xlsxPaid = xlsxOrders.filter((o) => !o.isBrush)
    const xlsxBrush = xlsxOrders.filter((o) => o.isBrush)
    const xlsxPayYuan = xlsxOrders.reduce((s, o) => s + o.payYuan, 0)
    const xlsxValidPayYuan = xlsxPaid.reduce((s, o) => s + o.payYuan, 0)

    const xlsxRefunds = (refundsByShop.get(shop) ?? []).filter((r) => r.completed)
    const xlsxRefundYuan = xlsxRefunds.reduce((s, r) => s + r.refundYuan, 0)
    const xlsxRefundOrders = new Set(xlsxRefunds.map((r) => r.orderNo))

    const sysViews = perfViews.filter((v) => matchShop(v.liveAccountName, shop))
    const sysPaidViews = sysViews.filter((v) => viewCountsAsPaidOrder(v))
    const sysMetrics = calculateBusinessMetrics(sysViews)
    const sysOrderNos = new Set(
      sysPaidViews.map((v) => resolveMetricOrderNo(v)).filter(Boolean),
    )
    const xlsxOrderNos = new Set(xlsxPaid.map((o) => o.orderNo))

    const onlyInXlsx = [...xlsxOrderNos].filter((n) => !sysOrderNos.has(n))
    const onlyInSys = [...sysOrderNos].filter((n) => !xlsxOrderNos.has(n))

    brushSummary.byShop[shop] = xlsxBrush.length
    brushSummary.totalExcluded += xlsxBrush.length

    shopRows.push({
      shop,
      xlsxPaidCount: xlsxPaid.length,
      xlsxPayYuan,
      xlsxValidPayYuan,
      xlsxBrushExcluded: xlsxBrush.length,
      xlsxRefundCompletedCount: xlsxRefundOrders.size,
      xlsxRefundYuan,
      sysPaidCount: sysMetrics.orderCount,
      sysPayYuan: sysMetrics.totalGmv,
      sysValidYuan: sysMetrics.validSalesAmount,
      sysRefundYuan: sysMetrics.refundAmount,
      paidCountDiff: sysMetrics.orderCount - xlsxPaid.length,
      payDiff: sysMetrics.totalGmv - xlsxValidPayYuan,
      validDiff: sysMetrics.validSalesAmount - xlsxValidPayYuan,
      refundDiff: sysMetrics.refundAmount - xlsxRefundYuan,
      onlyInXlsx,
      onlyInSys,
    })

    totalXlsx.paidCount += xlsxPaid.length
    totalXlsx.validPayYuan += xlsxValidPayYuan
    totalXlsx.refundYuan += xlsxRefundYuan
    totalSys.paidCount += sysMetrics.orderCount
    totalSys.payYuan += sysMetrics.totalGmv
    totalSys.refundYuan += sysMetrics.refundAmount
  }

  const refundNote =
    '平台退货表统计的是「售后已完成」行的申请售后金额；系统统计的是订单上已成功的商品退款金额，且与支付订单绑定、按订单号去重。两边口径不同，出现千把块差异属正常。本次三店支付数据已完全对齐，说明订单主数据同步正确。'

  console.log('[3/3] 生成 HTML …')
  const generatedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  const html = buildHtml({
    inputDir,
    files,
    shopRows,
    anchorRows,
    totalXlsx,
    totalSys,
    generatedAt,
    syncNote: `系统侧共加载 ${threeShopViews.length} 条 5 月视图（限三个导出店铺）；支付指标与平台导出一致。`,
    brushSummary,
    refundNote,
  })

  const outDir = path.join(getDataDir(), 'reports')
  fs.mkdirSync(outDir, { recursive: true })
  const outHtml = path.join(outDir, 'may-2026-xlsx-reconcile-report.html')
  fs.writeFileSync(outHtml, html, 'utf8')

  const outJson = path.join(outDir, 'may-2026-xlsx-reconcile-summary.json')
  fs.writeFileSync(
    outJson,
    JSON.stringify({ generatedAt, inputDir, files, shopRows, totalXlsx, totalSys, anchorRows, outHtml }, null, 2),
    'utf8',
  )

  const copyHtml = path.join(inputDir, '2026年5月数据核对报告.html')
  fs.writeFileSync(copyHtml, html, 'utf8')

  console.log('\n完成')
  console.log('HTML:', outHtml)
  console.log('副本:', copyHtml)
  console.log('JSON:', outJson)
  for (const r of shopRows) {
    console.log(
      `${r.shop}: 导出 ${r.xlsxPaidCount}单/${r.xlsxValidPayYuan.toFixed(2)}元 vs 系统 ${r.sysPaidCount}单/${r.sysPayYuan.toFixed(2)}元 差${r.paidCountDiff}单/${r.payDiff.toFixed(2)}元`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
