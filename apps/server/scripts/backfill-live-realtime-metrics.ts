/**
 * 历史直播大屏指标补齐
 *
 * 默认 dry-run：只列出待补齐场次，不请求接口、不写库。
 *
 * npx tsx apps/server/scripts/backfill-live-realtime-metrics.ts --date=2026-07-16
 * npx tsx apps/server/scripts/backfill-live-realtime-metrics.ts --date=2026-07-16 --dry-run
 * npx tsx apps/server/scripts/backfill-live-realtime-metrics.ts --date=2026-07-16 --execute --max-requests=20
 * 可选：--shop=和田雅玉 --anchor=小艺 --max-requests=30
 */
import { prisma } from '../src/lib/prisma'
import { resolveOfficialShopAccount } from '../src/services/official-shop-account.service'
import { GOOD_REVIEW_SHOPS } from '../src/config/good-review-shops.constants'
import { resolveDateRange } from '../src/utils/date-range'
import { extractLiveSessionTraffic } from '../src/services/live-session-traffic.util'
import {
  enrichLiveSessionsWithRealtimeMetric,
  liveRawNeedsRealtimeMetric,
} from '../src/services/xhs-api-sync/xhs-live-realtime-metric.service'
import { buildShopLiveSessionWhere } from '../src/services/xhs-api-sync/xhs-live-session-query.util'
import { isApiConfigured } from '../src/services/xhs-api-sync/xhs-api-registry'

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

async function main() {
  const date = argValue('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(
      '用法: --date=YYYY-MM-DD [--dry-run] [--execute] [--shop=名称] [--anchor=姓名] [--max-requests=N]',
    )
    process.exit(1)
  }

  const execute = hasFlag('execute')
  const dryRun = !execute
  if (hasFlag('write') && !execute) {
    console.error('已废弃 --write；请显式使用 --execute 才会请求并写库')
    process.exit(1)
  }

  const filterShop = argValue('shop')?.trim()
  const filterAnchor = argValue('anchor')?.trim()
  const maxRequests = Math.max(
    1,
    Number(argValue('max-requests') ?? argValue('max') ?? '30') || 30,
  )
  const apiConfigured = isApiConfigured('live_realtime_metric')

  console.log(
    JSON.stringify(
      {
        date,
        dryRun,
        execute,
        maxRequests,
        filterShop: filterShop ?? null,
        filterAnchor: filterAnchor ?? null,
        apiConfigured,
        note: dryRun
          ? '默认 dry-run：只列出待补齐，不请求、不写库'
          : '将请求大屏接口并写库',
      },
      null,
      2,
    ),
  )

  if (execute && !apiConfigured) {
    console.error('live_realtime_metric 未配置，无法 --execute')
    process.exit(1)
  }

  const range = resolveDateRange('custom', date, date)
  let listed = 0
  let alreadyOk = 0
  let enrichedTotal = 0
  let failedTotal = 0
  let skippedTotal = 0
  const failures: string[] = []

  for (const shop of GOOD_REVIEW_SHOPS) {
    if (filterShop && shop.shopName !== filterShop && shop.shopKey !== filterShop) continue
    const account = await resolveOfficialShopAccount(shop.shopKey)
    if (!account) {
      failures.push(`${shop.shopName}: 无官方账号`)
      continue
    }

    let rows = await prisma.xhsRawLiveSession.findMany({
      where: buildShopLiveSessionWhere({
        officialAccountId: account.id,
        shopKey: shop.shopKey,
        shopName: shop.shopName,
        startTimeGte: new Date(range.startTimeMs - 12 * 3600_000),
        startTimeLte: new Date(range.endTimeMs + 12 * 3600_000),
      }),
      orderBy: { startTime: 'asc' },
    })
    if (filterAnchor) {
      rows = rows.filter((r) => (r.anchorName ?? '').includes(filterAnchor))
    }

    const need = rows.filter((r) => liveRawNeedsRealtimeMetric(asRecord(r.rawJson)))
    alreadyOk += rows.length - need.length

    for (const row of need) {
      if (listed >= maxRequests) break
      listed++
      const traffic = extractLiveSessionTraffic(asRecord(row.rawJson))
      console.log(
        JSON.stringify({
          action: dryRun ? 'would_enrich' : 'pending',
          shop: shop.shopName,
          sessionId: row.id,
          liveId: row.liveId,
          anchorName: row.anchorName,
          startTime: row.startTime,
          coverClickRate: traffic.coverClickRate,
          stay60sUserCount: traffic.stay60sUserCount,
          needsMetric: true,
        }),
      )
    }

    if (dryRun) continue

    const budget = Math.max(0, maxRequests - enrichedTotal - failedTotal)
    if (budget <= 0 || need.length === 0) continue

    const result = await enrichLiveSessionsWithRealtimeMetric({
      sessionIds: need.map((r) => r.id).slice(0, budget),
      liveAccountId: account.id,
      liveAccountName: account.platformName,
      maxRequests: budget,
      invalidateCache: true,
    })
    enrichedTotal += result.enriched
    failedTotal += result.failed
    skippedTotal += result.skipped
    for (const w of result.warnings) {
      console.log(JSON.stringify({ shop: shop.shopName, result: w }))
    }
    console.log(
      JSON.stringify({
        shop: shop.shopName,
        enrich: {
          attempted: result.attempted,
          enriched: result.enriched,
          skipped: result.skipped,
          failed: result.failed,
        },
      }),
    )
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        listedNeedEnrich: listed,
        alreadyHasBothFields: alreadyOk,
        enriched: enrichedTotal,
        failed: failedTotal,
        skipped: skippedTotal,
        failures,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
