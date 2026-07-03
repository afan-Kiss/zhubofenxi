/**
 * 月度结账日期规则验收
 */
import {
  resolveMonthlyCloseMonth,
  resolvePreviousCalendarMonthKey,
} from '../src/utils/monthly-close-month.util'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function run(): void {
  const issues: string[] = []

  assert(
    resolvePreviousCalendarMonthKey(new Date('2026-07-15T12:00:00+08:00')) === '2026-06',
    '7月15日上一月应为6月',
    issues,
  )
  assert(
    resolvePreviousCalendarMonthKey(new Date('2026-01-10T12:00:00+08:00')) === '2025-12',
    '1月上一月应为去年12月',
    issues,
  )

  const july15 = resolveMonthlyCloseMonth({
    autoPrevMonth: true,
    now: new Date('2026-07-15T10:00:00+08:00'),
  })
  assert(july15.month === '2026-06', 'auto 7/15 -> 2026-06', issues)
  assert(july15.startDate === '2026-06-01', 'start 6/1', issues)
  assert(july15.endDate === '2026-06-30', 'end 6/30', issues)
  assert(july15.isCompleteNaturalMonth === true, '完整自然月', issues)

  const manual = resolveMonthlyCloseMonth({ month: '2026-05' })
  assert(manual.startDate === '2026-05-01' && manual.endDate === '2026-05-31', '手动5月', issues)

  if (issues.length) {
    console.error('[verify:monthly-close-month] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:monthly-close-month] PASS')
}

run()
