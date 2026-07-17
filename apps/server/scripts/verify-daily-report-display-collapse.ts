/**
 * 日报展示层：断播重开合并 + 封面点击率文案
 * npx tsx apps/server/scripts/verify-daily-report-display-collapse.ts
 */
import assert from 'node:assert/strict'
import type { AnchorLiveSessionBrief } from '../src/services/anchor-live-sessions.service'
import {
  buildDisplayLivePeriodText,
  buildLiveSessionDisplaySummary,
  collapseDailyReportDisplaySessions,
} from '../src/services/daily-report-session-display.util'
import { parseLiveRateValue } from '../src/services/live-session-traffic.util'
import { extractLiveSessionTraffic } from '../src/services/live-session-traffic.util'

const DATE = '2026-07-16'

function session(
  liveId: string,
  startHm: string,
  endHm: string,
  scheduleRowId: string,
  shop = '和田雅玉',
): AnchorLiveSessionBrief {
  const startMs = Date.parse(`${DATE}T${startHm}:00+08:00`)
  const endMs = Date.parse(`${DATE}T${endHm}:00+08:00`)
  const durationMinutes = Math.round((endMs - startMs) / 60_000)
  return {
    liveId: `${liveId}::seg::${scheduleRowId}::${startMs}`,
    liveName: shop,
    sourceShopName: shop,
    startTime: `${DATE} ${startHm}:00`,
    endTime: `${DATE} ${endHm}:00`,
    durationMinutes,
    durationText: `${durationMinutes}分`,
    viewSessionCount: null,
    joinUserCount: null,
    avgOnlineUserCount: null,
    avgViewDurationSeconds: null,
    newFollowerCount: null,
    dealUserCount: null,
    coverClickRate: null,
    stay60sUserCount: null,
    impressionCount: null,
    viewPayRate: null,
  }
}

function main() {
  console.log('verify-daily-report-display-collapse\n')

  // 1. 完全相同 liveId 片段（同 base）——两条同 clipped 不该由本函数去重，但同排班重叠会合并
  {
    const a = session('L1', '09:30', '11:00', 'morning')
    const b = session('L1', '09:30', '11:00', 'morning')
    const groups = collapseDailyReportDisplaySessions([a, b])
    assert.equal(groups.length, 1, '重叠同排班合并为 1')
    console.log('  ✓ 重叠记录合并为 1 个展示班次')
  }

  // 2. 不同 liveId 重叠 ≥30 分钟
  {
    const a = session('L-a', '09:30', '12:00', 'morning')
    const b = session('L-b', '10:00', '13:00', 'morning')
    const groups = collapseDailyReportDisplaySessions([a, b])
    assert.equal(groups.length, 1)
    assert.equal(groups[0]!.sourceSessionCount, 2)
    console.log('  ✓ 不同 liveId 重叠合并')
  }

  // 3. 断播 10 分钟重开
  {
    const a = session('L1', '09:32', '11:00', 'morning')
    const b = session('L2', '11:10', '13:58', 'morning')
    const groups = collapseDailyReportDisplaySessions([a, b])
    assert.equal(groups.length, 1, '断播10分钟应合并')
    assert.equal(groups[0]!.sourceSessionCount, 2)
    assert.equal(
      groups[0]!.durationMinutes,
      a.durationMinutes + b.durationMinutes,
      '时长不含断播间隙',
    )
    const summary = buildLiveSessionDisplaySummary(groups)
    assert.equal(summary.liveDurationText.includes('直播'), false, '不写直播2场')
    assert.equal(summary.platformRecordNote, '平台记录2段')
    const period = buildDisplayLivePeriodText(groups)
    assert.ok(period.includes('09:32') && period.includes('13:58'))
    assert.ok(!period.includes('\n'), '合并后单行时段')
    console.log('  ✓ 断播10分钟：展示1班次 + 平台记录2段 + 时长不含间隙')
  }

  // 4. 断播正好 30 分钟边界
  {
    const a = session('L1', '09:00', '11:00', 'morning')
    const b = session('L2', '11:30', '14:00', 'morning')
    const groups = collapseDailyReportDisplaySessions([a, b])
    assert.equal(groups.length, 1, '间隔30分钟应合并')
    console.log('  ✓ 间隔30分钟边界合并')
  }

  // 5. 间隔超过 30 分钟 → 2 场
  {
    const a = session('L1', '09:00', '11:00', 'morning')
    const b = session('L2', '11:31', '14:00', 'morning')
    const groups = collapseDailyReportDisplaySessions([a, b])
    assert.equal(groups.length, 2)
    const summary = buildLiveSessionDisplaySummary(groups)
    assert.ok(summary.liveDurationText.includes('直播 2 场'))
    console.log('  ✓ 间隔>30分钟显示直播2场')
  }

  // 6. 不同排班行上午/晚场 → 2 场
  {
    const a = session('L1', '09:30', '14:00', 'morning')
    const b = session('L2', '18:30', '22:00', 'evening')
    const groups = collapseDailyReportDisplaySessions([a, b])
    assert.equal(groups.length, 2)
    const summary = buildLiveSessionDisplaySummary(groups)
    assert.ok(summary.liveDurationText.includes('直播 2 场'))
    console.log('  ✓ 不同排班行显示直播2场')
  }

  // 7. 不同店铺不合并
  {
    const a = session('L1', '09:30', '12:00', 'morning', '和田雅玉')
    const b = session('L2', '12:05', '14:00', 'morning', '祥钰珠宝')
    const groups = collapseDailyReportDisplaySessions([a, b])
    assert.equal(groups.length, 2)
    console.log('  ✓ 不同店铺不合并')
  }

  // 8. 流量：合并不影响原 sessions（调用方仍对全量 sessions 聚合）
  {
    const a = { ...session('L1', '09:32', '11:00', 'morning'), coverClickRate: 0.05, impressionCount: 100 }
    const b = { ...session('L2', '11:10', '13:58', 'morning'), coverClickRate: 0.08, impressionCount: 100 }
    const groups = collapseDailyReportDisplaySessions([a, b])
    assert.equal(groups.length, 1)
    assert.equal(groups[0]!.sessions.length, 2)
    assert.equal(a.coverClickRate, 0.05)
    assert.equal(b.coverClickRate, 0.08)
    console.log('  ✓ 展示合并保留原始 sessions 供流量聚合')
  }

  // 封面点击率解析
  assert.equal(parseLiveRateValue(0.07), 0.07)
  assert.equal(parseLiveRateValue(0.069), 0.069)
  assert.equal(parseLiveRateValue(0.0522), 0.0522)
  assert.ok(Math.abs((parseLiveRateValue('5.22%') ?? 0) - 0.0522) < 1e-9)
  assert.equal(parseLiveRateValue(null), null)
  assert.equal(parseLiveRateValue(undefined), null)
  assert.equal(parseLiveRateValue(Number.NaN), null)
  const nestedCtr = extractLiveSessionTraffic({
    data: { room_data_info: { live_ctr: { value: 0.0522 } } },
  }).coverClickRate
  assert.ok(nestedCtr != null && Math.abs(nestedCtr - 0.0522) < 1e-9)
  console.log('  ✓ 封面点击率解析（含嵌套 room_data_info）')

  console.log('\nPASS')
}

main()
