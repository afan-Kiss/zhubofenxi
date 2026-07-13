/**
 * HAR 平台原始数据 vs 系统 DB 交叉比对
 * 用法:
 *   HAR_DIR="C:/Users/6/Desktop/数据" DATE=2026-07-03 npm run verify:har-system-crosscheck
 *   DATE=2026-07-03 SYSTEM_ONLY=1 npm run verify:har-system-crosscheck   # 仅输出系统 JSON
 */
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { buildAndSetBusinessBoardCache } from '../src/services/business-cache.service'
import { getBoardScopedViewsForRange } from '../src/services/board-scoped-views.service'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import { resolveCanonicalShopName } from '../src/config/qianfan-shops.constants'
import { formatDateTimeShanghai } from '../src/utils/business-timezone'
import {
  aggregateHarLiveByShopDate,
  aggregateHarOrdersByShopDate,
  listHarOrderDates,
  loadHarBundle,
  resolveHarDir,
  type HarShopLiveStats,
  type HarShopOrderStats,
} from './lib/har-platform-bundle'

loadEnv({ path: path.resolve(__dirname, '../.env') })

const DATE_ENV = process.env.DATE?.trim()
const HAR_DIR_ENV = process.env.HAR_DIR?.trim()
const SYSTEM_ONLY = process.env.SYSTEM_ONLY === '1'
const HAR_ONLY = process.env.HAR_ONLY === '1'

interface ShopOrderStats {
  shop: string
  count: number
  gmvYuan: number
  packageIds: string[]
}

interface ShopLiveStats {
  shop: string
  liveId: string
  title: string
  start: string
  end: string
}

function diffYuan(a: number, b: number): number {
  return Math.round((a - b) * 100) / 100
}

function resolveViewShop(liveAccountName: string): string | null {
  return resolveCanonicalShopName(liveAccountName)
}

function payDateKey(view: { orderTimeText?: string }, payMs: number | null): string | null {
  if (payMs != null) return formatDateTimeShanghai(new Date(payMs)).slice(0, 10)
  const text = (view.orderTimeText ?? '').trim()
  return text.length >= 10 ? text.slice(0, 10) : null
}

async function buildSystemOrderStats(dateKey: string): Promise<Map<string, ShopOrderStats>> {
  await buildAndSetBusinessBoardCache({ preset: 'custom', startDate: dateKey, endDate: dateKey })
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: dateKey,
    endDate: dateKey,
  })
  const byShop = new Map<string, Map<string, { gmvCent: number }>>()

  for (const view of dedupeViewsByMetricOrderNo(scoped.views)) {
    if (view.includedInGmv !== true) continue
    const payMs = parseViewPayTimeMs(view)
    const day = payDateKey(view, payMs)
    if (day !== dateKey) continue
    const shop = resolveViewShop((view.liveAccountName ?? '').trim())
    if (!shop) continue
    const orderNo = resolveMetricOrderNo(view) || view.orderId
    if (!orderNo) continue
    if (!byShop.has(shop)) byShop.set(shop, new Map())
    byShop.get(shop)!.set(orderNo, { gmvCent: view.paymentBaseCent })
  }

  const stats = new Map<string, ShopOrderStats>()
  for (const [shop, orderMap] of byShop.entries()) {
    const rows = [...orderMap.entries()]
    stats.set(shop, {
      shop,
      count: rows.length,
      gmvYuan: Math.round(rows.reduce((s, [, r]) => s + r.gmvCent, 0)) / 100,
      packageIds: rows.map(([id]) => id),
    })
  }
  return stats
}

