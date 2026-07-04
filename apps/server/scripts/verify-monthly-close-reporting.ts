#!/usr/bin/env tsx
/**
 * 月度结账结论/缓存/cent 口径验收（不依赖真实 DB 订单）
 */
import {
  buildConclusionReasonSummaryFromChecks,
  resolveValidRevenueCentFromSectionB,
} from '../src/services/monthly-close-conclusion.util'
import { isMonthlyCloseReportBuildStale } from '../src/utils/report-build-meta'
import type { DataAccuracyCheck } from '../src/services/monthly-close-auto.types'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function main(): void {
  const issues: string[] = []

  const boardDailyDanger: DataAccuracyCheck = {
    key: 'board_vs_daily_sum',
    title: '经营总览 vs 运营日报逐日求和',
    status: 'danger',
    category: 'blocking',
    diffCent: 20,
    note: 'test',
  }
  const summary1 = buildConclusionReasonSummaryFromChecks({
    checks: [boardDailyDanger],
    syncRiskStatus: 'pass',
    overallStatus: 'danger',
  })
  assert(summary1.includes('金额差异'), 'board_vs_daily_sum 新 title 仍应识别金额差异', issues)
  assert(
    !summary1.includes('经营总览和运营日报'),
    '结论摘要不应依赖 blockingIssues 中文文案',
    issues,
  )

  const qualityWarning: DataAccuracyCheck = {
    key: 'quality_refund_diagnostic',
    title: '品退订单数诊断',
    status: 'warning',
    category: 'info',
    note: '官方已匹配但未计入',
  }
  const summary2 = buildConclusionReasonSummaryFromChecks({
    checks: [qualityWarning],
    syncRiskStatus: 'pass',
    overallStatus: 'warning',
  })
  assert(summary2.includes('品退诊断异常'), 'quality warning 应显示品退诊断异常', issues)

  assert(
    isMonthlyCloseReportBuildStale(
      { schemaVersion: 2, gitCommit: 'abc123', fullScan: true },
      { schemaVersion: 2, gitCommit: 'def456', fullScan: true },
    ),
    'gitCommit 不一致应判定为 stale',
    issues,
  )
  assert(
    !isMonthlyCloseReportBuildStale(
      { schemaVersion: 2, gitCommit: 'abc123', fullScan: true },
      { schemaVersion: 2, gitCommit: 'abc123', fullScan: true },
    ),
    'buildMeta 一致不应 stale',
    issues,
  )
  assert(
    isMonthlyCloseReportBuildStale(
      { schemaVersion: 1, gitCommit: 'abc123', fullScan: true },
      { schemaVersion: 2, gitCommit: 'abc123', fullScan: true },
    ),
    'schemaVersion 不一致应 stale',
    issues,
  )

  assert(
    resolveValidRevenueCentFromSectionB({ validAmountCent: 239790 }) === 239790,
    '应优先使用 sectionB.validAmountCent',
    issues,
  )
  assert(
    resolveValidRevenueCentFromSectionB({ validAmountYuan: 2397.9 }) === 239790,
    '无 cent 时 fallback yuan*100',
    issues,
  )

  if (issues.length > 0) {
    console.error('[verify:monthly-close-reporting] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:monthly-close-reporting] PASS')
}

main()
