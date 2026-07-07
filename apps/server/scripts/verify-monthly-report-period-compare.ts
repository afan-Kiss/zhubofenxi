/**
 * 月报环比日期范围验收：本月未结束同天数对比 vs 完整历史月整月对比
 *
 * npm run verify:monthly-report-period-compare
 */
import path from 'node:path'
import { config } from 'dotenv'
import {
  getMonthlyOperationsReport,
  resolveMonthlyCompareRange,
  resolveMonthlyReportRange,
} from '../src/services/monthly-operations-report.service'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'

config({ path: path.resolve(__dirname, '../.env') })

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`)
}
function fail(msg: string): void {
  console.error(`  ✗ FAIL: ${msg}`)
}

async function main(): Promise<void> {
  console.log('verify-monthly-report-period-compare\n')
  let failures = 0

  const todayKey = formatDateKeyShanghai(new Date())
  const currentMonth = todayKey.slice(0, 7)

  console.log('=== 1. resolveMonthlyCompareRange 单元 ===')

  const unfinished = resolveMonthlyCompareRange({
    month: '2026-07',
    rangeEndDate: '2026-07-07',
    resolvedEndDate: '2026-07-31',
    todayKey: '2026-07-07',
  })
  if (unfinished.compareMode !== 'same_day_count') {
    fail(`未结束月 compareMode=${unfinished.compareMode}`)
    failures++
  } else if (unfinished.prevStartDate !== '2026-06-01' || unfinished.prevEndDate !== '2026-06-07') {
    fail(
      `未结束月对比范围 ${unfinished.prevStartDate}~${unfinished.prevEndDate}，期望 2026-06-01~2026-06-07`,
    )
    failures++
  } else {
    ok('2026-07-01~07 对比 2026-06-01~06（same_day_count）')
  }

  const fullMonth = resolveMonthlyCompareRange({
    month: '2026-05',
    rangeEndDate: '2026-05-31',
    resolvedEndDate: '2026-05-31',
    todayKey: '2026-07-07',
  })
  if (fullMonth.compareMode !== 'full_month') {
    fail(`历史完整月 compareMode=${fullMonth.compareMode}`)
    failures++
  } else if (fullMonth.prevStartDate !== '2026-04-01' || fullMonth.prevEndDate !== '2026-04-30') {
    fail(
      `历史完整月对比范围 ${fullMonth.prevStartDate}~${fullMonth.prevEndDate}，期望 2026-04-01~2026-04-30`,
    )
    failures++
  } else {
    ok('2026-05 整月对比 2026-04 整月（full_month）')
  }

  const febEdge = resolveMonthlyCompareRange({
    month: '2026-03',
    rangeEndDate: '2026-03-31',
    resolvedEndDate: '2026-03-31',
    todayKey: '2026-07-07',
  })
  if (febEdge.prevEndDate !== '2026-02-28') {
    fail(`3月整月对比 2月应为 02-28，实际 ${febEdge.prevEndDate}`)
    failures++
  } else {
    ok('3月整月对比 2月截断至 02-28')
  }

  console.log('\n=== 2. 月报接口返回 ===')

  try {
    const currentReport = await getMonthlyOperationsReport({ month: currentMonth })
    const { range, dataQuality, plainLanguageSummary } = currentReport
    const resolved = resolveMonthlyReportRange({ month: currentMonth })
    const monthNotFinished = resolved.endDate > todayKey

    if (monthNotFinished) {
      if (range.compareMode !== 'same_day_count') {
        fail(`当前月 ${currentMonth} compareMode=${range.compareMode}，期望 same_day_count`)
        failures++
      } else {
        ok(`当前月 compareMode=same_day_count`)
      }
      const expectedPrevEnd = resolveMonthlyCompareRange({
        month: currentMonth,
        rangeEndDate: range.endDate,
        resolvedEndDate: resolved.endDate,
        todayKey,
      }).prevEndDate
      if (range.prevEndDate !== expectedPrevEnd) {
        fail(`prevEndDate=${range.prevEndDate} ≠ ${expectedPrevEnd}`)
        failures++
      } else {
        ok(`prev 对比范围 ${range.prevStartDate} ~ ${range.prevEndDate}`)
      }
      const hint = '本月还没结束，先按同天数和上月比较，月底后再看整月。'
      const hasHint =
        dataQuality.warnings.some((w) => w.includes(hint)) ||
        plainLanguageSummary.items.some((i) => i.text.includes(hint))
      if (!hasHint) {
        fail('缺少月中环比大白话提示')
        failures++
      } else {
        ok('dataQuality / plainLanguageSummary 含月中对比提示')
      }
    } else {
      if (range.compareMode !== 'full_month') {
        fail(`当前月已结束 compareMode=${range.compareMode}`)
        failures++
      } else {
        ok(`当前月已结束 compareMode=full_month`)
      }
    }
  } catch (err) {
    fail(`当前月报生成失败：${err instanceof Error ? err.message : String(err)}`)
    failures++
  }

  try {
    const histReport = await getMonthlyOperationsReport({ month: '2026-05' })
    if (histReport.range.compareMode !== 'full_month') {
      fail(`2026-05 compareMode=${histReport.range.compareMode}`)
      failures++
    } else if (
      histReport.range.prevStartDate !== '2026-04-01' ||
      histReport.range.prevEndDate !== '2026-04-30'
    ) {
      fail(
        `2026-05 prev 范围 ${histReport.range.prevStartDate}~${histReport.range.prevEndDate}`,
      )
      failures++
    } else {
      ok('2026-05 历史月 compareMode=full_month，prev=2026-04 整月')
    }
  } catch (err) {
    fail(`2026-05 月报生成失败：${err instanceof Error ? err.message : String(err)}`)
    failures++
  }

  if (failures > 0) {
    console.log(`\nFAIL (${failures} 项)`)
    process.exit(1)
  }
  console.log('\nPASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