async function buildSystemLiveStats(dateKey: string): Promise<Map<string, ShopLiveStats[]>> {
  const dayStart = new Date(`${dateKey}T00:00:00+08:00`)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const rows = await prisma.xhsRawLiveSession.findMany({
    where: {
      startTime: { gte: dayStart, lt: dayEnd },
    },
    select: {
      liveId: true,
      liveName: true,
      liveAccountName: true,
      startTime: true,
      endTime: true,
    },
    orderBy: { startTime: 'asc' },
  })

  const byShop = new Map<string, Map<string, ShopLiveStats>>()
  for (const row of rows) {
    const shop =
      resolveViewShop((row.liveAccountName ?? '').trim()) ??
      resolveViewShop((row.liveName ?? '').trim())
    if (!shop || !row.startTime) continue
    const start = formatDateTimeShanghai(row.startTime)
    const end = row.endTime ? formatDateTimeShanghai(row.endTime) : '—'
    const key = `${row.liveId ?? ''}|${start}|${end}`
    if (!byShop.has(shop)) byShop.set(shop, new Map())
    byShop.get(shop)!.set(key, {
      shop,
      liveId: row.liveId ?? '',
      title: row.liveName ?? row.liveAccountName ?? shop,
      start,
      end,
    })
  }

  const out = new Map<string, ShopLiveStats[]>()
  for (const [shop, sessionMap] of byShop.entries()) {
    out.set(shop, [...sessionMap.values()].sort((a, b) => a.start.localeCompare(b.start)))
  }
  return out
}

function printOrderCompare(
  dateKey: string,
  harStats: Map<string, HarShopOrderStats>,
  sysStats: Map<string, ShopOrderStats>,
): string[] {
  const failures: string[] = []
  console.log(`\n=== 订单交叉比对 ${dateKey} ===`)
  console.log('口径: HAR actualPaid vs 系统 paymentBaseCent（includedInGmv）')

  const shops = new Set([...harStats.keys(), ...sysStats.keys()])
  let harTotalCount = 0
  let harTotalGmv = 0
  let sysTotalCount = 0
  let sysTotalGmv = 0

  for (const shop of [...shops].sort()) {
    const har = harStats.get(shop)
    const sys = sysStats.get(shop)
    const harCount = har?.count ?? 0
    const harGmv = har?.gmvYuan ?? 0
    const sysCount = sys?.count ?? 0
    const sysGmv = sys?.gmvYuan ?? 0
    harTotalCount += harCount
    harTotalGmv += harGmv
    sysTotalCount += sysCount
    sysTotalGmv += sysGmv

    const countOk = harCount === sysCount
    const gmvOk = Math.abs(diffYuan(harGmv, sysGmv)) <= 0.01
    const mark = countOk && gmvOk ? '✓' : '✗'
    console.log(
      `${mark} ${shop}: HAR ${harCount}单/¥${harGmv.toFixed(2)} | 系统 ${sysCount}单/¥${sysGmv.toFixed(2)}`,
    )

    if (!countOk || !gmvOk) {
      failures.push(`${shop} 订单 HAR ${harCount}/¥${harGmv} vs 系统 ${sysCount}/¥${sysGmv}`)
      const harIds = new Set(har?.packageIds ?? [])
      const sysIds = new Set(sys?.packageIds ?? [])
      const onlyHar = [...harIds].filter((id) => !sysIds.has(id))
      const onlySys = [...sysIds].filter((id) => !harIds.has(id))
      if (onlyHar.length) console.log(`    仅 HAR: ${onlyHar.slice(0, 8).join(', ')}${onlyHar.length > 8 ? '...' : ''}`)
      if (onlySys.length) console.log(`    仅系统: ${onlySys.slice(0, 8).join(', ')}${onlySys.length > 8 ? '...' : ''}`)
    }
  }

  const totalOk =
    harTotalCount === sysTotalCount && Math.abs(diffYuan(harTotalGmv, sysTotalGmv)) <= 0.01
  console.log(
    `${totalOk ? '✓' : '✗'} 合计: HAR ${harTotalCount}单/¥${harTotalGmv.toFixed(2)} | 系统 ${sysTotalCount}单/¥${sysTotalGmv.toFixed(2)}`,
  )
  if (!totalOk) {
    failures.push(
      `合计 HAR ${harTotalCount}/¥${harTotalGmv} vs 系统 ${sysTotalCount}/¥${sysTotalGmv}`,
    )
  }
  return failures
}

function normalizeLiveTime(text: string): string {
  return text.replace('T', ' ').slice(0, 19)
}

