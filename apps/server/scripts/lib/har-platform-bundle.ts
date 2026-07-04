import fs from 'node:fs'
import path from 'node:path'
import { resolveCanonicalShopName } from '../../src/config/qianfan-shops.constants'

export interface HarOrderRow {
  packageId: string
  orderId: string
  paidAt: string
  orderedAt: string
  actualPaid: number
  sourceFile: string
  sourceShop: string
}

export interface HarLiveRow {
  liveId: string
  liveStartTime: string
  liveEndTime: string
  liveAccountName: string
  sourceShopName: string
  sourceFile: string
  sourceShop: string
}

export interface HarShopOrderStats {
  shop: string
  count: number
  gmvYuan: number
  packageIds: string[]
}

export interface HarShopLiveStats {
  shop: string
  liveId: string
  title: string
  start: string
  end: string
}

type HarEntry = {
  request?: { url?: string }
  response?: { content?: { text?: string; encoding?: string } }
}

function unwrapHarField(v: unknown): unknown {
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    return (v as Record<string, unknown>).value
  }
  return v
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const raw = unwrapHarField(obj[k])
    if (raw != null && String(raw).trim()) return String(raw).trim()
  }
  return ''
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const raw = unwrapHarField(obj[k])
    if (raw == null || raw === '') continue
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return null
}

function decodeHarResponseText(entry: HarEntry): string {
  const content = entry.response?.content ?? {}
  let text = content.text ?? ''
  if (content.encoding === 'base64' && text) {
    text = Buffer.from(text, 'base64').toString('utf-8')
  }
  return text
}

function parseHarEntries(filePath: string): HarEntry[] {
  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw) as { log?: { entries?: HarEntry[] } }
  return parsed.log?.entries ?? []
}

export function shopFromHarFilename(name: string): string {
  if (name.startsWith('XY祥钰珠宝')) return 'XY祥钰珠宝'
  if (name.startsWith('祥钰珠宝')) return '祥钰珠宝'
  if (name.startsWith('和田雅玉')) return '和田雅玉'
  if (name.startsWith('拾玉居')) return '拾玉居和田玉'
  const prefix = name.split('的')[0]?.trim()
  return resolveCanonicalShopName(prefix ?? '') ?? prefix ?? name
}

export function parseOrderHarFile(filePath: string): HarOrderRow[] {
  const base = path.basename(filePath)
  const sourceShop = shopFromHarFilename(base)
  const rows: HarOrderRow[] = []
  for (const entry of parseHarEntries(filePath)) {
    const url = entry.request?.url ?? ''
    if (!url.includes('/api/edith/fulfillment/order/page')) continue
    const text = decodeHarResponseText(entry)
    if (!text) continue
    let body: Record<string, unknown>
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    const data = (body.data ?? body) as Record<string, unknown>
    const packages = (data.packages ?? data.list ?? data.records ?? []) as Record<string, unknown>[]
    for (const pkg of packages) {
      rows.push({
        packageId: pickString(pkg, ['packageId', 'package_id']),
        orderId: pickString(pkg, ['orderId', 'order_id']),
        paidAt: pickString(pkg, ['paidAt', 'paid_at', 'payTime']),
        orderedAt: pickString(pkg, ['orderedAt', 'ordered_at', 'orderTime']),
        actualPaid: pickNum(pkg, ['actualPaid', 'actual_paid']) ?? 0,
        sourceFile: base,
        sourceShop,
      })
    }
  }
  return rows
}

export function parseLiveHarFile(filePath: string): HarLiveRow[] {
  const base = path.basename(filePath)
  const sourceShop = shopFromHarFilename(base)
  const rows: HarLiveRow[] = []
  for (const entry of parseHarEntries(filePath)) {
    const url = entry.request?.url ?? ''
    if (!url.includes('sellerLiveDetailData')) continue
    const text = decodeHarResponseText(entry)
    if (!text) continue
    let body: Record<string, unknown>
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      continue
    }
    const dataArr = (body.data ?? []) as unknown[]
    for (const block of dataArr) {
      if (!block || typeof block !== 'object') continue
      const rec = block as Record<string, unknown>
      const inner = (rec.data ?? []) as unknown[]
      for (const item of inner) {
        if (!item || typeof item !== 'object') continue
        const d = item as Record<string, unknown>
        rows.push({
          liveId: pickString(d, ['liveId', 'live_id']),
          liveStartTime: pickString(d, ['liveStartTime', 'live_start_time', 'startTime']),
          liveEndTime: pickString(d, ['liveEndTime', 'live_end_time', 'endTime']),
          liveAccountName: pickString(d, ['liveAccountName', 'liveName', 'nickName', 'live_account_name']),
          sourceShopName: pickString(d, ['sourceShopName', 'shopName', 'sellerName']),
          sourceFile: base,
          sourceShop,
        })
      }
    }
  }
  return rows
}

