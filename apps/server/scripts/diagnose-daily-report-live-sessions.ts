/**
 * 只读诊断：日报场次归属 / 断播重开展示 / 封面点击率字段
 *
 * npx tsx apps/server/scripts/diagnose-daily-report-live-sessions.ts --date=2026-07-16
 * 可选：--anchor=主播姓名 --shop=店铺名称
 */
import { execSync } from 'node:child_process'
import { getEffectiveScheduleTableForDate } from '../src/services/anchor-daily-schedule.service'
import { buildDailyReport } from '../src/services/daily-report.service'
import {
  resolveDailyReportLiveSessionAssignments,
  type DailyReportLiveSession,
} from '../src/services/daily-report-live-sessions.service'
import {
  collapseDailyReportDisplaySessions,
  isSuspectedReconnectPair,
  parseBaseLiveId,
  parseClippedScheduleRowId,
} from '../src/services/daily-report-session-display.util'
import {
  collectLiveMetricSourceRecords,
  extractLiveSessionTraffic,
  isCoverClickRateQualified,
  parseLiveRateValue,
} from '../src/services/live-session-traffic.util'
import { parseLiveSessionTimeMs } from '../src/utils/business-timezone'

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function gapMinutes(a: DailyReportLiveSession, b: DailyReportLiveSession): number | null {
  const aEnd =
    a.endTime && a.endTime !== '—'
      ? parseLiveSessionTimeMs(a.endTime)
      : null
  const bStart = parseLiveSessionTimeMs(b.startTime)
  if (aEnd == null || bStart == null) return null
  return Math.round((bStart - aEnd) / 60_000)
}

async function main() {
  const date = argValue('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('用法: --date=YYYY-MM-DD [--anchor=姓名] [--shop=店铺]')
    process.exit(1)
  }
  const filterAnchor = argValue('anchor')?.trim()
  const filterShop = argValue('shop')?.trim()

  console.log('diagnose-daily-report-live-sessions')
  console.log(JSON.stringify({ date, gitCommit: gitSha(), filterAnchor, filterShop }, null, 2))

  const assignment = await resolveDailyReportLiveSessionAssignments(date)
  const scheduleTable = await getEffectiveScheduleTableForDate(date)
  const report = await buildDailyReport({
    preset: 'custom',
    startDate: date,
    endDate: date,
  })

  const hitMultipleKeepAll = false // 归属层固定策略：同主播多场保留
  const hitMultipleScheduleRows = assignment.debugRows.some(
    (r) => r.matchedScheduleRowId && r.skipReason == null,
  )

  console.log('\n# 策略标记')
  console.log(
    JSON.stringify(
      {
        multiple_sessions_for_anchor_keep_all: true,
        multiple_schedule_rows_for_anchor_in_one_session: hitMultipleScheduleRows,
        note: '归属层仍保留多场；展示层按同一排班+≤30分钟间隔合并',
      },
      null,
      2,
    ),
  )

  for (const [anchorName, sessions] of assignment.byAnchor.entries()) {
    if (filterAnchor && !anchorName.includes(filterAnchor)) continue
    const shopFiltered = filterShop
      ? sessions.filter(
          (s) =>
            s.sourceShopName.includes(filterShop) ||
            s.liveAccountName.includes(filterShop) ||
            s.liveName.includes(filterShop),
        )
      : sessions
    if (filterShop && shopFiltered.length === 0) continue

    const sorted = [...shopFiltered].sort((a, b) => a.startTime.localeCompare(b.startTime))
    const displayGroups = collapseDailyReportDisplaySessions(sorted)
    const reportRow = report.anchors.find((a) => a.anchorName === anchorName)

    console.log(`\n## 主播 ${anchorName}`)
    console.log(
      JSON.stringify(
        {
          sessionCountBeforeDisplayCollapse: sorted.length,
          displayGroupCount: displayGroups.length,
          reportLiveDurationText: reportRow?.liveDurationText ?? null,
          reportLiveTimeRange: reportRow?.liveTimeRange ?? null,
          reportPlatformNote: reportRow?.liveSessionPlatformNote ?? null,
          reportCoverClickRate: reportRow?.coverClickRate ?? null,
          reportCoverQualified: isCoverClickRateQualified(reportRow?.coverClickRate),
        },
        null,
        2,
      ),
    )

    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i]!
      const next = sorted[i + 1]
      const raw = s.rawJson ?? {}
      const traffic = extractLiveSessionTraffic(raw)
      const sources = collectLiveMetricSourceRecords(raw)
      const nestedCtrs: Record<string, unknown> = {}
      for (const { path, record } of sources) {
        for (const k of ['live_ctr', 'liveCtr', 'coverClickRate'] as const) {
          if (record[k] != null) nestedCtrs[`${path}.${k}`] = record[k]
        }
      }
      const roomInfo = (raw.room_data_info ??
        (raw.data as Record<string, unknown> | undefined)?.room_data_info) as
        | Record<string, unknown>
        | undefined

      const scheduleRow = scheduleTable.rows.find(
        (r) => r.rowId === parseClippedScheduleRowId(s.liveId),
      )
      const gap = next ? gapMinutes(s, next) : null
      const suspected =
        next != null ? isSuspectedReconnectPair(s, next) : false

      console.log(
        JSON.stringify(
          {
            anchorName,
            shop: s.sourceShopName,
            liveAccountName: s.liveAccountName,
            scheduleRowId: parseClippedScheduleRowId(s.liveId),
            scheduleStart: scheduleRow?.startTime ?? null,
            scheduleEnd: scheduleRow?.endTime ?? null,
            liveId: s.liveId,
            baseLiveId: parseBaseLiveId(s.liveId),
            startTime: s.startTime,
            endTime: s.endTime,
            durationMinutes: s.durationMinutes,
            gapMinutesToNext: gap,
            suspectedReconnectWithNext: suspected,
            _realtimeMetricSyncedAt: raw._realtimeMetricSyncedAt ?? null,
            liveCtr: raw.liveCtr ?? null,
            live_ctr: raw.live_ctr ?? null,
            coverClickRate_flat: raw.coverClickRate ?? null,
            room_data_info_live_ctr: roomInfo?.live_ctr ?? null,
            nestedCtrCandidates: nestedCtrs,
            parsedCoverClickRate: traffic.coverClickRate,
            parsedFromNested: parseLiveRateValue(roomInfo?.live_ctr),
            coverQualified: isCoverClickRateQualified(traffic.coverClickRate),
            trafficMissing: traffic.dataQuality.missingFields,
          },
          null,
          2,
        ),
      )
    }

    console.log(
      JSON.stringify(
        {
          displayGroups: displayGroups.map((g) => ({
            startTime: g.startTime,
            endTime: g.endTime,
            durationMinutes: g.durationMinutes,
            sourceSessionCount: g.sourceSessionCount,
            liveIds: g.liveIds,
            scheduleRowId: g.scheduleRowId,
          })),
        },
        null,
        2,
      ),
    )
  }

  console.log('\n# 日报封面点击率抽样')
  for (const row of report.anchors.slice(0, 12)) {
    console.log(
      `${row.anchorName}\tcoverClickRate=${row.coverClickRate}\tqualified=${isCoverClickRateQualified(row.coverClickRate)}\t${row.liveDurationText}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
