/**
 * 全项目数据展示一致性只读体检
 * 用法: npm run verify:data-display-consistency
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import {
  buildAndSetBusinessBoardCache,
  getBusinessBoardCache,
} from '../src/services/business-cache.service'
import { calculateBusinessMetrics } from '../src/services/business-metrics.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { resolveBusinessRange } from '../src/utils/business-range'

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

const failures: string[] = []
const warnings: string[] = []

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function warn(msg: string): void {
  warnings.push(msg)
  console.log(`⚠ ${msg}`)
}

function fail(msg: string): void {
  failures.push(msg)
  console.log(`✗ FAIL: ${msg}`)
}

async function printDataFoundation(): Promise<{
  qbTotal: number
  qbMatched: number
  qbUnmatched: number
}> {
  section('数据基础')
  const orderCount = await prisma.xhsRawOrder.count()
  const liveSessionCount = await prisma.xhsRawLiveSession.count()
  const credCount = await prisma.platformCredential.count()
  const userCount = await prisma.user.count()
  const qbTotal = await prisma.qualityBadCase.count()
  const qbMatched = await prisma.qualityBadCase.count({
    where: {
      matchStatus: {
        in: ['matched_order_and_after_sale', 'matched_order_only', 'matched_after_sale_only'],
      },
    },
  })
  const qbUnmatched = await prisma.qualityBadCase.count({ where: { matchStatus: 'unmatched' } })

  console.log(`XhsRawOrder: ${orderCount}`)
  console.log(`XhsRawLiveSession: ${liveSessionCount}`)
  console.log(`PlatformCredential: ${credCount}`)
  console.log(`User: ${userCount}`)
  console.log(`QualityBadCase: ${qbTotal} (matched=${qbMatched}, unmatched=${qbUnmatched})`)

  if (orderCount <= 0) fail('XhsRawOrder 必须 > 0')
  if (liveSessionCount <= 0) fail('XhsRawLiveSession 必须 > 0')
  if (credCount <= 0) fail('PlatformCredential 必须 > 0')
  if (userCount <= 0) fail('User 必须 > 0')

  if (qbTotal === 0) {
    console.log('官方品退表为空，页面只能显示售后商品问题品退。')
  }

  return { qbTotal, qbMatched, qbUnmatched }
}

async function checkRange(
  params: { label: string; preset: string; startDate?: string; endDate?: string },
  qbTotal: number,
): Promise<void> {
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

  const summary = (local.summary ?? {}) as Record<string, unknown>
  const fields = [
    'totalGmv',
    'validSalesAmount',
    'orderCount',
    'returnRate',
    'qualityReturnCount',
    'qualityReturnRate',
    'returnCount',
    'actualSignedAmount',
  ] as const

  console.log('经营总览 summary:')
  for (const f of fields) {
    const v = summary[f] ?? summary[f === 'validSalesAmount' ? 'effectiveGmv' : f]
    console.log(`  ${f}: ${v ?? '—'}`)
  }

  const qualityReturnCount = Number(summary.qualityReturnCount ?? 0)
  const liveSessionsInCache = cacheEntry?.liveSessions?.length ?? 0
  console.log(`cache.liveSessions: ${liveSessionsInCache}`)

  const leaderboard = local.anchorLeaderboard ?? []
  let anchorQualitySum = 0
  console.log('主播业绩 anchorLeaderboard:')
  for (const row of leaderboard) {
    const q = Number(row.qualityReturnCount ?? 0)
    anchorQualitySum += q
    console.log(
      `  ${String(row.anchorName)}: gmv=${row.totalGmv ?? row.gmv ?? '—'} ` +
        `validSales=${row.validSalesAmount ?? row.effectiveGmv ?? '—'} ` +
        `orders=${row.orderCount ?? row.paidOrderCount ?? '—'} ` +
        `returnRate=${row.returnRate ?? '—'} ` +
        `qualityReturnCount=${q} qualityReturnRate=${row.qualityReturnRate ?? '—'} ` +
        `livePeriodText=${row.livePeriodText ?? '—'} ` +
        `liveTimeRange=${row.liveTimeRange ?? '—'} ` +
        `scheduleTimeRange=${row.scheduleTimeRange ?? row.scheduledPeriodText ?? '—'}`,
    )
  }
  console.log(`主播榜品退合计: ${anchorQualitySum}`)

  if (qualityReturnCount > 0 && anchorQualitySum === 0) {
    fail(
      `${params.label}: summary.qualityReturnCount=${qualityReturnCount} 但主播 qualityReturnCount 合计为 0`,
    )
    if (liveSessionsInCache === 0) {
      warn(`${params.label}: liveSessions 为空，主播品退归属可能失败`)
    }
  }

  if (qbTotal > 0 && qualityReturnCount === 0) {
    console.log('QualityBadCase>0 但 qualityReturnCount=0，可能原因:')
    const allUnmatched = await prisma.qualityBadCase.count({ where: { matchStatus: 'unmatched' } })
    if (allUnmatched === qbTotal) console.log('  - matchStatus 全是 unmatched')
    const withMatchedOrder = await prisma.qualityBadCase.count({
      where: { matchedOrderNo: { not: null } },
    })
    console.log(`  - 有 matchedOrderNo: ${withMatchedOrder}/${qbTotal}`)
    console.log('  - 日期范围可能不包含订单支付时间')
    console.log('  - 缓存可能未重建')
    console.log('  - 官方品退可能未匹配到 XhsRawOrder')
  }

  if (qualityReturnCount > 0 && liveSessionsInCache === 0) {
    warn(`${params.label}: 有品退订单，但缺少直播场次，主播品退归属可能偏低`)
  }

  if (cacheEntry) {
    const coreViews = filterViewsForCoreMetrics(cacheEntry.views)
    const realtime = calculateBusinessMetrics(coreViews)
    const checks: Array<{ name: string; cached: number; realtime: number }> = [
      {
        name: 'qualityReturnCount',
        cached: Number(cacheEntry.summary.qualityReturnCount ?? 0),
        realtime: realtime.qualityRefundOrderCount,
      },
      {
        name: 'orderCount',
        cached: Number(cacheEntry.summary.orderCount ?? 0),
        realtime: realtime.orderCount,
      },
      {
        name: 'totalGmv',
        cached: Number(cacheEntry.summary.totalGmv ?? 0),
        realtime: realtime.totalGmv,
      },
    ]
    for (const c of checks) {
      if (Math.abs(c.cached - c.realtime) > 0.02) {
        warn(
          `${params.label} 缓存 vs 实时 ${c.name} 不一致: cache=${c.cached} realtime=${c.realtime}`,
        )
      }
    }
  }
}

function printPageFieldChecklist(): void {
  section('页面默认字段清单（人工验收）')
  console.log('经营总览默认：支付金额 / 有效成交额 / 支付单数 / 退款率 / 品退单数')
  console.log('经营总览更多指标：签收金额 / 签收单数 / 签收率 / 退款金额 / 退款单数')
  console.log('主播业绩 PC 默认：主播 / 支付金额 / 有效成交额 / 支付单数 / 退款率 / 品退单数')
  console.log('主播业绩手机默认：支付金额 / 有效成交额 / 支付单数 / 退款率 / 品退单数')
  console.log('买家榜分区：客户价值（高价值/高客单/稳定签收/复购）· 售后风险（高风险售后/品退客户）')
  console.log('运营日报默认：核心 4 指标 + 更多指标折叠')
}

async function main(): Promise<void> {
  console.log('[verify:data-display-consistency] 只读体检，不改数据库')

  await bootstrapQualityBadCaseCache()
  const qb = await printDataFoundation()

  for (const r of CHECK_RANGES) {
    await checkRange(r, qb.qbTotal)
  }

  printPageFieldChecklist()

  section('汇总')
  console.log(`warnings: ${warnings.length}`)
  console.log(`failures: ${failures.length}`)

  if (failures.length > 0) {
    console.error('\nverify:data-display-consistency FAIL')
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }

  console.log('verify:data-display-consistency OK')
}

main()
  .catch((err) => {
    console.error('[verify:data-display-consistency] ERROR', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
