/**
 * 品退展示与归属只读诊断
 * 用法: npm run verify:quality-return-display
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import {
  buildAndSetBusinessBoardCache,
  getBusinessBoardCache,
} from '../src/services/business-cache.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { aggregateAnchorLeaderboard } from '../src/services/board-metrics.service'
import { resolveBusinessRange } from '../src/utils/business-range'
import { getQualityBadCaseCoverage } from '../src/services/quality-badcase-store.service'

config({ path: path.resolve(__dirname, '../.env') })

const CHECK_RANGES: Array<{
  label: string
  preset: string
  startDate?: string
  endDate?: string
}> = [
  { label: 'today', preset: 'today' },
  { label: 'yesterday', preset: 'yesterday' },
  { label: 'thisMonth', preset: 'thisMonth' },
  { label: 'custom-2026-07-04', preset: 'custom', startDate: '2026-07-04', endDate: '2026-07-04' },
]

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

async function printQualityBadCaseStats(): Promise<{
  total: number
  matched: number
  unmatched: number
}> {
  section('QualityBadCase 表')
  const total = await prisma.qualityBadCase.count()
  const matched = await prisma.qualityBadCase.count({
    where: {
      matchStatus: { in: ['matched_order_and_after_sale', 'matched_order_only', 'matched_after_sale_only'] },
    },
  })
  const unmatched = await prisma.qualityBadCase.count({ where: { matchStatus: 'unmatched' } })

  const latest = await prisma.qualityBadCase.findFirst({
    orderBy: { syncedAt: 'desc' },
    select: { syncedAt: true, updatedAt: true },
  })
  const updated = await prisma.qualityBadCase.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  })

  console.log(`总数: ${total}`)
  console.log(`matched: ${matched}`)
  console.log(`unmatched: ${unmatched}`)
  console.log(`最近 syncedAt: ${latest?.syncedAt?.toISOString() ?? '—'}`)
  console.log(`最近 updatedAt: ${updated?.updatedAt?.toISOString() ?? '—'}`)

  const byAccount = await prisma.qualityBadCase.groupBy({
    by: ['liveAccountId'],
    _count: { _all: true },
  })
  console.log('按 liveAccountId 分组:')
  for (const row of byAccount) {
    console.log(`  ${row.liveAccountId}: ${row._count._all}`)
  }

  const coverage = await getQualityBadCaseCoverage()
  console.log(
    `同步窗口: ${coverage.windowDays} 天, lastSyncedAt=${coverage.lastSyncedAt ?? '—'}`,
  )

  if (total === 0) {
    console.log('\n⚠ 官方品退数据未同步，经营总览品退会显示 0，不是前端问题。')
  }

  return { total, matched, unmatched }
}

async function checkRange(params: {
  label: string
  preset: string
  startDate?: string
  endDate?: string
  qbTotal: number
}): Promise<void> {
  const range = resolveBusinessRange(
    params.preset as import('../src/utils/business-range').BusinessRangePreset,
    params.startDate,
    params.endDate,
  )

  section(`范围 ${params.label} (${range.startDate}~${range.endDate})`)

  const orderCount = await prisma.xhsRawOrder.count({
    where: {
      orderTime: {
        gte: new Date(`${range.startDate}T00:00:00+08:00`),
        lte: new Date(`${range.endDate}T23:59:59+08:00`),
      },
    },
  })
  const liveSessionCount = await prisma.xhsRawLiveSession.count({
    where: {
      startTime: {
        gte: new Date(`${range.startDate}T00:00:00+08:00`),
        lte: new Date(`${range.endDate}T23:59:59+08:00`),
      },
    },
  })
  console.log(`XhsRawOrder(日期范围): ${orderCount}`)
  console.log(`XhsRawLiveSession(日期范围): ${liveSessionCount}`)

  await buildAndSetBusinessBoardCache({
    preset: params.preset,
    startDate: range.startDate,
    endDate: range.endDate,
  })
  const cacheEntry = getBusinessBoardCache(params.preset, range.startDate, range.endDate)
  const local = await executeBoardLocalQuery({
    preset: params.preset as import('../src/services/board-live-query.service').BoardLiveQueryPreset,
    startDate: range.startDate,
    endDate: range.endDate,
  })

  const summary = (local.summary ?? {}) as Record<string, unknown>
  const perfSummary = (local.anchorPerformanceSummary ?? {}) as Record<string, unknown>
  const qualityReturnCount = Number(summary.qualityReturnCount ?? 0)
  const qualityReturnRate = summary.qualityReturnRate
  const liveSessionsInCache = cacheEntry?.liveSessions?.length ?? 0

  console.log(`summary.qualityReturnCount: ${qualityReturnCount}`)
  console.log(`summary.qualityReturnRate: ${qualityReturnRate ?? '—'}`)
  console.log(`cache.liveSessions: ${liveSessionsInCache}`)

  const detail = await buildBoardMetricDetail({
    metric: 'qualityReturnCount',
    preset: params.preset,
    startDate: range.startDate,
    endDate: range.endDate,
    role: 'super_admin',
    username: 'admin',
  })
  const detailMatched = Number(detail.summary.matchedOrders ?? detail.summary.qualityRefundOrderCount ?? 0)
  const detailTotal = Number(detail.summary.totalOrders ?? 0)
  const unmatchedOfficial = Number(detail.summary.unmatchedOfficialQualityCount ?? 0)
  console.log(
    `metric-detail qualityReturnCount: matchedOrders=${detailMatched} totalOrders=${detailTotal} unmatchedOfficial=${unmatchedOfficial}`,
  )

  if (qualityReturnCount !== detailMatched) {
    console.log(
      `⚠ summary.qualityReturnCount(${qualityReturnCount}) 与 metric-detail matchedOrders(${detailMatched}) 不一致`,
    )
  }

  const leaderboard = local.anchorLeaderboard ?? []
  let anchorQualitySum = 0
  console.log('主播榜品退:')
  for (const row of leaderboard) {
    const q = Number(row.qualityReturnCount ?? 0)
    anchorQualitySum += q
    const rate = row.qualityReturnRate
    console.log(
      `  ${String(row.anchorName)}: qualityReturnCount=${q} qualityReturnRate=${rate ?? '—'}`,
    )
  }
  console.log(`主播榜品退合计: ${anchorQualitySum}`)

  if (params.qbTotal > 0 && qualityReturnCount === 0) {
    console.log('\n⚠ QualityBadCase>0 但 qualityReturnCount=0，可能原因:')
    const allUnmatched = await prisma.qualityBadCase.count({
      where: { matchStatus: 'unmatched' },
    })
    if (allUnmatched === params.qbTotal) {
      console.log('  - matchStatus 全是 unmatched')
    }
    const withMatchedOrder = await prisma.qualityBadCase.count({
      where: { matchedOrderNo: { not: null } },
    })
    console.log(`  - 有 matchedOrderNo 的记录: ${withMatchedOrder}/${params.qbTotal}`)
    console.log('  - 检查日期范围是否包含 packagePayTime / 订单支付时间')
    console.log('  - 检查经营缓存是否已重建（见下方缓存一致性）')
  }

  if (qualityReturnCount > 0 && anchorQualitySum === 0) {
    console.log(
      '\n⚠ 品退总览有值，但主播归属失败，请检查 liveSessions 显式传入。',
    )
    if (liveSessionsInCache === 0) {
      console.log('  - cache.liveSessions 为空')
    }
  }

  if (cacheEntry) {
    const coreViews = filterViewsForCoreMetrics(cacheEntry.views)
    const realtime = calculateBusinessMetrics(coreViews)
    const cachedQuality = Number(cacheEntry.summary.qualityReturnCount ?? 0)
    if (cachedQuality !== realtime.qualityRefundOrderCount) {
      console.log(
        `⚠ 缓存 summary.qualityReturnCount(${cachedQuality}) 与实时计算(${realtime.qualityRefundOrderCount}) 不一致，缓存可能过期`,
      )
    }

    const perfViews = coreViews
    const withSessions = aggregateAnchorLeaderboard(perfViews, undefined, {
      liveSessions: cacheEntry.liveSessions ?? [],
    })
    const withoutSessions = aggregateAnchorLeaderboard(perfViews, undefined, {
      liveSessions: [],
    })
    const withSum = withSessions.reduce((s, r) => s + r.qualityReturnCount, 0)
    const withoutSum = withoutSessions.reduce((s, r) => s + r.qualityReturnCount, 0)
    if (withSum !== withoutSum && liveSessionsInCache > 0) {
      console.log(
        `  liveSessions 影响: 有场次合计=${withSum} 无场次合计=${withoutSum}`,
      )
    }

    const cachedLeaderSum = (cacheEntry.anchorLeaderboard ?? []).reduce(
      (s, r) => s + Number(r.qualityReturnCount ?? 0),
      0,
    )
    if (qualityReturnCount > 0 && cachedLeaderSum === 0 && liveSessionsInCache > 0) {
      console.log(
        `⚠ 缓存 anchorLeaderboard 品退合计为 0，但 summary 有 ${qualityReturnCount}，需重建缓存`,
      )
    }
  }

  const perfQuality = Number(perfSummary.qualityReturnCount ?? 0)
  if (perfQuality !== qualityReturnCount) {
    console.log(
      `  anchorPerformanceSummary.qualityReturnCount=${perfQuality} (overview=${qualityReturnCount})`,
    )
  }
}

async function main(): Promise<void> {
  console.log('[verify:quality-return-display] 只读诊断，不改数据库')

  await bootstrapQualityBadCaseCache()
  const qb = await printQualityBadCaseStats()

  for (const r of CHECK_RANGES) {
    await checkRange({ ...r, qbTotal: qb.total })
  }

  section('完成')
  console.log('verify:quality-return-display OK')
}

main()
  .catch((err) => {
    console.error('[verify:quality-return-display] FAIL', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