export function resolveHarDir(harDirEnv?: string): string {
  if (harDirEnv?.trim()) {
    const trimmed = harDirEnv.trim()
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed)
  }
  return path.resolve(process.cwd(), 'debug/har')
}

export function loadHarBundle(harDir: string): {
  orders: HarOrderRow[]
  lives: HarLiveRow[]
  warnings: string[]
} {
  const warnings: string[] = []
  if (!fs.existsSync(harDir)) {
    warnings.push(`HAR_DIR 不存在: ${harDir}`)
    return { orders: [], lives: [], warnings }
  }

  const files = fs.readdirSync(harDir).filter((f) => f.endsWith('.har'))
  let orders: HarOrderRow[] = []
  let lives: HarLiveRow[] = []
  for (const f of files) {
    const full = path.join(harDir, f)
    try {
      if (f.includes('订单')) orders = orders.concat(parseOrderHarFile(full))
      if (f.includes('直播')) lives = lives.concat(parseLiveHarFile(full))
    } catch (err) {
      warnings.push(`${f} 解析失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { orders, lives, warnings }
}

function orderDay(row: HarOrderRow): string {
  const paid = row.paidAt || row.orderedAt
  return paid.slice(0, 10) || 'unknown'
}

export function aggregateHarOrdersByShopDate(
  orders: HarOrderRow[],
  dateKey: string,
): Map<string, HarShopOrderStats> {
  const byShop = new Map<string, Map<string, HarOrderRow>>()
  for (const row of orders) {
    if (orderDay(row) !== dateKey) continue
    const shop = row.sourceShop
    const pid = row.packageId || row.orderId
    if (!pid) continue
    if (!byShop.has(shop)) byShop.set(shop, new Map())
    byShop.get(shop)!.set(pid, row)
  }

  const stats = new Map<string, HarShopOrderStats>()
  for (const [shop, pkgMap] of byShop.entries()) {
    const rows = [...pkgMap.values()]
    stats.set(shop, {
      shop,
      count: rows.length,
      gmvYuan: Math.round(rows.reduce((s, r) => s + r.actualPaid, 0) * 100) / 100,
      packageIds: rows.map((r) => r.packageId || r.orderId).filter(Boolean),
    })
  }
  return stats
}

export function aggregateHarLiveByShopDate(
  lives: HarLiveRow[],
  dateKey: string,
): Map<string, HarShopLiveStats[]> {
  const byShop = new Map<string, Map<string, HarShopLiveStats>>()
  for (const row of lives) {
    const day = row.liveStartTime.slice(0, 10)
    if (day !== dateKey) continue
    const shop = row.sourceShop
    const key = `${row.liveId}|${row.liveStartTime}|${row.liveEndTime}`
    if (!byShop.has(shop)) byShop.set(shop, new Map())
    byShop.get(shop)!.set(key, {
      shop,
      liveId: row.liveId,
      title: row.liveAccountName || row.sourceShopName,
      start: row.liveStartTime,
      end: row.liveEndTime,
    })
  }
  const out = new Map<string, HarShopLiveStats[]>()
  for (const [shop, sessionMap] of byShop.entries()) {
    out.set(
      shop,
      [...sessionMap.values()].sort((a, b) => a.start.localeCompare(b.start)),
    )
  }
  return out
}

export function listHarOrderDates(orders: HarOrderRow[]): string[] {
  const dates = new Set<string>()
  for (const row of orders) {
    const day = orderDay(row)
    if (day !== 'unknown') dates.add(day)
  }
  return [...dates].sort()
}
