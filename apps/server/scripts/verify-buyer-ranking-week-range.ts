/**
 * 买家排行周范围验收（Asia/Shanghai 周一到周日）
 * 用法: npm run verify:buyer-ranking-week-range
 */
import {
  lastWeekEndKeyShanghai,
  lastWeekStartKeyShanghai,
  resolveBuyerRankingDateRange,
} from '../src/utils/buyer-ranking-date-range'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function shanghaiNoonUtc(year: number, month: number, day: number): Date {
  return new Date(
    Date.parse(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00+08:00`,
    ),
  )
}

function addDayKey(key: string, delta: number): string {
  const ms = Date.parse(`${key}T12:00:00+08:00`) + delta * 86_400_000
  return formatDateKeyShanghai(new Date(ms))
}

function main() {
  const issues: string[] = []

  const fri = shanghaiNoonUtc(2026, 7, 3)
  const thisWeekFri = resolveBuyerRankingDateRange('thisWeek', undefined, undefined, fri)
  assert(
    thisWeekFri.startDate === '2026-06-29' && thisWeekFri.endDate === '2026-07-03',
    `2026-07-03 本周应为 2026-06-29~2026-07-03，实际 ${thisWeekFri.startDate}~${thisWeekFri.endDate}`,
    issues,
  )

  const lastWeekFri = resolveBuyerRankingDateRange('lastWeek', undefined, undefined, fri)
  const expectedLastStart = lastWeekStartKeyShanghai(fri)
  const expectedLastEnd = lastWeekEndKeyShanghai(fri)
  assert(
    lastWeekFri.startDate === expectedLastStart && lastWeekFri.endDate === expectedLastEnd,
    `2026-07-03 上周应为 ${expectedLastStart}~${expectedLastEnd}（周一到周日），实际 ${lastWeekFri.startDate}~${lastWeekFri.endDate}`,
    issues,
  )
  assert(
    lastWeekFri.endDate === addDayKey(expectedLastStart, 6),
    `上周结束日应为上周一+6天（周日），实际 ${lastWeekFri.endDate}`,
    issues,
  )

  const mon = shanghaiNoonUtc(2026, 7, 6)
  const thisWeekMon = resolveBuyerRankingDateRange('thisWeek', undefined, undefined, mon)
  assert(
    thisWeekMon.startDate === '2026-07-06' && thisWeekMon.endDate === '2026-07-06',
    `2026-07-06 本周应为 2026-07-06~2026-07-06，实际 ${thisWeekMon.startDate}~${thisWeekMon.endDate}`,
    issues,
  )

  const lastWeekMon = resolveBuyerRankingDateRange('lastWeek', undefined, undefined, mon)
  assert(
    lastWeekMon.startDate === '2026-06-29' && lastWeekMon.endDate === '2026-07-05',
    `2026-07-06 上周应为 2026-06-29~2026-07-05，实际 ${lastWeekMon.startDate}~${lastWeekMon.endDate}`,
    issues,
  )

  const recent7 = resolveBuyerRankingDateRange('recent7', undefined, undefined, fri)
  assert(
    recent7.startDate === '2026-06-27' && recent7.endDate === '2026-07-03',
    `2026-07-03 recent7 应为 2026-06-27~2026-07-03，实际 ${recent7.startDate}~${recent7.endDate}`,
    issues,
  )
  const recent15 = resolveBuyerRankingDateRange('recent15', undefined, undefined, fri)
  assert(
    recent15.startDate === '2026-06-19' && recent15.endDate === '2026-07-03',
    `2026-07-03 recent15 应为 2026-06-19~2026-07-03，实际 ${recent15.startDate}~${recent15.endDate}`,
    issues,
  )
  const recent30 = resolveBuyerRankingDateRange('recent30', undefined, undefined, fri)
  assert(
    recent30.startDate === '2026-06-04' && recent30.endDate === '2026-07-03',
    `2026-07-03 recent30 应为 2026-06-04~2026-07-03，实际 ${recent30.startDate}~${recent30.endDate}`,
    issues,
  )

  if (issues.length > 0) {
    console.error('[verify:buyer-ranking-week-range] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:buyer-ranking-week-range] PASS')
}

main()
