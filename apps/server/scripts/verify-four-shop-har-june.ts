/**
 * 四店 HAR 只读验收：2026-06 GMV/支付单数 + 与关账基线差异清单（禁止硬编码删单）
 *
 * HAR_DIR="C:/Users/6/Desktop" npm run verify:four-shop-har-june
 *
 * soft 仅本地分析：输出「未通过关账门禁」，exit 0 但不得冒充正式通过。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  decodeHarContentText,
  parseOrderHarFile,
  shopFromHarFilename,
} from './lib/har-platform-bundle'
import { extractAfterSalesList } from '../src/services/xhs-after-sales-workbench.service'
import {
  isFreightOnlyRefund,
  resolveBusinessProductRefundAmountCent,
  yuanApiAmountToCent,
} from '../src/services/business-refund-caliber.service'
import { isSuccessfulAfterSale } from '../src/services/strict-after-sale-metrics.service'

const START = '2026-06-01'
const END = '2026-06-30'
const EXPECT_TOTAL_GMV = 387_837
const EXPECT_ORDER_COUNT = 218

const REQUIRED_HAR_NAMES = ['拾玉居.har', '和田雅玉.har', 'XY祥钰珠宝.har', '祥钰珠宝.har']

type RawHarOrder = {
  packageId: string
  orderId: string
  payYuan: number
  paidAt: string
  orderedAt: string
  shop: string
  sourceFile: string
  sourceUrl: string
  pageHint: string
}

function resolveHarDir(): string {
  const env = process.env.HAR_DIR?.trim()
  if (env) return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env)
  const desktop = 'C:/Users/6/Desktop'
  if (REQUIRED_HAR_NAMES.every((n) => fs.existsSync(path.join(desktop, n)))) return desktop
  return path.resolve(process.cwd(), 'debug/har')
}

function inJune(iso: string): boolean {
  const d = (iso || '').replace('T', ' ').slice(0, 10)
  return d >= START && d <= END
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
      const paidAt = String(pkg.paidAt ?? pkg.paid_at ?? pkg.payTime ?? '').trim()
      const orderedAt = String(pkg.orderedAt ?? pkg.ordered_at ?? pkg.orderTime ?? '').trim()
      const payYuan = Number(pkg.actualPaid ?? pkg.actual_paid ?? 0) || 0
      out.push({
        packageId,
        orderId,
        payYuan,
        paidAt,
        orderedAt,
        shop,
        sourceFile: base,
        sourceUrl: url.slice(0, 160),
        pageHint,
      })
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

function main(): void {
  const soft = process.env.HAR_SOFT === '1'
  console.log('verify:four-shop-har-june\n')
  const harDir = resolveHarDir()
  console.log(`HAR_DIR=${harDir}`)

  const missing = REQUIRED_HAR_NAMES.filter((n) => !fs.existsSync(path.join(harDir, n)))
  if (missing.length) {
    console.error(`缺少 HAR 文件: ${missing.join(', ')}`)
    process.exit(1)
  }

  const allRaw: RawHarOrder[] = []
  for (const name of REQUIRED_HAR_NAMES) {
    allRaw.push(...parseOrdersDetailed(path.join(harDir, name)))
  }

  const outOfRange = allRaw.filter((o) => !inJune(o.paidAt || o.orderedAt))
  const inRange = allRaw.filter((o) => inJune(o.paidAt || o.orderedAt))

  // 同店同 P：保留支付金额最大、时间最新
  const byShopP = new Map<string, RawHarOrder>()
  const crossFileDupKeys: string[] = []
  for (const o of inRange) {
    const no = (o.packageId || o.orderId || '').trim()
    if (!no || !/^P/i.test(no)) continue
    const key = dedupeKey(o)
    const prev = byShopP.get(key)
    if (!prev) {
      byShopP.set(key, o)
      continue
    }
    crossFileDupKeys.push(key)
    if (o.payYuan > prev.payYuan || (o.paidAt || '') > (prev.paidAt || '')) {
      byShopP.set(key, o)
    }
  }

  // 跨店同 P 冲突
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

  // 关账基线不自动删；这里仅去重同店同 P，跨店冲突保留全部并标记
  const kept: RawHarOrder[] = []
  for (const [, list] of byP) {
    if (list.length === 1) {
      kept.push(list[0]!)
      continue
    }
    const shops = new Set(list.map((x) => x.shop))
    if (shops.size === 1) {
      kept.push(list.sort((a, b) => b.payYuan - a.payYuan)[0]!)
    } else {
      // 跨店冲突：暂不合并，计入并输出
      kept.push(...list)
    }
  }

  let totalGmv = 0
  for (const o of kept) totalGmv += o.payYuan
  const orderCount = kept.length
  const gmvRounded = Math.round(totalGmv)

  console.log(`原始 HAR 行（含区外）: ${allRaw.length}`)
  console.log(`区外支付时间: ${outOfRange.length}`)
  console.log(`区内原始行: ${inRange.length}`)
  console.log(`同店同P去重后: ${byShopP.size}`)
  console.log(`跨店同P冲突组: ${crossShopConflicts.length}`)
  console.log(`最终纳入对比: ${orderCount} / 期望 ${EXPECT_ORDER_COUNT}`)
  console.log(`GMV: ${gmvRounded} / 期望 ${EXPECT_TOTAL_GMV}`)
  console.log(`差额: 单数 ${orderCount - EXPECT_ORDER_COUNT}，金额 ${gmvRounded - EXPECT_TOTAL_GMV}`)

  // 逐单差异：相对基线无法直接对比订单集合时，输出「多出候选」——金额排序前 N
  if (orderCount > EXPECT_ORDER_COUNT) {
    const extraN = orderCount - EXPECT_ORDER_COUNT
    console.log(`\n--- 多出约 ${extraN} 单的候选清单（同店同P已去重后；禁止硬删）---`)
    const sorted = [...kept].sort((a, b) => (a.paidAt || '').localeCompare(b.paidAt || ''))
    // 列出全部交叉文件重复与跨店冲突 + 金额靠前区外错误纳入风险
    for (const o of sorted.slice(0, Math.min(40, sorted.length))) {
      const no = o.packageId || o.orderId
      const conflict = crossShopConflicts.find(([p]) => p === no)
      console.log(
        [
          no,
          `店铺=${o.shop}`,
          `支付=${o.payYuan}`,
          `支付时间=${o.paidAt}`,
          `下单时间=${o.orderedAt}`,
          `文件=${o.sourceFile}`,
          `页=${o.pageHint}`,
          conflict ? '跨店冲突=Y' : '跨店冲突=N',
          `URL=${o.sourceUrl.slice(0, 80)}`,
        ].join(' | '),
      )
    }
  }

  if (crossShopConflicts.length) {
    console.log('\n--- 跨店同P冲突（不得悄悄合并）---')
    for (const [p, list] of crossShopConflicts.slice(0, 30)) {
      console.log(
        `${p}: ` +
          list.map((x) => `${x.shop}/${x.payYuan}/${x.sourceFile}`).join(' ; '),
      )
    }
  }

  // 售后抽样重算
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
  for (const [no, recs] of returnsByOrder) {
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
    void no
  }
  console.log(
    `\n售后重算（HAR returns）：商品退款单=${productRefundOrders} 纯运费单=${freightOnlyOrders}（未硬编码月售后黄金值）`,
  )

  const gateFail =
    orderCount !== EXPECT_ORDER_COUNT || gmvRounded !== EXPECT_TOTAL_GMV

  if (gateFail) {
    console.error('\n未通过关账门禁：支付单数/GMV 与基线不一致。')
    console.error('原因需结合跨店冲突、HAR 分页重叠、是否夹杂区外/非关账口径订单继续分析。')
    console.error('禁止用 HAR_SOFT=1 冒充正式关账通过。')
    if (soft) {
      console.log('\nHAR_SOFT=1 → 仅本地分析退出 0（非正式通过）')
      process.exit(0)
    }
    process.exit(1)
  }

  console.log('\nPASS（关账门禁：218 / 387837）')
}

main()
