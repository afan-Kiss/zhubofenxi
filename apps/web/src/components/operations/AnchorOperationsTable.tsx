import React from 'react'
import type { DailyOperationsAnchorRow } from '../../pages/operations/operationsReportTypes'
import { AnchorLateStatusBadge } from '../board/AnchorLateStatusBadge'
import {
  formatLateTimingLine,
  readLateStatus,
} from '../../lib/anchor-late-status'
import {
  formatDuration,
  formatHourly,
  formatIntegerMoney,
  formatOrderCount,
  formatPeopleCount,
  formatRatePercent,
  formatStayDurationSeconds,
} from './operationsReportFormatters'

function formatAnchorSessionTiming(
  row: DailyOperationsAnchorRow,
  showAttendanceStatus: boolean,
): string {
  const liveTime =
    row.liveTimeRange && row.liveTimeRange !== '—'
      ? row.liveTimeRange
      : row.livePeriodText?.replace(/~/g, '–') ?? '—'
  if (!showAttendanceStatus) return liveTime
  const late = readLateStatus(row)
  const scheduleHint =
    row.scheduleMatched && row.scheduleTimeRange
      ? `（排班 ${row.scheduleTimeRange}）`
      : ''
  if (liveTime !== '—') {
    return `${liveTime}${scheduleHint}`
  }
  return formatLateTimingLine(late) ?? liveTime
}

interface Props {
  rows: DailyOperationsAnchorRow[]
  showAttendanceStatus?: boolean
}

export const AnchorOperationsTable: React.FC<Props> = ({
  rows,
  showAttendanceStatus = true,
}) => {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">暂无主播数据</p>
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-[1200px] w-full text-left text-xs">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2">主播</th>
            <th className="px-3 py-2">场次</th>
            <th className="px-3 py-2">开播时间</th>
            <th className="px-3 py-2">有效成交</th>
            <th className="px-3 py-2">订单</th>
            <th className="px-3 py-2">退货单</th>
            <th className="px-3 py-2">退货单率</th>
            <th className="px-3 py-2">直播时长</th>
            <th className="px-3 py-2">每小时成交</th>
            <th className="px-3 py-2">场观</th>
            <th className="px-3 py-2">进房</th>
            <th className="px-3 py-2">成交人数</th>
            <th className="px-3 py-2">成交率</th>
            <th className="px-3 py-2">新增粉丝</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const late = readLateStatus(row)
            const highlightRow =
              showAttendanceStatus && (late.isLate || late.isEarlyLeave)
            return (
            <tr
              key={row.anchorName}
              className={
                highlightRow ? 'border-t border-red-100 bg-red-50/40' : 'border-t border-slate-100'
              }
            >
              <td className="px-3 py-2 font-medium text-slate-900">
                <div className="flex items-center gap-2">
                  <span>{row.anchorName}</span>
                  {showAttendanceStatus ? <AnchorLateStatusBadge row={row} /> : null}
                </div>
              </td>
              <td className="px-3 py-2 text-slate-600">{row.sessionLabel}</td>
              <td
                className={
                  showAttendanceStatus && late.isLate
                    ? 'px-3 py-2 font-medium text-red-600'
                    : 'px-3 py-2 text-slate-600'
                }
              >
                {formatAnchorSessionTiming(row, showAttendanceStatus)}
              </td>
              <td className="px-3 py-2">{formatIntegerMoney(row.validAmountYuan)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.soldOrderCount)}</td>
              <td className="px-3 py-2">{formatOrderCount(row.returnOrderCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.returnOrderRate)}</td>
              <td className="px-3 py-2">{formatDuration(row.liveDurationMinutes)}</td>
              <td className="px-3 py-2">{formatHourly(row.hourlyAmountYuan)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.viewSessionCount)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.joinUserCount)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.dealUserCount)}</td>
              <td className="px-3 py-2">{formatRatePercent(row.dealConversionRate)}</td>
              <td className="px-3 py-2">{formatPeopleCount(row.newFollowerCount)}</td>
            </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
