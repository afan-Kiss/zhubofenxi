/**
 * 批量订单归属验收：按每笔订单支付日期的生效排班校验（只读，不改库）
 *
 * npm run verify:anchor-attribution-by-effective-schedule -- --startDate=2026-07-01 --endDate=2026-07-04
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import { buildRawAnalyzeBundleAll } from '../src/services/xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from '../src/services/business-analysis.service'
import { attachRawByMatchToViews } from '../src/services/low-price-brush-order.service'
import { resolveAnchorWithScheduleOverlay } from '../src/services/anchor-schedule-attribution.service'
import { ensureManualAnchorOverrideCache, resolveManualAnchorOverrideForView } from '../src/services/order-anchor-manual-override.service'
import { parseViewPayTimeMs } from '../src/services/anchor-performance-attribution.service'
import { scheduleDateFromPayMs } from '../src/utils/anchor-schedule-time.util'
import { resolveMetricOrderNo } from '../src/services/calc-refund-rate.service'
import type { AnalyzedOrderView } from '../src/types/analysis'
import {
  computeExpectedAnchorFromEffectiveSchedule,
  loadDailyScheduleMeta,
} from './lib/anchor-attribution-verify.util'

config({ path: path.resolve(__dirname, '../.env') })

function parseArgs(): { startDate: string; endDate: string } {
  let startDate = '2026-07-01'
  let endDate = '2026-07-04'
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--startDate=')) startDate = arg.slice('--startDate='.length).trim()
    if (arg.startsWith('--endDate=')) endDate = arg.slice('--endDate='.length).trim()
  }
  return { startDate, endDate }
}

interface MismatchRow {
  orderNo: string
  payTime: string
  liveAccountName: string
  currentAnchor: string
  attributionSource: string
  attributionExplain: string
  expectedAnchor: string
  expectedRowId: string
  expectedScheduleSource: string
}

async function main(): Promise<void> {
  const { startDate, endDate } = parseArgs()
  await bootstrapQualityBadCaseCache()
  await ensureManualAnchorOverrideCache()

  console.log('\n=== 1. 检查日期范围 ===')
  console.log(`${startDate} ~ ${endDate}`)

  const startMs = Date.parse(`${startDate}T00:00:00+08:00`)
  const endMs = Date.parse(`${endDate}T23:59:59.999+08:00`)

  const bundle = await buildRawAnalyzeBundleAll()
  if (!bundle) {
    console.log('FAIL: 无分析数据')
    process.exit(1)
  }
  const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
  const rawByMatch = new Map(
    (artifacts.dedupe.uniqueOrders ?? []).map((o) => [o.matchOrderId, o.raw]),
  )
  const views = attachRawByMatchToViews(artifacts.views, rawByMatch)

  const inRange = views.filter((v) => {
    const payMs = parseViewPayTimeMs(v)
    return payMs != null && payMs >= startMs && payMs <= endMs
  })

  console.log('\n=== 2. 检查订单总数 ===')
  console.log(inRange.length)

  const skip = {
    noPayTime: 0,
    noShop: 0,
    noScheduleHit: 0,
    manualOverride: 0,
  }
  const templateFallbackDates = new Set<string>()
  const mismatches: MismatchRow[] = []
  let derivable = 0

  const scheduleCache = new Map<string, Awaited<ReturnType<typeof loadDailyScheduleMeta>>>()

  for (const view of inRange) {
    const orderNo = resolveMetricOrderNo(view) || view.packageId || view.orderId || ''
    const payMs = parseViewPayTimeMs(view)
    if (payMs == null) {
      skip.noPayTime++
      continue
    }
    const liveAccountName = (view.liveAccountName ?? '').trim()
    if (!liveAccountName) {
      skip.noShop++
      continue
    }

    const dateKey = scheduleDateFromPayMs(payMs)
    if (!scheduleCache.has(dateKey)) {
      scheduleCache.set(dateKey, await loadDailyScheduleMeta(dateKey))
    }
    const meta = scheduleCache.get(dateKey)!
    if (meta.dbRowCount === 0) {
      templateFallbackDates.add(dateKey)
    }

    const manual = resolveManualAnchorOverrideForView(view)
    if (manual) {
      skip.manualOverride++
      continue
    }

    const { hit } = await computeExpectedAnchorFromEffectiveSchedule({
      dateKey,
      payMs,
      liveAccountName,
    })
    if (!hit) {
      skip.noScheduleHit++
      continue
    }
    derivable++

    const resolved = await resolveAnchorWithScheduleOverlay(view)
    if (resolved.anchorName !== hit.anchorName) {
      mismatches.push({
        orderNo,
        payTime: view.orderTimeText ?? new Date(payMs).toISOString(),
        liveAccountName,
        currentAnchor: resolved.anchorName,
        attributionSource: resolved.attributionSource,
        attributionExplain: resolved.attributionExplain,
        expectedAnchor: hit.anchorName,
        expectedRowId: hit.row.rowId,
        expectedScheduleSource: hit.row.source,
      })
    }
  }

  console.log('\n=== 3. 可按当天生效排班推导订单数 ===')
  console.log(derivable)

  console.log('\n=== 4. 跳过原因统计 ===')
  console.log(JSON.stringify(skip, null, 2))

  if (templateFallbackDates.size > 0) {
    console.log('\n⚠ 以下日期无日排班，使用模板兜底；请确认这不是历史排班缺失：')
    for (const d of [...templateFallbackDates].sort()) {
      console.log(`  - ${d}`)
    }
  }

  console.log('\n=== 5. 错归订单列表 ===')
  if (mismatches.length === 0) {
    console.log('（无）')
  } else {
    for (const row of mismatches) {
      console.log(JSON.stringify(row, null, 2))
    }
  }

  console.log('\n=== 验收 ===')
  if (mismatches.length > 0) {
    console.log(`✗ FAIL: ${mismatches.length} 笔订单与当天生效排班不一致`)
    process.exit(1)
  }
  console.log('✓ PASS: 范围内可推导订单均与当天生效排班一致')
}

main()
  .catch((err) => {
    console.error('FAIL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
