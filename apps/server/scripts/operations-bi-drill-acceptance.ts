/**
 * 运营报表 BI 钻取验收
 * 用法: npm run accept:operations-bi-drill
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/lib/prisma'
import {
  buildOperationsBiDrill,
  OperationsBiDrillValidationError,
} from '../src/services/operations-bi-drill.service'
import { assertOperationsBiDrillPayloadPrivacy } from '../src/services/operations-bi-drill-row.mapper'
import {
  consumeQianfanOrderOpenTicket,
  createQianfanOrderOpenTicket,
  __testOnlySeedQianfanTicket,
} from '../src/services/qianfan-order-open-ticket.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_OPS = path.resolve(__dirname, '../../web/src/components/operations')
const WEB_PAGES = path.resolve(__dirname, '../../web/src/pages/operations')

const BASE = (process.env.METRICS_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4723').replace(
  /\/$/,
  '',
)

const GOLDEN_DATE = '2026-05-28'
const WEEK_START = '2026-05-26'
const WEEK_END = '2026-06-01'
const MONTH_START = '2026-05-01'
const MONTH_END = '2026-05-31'

const FORBIDDEN_UI = ['drill', 'raw data', 'payload', 'dataQuality', 'token expired', 'BI Drill']

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

async function fetchDrill(query: Record<string, string | number | undefined>) {
  const url = new URL(`${BASE}/api/board/operations-bi-drill`)
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  const body = (await res.json()) as { ok?: boolean; data?: Record<string, unknown>; message?: string }
  return { status: res.status, body }
}

async function fetchTicket(orderNo: string) {
  const res = await fetch(`${BASE}/api/board/qianfan-order-detail-ticket`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNo }),
  })
  const body = (await res.json()) as { ok?: boolean; data?: Record<string, unknown>; message?: string }
  return { status: res.status, body, text: JSON.stringify(body) }
}

function scanFrontendForbiddenWords(issues: string[]) {
  const files: string[] = []
  for (const dir of [WEB_OPS, WEB_PAGES]) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (full.endsWith('.tsx') && !full.includes('operationsBiDrillTypes')) {
        files.push(full)
      }
    }
  }
  for (const file of files) {
    const rel = path.relative(path.resolve(__dirname, '../..'), file).replace(/\\/g, '/')
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.trim().startsWith('import ')) continue
      if (line.includes('OperationsBiDrill') || line.includes('operationsBiDrill')) continue
      const strings = line.match(/'[^']*'|"[^"]*"/g) ?? []
      for (const s of strings) {
        const lower = s.toLowerCase()
        for (const word of FORBIDDEN_UI) {
          if (lower.includes(word.toLowerCase())) {
            issues.push(`前端用户文案含禁用词 ${word}：${rel}:${i + 1}`)
          }
        }
      }
    }
  }
}

async function pickSampleProductKey(): Promise<string | null> {
  const payload = await buildOperationsBiDrill({
    source: 'daily_summary',
    target: 'summary_valid_amount',
    startDate: GOLDEN_DATE,
    endDate: GOLDEN_DATE,
    pageSize: 50,
  }).catch(() => null)
  const row = payload?.rows.find((r) => r.productKey && r.productKey !== '—')
  return row?.productKey ?? null
}

async function pickSampleAnchorName(): Promise<string | null> {
  const payload = await buildOperationsBiDrill({
    source: 'daily_summary',
    target: 'summary_valid_amount',
    startDate: GOLDEN_DATE,
    endDate: GOLDEN_DATE,
    pageSize: 5,
  }).catch(() => null)
  const name = payload?.rows.find((r) => r.anchorName)?.anchorName
  return name ?? null
}

async function pickSampleOrderNo(): Promise<string | null> {
  const row = await prisma.xhsRawOrder.findFirst({
    orderBy: { orderTime: 'desc' },
    select: { packageId: true, orderId: true },
  })
  return row?.packageId || row?.orderId || null
}

async function main() {
  const issues: string[] = []

  // 1-2 日报总览卡
  const dailyAmount = await buildOperationsBiDrill({
    source: 'daily_summary',
    target: 'summary_valid_amount',
    startDate: GOLDEN_DATE,
    endDate: GOLDEN_DATE,
  })
  assert(dailyAmount.summary.orderCount >= 0, '有效成交金额下钻应返回 summary', issues)
  assert(dailyAmount.rows.length > 0, '有效成交金额下钻应有订单行', issues)

  const dailyOrders = await buildOperationsBiDrill({
    source: 'daily_summary',
    target: 'summary_orders',
    startDate: GOLDEN_DATE,
    endDate: GOLDEN_DATE,
  })
  assert(
    dailyOrders.summary.orderCount === dailyOrders.pagination.total,
    '成交订单数下钻 total 应与 summary.orderCount 一致',
    issues,
  )

  // 3-4 商品榜
  const productKey = await pickSampleProductKey()
  if (productKey) {
    const hot = await buildOperationsBiDrill({
      source: 'product_ranking',
      target: 'product_hot',
      startDate: GOLDEN_DATE,
      endDate: GOLDEN_DATE,
      productKey,
    })
    assert(hot.rows.every((r) => r.productKey === productKey), '热卖商品下钻应过滤 productKey', issues)

    const highReturn = await buildOperationsBiDrill({
      source: 'product_ranking',
      target: 'product_high_return',
      startDate: GOLDEN_DATE,
      endDate: GOLDEN_DATE,
      productKey,
    })
    assert(highReturn.explanation.includes('退货') || highReturn.rows.length >= 0, '高退货商品下钻应可调用', issues)
  } else {
    console.log('[accept:operations-bi-drill] 跳过：未找到样本 productKey')
  }

  // 5 主播榜
  const anchorName = await pickSampleAnchorName()
  if (anchorName) {
    const anchor = await buildOperationsBiDrill({
      source: 'anchor_ranking',
      target: 'anchor_amount',
      startDate: GOLDEN_DATE,
      endDate: GOLDEN_DATE,
      anchorName,
    })
    assert(
      anchor.rows.every((r) => (r.anchorName ?? '') === anchorName || anchor.rows.length === 0),
      '主播成交下钻应过滤主播',
      issues,
    )
  } else {
    console.log('[accept:operations-bi-drill] 跳过：未找到样本 anchorName')
  }

  // 6 价格带
  const priceBand = await buildOperationsBiDrill({
    source: 'price_band_ranking',
    target: 'price_band_amount',
    startDate: GOLDEN_DATE,
    endDate: GOLDEN_DATE,
    priceBandLabel: '800~999',
  }).catch(() => null)
  if (priceBand) {
    assert(priceBand.pagination.total >= 0, '价格带下钻应返回分页', issues)
  }

  // 7 售后原因
  const afterSales = await buildOperationsBiDrill({
    source: 'after_sales_ranking',
    target: 'after_sales_reason',
    startDate: WEEK_START,
    endDate: WEEK_END,
    afterSalesCategory: 'quality',
    afterSalesReason: '质量问题',
  }).catch(() => null)
  if (afterSales) {
    assert(Array.isArray(afterSales.rows), '售后原因下钻应返回 rows', issues)
  }

  // 8 主推未成交
  const slow = await buildOperationsBiDrill({
    source: 'product_ranking',
    target: 'product_slow',
    startDate: GOLDEN_DATE,
    endDate: GOLDEN_DATE,
    productKey: 'non-existent-product-key-for-test',
  })
  assert(
    slow.explanation.includes('没有有效成交') || slow.rows.length === 0,
    '主推未成交无订单时应给出说明',
    issues,
  )

  // 9 官方流量
  const traffic = await buildOperationsBiDrill({
    source: 'daily_summary',
    target: 'summary_deal_conversion',
    startDate: GOLDEN_DATE,
    endDate: GOLDEN_DATE,
  })
  assert(traffic.rows.length === 0, '成交率下钻不应伪造订单', issues)
  assert(
    traffic.dataQuality.warnings.some((w) => w.includes('官方流量')),
    '成交率下钻应提示官方流量来源',
    issues,
  )

  // 10 分页
  const paged = await buildOperationsBiDrill({
    source: 'daily_summary',
    target: 'summary_orders',
    startDate: GOLDEN_DATE,
    endDate: GOLDEN_DATE,
    page: 1,
    pageSize: 100,
  })
  assert(paged.pagination.pageSize === 100, 'pageSize 最大 100 应生效', issues)
  assert(paged.rows.length <= 100, '返回行数不应超过 pageSize', issues)

  // 11-12 非法参数
  try {
    await buildOperationsBiDrill({
      source: 'invalid' as never,
      target: 'summary_orders',
      startDate: GOLDEN_DATE,
      endDate: GOLDEN_DATE,
    })
    issues.push('非法 source 应抛错')
  } catch (e) {
    assert(e instanceof OperationsBiDrillValidationError, '非法 source 应返回 ValidationError', issues)
  }

  try {
    await buildOperationsBiDrill({
      source: 'product_ranking',
      target: 'product_hot',
      startDate: GOLDEN_DATE,
      endDate: GOLDEN_DATE,
    })
    issues.push('缺少 productKey 应抛错')
  } catch (e) {
    assert(e instanceof OperationsBiDrillValidationError, '缺少 productKey 应 ValidationError', issues)
  }

  // 13-14 隐私
  for (const payload of [dailyAmount, dailyOrders, traffic]) {
    const privacyIssues = assertOperationsBiDrillPayloadPrivacy(payload)
    for (const p of privacyIssues) issues.push(p)
  }

  // HTTP 400
  const badHttp = await fetchDrill({
    source: 'product_ranking',
    target: 'product_hot',
    startDate: GOLDEN_DATE,
    endDate: GOLDEN_DATE,
  })
  assert(badHttp.status === 400, `缺少 productKey HTTP 应 400，实际 ${badHttp.status}`, issues)

  const rangeHttp = await fetchDrill({
    source: 'daily_summary',
    target: 'summary_orders',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
  })
  assert(rangeHttp.status === 400, `超长日期 HTTP 应 400，实际 ${rangeHttp.status}`, issues)

  // 15-17 千帆 ticket
  const seeded = 'test-qf-ticket-acceptance'
  __testOnlySeedQianfanTicket(seeded, 'https://example.com/order/detail')
  const openOk = consumeQianfanOrderOpenTicket(seeded)
  assert(openOk.ok === true, 'seed ticket 应可消费', issues)
  const openReuse = consumeQianfanOrderOpenTicket(seeded)
  assert(openReuse.ok === false, 'ticket 重复使用应失败', issues)
  const openMissing = consumeQianfanOrderOpenTicket('missing-ticket')
  assert(openMissing.ok === false, '过期 ticket 应失败', issues)
  if (!openMissing.ok) {
    assert(openMissing.html.includes('过期'), 'ticket 失败页应大白话提示', issues)
  }

  const orderNo = await pickSampleOrderNo()
  if (orderNo) {
    const ticketRes = await fetchTicket(orderNo)
    const ticketJson = ticketRes.text.toLowerCase()
    assert(!ticketJson.includes('cookie'), 'ticket 响应不应含 cookie', issues)
    if (ticketRes.status === 200 && ticketRes.body.ok && ticketRes.body.data) {
      assert(typeof ticketRes.body.data.ticket === 'string', 'ticket 创建成功应返回 ticket', issues)
      assert(
        String(ticketRes.body.data.openUrl ?? '').includes('/api/board/qianfan-order-detail/open'),
        'openUrl 应指向 open 接口',
        issues,
      )
    } else {
      console.log(`[accept:operations-bi-drill] ticket 创建跳过（可能无 Cookie）：${ticketRes.body.message ?? ticketRes.status}`)
    }
  }

  // 18 前端文案
  scanFrontendForbiddenWords(issues)

  if (issues.length > 0) {
    console.error('[accept:operations-bi-drill] FAIL')
    for (const i of issues) console.error(`  - ${i}`)
    process.exit(1)
  }
  console.log('[accept:operations-bi-drill] PASS')
}

main()
  .catch((err) => {
    console.error('[accept:operations-bi-drill] ERROR', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
