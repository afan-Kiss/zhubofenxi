/**
 * 从小红书接口拉取指定月份订单+售后，生成 ChatGPT 分析文本。
 *
 * 用法:
 *   npx tsx apps/server/scripts/may-2026-chatgpt-export.ts
 *
 * 环境: apps/server/.env（Cookie 加密密钥 + 本地 DB 中的直播号 Cookie）
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadEnv, getDataDir } from '../src/config/env'
import { resolveDateRange } from '../src/utils/date-range'
import { formatDateTimeShanghai } from '../src/utils/business-timezone'
import { LOW_PRICE_BRUSH_THRESHOLD_CENT } from '../src/services/low-price-brush-order.service'
import { listEnabledLiveAccountsWithCookie, getDecryptedCookieByAccountId } from '../src/services/live-account.service'
import { requestXhsApi } from '../src/services/xhs-api-sync/xhs-api-client.service'
import {
  buildOrderListBody,
  extractOrderPackages,
} from '../src/services/xhs-api-sync/xhs-order-sync.service'
import {
  extractApiHasMore,
  extractApiTotal,
  SAFE_MAX_PAGES,
  shouldStopPagination,
} from '../src/services/xhs-api-sync/xhs-page-pagination.util'
import { pickOfficialDisplayOrderNo } from '../src/services/order-display-no.service'
import { parseMoneyToCent } from '../src/utils/amount-parse.service'
import { enqueueXhsRequest } from '../src/services/xhs-api-sync/xhs-rate-limiter.service'
import { requestXhsJson } from '../src/services/xhs-http.service'
import {
  normalizeAfterSaleRecord,
  type NormalizedAfterSaleRecord,
} from '../src/services/xhs-after-sales-range.service'
import { extractAfterSalesList } from '../src/services/xhs-after-sales-workbench.service'
import { centToYuan } from '../src/utils/money'

loadEnv()

const START_DATE = '2026-05-01'
const END_DATE = '2026-05-31'
const EXCLUDE_SHOP_NAMES = new Set(['和田雅玉'])
const BRUSH_THRESHOLD_YUAN = centToYuan(LOW_PRICE_BRUSH_THRESHOLD_CENT)

const AFTER_SALES_URL = 'https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3'
const AFTER_SALES_REFERER = 'https://ark.xiaohongshu.com/app-order/aftersale/list'

interface ExportOrderRow {
  shopName: string
  orderId: string
  orderTime: string
  payTime: string
  orderStatus: string
  afterSaleStatus: string
  productName: string
  skuName: string
  quantity: number | null
  orderAmountYuan: number | null
  payAmountYuan: number | null
  refundAmountYuan: number | null
  shippingFeeYuan: number | null
  anchorName: string
  anchorRule: string
  isLowPriceBrush: boolean
  excludedAsBrush: boolean
  rawSource: string
}

interface ShopFetchMeta {
  shopName: string
  liveAccountId: string
  orderApiTotal: number
  orderFetched: number
  orderPages: number
  afterSaleFetched: number
  afterSalePages: number
  brushExcluded: number
  warnings: string[]
}

function pickString(raw: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

function yuanFromRaw(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const pair = raw[k]
    if (pair == null || pair === '') continue
    const parsed = parseMoneyToCent(pair, undefined, k)
    if (parsed.cent > 0) return centToYuan(parsed.cent)
  }
  return null
}

function paymentBaseCentFromPackage(pkg: Record<string, unknown>): number {
  const keys = [
    'actual_seller_receive_amount',
    'actualSellerReceiveAmount',
    'sellerReceiveAmount',
    'pay_amount',
    'payAmount',
    'receivable_amount',
    'receivableAmount',
    'totalPayAmount',
    'total_pay_amount',
  ]
  for (const k of keys) {
    const v = pkg[k]
    if (v == null || v === '') continue
    const parsed = parseMoneyToCent(v, undefined, k)
    if (parsed.cent > 0) return parsed.cent
  }
  return 0
}

function parseOrderTimeMs(pkg: Record<string, unknown>): number | null {
  const raw = pkg.orderedAt ?? pkg.paidAt ?? pkg.ordered_at ?? pkg.paid_at ?? pkg.orderTime
  if (raw == null) return null
  if (typeof raw === 'number') {
    const ms = raw < 1e12 ? raw * 1000 : raw
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Date.parse(String(raw))
  return Number.isFinite(ms) ? ms : null
}

function formatOrderTimeText(pkg: Record<string, unknown>): string {
  const ms = parseOrderTimeMs(pkg)
  if (ms == null) return pickString(pkg, ['orderedAtText', 'orderTimeText', 'ordered_at_text']) || '—'
  return formatDateTimeShanghai(new Date(ms))
}

function shanghaiClockMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

function resolveAnchorByOrderTime(orderTimeMs: number | null): { anchorName: string; rule: string } {
  if (orderTimeMs == null) {
    return { anchorName: '未归属', rule: '缺少下单时间' }
  }
  const minutes = shanghaiClockMinutes(orderTimeMs)
  const morningStart = 8 * 60 + 30
  const morningEnd = 14 * 60 + 59
  const eveningStart = 18 * 60
  const eveningEnd = 23 * 60 + 59
  if (minutes >= morningStart && minutes <= morningEnd) {
    return { anchorName: '子杰', rule: '早场 08:30~14:59 下单' }
  }
  if (minutes >= eveningStart && minutes <= eveningEnd) {
    return { anchorName: '飞云', rule: '晚场 18:00~23:59 下单' }
  }
  return { anchorName: '未归属', rule: '不在早场/晚场时间段' }
}

function pickProductName(pkg: Record<string, unknown>): string {
  const skus = pkg.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    const name = first.skuName ?? first.displayName ?? first.name ?? first.productName
    if (name != null && String(name).trim()) return String(name).trim()
  }
  return pickString(pkg, ['productName', 'product_name', 'title', 'goodsName', 'goods_name']) || '—'
}

function pickSkuName(pkg: Record<string, unknown>): string {
  const skus = pkg.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    const name = first.skuSpec ?? first.spec ?? first.skuName ?? first.displayName
    if (name != null && String(name).trim()) return String(name).trim()
  }
  return pickString(pkg, ['skuName', 'sku_name', 'spec']) || '—'
}

function pickQuantity(pkg: Record<string, unknown>): number | null {
  const skus = pkg.skus
  if (Array.isArray(skus) && skus.length > 0) {
    let total = 0
    for (const row of skus) {
      if (!row || typeof row !== 'object') continue
      const sku = row as Record<string, unknown>
      const n = Number(sku.skuQuantity ?? sku.quantity ?? sku.qty ?? 1)
      total += Number.isFinite(n) && n > 0 ? n : 1
    }
    return total > 0 ? total : null
  }
  const n = Number(pkg.quantity ?? pkg.qty)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

function mapPackageToOrderRow(
  pkg: Record<string, unknown>,
  shopName: string,
  includeBrush: boolean,
): ExportOrderRow | null {
  const payCent = paymentBaseCentFromPackage(pkg)
  const isLowPriceBrush = payCent > 0 && payCent < LOW_PRICE_BRUSH_THRESHOLD_CENT
  if (isLowPriceBrush && !includeBrush) return null

  const orderTimeMs = parseOrderTimeMs(pkg)
  const anchor = resolveAnchorByOrderTime(orderTimeMs)
  const display = pickOfficialDisplayOrderNo(pkg)

  return {
    shopName,
    orderId: display.displayOrderNo || pickString(pkg, ['packageId', 'package_id', 'orderId']) || '—',
    orderTime: formatOrderTimeText(pkg),
    payTime: pickString(pkg, ['paidAt', 'paid_at', 'payTime', 'pay_time']) || formatOrderTimeText(pkg),
    orderStatus: pickString(pkg, ['statusDesc', 'status_desc', 'orderStatusDesc', 'statusName', 'status']) || '—',
    afterSaleStatus:
      pickString(pkg, ['afterSaleStatusDesc', 'after_sale_status_desc', 'afterSaleStatus']) || '—',
    productName: pickProductName(pkg),
    skuName: pickSkuName(pkg),
    quantity: pickQuantity(pkg),
    orderAmountYuan: yuanFromRaw(pkg, ['totalOrderAmount', 'total_order_amount', 'receivableAmount', 'receivable_amount']),
    payAmountYuan: payCent > 0 ? centToYuan(payCent) : null,
    refundAmountYuan: yuanFromRaw(pkg, ['refundAmount', 'refund_amount', 'afterSaleRefundAmount']),
    shippingFeeYuan: yuanFromRaw(pkg, ['shippingFee', 'shipping_fee', 'freightAmount', 'freight_amount']),
    anchorName: anchor.anchorName,
    anchorRule: anchor.rule,
    isLowPriceBrush,
    excludedAsBrush: isLowPriceBrush,
    rawSource: 'xiaohongshu_api',
  }
}

function buildAfterSalesQueryUrl(page: number, pageSize: number, startMs: number, endMs: number): string {
  const u = new URL(AFTER_SALES_URL)
  u.searchParams.set('page', String(page))
  u.searchParams.set('number', String(pageSize))
  u.searchParams.append('goods_source[]', '1')
  u.searchParams.append('goods_source[]', '2')
  u.searchParams.set('create_time_begin', String(startMs))
  u.searchParams.set('create_time_end', String(endMs))
  u.searchParams.set('return_type_in', '3,4,1,2,5')
  u.searchParams.set('sort', 'deadline_for_sort_v1')
  u.searchParams.set('order', 'asc')
  u.searchParams.set('status_in', '1,2,3,12,13,4,5,6,9,9001,14')
  return u.toString()
}

async function fetchOrdersForAccount(params: {
  liveAccountId: string
  shopName: string
  startDate: string
  endDate: string
}): Promise<{ packages: Record<string, unknown>[]; meta: Partial<ShopFetchMeta> }> {
  const range = resolveDateRange('custom', params.startDate, params.endDate)
  const warnings: string[] = []
  const packages: Record<string, unknown>[] = []
  const pageSize = 50
  let pageNo = 1
  let total = 0
  let pageCount = 0

  while (pageNo <= SAFE_MAX_PAGES) {
    process.stdout.write(`  [${params.shopName}] 订单第 ${pageNo} 页...\n`)
    const res = await requestXhsApi({
      apiKey: 'order_list',
      liveAccountId: params.liveAccountId,
      liveAccountName: params.shopName,
      body: buildOrderListBody(pageNo, pageSize, range.startTimeMs, range.endTimeMs),
      context: { triggerSource: 'script:may-2026-export' },
    })
    pageCount++
    if (!res.ok || !res.data) {
      warnings.push(res.errorMessage ?? `订单第 ${pageNo} 页失败`)
      break
    }
    const pagePackages = extractOrderPackages(res.data)
    total = extractApiTotal(res.data) || total
    packages.push(...pagePackages)
    if (
      shouldStopPagination({
        rowsThisPage: pagePackages.length,
        pageSize,
        pageNo,
        hasMore: extractApiHasMore(res.data),
        totalEstimate: total,
        accumulatedRows: packages.length,
      })
    ) {
      break
    }
    pageNo++
  }

  const dedup = new Map<string, Record<string, unknown>>()
  for (const pkg of packages) {
    const picked = pickOfficialDisplayOrderNo(pkg)
    const key =
      picked.displayOrderNo?.trim() ||
      pickString(pkg, ['packageId', 'package_id', 'orderId', 'order_id']) ||
      `row:${dedup.size}`
    if (!dedup.has(key)) dedup.set(key, pkg)
  }

  return {
    packages: [...dedup.values()],
    meta: {
      orderApiTotal: total,
      orderFetched: dedup.size,
      orderPages: pageCount,
      warnings,
    },
  }
}

async function fetchAfterSalesForAccount(params: {
  liveAccountId: string
  shopName: string
  startMs: number
  endMs: number
}): Promise<{ records: NormalizedAfterSaleRecord[]; pageCount: number; warnings: string[] }> {
  const warnings: string[] = []
  const records: NormalizedAfterSaleRecord[] = []
  const seen = new Set<string>()
  const pageSize = 50
  let page = 1
  let pageCount = 0

  let cookie: string
  try {
    cookie = await getDecryptedCookieByAccountId(params.liveAccountId)
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : 'Cookie 不可用')
    return { records, pageCount, warnings }
  }

  while (page <= SAFE_MAX_PAGES) {
    process.stdout.write(`  [${params.shopName}] 售后第 ${page} 页...\n`)
    const url = buildAfterSalesQueryUrl(page, pageSize, params.startMs, params.endMs)
    let payload: unknown
    try {
      payload = await enqueueXhsRequest(() =>
        requestXhsJson<unknown>({
          method: 'GET',
          url,
          cookie,
          referer: AFTER_SALES_REFERER,
          needSign: true,
          parseEnvelope: true,
        }),
      )
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : `售后第 ${page} 页失败`)
      break
    }
    pageCount++
    const list = extractAfterSalesList(payload)
    for (const rec of list) {
      const normalized = normalizeAfterSaleRecord(rec)
      if (!normalized) continue
      const key = `${normalized.returnId || normalized.orderNo}:${normalized.statusName}`
      if (seen.has(key)) continue
      seen.add(key)
      records.push(normalized)
    }
    const total = extractApiTotal(payload)
    if (
      shouldStopPagination({
        rowsThisPage: list.length,
        pageSize,
        pageNo: page,
        hasMore: extractApiHasMore(payload),
        totalEstimate: total,
        accumulatedRows: records.length,
      })
    ) {
      break
    }
    page++
  }

  return { records, pageCount, warnings }
}

function displayValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number' && !Number.isFinite(value)) return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  const text = String(value).trim()
  return text || '—'
}

function formatMoney(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan)) return '—'
  return yuan.toFixed(2)
}

function formatOrderBlock(order: ExportOrderRow, index: number): string {
  return [
    `【订单 ${index + 1}】`,
    `- 店铺：${displayValue(order.shopName)}`,
    `- 订单号：${displayValue(order.orderId)}`,
    `- 下单时间：${displayValue(order.orderTime)}`,
    `- 支付时间：${displayValue(order.payTime)}`,
    `- 商品名称：${displayValue(order.productName)}`,
    `- SKU/规格：${displayValue(order.skuName)}`,
    `- 件数：${displayValue(order.quantity)}`,
    `- 订单金额：${formatMoney(order.orderAmountYuan)}`,
    `- 实付/计入金额：${formatMoney(order.payAmountYuan)}`,
    `- 退款金额：${formatMoney(order.refundAmountYuan)}`,
    `- 运费：${formatMoney(order.shippingFeeYuan)}`,
    `- 订单状态：${displayValue(order.orderStatus)}`,
    `- 售后状态：${displayValue(order.afterSaleStatus)}`,
    `- 是否低价刷单(<29元)：${displayValue(order.isLowPriceBrush)}`,
    `- 匹配主播：${displayValue(order.anchorName)}`,
    `- 归属规则：${displayValue(order.anchorRule)}`,
    `- 数据来源：${displayValue(order.rawSource)}`,
  ].join('\n')
}

function formatAfterSaleBlock(rec: NormalizedAfterSaleRecord, shopName: string, index: number): string {
  return [
    `【售后 ${index + 1}】`,
    `- 店铺：${displayValue(shopName)}`,
    `- 订单号：${displayValue(rec.orderNo)}`,
    `- 售后单号：${displayValue(rec.returnId)}`,
    `- 申请时间：${displayValue(rec.applyTime)}`,
    `- 退款时间：${displayValue(rec.refundTime)}`,
    `- 售后状态：${displayValue(rec.statusName)}`,
    `- 退款状态：${displayValue(rec.refundStatusName)}`,
    `- 售后类型：${displayValue(rec.returnTypeName)}`,
    `- 售后原因：${displayValue(rec.reason)}`,
    `- 申请金额：${formatMoney(rec.appliedAmountCent > 0 ? centToYuan(rec.appliedAmountCent) : null)}`,
    `- 退款金额：${formatMoney(rec.refundAmountCent > 0 ? centToYuan(rec.refundAmountCent) : null)}`,
    `- 订单支付金额：${formatMoney(rec.payAmountCent > 0 ? centToYuan(rec.payAmountCent) : null)}`,
    `- 数据来源：xiaohongshu_api`,
  ].join('\n')
}

function buildChatGptText(params: {
  rangeLabel: string
  shops: ShopFetchMeta[]
  orders: ExportOrderRow[]
  afterSales: Array<{ shopName: string; record: NormalizedAfterSaleRecord }>
  brushExcludedCount: number
}): string {
  const shopSummary = params.shops
    .map(
      (s) =>
        `- ${s.shopName}：订单接口总数 ${s.orderApiTotal}，实际拉取 ${s.orderFetched} 条（${s.orderPages} 页）；售后 ${s.afterSaleFetched} 条（${s.afterSalePages} 页）`,
    )
    .join('\n')

  const anchorSummary = ['子杰', '飞云', '未归属'].map((name) => {
    const list = params.orders.filter((o) => o.anchorName === name)
    const amount = list.reduce((sum, o) => sum + (o.payAmountYuan ?? 0), 0)
    return `- ${name}：${list.length} 单，实付/计入合计 ${amount.toFixed(2)} 元`
  })

  const orderBlocks = params.orders.map((o, i) => formatOrderBlock(o, i)).join('\n\n')
  const afterSaleBlocks = params.afterSales
    .map((row, i) => formatAfterSaleBlock(row.record, row.shopName, i))
    .join('\n\n')

  const warnings = params.shops.flatMap((s) => s.warnings.map((w) => `- [${s.shopName}] ${w}`))

  return [
    '请根据下面 2026 年 5 月小红书原始订单与售后数据，帮我分析三个店铺（不含和田雅玉新号）的经营情况、主播表现、售后风险。',
    '',
    '分析要求：',
    '1. 分别按店铺、按主播（子杰/飞云）给出结论。',
    '2. 早场 08:30~14:59 下单归子杰；晚场 18:00~23:59 下单归飞云。',
    '3. 已排除实付/计入金额低于 29 元的低价刷单订单。',
    '4. 不要编造订单号、金额、主播名。',
    '5. 重点看：真实成交、关闭/售后、退款、各店铺差异。',
    '6. 输出 5~8 条老板能看懂的建议。',
    '',
    `分析时间段：${params.rangeLabel}`,
    '',
    '参与店铺（已从接口 POST/GET 拉取，不含和田雅玉）：',
    shopSummary,
    '',
    '主播归属汇总（按下单时间规则，已排除<29元刷单）：',
    ...anchorSummary,
    '',
    `已排除低价刷单(<29元)订单数：${params.brushExcludedCount}`,
    '',
    warnings.length > 0 ? '接口警告：\n' + warnings.join('\n') + '\n' : '',
    '订单明细（已排除<29元刷单）：',
    orderBlocks || '—',
    '',
    '售后明细（按售后申请时间范围接口拉取）：',
    afterSaleBlocks || '—',
    '',
    '数据说明：',
    '1. 订单来自 POST https://ark.xiaohongshu.com/api/edith/fulfillment/order/page',
    '2. 售后来自 GET https://ark.xiaohongshu.com/api/edith/after-sales/returns/v3',
    '3. 买家隐私字段未写入本文本',
    '4. 和田雅玉为新号，本次未纳入',
    `5. 实付/计入低于 ${BRUSH_THRESHOLD_YUAN} 元的订单视为刷单已排除`,
  ].join('\n')
}

async function main() {
  const range = resolveDateRange('custom', START_DATE, END_DATE)
  const rangeLabel = `${formatDateTimeShanghai(new Date(range.startTimeMs))} ~ ${formatDateTimeShanghai(new Date(range.endTimeMs))}`

  const accounts = (await listEnabledLiveAccountsWithCookie()).filter(
    (a) => !EXCLUDE_SHOP_NAMES.has(a.name.trim()),
  )

  if (accounts.length === 0) {
    throw new Error('没有可用的直播号 Cookie（或全部被排除）')
  }

  console.log(`开始拉取 ${START_DATE} ~ ${END_DATE}，店铺：${accounts.map((a) => a.name).join('、')}`)

  const allOrders: ExportOrderRow[] = []
  const allAfterSales: Array<{ shopName: string; record: NormalizedAfterSaleRecord }> = []
  const shopMetas: ShopFetchMeta[] = []
  let brushExcludedCount = 0

  for (const account of accounts) {
    console.log(`\n=== ${account.name} ===`)
    const orderResult = await fetchOrdersForAccount({
      liveAccountId: account.id,
      shopName: account.name,
      startDate: START_DATE,
      endDate: END_DATE,
    })

    let shopBrushExcluded = 0
    for (const pkg of orderResult.packages) {
      const payCent = paymentBaseCentFromPackage(pkg)
      const isBrush = payCent > 0 && payCent < LOW_PRICE_BRUSH_THRESHOLD_CENT
      if (isBrush) {
        shopBrushExcluded++
        continue
      }
      const row = mapPackageToOrderRow(pkg, account.name, false)
      if (row) allOrders.push(row)
    }
    brushExcludedCount += shopBrushExcluded

    const afterSaleResult = await fetchAfterSalesForAccount({
      liveAccountId: account.id,
      shopName: account.name,
      startMs: range.startTimeMs,
      endMs: range.endTimeMs,
    })

    for (const rec of afterSaleResult.records) {
      allAfterSales.push({ shopName: account.name, record: rec })
    }

    shopMetas.push({
      shopName: account.name,
      liveAccountId: account.id,
      orderApiTotal: orderResult.meta.orderApiTotal ?? 0,
      orderFetched: orderResult.meta.orderFetched ?? 0,
      orderPages: orderResult.meta.orderPages ?? 0,
      afterSaleFetched: afterSaleResult.records.length,
      afterSalePages: afterSaleResult.pageCount,
      brushExcluded: shopBrushExcluded,
      warnings: [...(orderResult.meta.warnings ?? []), ...afterSaleResult.warnings],
    })
  }

  allOrders.sort((a, b) => a.orderTime.localeCompare(b.orderTime))
  allAfterSales.sort((a, b) =>
    String(a.record.applyTime ?? '').localeCompare(String(b.record.applyTime ?? '')),
  )

  const text = buildChatGptText({
    rangeLabel,
    shops: shopMetas,
    orders: allOrders,
    afterSales: allAfterSales,
    brushExcludedCount,
  })

  const outDir = path.join(getDataDir(), 'exports')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'may-2026-chatgpt-data.txt')
  fs.writeFileSync(outPath, text, 'utf8')

  const summaryPath = path.join(outDir, 'may-2026-chatgpt-summary.json')
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        range: { startDate: START_DATE, endDate: END_DATE, label: rangeLabel },
        excludedShops: [...EXCLUDE_SHOP_NAMES],
        shops: shopMetas,
        orderCountIncluded: allOrders.length,
        afterSaleCount: allAfterSales.length,
        brushExcludedCount,
        outputFile: outPath,
      },
      null,
      2,
    ),
    'utf8',
  )

  console.log('\n完成。')
  console.log(`订单（已排除<29元）：${allOrders.length}`)
  console.log(`售后：${allAfterSales.length}`)
  console.log(`排除刷单：${brushExcludedCount}`)
  console.log(`输出：${outPath}`)
  console.log(`摘要：${summaryPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