function printLiveCompare(
  dateKey: string,
  harStats: Map<string, HarShopLiveStats[]>,
  sysStats: Map<string, ShopLiveStats[]>,
): string[] {
  const failures: string[] = []
  console.log(`\n=== 直播场次交叉比对 ${dateKey} ===`)
  console.log('口径: HAR sellerLiveDetailData vs 系统 XhsRawLiveSession')

  const shops = new Set([...harStats.keys(), ...sysStats.keys()])
  for (const shop of [...shops].sort()) {
    const harSessions = harStats.get(shop) ?? []
    const sysSessions = sysStats.get(shop) ?? []
    console.log(`\n${shop}: HAR ${harSessions.length} 场 | 系统 ${sysSessions.length} 场`)

    if (harSessions.length === 0 && sysSessions.length === 0) continue

    const maxLen = Math.max(harSessions.length, sysSessions.length)
    for (let i = 0; i < maxLen; i += 1) {
      const har = harSessions[i]
      const sys = sysSessions[i]
      if (har && sys) {
        const startOk = normalizeLiveTime(har.start) === normalizeLiveTime(sys.start)
        const endOk = normalizeLiveTime(har.end) === normalizeLiveTime(sys.end)
        const mark = startOk && endOk ? '✓' : '≈'
        console.log(
          `  ${mark} HAR ${har.start}~${har.end} | 系统 ${sys.start}~${sys.end} | ${har.title}`,
        )
        if (!startOk || !endOk) {
          failures.push(`${shop} 场次${i + 1} 时间不一致`)
        }
      } else if (har) {
        console.log(`  ✗ 仅 HAR: ${har.start}~${har.end} | ${har.title}`)
        failures.push(`${shop} 仅 HAR 有场次 ${har.start}~${har.end}`)
      } else if (sys) {
        console.log(`  ✗ 仅系统: ${sys.start}~${sys.end} | ${sys.title}`)
        failures.push(`${shop} 仅系统有场次 ${sys.start}~${sys.end}`)
      }
    }
  }
  return failures
}

async function main(): Promise<void> {
  loadEnv({ path: path.resolve(__dirname, '../.env') })
  await bootstrapQualityBadCaseCache()

  const dateKey = DATE_ENV
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    console.error('请设置 DATE=YYYY-MM-DD')
    process.exit(1)
  }

  const harDir = resolveHarDir(HAR_DIR_ENV)
  const harBundle = loadHarBundle(harDir)
  const harOrderStats = aggregateHarOrdersByShopDate(harBundle.orders, dateKey)
  const harLiveStats = aggregateHarLiveByShopDate(harBundle.lives, dateKey)

  if (HAR_ONLY) {
    console.log(
      JSON.stringify(
        {
          date: dateKey,
          harDir,
          warnings: harBundle.warnings,
          ordersByShop: Object.fromEntries(harOrderStats),
          liveByShop: Object.fromEntries(harLiveStats),
        },
        null,
        2,
      ),
    )
    return
  }

  const sysOrderStats = await buildSystemOrderStats(dateKey)
  const sysLiveStats = await buildSystemLiveStats(dateKey)

  if (SYSTEM_ONLY) {
    console.log(
      JSON.stringify(
        {
          date: dateKey,
          ordersByShop: Object.fromEntries(sysOrderStats),
          liveByShop: Object.fromEntries(sysLiveStats),
        },
        null,
        2,
      ),
    )
    return
  }

  console.log('[verify:har-system-crosscheck] HAR vs 系统只读交叉比对')
  console.log(`DATE=${dateKey}`)
  console.log(`HAR_DIR=${harDir}`)
  for (const w of harBundle.warnings) console.log(`⚠ ${w}`)

  const availableDates = listHarOrderDates(harBundle.orders)
  if (availableDates.length > 0 && !availableDates.includes(dateKey)) {
    console.log(`⚠ HAR 订单未覆盖 ${dateKey}，最近可选日期: ${availableDates.slice(-5).join(', ')}`)
  }

  const failures = [
    ...printOrderCompare(dateKey, harOrderStats, sysOrderStats),
    ...printLiveCompare(dateKey, harLiveStats, sysLiveStats),
  ]

  console.log('\n=== 汇总 ===')
  console.log(`failures: ${failures.length}`)
  for (const f of failures) console.log(`  ✗ ${f}`)

  if (failures.length > 0) {
    console.log('\nverify:har-system-crosscheck FAIL')
    process.exit(1)
  }
  console.log('\nverify:har-system-crosscheck OK')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
