/**
 * 四店 HAR 关账门禁：2026-06 GMV/支付单数
 * - 无有效支付时间不得计入 GMV/支付单数（禁止用 orderedAt 替代）
 * - 区间 [2026-06-01 00:00:00, 2026-07-01 00:00:00) Asia/Shanghai
 * - HAR_SOFT=1 仅分析模式，不得冒充正式通过
 */
import fs from 'node:fs'
import path from 'node:path'
import { decodeHarContentText, shopFromHarFilename } from './lib/har-platform-bundle'
import { extractAfterSalesList } from '../src/services/xhs-after-sales-workbench.service'
import {
  isFreightOnlyRefund,
  resolveBusinessProductRefundAmountCent,
  yuanApiAmountToCent,
} from '../src/services/business-refund-caliber.service'
import { isSuccessfulAfterSale } from '../src/services/strict-after-sale-metrics.service'
import { parseMoneyToCent } from '../src/utils/money'

const RANGE_START_MS = Date.parse('2026-06-01T00:00:00+08:00')
const RANGE_END_MS = Date.parse('2026-07-01T00:00:00+08:00')
const EXPECT_TOTAL_GMV = 387_837
const EXPECT_ORDER_COUNT = 218

const REQUIRED_HAR_NAMES = ['拾玉居.har', '和田雅玉.har', 'XY祥钰珠宝.har', '祥钰珠宝.har']

const PAID_KEYS = [
  'actualPaid',
  'actualPaidWithoutDeposit',
  'actual_paid',
  'paidAmount',
  'payAmount',
  'paymentAmount',
  'orderPaidAmount',
  'buyerPayAmount',
  'realPayAmount',
  'statisticsPaidAmount',
] as const

const SELLER_RECV_KEYS = [
  'merchantReceivableAmount',
  'merchant_receivable_amount',
  'sellerReceiveAmount',
  'seller_receive_amount',
  'actualSellerReceiveAmount',
  'receivableAmount',
  'merchantAmount',
] as const

type RawHarOrder = {
  packageId: string
  orderId: string
  payYuan: number
  payCent: number
  paidAt: string
  paidAtRaw: string
  orderedAt: string
  statusText: string
  shop: string
  sourceFile: string
  sourceUrl: string
  pageHint: string
  completeness: number
}

function resolveHarDir(): string {
  const env = process.env.HAR_DIR?.trim()
  if (env) return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env)
  const desktop = 'C:/Users/6/Desktop'
  if (REQUIRED_HAR_NAMES.every((n) => fs.existsSync(path.join(desktop, n)))) return desktop
  return path.resolve(process.cwd(), 'debug/har')
}

