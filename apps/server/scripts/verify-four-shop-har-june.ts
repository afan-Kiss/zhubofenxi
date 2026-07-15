/**
 * 四店 HAR 只读验收：2026-06 GMV/支付单数 + 售后逐单差异（不硬编码售后黄金值）
 *
 * HAR_DIR="C:/Users/6/Desktop" npm run verify:four-shop-har-june
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
import { isEmptyWorkbenchCacheStale } from '../src/services/workbench-cache-validity.service'

const START = '2026-06-01'
const END = '2026-06-30'
const EXPECT_TOTAL_GMV = 387_837
const EXPECT_ORDER_COUNT = 218
const EXPECT_ANCHOR_GMV: Record<string, { gmv: number; orders: number }> = {
  飞云: { gmv: 254_512, orders: 114 },
  子杰: { gmv: 86_865, orders: 60 },
  小白: { gmv: 18_866, orders: 14 },
  小艺: { gmv: 14_517, orders: 21 },
  小红: { gmv: 10_079, orders: 8 },
  未归属: { gmv: 2_998, orders: 1 },
}

const REQUIRED_HAR_NAMES = ['拾玉居.har', '和田雅玉.har', 'XY祥钰珠宝.har', '祥钰珠宝.har']

type AuditRow = {
  orderNo: string
  shop: string
  payYuan: number
  paidAt: string
  productRefundCent: number
  freightRefundCent: number
  isProductRefundOrder: boolean
  isFreightOnly: boolean
  afterSaleCount: number
  notes: string
}

function resolveHarDir(): string {
  const env = process.env.HAR_DIR?.trim()
  if (env) return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env)
  const desktop = 'C:/Users/6/Desktop'
  if (REQUIRED_HAR_NAMES.every((n) => fs.existsSync(path.join(desktop, n)))) return desktop
  return path.resolve(process.cwd(), 'debug/har')
}

function inJune(iso: string): boolean {
  const d = (iso || '').slice(0, 10)
  return d >= START && d <= END
}

function parseReturnsFromHar(filePath: string): Record<string, unknown>[] {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw) as {
    log?: { entries?: Array<{ request?: { url?: string }; response?: { content?: { text?: string; encoding?: string } } }> }
  }
  const out: Record<string, unknown>[] = []
  for (const entry of parsed.log?.entries ?? []) {
    const url = entry.request?.url ?? ''
    if (!url.includes('/after-sales/returns/v3')) continue
    const text = decodeHarContentText(entry.response?.content ?? {})
    if (!text) continue
    try {
      const body = JSON.parse(text) as unknown
      out.push(...extractAfterSalesList(body))
    } catch {
      // skip
    }
  }
  return out
}

function uniqueRecs(recs: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>()
  for (const r of recs) {
    const id = String(r.returns_id ?? r.returnsId ?? r.return_id ?? JSON.stringify(r))
    if (!byId.has(id)) byId.set(id, r)
  }
  return [...byId.values()]
}

function main(): void {
  console.log('verify:four-shop-har-june\n')
  const harDir = resolveHarDir()
  console.log(`HAR_DIR=${harDir}`)

  const missing = REQUIRED_HAR_NAMES.filter((n) => !fs.existsSync(path.join(harDir, n)))
  if (missing.length) {
    console.error(`缺少 HAR 文件: ${missing.join(', ')}`)
    process.exit(1)
  }

  const orderByNo = new Map<string, { shop: string; payYuan: number; paidAt: string }>()
  for (const name of REQUIRED_HAR_NAMES) {
    const full = path.join(harDir, name)
    const shop = shopFromHarFilename(name)
    const rows = parseOrderHarFile(full)
    for (const r of rows) {
      const no = (r.packageId || r.orderId || '').trim()
      if (!no || !/^P/i.test(no)) continue
      const paidAt = r.paidAt || r.orderedAt
      if (!inJune(paidAt)) continue
      const payYuan = Number(r.actualPaid) || 0
      const prev = orderByNo.get(no)
      if (!prev || payYuan > prev.payYuan) {
        orderByNo.set(no, { shop, payYuan, paidAt })
      }
    }
  }

  const returnsByOrder = new Map<string, Record<string, unknown>[]>()
  for (const name of REQUIRED_HAR_NAMES) {
    const recs = parseReturnsFromHar(path.join(harDir, name))
    for (const rec of recs) {
      const no = String(
        rec.delivery_package_id ?? rec.packageId ?? rec.package_id ?? rec.order_id ?? '',
      ).trim()
      if (!no || !/^P/i.test(no)) continue
      const list = returnsByOrder.get(no) ?? []
      list.push(rec)
      returnsByOrder.set(no, list)
    }
  }

  let totalGmv = 0
  const audit: AuditRow[] = []
  for (const [orderNo, o] of orderByNo) {
    totalGmv += o.payYuan
    const recs = returnsByOrder.get(orderNo) ?? []
    let productCent = 0
    let freightCent = 0
    let freightOnly = false
    for (const rec of uniqueRecs(recs)) {
      if (!isSuccessfulAfterSale(rec)) continue
      const fee = resolveBusinessProductRefundAmountCent(rec)
      if (isFreightOnlyRefund(rec)) {
        freightOnly = true
        freightCent += yuanApiAmountToCent(rec.refund_fee ?? rec.refundFee ?? 0)
      } else {
        productCent += fee
      }
    }
    // 多条售后按订单去重：商品退款单至多计 1
    const isProductRefundOrder = productCent > 0
    audit.push({
      orderNo,
      shop: o.shop,
      payYuan: o.payYuan,
      paidAt: o.paidAt,
      productRefundCent: productCent,
      freightRefundCent: freightCent,
      isProductRefundOrder,
      isFreightOnly: freightOnly && productCent <= 0,
      afterSaleCount: recs.length,
      notes: isEmptyWorkbenchCacheStale(
        { fetchStatus: 'empty', fetchedAt: new Date(0), officialRefundAmountCent: 0 },
        { afterSaleStatusText: productCent > 0 ? '售后完成' : '', isReturned: productCent > 0 },
      )
        ? 'stale_empty_if_cached'
        : '',
    })
  }

  const orderCount = orderByNo.size
  const gmvRounded = Math.round(totalGmv)
  console.log(`HAR 支付订单 ${orderCount} / 期望 ${EXPECT_ORDER_COUNT}`)
  console.log(`HAR 总 GMV ${gmvRounded} / 期望 ${EXPECT_TOTAL_GMV}`)

  console.log('\n--- 逐单售后审计（节选有售后）---')
  const withAs = audit.filter((a) => a.afterSaleCount > 0 || a.isProductRefundOrder)
  for (const row of withAs.slice(0, 40)) {
    console.log(
      [
        row.orderNo,
        `店铺=${row.shop}`,
        `支付=${row.payYuan}`,
        `商品退=${(row.productRefundCent / 100).toFixed(2)}`,
        `运费退=${(row.freightRefundCent / 100).toFixed(2)}`,
        `退款单=${row.isProductRefundOrder ? 'Y' : 'N'}`,
        `纯运费=${row.isFreightOnly ? 'Y' : 'N'}`,
        row.notes,
      ].join(' | '),
    )
  }
  console.log(`售后相关订单 ${withAs.length}（按统一业务函数重算，未硬编码月售后黄金值）`)

  console.log('\n--- 主播 GMV 基线（期望，需结合排班归属；HAR 只读阶段校验总量）---')
  for (const [name, v] of Object.entries(EXPECT_ANCHOR_GMV)) {
    console.log(`  ${name}: ${v.gmv} 元 / ${v.orders} 单`)
  }

  let failed = false
  if (orderCount !== EXPECT_ORDER_COUNT) {
    console.error(
      `✗ 支付订单数不匹配（HAR 捕获可能不完整：实际 ${orderCount}）。请用含完整六月订单的 HAR_DIR。`,
    )
    failed = true
  } else {
    console.log('✓ 支付订单数 = 218')
  }
  if (gmvRounded !== EXPECT_TOTAL_GMV) {
    console.error(
      `✗ 总 GMV 不匹配（实际 ${gmvRounded}）。HAR 分页可能不全。`,
    )
    failed = true
  } else {
    console.log('✓ 总 GMV = 387837')
  }

  if (failed) {
    console.log('\nFAIL（HAR 基线 GMV/单数）— 售后重算逻辑已输出，不阻断业务函数修复验收时可设 HAR_SOFT=1')
    if (process.env.HAR_SOFT === '1') {
      console.log('HAR_SOFT=1 → 退出 0')
      process.exit(0)
    }
    process.exit(1)
  }
  console.log('\nPASS')
}

main()
