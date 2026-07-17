/**
 * 只读诊断：直播大屏 realtime/metric 字段是否已入库
 *
 * npx tsx apps/server/scripts/diagnose-live-realtime-metrics.ts --date=2026-07-16
 * 可选：--shop=和田雅玉 --anchor=小艺
 */
import { prisma } from '../src/lib/prisma'
import { GOOD_REVIEW_SHOPS } from '../src/config/good-review-shops.constants'
import { resolveOfficialShopAccount } from '../src/services/official-shop-account.service'
import { resolveDateRange } from '../src/utils/date-range'
import { extractLiveSessionTraffic } from '../src/services/live-session-traffic.util'
import { liveRawNeedsRealtimeMetric } from '../src/services/xhs-api-sync/xhs-live-realtime-metric.service'
import { buildShopLiveSessionWhere } from '../src/services/xhs-api-sync/xhs-live-session-query.util'
import { isApiConfigured } from '../src/services/xhs-api-sync/xhs-api-registry'

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function peekField(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (raw[k] != null && raw[k] !== '') return raw[k]
    const room = raw.room_data_info
    if (room && typeof room === 'object' && !Array.isArray(room)) {
      const r = room as Record<string, unknown>
      if (r[k] != null && r[k] !== '') return r[k]
    }
  }
  return null
}

async function main() {
  const date = argValue('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('用法: --date=YYYY-MM-DD [--shop=店铺名称] [--anchor=主播]（只读，不写库）')
    process.exit(1)
  }
  const filterShop = argValue('shop')?.trim()
  const filterAnchor = argValue('anchor')?.trim()
  const range = resolveDateRange('custom', date, date)
  const apiConfigured = isApiConfigured('live_realtime_metric')

  console.log('diagnose-live-realtime-metrics（只读）')
  console.log(
    JSON.stringify(
      {
        date,
        live_realtime_metric_configured: apiConfigured,
        filterShop: filterShop ?? null,
        filterAnchor: filterAnchor ?? null,
      },
      null,
      2,
    ),
  )

  let total = 0
  let hasCtr = 0
  let hasStay60 = 0
  let bothOk = 0
  let needEnrich = 0

  for (const shop of GOOD_REVIEW_SHOPS) {
    if (filterShop && shop.shopName !== filterShop && shop.shopKey !== filterShop) continue
    const account = await resolveOfficialShopAccount(shop.shopKey)
    if (!account) {
      console.log(`\n# ${shop.shopName}: 无官方账号`)
      continue
    }

    const rows = await prisma.xhsRawLiveSession.findMany({
      where: buildShopLiveSessionWhere({
        officialAccountId: account.id,
        shopKey: shop.shopKey,
        shopName: shop.shopName,
        startTimeGte: new Date(range.startTimeMs - 12 * 3600_000),
        startTimeLte: new Date(range.endTimeMs + 12 * 3600_000),
      }),
      orderBy: { startTime: 'asc' },
    })

    const filtered = filterAnchor
      ? rows.filter((r) => (r.anchorName ?? '').includes(filterAnchor))
      : rows

    console.log(`\n# ${shop.shopName}（${filtered.length} 场）`)
    for (const row of filtered) {
      const raw = asRecord(row.rawJson)
      const traffic = extractLiveSessionTraffic(raw)
      const needs = liveRawNeedsRealtimeMetric(raw)
      total++
      if (traffic.coverClickRate != null) hasCtr++
      if (traffic.stay60sUserCount != null) hasStay60++
      if (traffic.coverClickRate != null && traffic.stay60sUserCount != null) bothOk++
      if (needs) needEnrich++

      console.log(
        JSON.stringify(
          {
            sessionId: row.id,
            liveId: row.liveId,
            shopName: shop.shopName,
            anchorName: row.anchorName,
            startTime: row.startTime,
            endTime: row.endTime,
            _realtimeMetricSyncedAt: raw._realtimeMetricSyncedAt ?? null,
            live_ctr: peekField(raw, 'live_ctr'),
            liveCtr: peekField(raw, 'liveCtr'),
            live_view_over60s_user_num: peekField(raw, 'live_view_over60s_user_num'),
            liveViewOver60sUserNum: peekField(raw, 'liveViewOver60sUserNum'),
            live_total_impression_cnt: peekField(raw, 'live_total_impression_cnt'),
            join_conversion_rate: peekField(raw, 'join_conversion_rate'),
            coverClickRate: traffic.coverClickRate,
            stay60sUserCount: traffic.stay60sUserCount,
            liveRawNeedsRealtimeMetric: needs,
            apiConfigured,
            shouldEnrich: needs && apiConfigured,
          },
          null,
          2,
        ),
      )
    }
  }

  console.log('\n========== 汇总 ==========')
  console.log(`真实场次总数：${total}`)
  console.log(`已有封面点击率：${hasCtr}`)
  console.log(`已有60s停留：${hasStay60}`)
  console.log(`两个字段均完整：${bothOk}`)
  console.log(`需要补齐：${needEnrich}`)
  console.log(`接口已配置：${apiConfigured ? '是' : '否'}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
