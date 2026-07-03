/**
 * 直播场次无时区时间过滤验收（Asia/Shanghai）
 */
import { parseLiveSessionTimeMs } from '../src/utils/business-timezone'
import { formatDateKeyShanghai } from '../src/utils/business-timezone'

function assert(cond: boolean, msg: string, issues: string[]) {
  if (!cond) issues.push(msg)
}

function sessionInDateRange(startTime: string, rangeStartMs: number, rangeEndMs: number): boolean {
  const startMs = parseLiveSessionTimeMs(startTime)
  if (startMs == null) return false
  return startMs >= rangeStartMs && startMs <= rangeEndMs
}

function run(): void {
  const issues: string[] = []
  const dateKey = '2026-06-18'
  const rangeStartMs = Date.parse(`${dateKey}T00:00:00+08:00`)
  const rangeEndMs = Date.parse(`${dateKey}T23:59:59.999+08:00`)

  const earlyMorning = '2026-06-18 00:30:00'
  const lateNight = '2026-06-18 23:50:00'

  assert(sessionInDateRange(earlyMorning, rangeStartMs, rangeEndMs), '00:30 应属于当天', issues)
  assert(sessionInDateRange(lateNight, rangeStartMs, rangeEndMs), '23:50 应属于当天', issues)

  const ms = parseLiveSessionTimeMs(earlyMorning)!
  assert(formatDateKeyShanghai(new Date(ms)) === dateKey, '解析后日期 key 应为 2026-06-18', issues)

  const wrongParse = new Date(earlyMorning).getTime()
  const wrongKey = formatDateKeyShanghai(new Date(wrongParse))
  if (process.env.TZ === 'UTC' || new Date(earlyMorning).getUTCHours() !== 0) {
    // 在 UTC 等非上海时区，原生 Date 解析可能跨天；业务解析必须稳定
    assert(formatDateKeyShanghai(new Date(ms)) === dateKey, '业务解析不应受服务器时区影响', issues)
  }

  if (issues.length) {
    console.error('[verify:live-session-timezone-filter] FAIL')
    for (const i of issues) console.error(' -', i)
    process.exit(1)
  }
  console.log('[verify:live-session-timezone-filter] PASS')
}

run()
