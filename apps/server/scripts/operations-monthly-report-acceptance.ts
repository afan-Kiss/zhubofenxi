/**
 * 运营月报验收
 * 用法: npm run accept:operations-monthly-report
 */
import {
  getMonthlyOperationsReport,
  MonthlyOperationsReportValidationError,
  resolveMonthlyReportRange,
} from '../src/services/monthly-operations-report.service'

const PRIVACY_FIELDS = [
  'phone',
  'mobile',
  'address',
  'receiver',
  'buyerName',
  'buyerPhone',
  'platformRawJson',
  'rawJson',
  'idCard',
  'buyerId',
  'buyerKey',
]

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function scanPrivacy(payload: unknown, issues: string[]) {
  const json = JSON.stringify(payload)
  for (const f of PRIVACY_FIELDS) {
    if (json.includes(`"${f}"`)) issues.push(`响应含隐私字段 ${f}`)
  }
}

async function expectValidation(fn: () => unknown, issues: string[]) {
  try {
    await fn()
    issues.push('应抛出校验错误但未抛出')
  } catch (err) {
    if (!(err instanceof MonthlyOperationsReportValidationError)) {
      issues.push(`期望 MonthlyOperationsReportValidationError，实际 ${String(err)}`)
    }
  }
}

async function main() {
  const issues: string[] = []

  const byMonth = resolveMonthlyReportRange({ month: '2026-05' })
  assert(byMonth.startDate === '2026-05-01', 'month=2026-05 startDate 应为 2026-05-01', issues)
  assert(byMonth.endDate === '2026-05-31', 'month=2026-05 endDate 应为 2026-05-31', issues)

  const byRange = resolveMonthlyReportRange({
    startDate: '2026-05-01',
    endDate: '2026-05-07',
  })
  assert(byRange.startDate === '2026-05-01', 'startDate/endDate 模式 start 正确', issues)

  await expectValidation(
    () => resolveMonthlyReportRange({ month: '2026-13' }),
    issues,
  )
  await expectValidation(
    () => resolveMonthlyReportRange({ startDate: 'bad', endDate: '2026-05-01' }),
    issues,
  )
  await expectValidation(
    () =>
      resolveMonthlyReportRange({
        startDate: '2026-05-01',
        endDate: '2026-07-05',
      }),
    issues,
  )

  let report
  try {
    report = await getMonthlyOperationsReport({ month: '2026-05' })
  } catch (err) {
    issues.push(`月报生成失败：${err instanceof Error ? err.message : String(err)}`)
    report = null
  }

  if (report) {
    const { summary } = report
    assert(Number.isFinite(summary.validAmountYuan), 'validAmountYuan 应为有限数', issues)
    assert(!Number.isNaN(summary.soldOrderCount), 'soldOrderCount 不应为 NaN', issues)
    assert(Array.isArray(report.dailyTrend), 'dailyTrend 应为数组', issues)
    assert(report.dailyTrend.length > 0, 'dailyTrend 应有日期', issues)
    assert(report.rankings.anchors.byAmount != null, 'rankings.anchors 存在', issues)
    assert(report.businessInsights != null, 'businessInsights 存在', issues)
    assert(report.insightActionStats.summary != null, 'insightActionStats 存在', issues)
    assert(Array.isArray(report.dataQuality.warnings), 'dataQuality.warnings 应为数组', issues)

    if (summary.dealUserCount == null || summary.joinUserCount == null) {
      assert(summary.dealConversionRate == null, '缺官方成交人数时成交率应为 null', issues)
    }

    const cmp = report.compareWithPreviousMonth
    if (cmp.validAmountYuanChangePercent == null && cmp.warnings.length === 0) {
      /* 有上月数据时可为数；无上月时 warnings 或 null 均可 */
    }

    const slowWarnings = JSON.stringify(report.rankings.products.slow.dataQuality.warnings)
    if (!slowWarnings.includes('主推')) {
      assert(
        report.rankings.products.slow.items.length === 0 ||
          report.rankings.products.slow.dataQuality.reliable === false,
        '无主推池时不应生成可靠滞销正式榜',
        issues,
      )
    }

    scanPrivacy(report, issues)
  }

  if (issues.length > 0) {
    console.error('[operations-monthly-report-acceptance] FAIL')
    for (const i of issues) console.error(`  - ${i}`)
    process.exit(1)
  }
  console.log('[operations-monthly-report-acceptance] OK')
}

main().catch((err) => {
  console.error('[operations-monthly-report-acceptance] FAIL', err)
  process.exit(1)
})
