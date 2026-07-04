/**
 * 经营总览稳定性只读体检
 * 用法: npm run verify:overview-stability
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import {
  buildAndSetBusinessBoardCache,
  getBusinessBoardCache,
  getRecentBusinessCacheRebuilds,
} from '../src/services/business-cache.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { resolveBusinessRange } from '../src/utils/business-range'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import { sumValidRevenueFromViews } from '../src/services/valid-revenue-order.service'

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
  { label: 'lastMonth', preset: 'lastMonth' },
  { label: 'custom-2026-07-04', preset: 'custom', startDate: '2026-07-04', endDate: '2026-07-04' },
]

const failures: string[] = []
const warnings: string[] = []

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function fail(msg: string): void {
  failures.push(msg)
  console.log(`✗ FAIL: ${msg}`)
}

function warn(msg: string): void {
  warnings.push(msg)
  console.log(`⚠ ${msg}`)
}

function num(v: unknown): number {
  return Number(v ?? 0)
}

function diff(a: number, b: number): number {
  return Math.round((a - b) * 100) / 100
}

function printMetrics(label: string, s: Record<string, unknown>): void {
  console.log(`${label}:`)
  console.log(`  orderCount: ${num(s.orderCount ?? s.paidOrderCount)}`)
  console.log(`  totalGmv: ${num(s.totalGmv ?? s.gmv)}`)
  console.log(`  validSalesAmount: ${num(s.validSalesAmount ?? s.effectiveGmv)}`)
  console.log(`  paidOrderCount: ${num(s.paidOrderCount ?? s.orderCount)}`)
  console.log(`  refundAmount: ${num(s.returnAmount ?? s.refundAmount)}`)
  console.log(`  returnRate: ${s.returnRate ?? '—'}`)
  console.log(`  qualityReturnCount: ${num(s.qualityReturnCount)}`)
}

async function checkRange(params: {
  label: string
  preset: string
  startDate?: string
  endDate?: string
}): Promise<{ lastMonthValid?: number; lastMonthRecalc?: number }> {
  const range = resolveBusinessRange(
    params.preset as import('../src/utils/business-range').BusinessRangePreset,
    params.startDate,
    params.endDate,
  )

  section(`范围 ${params.label} (${range.startDate}~${range.endDate})`)

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

  const cacheSummary = (cacheEntry?.summary ?? {}) as Record<string, unknown>
  const localSummary = (local.summary ?? {}) as Record<string, unknown>
  const overviewMeta = local.overviewMeta

  console.log('1) 当前缓存数据:')
  console.log(`  cacheKey: ${overviewMeta?.cacheKey ?? cacheEntry?.cacheKey ?? '—'}`)
  console.log(`  businessCacheHit: ${overviewMeta?.businessCacheHit ?? false}`)
  console.log(`  cacheBuiltAt: ${overviewMeta?.cacheBuiltAt ?? cacheEntry?.lastBuiltAt ?? '—'}`)
  console.log(`  sourceSyncJobId: ${overviewMeta?.sourceSyncJobId ?? cacheEntry?.sourceSyncJobId ?? '—'}`)
  console.log(`  sourceDataMaxTime: ${overviewMeta?.sourceDataMaxTime ?? cacheEntry?.sourceDataMaxTime ?? '—'}`)
  printMetrics('  cache', cacheSummary)

  const views = filterViewsForCoreMetrics(cacheEntry?.views ?? [])
  const realtimeMetrics = calculateBusinessMetrics(views)
  const realtimeSummary: Record<string, unknown> = {
    orderCount: realtimeMetrics.orderCount,
    totalGmv: realtimeMetrics.totalGmv,
    validSalesAmount: realtimeMetrics.validSalesAmount,
    paidOrderCount: realtimeMetrics.orderCount,
    refundAmount: realtimeMetrics.refundAmount,
    returnRate: realtimeMetrics.refundRate,
    qualityReturnCount: realtimeMetrics.qualityRefundOrderCount,
  }

  console.log('2) 实时从本地库重算:')
  printMetrics('  realtime', realtimeSummary)

  console.log('3) 缓存 vs 实时重算差异:')
  const pairs: Array<[string, number, number]> = [
    ['totalGmv', num(cacheSummary.totalGmv), num(realtimeSummary.totalGmv)],
    ['validSalesAmount', num(cacheSummary.validSalesAmount), num(realtimeSummary.validSalesAmount)],
    ['orderCount', num(cacheSummary.orderCount), num(realtimeSummary.orderCount)],
    ['qualityReturnCount', num(cacheSummary.qualityReturnCount), num(realtimeSummary.qualityReturnCount)],
  ]
  for (const [name, a, b] of pairs) {
    const d = diff(a, b)
    console.log(`  ${name}: cache=${a} realtime=${b} diff=${d}`)
    if (name === 'validSalesAmount' && Math.abs(d) > 1) {
      fail(`${params.label} validSalesAmount 缓存 vs 实时差异 ${d} 元 (>1)`)
    }
  }

  const localValid = num(localSummary.validSalesAmount ?? localSummary.effectiveGmv)
  const cacheValid = num(cacheSummary.validSalesAmount)
  if (Math.abs(diff(localValid, cacheValid)) > 1 && params.preset !== 'lastMonth') {
    warn(`${params.label} local-data summary 与 cache summary 有效成交额不一致`)
  }

  if (params.preset === 'lastMonth') {
    console.log('  lastMonth 稳定机制:')
    console.log(`  stableSnapshot: ${overviewMeta?.stableSnapshot?.label ?? '无'}`)
    console.log(`  stableVsLatest: ${overviewMeta?.stableVsLatest?.message ?? '—'}`)
    return {
      lastMonthValid: localValid,
      lastMonthRecalc: num(realtimeSummary.validSalesAmount),
    }
  }

  return {}
}

async function printSyncJobs(): Promise<void> {
  section('最近 10 个 XhsSyncJob')
  const jobs = await prisma.xhsSyncJob.findMany({
    orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
    take: 10,
    select: {
      id: true,
      status: true,
      startedBy: true,
      startDate: true,
      endDate: true,
      orderCount: true,
      liveSessionCount: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
    },
  })
  for (const j of jobs) {
    console.log(
      `  ${j.id} | ${j.status} | ${j.startedBy ?? '—'} | ${j.startDate}~${j.endDate} | orders=${j.orderCount} live=${j.liveSessionCount} | ${j.errorMessage ?? ''} | ${j.startedAt?.toISOString() ?? '—'} ~ ${j.finishedAt?.toISOString() ?? '—'}`,
    )
  }
}

async function printHistoricalAdjustments(): Promise<void> {
  section('历史调整项 HistoricalAdjustment（按月）')
  const rows = await prisma.historicalAdjustment.groupBy({
    by: ['monthKey'],
    _count: { _all: true },
    orderBy: { monthKey: 'desc' },
  })
  if (rows.length === 0) {
    console.log('  无记录（detectHistoricalAdjustments 在经营同步 analyzing_business 步骤写入）')
    return
  }
  for (const r of rows) {
    console.log(`  ${r.monthKey}: ${r._count._all} 条`)
  }
}

async function printCacheRebuilds(): Promise<void> {
  section('最近 24 小时经营缓存重建')
  const recent = getRecentBusinessCacheRebuilds(86_400_000)
  if (recent.length === 0) {
    console.log('  内存日志无记录（可能进程刚启动或未重建）')
    for (const preset of ['today', 'yesterday', 'thisMonth', 'lastMonth']) {
      const range = resolveBusinessRange(preset as import('../src/utils/business-range').BusinessRangePreset)
      const hit = getBusinessBoardCache(preset, range.startDate, range.endDate)
      if (hit?.lastBuiltAt) {
        console.log(`  ${preset} cacheBuiltAt=${hit.lastBuiltAt}`)
      }
    }
    return
  }
  for (const e of recent) {
    console.log(`  ${e.at} | ${e.reason} | presets=${e.presetCount}`)
  }
}

async function checkValidSalesCrossModule(): Promise<void> {
  section('有效成交额口径交叉验证 (lastMonth)')
  const range = resolveBusinessRange('lastMonth')
  await buildAndSetBusinessBoardCache({ preset: 'lastMonth', ...range })
  const cacheEntry = getBusinessBoardCache('lastMonth', range.startDate, range.endDate)
  const local = await executeBoardLocalQuery({ preset: 'lastMonth', ...range })

  const overviewValid = num(local.summary?.validSalesAmount ?? local.summary?.effectiveGmv)
  const cacheValid = num(cacheEntry?.summary?.validSalesAmount)

  const detail = await buildBoardMetricDetail({
    metric: 'effectiveGmv',
    preset: 'lastMonth',
    startDate: range.startDate,
    endDate: range.endDate,
    role: 'super_admin',
    username: 'verify-script',
  })
  const detailValid = num(detail.summary?.valueRaw ?? detail.summary?.value)

  const views = filterViewsForCoreMetrics(cacheEntry?.views ?? [])
  const opsValid = sumValidRevenueFromViews(views).validAmountYuan

  console.log(`  overview summary: ${overviewValid}`)
  console.log(`  business-cache: ${cacheValid}`)
  console.log(`  metric-detail effectiveGmv: ${detailValid}`)
  console.log(`  operations(validAmountYuan口径): ${opsValid}`)

  const modules = [
    ['overview', overviewValid],
    ['cache', cacheValid],
    ['metric-detail', detailValid],
    ['operations', opsValid],
  ] as const

  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      const d = Math.abs(diff(modules[i][1], modules[j][1]))
      if (d > 1) {
        fail(
          `有效成交额不一致：${modules[i][0]}(${modules[i][1]}) vs ${modules[j][0]}(${modules[j][1]}) 差 ${d} 元`,
        )
      }
    }
  }
}

async function main(): Promise<void> {
  console.log('[verify:overview-stability] 只读体检，不改数据库')
  await bootstrapQualityBadCaseCache()

  let lastMonthValid: number | undefined
  let lastMonthRecalc: number | undefined

  for (const r of CHECK_RANGES) {
    const out = await checkRange(r)
    if (r.preset === 'lastMonth') {
      lastMonthValid = out.lastMonthValid
      lastMonthRecalc = out.lastMonthRecalc
    }
  }

  await printSyncJobs()
  await printHistoricalAdjustments()
  await printCacheRebuilds()
  await checkValidSalesCrossModule()

  section('汇总')
  if (lastMonthValid != null) {
    console.log(`lastMonth 当前展示有效成交额: ${lastMonthValid}`)
    console.log(`lastMonth 实时重算有效成交额: ${lastMonthRecalc ?? '—'}`)
  }
  console.log(`warnings: ${warnings.length}`)
  console.log(`failures: ${failures.length}`)

  if (failures.length > 0) {
    console.log('\nverify:overview-stability FAIL')
    process.exit(1)
  }
  console.log('\nverify:overview-stability OK')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
