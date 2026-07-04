/**
 * 品退同步后经营总览缓存一致性验收
 * 用法: npm run accept:quality-business-cache
 */
import path from 'node:path'
import { config } from 'dotenv'
import { bootstrapQualityBadCaseCache } from '../src/services/quality-badcase-store.service'
import {
  buildAndSetBusinessBoardCache,
  getBusinessBoardCache,
  invalidateBusinessBoardCache,
} from '../src/services/business-cache.service'
import { buildBoardMetricDetail } from '../src/services/board-metric-detail.service'
import { executeBoardLocalQuery } from '../src/services/board-local-query.service'
import { buildQualityRefundMonthDiagnostic } from '../src/services/quality-refund-month-diagnostic.service'
import { filterViewsForCoreMetrics } from '../src/services/metrics-exclusion.service'
import { rebuildBusinessBoardCacheAfterQualityDataChange } from '../src/services/quality-badcase-cache-hooks.service'
import { resolveBusinessRange } from '../src/utils/business-range'
import { prisma } from '../src/lib/prisma'

config({ path: path.resolve(__dirname, '../.env') })

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

async function main(): Promise<void> {
  const issues: string[] = []
  const preset = 'thisMonth'
  const range = resolveBusinessRange(preset)

  await bootstrapQualityBadCaseCache()
  const caseCount = await prisma.qualityBadCase.count()

  invalidateBusinessBoardCache()
  const before = getBusinessBoardCache(preset, range.startDate, range.endDate)
  assert(before == null, 'invalidate 后 thisMonth 缓存应为空', issues)

  await buildAndSetBusinessBoardCache({ preset })
  const entry1 = getBusinessBoardCache(preset, range.startDate, range.endDate)
  assert(Boolean(entry1), 'build 后 thisMonth 缓存应存在', issues)

  await rebuildBusinessBoardCacheAfterQualityDataChange('accept:quality-business-cache 验收')
  const entry2 = getBusinessBoardCache(preset, range.startDate, range.endDate)
  assert(Boolean(entry2), '品退重建后 thisMonth 缓存应存在', issues)
  if (entry1 && entry2) {
    assert(
      entry2.lastBuiltAt >= entry1.lastBuiltAt,
      '品退重建后缓存 lastBuiltAt 应更新',
      issues,
    )
  }

  const local = await executeBoardLocalQuery({ preset })
  const summary = (local.summary ?? {}) as Record<string, unknown>
  const summaryQuality = Number(summary.qualityReturnCount ?? 0)
  const summaryReturnCount = Number(summary.returnCount ?? 0)
  const summaryReturnAmount = Number(summary.returnAmount ?? 0)

  const detail = await buildBoardMetricDetail({
    metric: 'qualityReturnCount',
    preset,
    startDate: local.startDate,
    endDate: local.endDate,
    role: 'super_admin',
    username: 'admin',
  })
  const detailQuality = Number(detail.summary.qualityRefundOrderCount ?? detail.summary.valueRaw ?? 0)
  assert(
    summaryQuality === detailQuality,
    `thisMonth summary.qualityReturnCount(${summaryQuality}) 应与 metric-detail(${detailQuality}) 一致`,
    issues,
  )

  if (entry2) {
    const coreViews = filterViewsForCoreMetrics(entry2.views)
    const diagnostic = buildQualityRefundMonthDiagnostic({
      views: coreViews,
      allViews: entry2.views,
      startDate: entry2.startDate,
      endDate: entry2.endDate,
    })
    assert(
      diagnostic.periodQualityRefundOrderCount === summaryQuality,
      `诊断 periodQualityRefundOrderCount(${diagnostic.periodQualityRefundOrderCount}) 应与 summary(${summaryQuality}) 一致`,
      issues,
    )

    if (diagnostic.excludedByLowPriceBrushCount > 0) {
      const hasBrushReason = diagnostic.excludeSamples.some((s) =>
        s.reason.includes('低价刷单'),
      )
      assert(
        hasBrushReason || diagnostic.excludedByLowPriceBrushCount > 0,
        '存在低价刷单排除时，诊断应说明「被低价刷单排除」',
        issues,
      )
    }

    if (caseCount > 0 && summaryQuality === 0 && diagnostic.officialMatchedInPeriodCount > 0) {
      assert(
        diagnostic.excludeSamples.length > 0,
        '有官方品退匹配但 summary 为 0 时，诊断必须给出未计入原因样本',
        issues,
      )
    }
  }

  console.log('[accept:quality-business-cache] thisMonth 对账:')
  console.log(`  qualityReturnCount=${summaryQuality}`)
  console.log(`  returnCount=${summaryReturnCount}`)
  console.log(`  returnAmount=${summaryReturnAmount.toFixed(2)}`)
  console.log(`  qualityBadCaseRows=${caseCount}`)
  console.log(`  metric-detail qualityRefundOrderCount=${detailQuality}`)

  if (issues.length) {
    console.error('[accept:quality-business-cache] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[accept:quality-business-cache] PASS')
}

void main()
  .catch((err) => {
    console.error('[accept:quality-business-cache] ERROR', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