function parseShanghaiMs(iso: string): number | null {
  const s = (iso || '').trim()
  if (!s) return null
  const normalized = s.includes('T') ? s : s.replace(' ', 'T')
  const withTz =
    /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}+08:00`
  const ms = Date.parse(withTz)
  return Number.isFinite(ms) ? ms : null
}

function inPayRange(paidAt: string): boolean {
  const ms = parseShanghaiMs(paidAt)
  if (ms == null) return false
  return ms >= RANGE_START_MS && ms < RANGE_END_MS
}

function pickCentFromKeys(pkg: Record<string, unknown>, keys: readonly string[]): number {
  for (const k of keys) {
    if (pkg[k] == null || pkg[k] === '') continue
    const parsed = parseMoneyToCent(pkg[k])
    if (parsed.ok && parsed.cent > 0) return parsed.cent
  }
  return 0
}

/** 与生产 pickPaymentBaseCent 一致：商家应收 > 实付 */
function pickPaidCent(pkg: Record<string, unknown>): number {
  const seller = pickCentFromKeys(pkg, SELLER_RECV_KEYS)
  if (seller > 0) return seller
  return pickCentFromKeys(pkg, PAID_KEYS)
}

function completenessScore(o: RawHarOrder): number {
  let score = 0
  if (o.paidAt) score += 8
  if (o.payCent > 0) score += 4
  if (o.orderedAt) score += 2
  if (o.statusText) score += 1
  if (o.packageId) score += 1
  return score
}

function uniqueRecs(recs: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>()
  for (const r of recs) {
    const id = String(r.returns_id ?? r.returnsId ?? r.return_id ?? JSON.stringify(r))
    if (!byId.has(id)) byId.set(id, r)
  }
  return [...byId.values()]
}

function parseOrdersDetailed(filePath: string): RawHarOrder[] {
  const base = path.basename(filePath)
  const shop = shopFromHarFilename(base)
  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw) as {
    log?: {
      entries?: Array<{
        request?: { url?: string }
        response?: { content?: { text?: string; encoding?: string } }
      }>
    }
  }
  const out: RawHarOrder[] = []
  for (const entry of parsed.log?.entries ?? []) {
    const url = entry.request?.url ?? ''
    if (!url.includes('/api/edith/fulfillment/order/page')) continue
    const pageHint = (() => {
      try {
        return new URL(url).searchParams.get('page') ?? new URL(url).searchParams.get('pageNo') ?? '?'
      } catch {
        return '?'
      }
    })()
    const text = decodeHarContentText(entry.response?.content ?? {})
    if (!text) continue
    let body: Record<string, unknown>
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    const data = (body.data ?? body) as Record<string, unknown>
    const packages = (data.packages ?? data.list ?? data.records ?? []) as Record<
      string,
      unknown
    >[]
    for (const pkg of packages) {
      const packageId = String(pkg.packageId ?? pkg.package_id ?? '').trim()
      const orderId = String(pkg.orderId ?? pkg.order_id ?? '').trim()
      const paidAtRaw = String(
        pkg.paidAt ?? pkg.paid_at ?? pkg.payTime ?? pkg.pay_time ?? pkg.paymentTime ?? '',
      ).trim()
      const orderedAt = String(pkg.orderedAt ?? pkg.ordered_at ?? pkg.orderTime ?? '').trim()
      const statusText = String(
        pkg.status ?? pkg.orderStatus ?? pkg.statusName ?? pkg.packageStatus ?? '',
      ).trim()
      const payCent = pickPaidCent(pkg)
      const o: RawHarOrder = {
        packageId,
        orderId,
        payYuan: payCent / 100,
        payCent,
        paidAt: paidAtRaw,
        paidAtRaw,
        orderedAt,
        statusText,
        shop,
        sourceFile: base,
        sourceUrl: url.slice(0, 160),
        pageHint,
        completeness: 0,
      }
      o.completeness = completenessScore(o)
      out.push(o)
    }
  }
  return out
}

function parseReturnsFromHar(filePath: string): Record<string, unknown>[] {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw) as {
    log?: {
      entries?: Array<{
        request?: { url?: string }
        response?: { content?: { text?: string; encoding?: string } }
      }>
    }
  }
  const out: Record<string, unknown>[] = []
  for (const entry of parsed.log?.entries ?? []) {
    const url = entry.request?.url ?? ''
    if (!url.includes('/after-sales/returns/v3')) continue
    const text = decodeHarContentText(entry.response?.content ?? {})
    if (!text) continue
    try {
      out.push(...extractAfterSalesList(JSON.parse(text) as unknown))
    } catch {
      // skip
    }
  }
  return out
}

function dedupeKey(o: RawHarOrder): string {
  const no = (o.packageId || o.orderId || '').trim()
  return `${o.shop}::${no}`
}

function preferOrder(a: RawHarOrder, b: RawHarOrder): {
  winner: RawHarOrder
  conflict: boolean
} {
  if (a.payCent !== b.payCent && a.payCent > 0 && b.payCent > 0) {
    // 金额冲突：不默认取最大，标记冲突并选完整度更高者仅用于展示
    const winner = a.completeness >= b.completeness ? a : b
    return { winner, conflict: true }
  }
  if (a.completeness !== b.completeness) {
    return { winner: a.completeness > b.completeness ? a : b, conflict: false }
  }
  const aMs = parseShanghaiMs(a.paidAt) ?? 0
  const bMs = parseShanghaiMs(b.paidAt) ?? 0
  return { winner: aMs >= bMs ? a : b, conflict: false }
}

function main(): void {
  const soft = process.env.HAR_SOFT === '1'
  console.log('verify:four-shop-har-june\n')
  const harDir = resolveHarDir()
  console.log(`HAR_DIR=${harDir}`)
  console.log('区间: [2026-06-01 00:00:00, 2026-07-01 00:00:00) Asia/Shanghai')

  const missing = REQUIRED_HAR_NAMES.filter((n) => !fs.existsSync(path.join(harDir, n)))
  if (missing.length) {
    console.error(`缺少 HAR 文件: ${missing.join(', ')}`)
    process.exit(1)
  }

  const allRaw: RawHarOrder[] = []
  for (const name of REQUIRED_HAR_NAMES) {
    allRaw.push(...parseOrdersDetailed(path.join(harDir, name)))
  }

  const missingPayTime = allRaw.filter((o) => {
    const no = (o.packageId || o.orderId || '').trim()
    return no && /^P/i.test(no) && !o.paidAt
  })
  const withPay = allRaw.filter((o) => o.paidAt)
  const inRange = withPay.filter((o) => inPayRange(o.paidAt))
  const outOfRange = withPay.filter((o) => !inPayRange(o.paidAt))

  // 缺支付时间是否被其他分页补全
  const paidByShopP = new Set(
    withPay.map((o) => `${o.shop}::${(o.packageId || o.orderId || '').trim()}`),
  )

  console.log('\n--- 支付时间为空（已排除出 GMV/支付单数）---')
  for (const o of missingPayTime) {
    const no = (o.packageId || o.orderId || '').trim()
    const key = `${o.shop}::${no}`
    const filledElsewhere = paidByShopP.has(key)
    console.log(
      [
        no,
        `店铺=${o.shop}`,
        `下单时间=${o.orderedAt || '—'}`,
        `支付时间原字段=${o.paidAtRaw || '(空)'}`,
        `金额=${o.payYuan}`,
        `状态=${o.statusText || '—'}`,
        `排除原因=无有效支付时间`,
        `其它分页是否补全支付时间=${filledElsewhere ? 'Y' : 'N'}`,
        `文件=${o.sourceFile}`,
      ].join(' | '),
    )
  }
  console.log(`缺支付时间行数: ${missingPayTime.length}`)

  const amountConflicts: string[] = []
  const byShopP = new Map<string, RawHarOrder>()
  for (const o of inRange) {
    const no = (o.packageId || o.orderId || '').trim()
    if (!no || !/^P/i.test(no)) continue
    if (o.payCent <= 0) continue
    const key = dedupeKey(o)
    const prev = byShopP.get(key)
    if (!prev) {
      byShopP.set(key, o)
      continue
    }
    const { winner, conflict } = preferOrder(prev, o)
    if (conflict) amountConflicts.push(key)
    byShopP.set(key, winner)
  }

  const byP = new Map<string, RawHarOrder[]>()
  for (const o of byShopP.values()) {
    const no = (o.packageId || o.orderId || '').trim()
    const list = byP.get(no) ?? []
    list.push(o)
    byP.set(no, list)
  }
  const crossShopConflicts = [...byP.entries()].filter(([, list]) => {
    const shops = new Set(list.map((x) => x.shop))
    return shops.size > 1
  })

  const kept: RawHarOrder[] = []
  for (const [, list] of byP) {
    const shops = new Set(list.map((x) => x.shop))
    if (shops.size === 1) {
      kept.push(list[0]!)
    } else {
      kept.push(...list)
    }
  }

  let totalCent = 0
  for (const o of kept) totalCent += o.payCent
  const orderCount = kept.length
  const gmvRounded = Math.round(totalCent) / 100

  console.log(`\n原始 HAR 行: ${allRaw.length}`)
  console.log(`有支付时间: ${withPay.length}`)
  console.log(`区外支付时间: ${outOfRange.length}`)
  console.log(`区内（按支付时间）: ${inRange.length}`)
  console.log(`同店同P去重后: ${byShopP.size}`)
  console.log(`金额冲突键: ${amountConflicts.length}`)
  console.log(`跨店同P冲突组: ${crossShopConflicts.length}`)
  console.log(`最终纳入对比: ${orderCount} / 期望 ${EXPECT_ORDER_COUNT}`)
  console.log(`GMV: ${gmvRounded} / 期望 ${EXPECT_TOTAL_GMV}`)
  console.log(`差额: 单数 ${orderCount - EXPECT_ORDER_COUNT}，金额 ${gmvRounded - EXPECT_TOTAL_GMV}`)

  if (amountConflicts.length) {
    console.log('\n--- 同店同P金额冲突（未默认取最大）---')
    for (const k of amountConflicts.slice(0, 30)) console.log(k)
  }

  if (crossShopConflicts.length) {
    console.log('\n--- 跨店同P冲突（不得悄悄合并）---')
    for (const [p, list] of crossShopConflicts.slice(0, 30)) {
      console.log(`${p}: ` + list.map((x) => `${x.shop}/${x.payYuan}`).join(' ; '))
    }
  }

  const returnsByOrder = new Map<string, Record<string, unknown>[]>()
  for (const name of REQUIRED_HAR_NAMES) {
    for (const rec of parseReturnsFromHar(path.join(harDir, name))) {
      const no = String(
        rec.delivery_package_id ?? rec.packageId ?? rec.package_id ?? rec.order_id ?? '',
      ).trim()
      if (!no || !/^P/i.test(no)) continue
      const list = returnsByOrder.get(no) ?? []
      list.push(rec)
      returnsByOrder.set(no, list)
    }
  }
  let productRefundOrders = 0
  let freightOnlyOrders = 0
  for (const [, recs] of returnsByOrder) {
    let product = 0
    let freightOnly = false
    for (const rec of uniqueRecs(recs)) {
      if (!isSuccessfulAfterSale(rec)) continue
      if (isFreightOnlyRefund(rec)) {
        freightOnly = true
        void yuanApiAmountToCent(rec.refund_fee ?? 0)
      } else {
        product += resolveBusinessProductRefundAmountCent(rec)
      }
    }
    if (product > 0) productRefundOrders++
    else if (freightOnly) freightOnlyOrders++
  }
  console.log(
    `\n售后重算（HAR returns）：商品退款单=${productRefundOrders} 纯运费单=${freightOnlyOrders}`,
  )

  const gateFail =
    orderCount !== EXPECT_ORDER_COUNT || Math.round(gmvRounded) !== EXPECT_TOTAL_GMV

  if (gateFail) {
    console.error('\n未通过关账门禁：支付单数/GMV 与基线不一致。')
    console.error('禁止硬删订单；禁止用 HAR_SOFT=1 冒充正式通过。')
    if (soft) {
      console.log('\n分析模式完成，但未通过正式关账门禁')
      process.exit(0)
    }
    process.exit(1)
  }

  console.log('\nPASS（关账门禁：218 / 387837）')
}

main()
