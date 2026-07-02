import React from 'react'
import './daily-report-export.css'
import {
  formatDuration,
  formatHourly,
  formatMoney,
  formatOrderCount,
  formatPeopleCount,
  formatPercent,
} from './dailyReportFormatters'
import { AnchorLateStatusBadge } from './AnchorLateStatusBadge'
import {
  formatLateTimingLine,
  readLateStatus,
} from '../../lib/anchor-late-status'
import type { DailyReportAnchorRow, DailyReportPayload } from './DailyReportImageSheet'

const EXPORT_MAX_PHOTOS = 16

interface ShipmentPhoto {
  id: string
  publicUrl: string
  caption: string | null
  dataUrl?: string | null
}

interface Props {
  data: DailyReportPayload
  showAttendanceStatus?: boolean
  shipmentPhotos?: ShipmentPhoto[]
}

function resolvePhotoWall(totalCount: number): { cols: 2 | 3 | 4; colsClass: string } {
  if (totalCount >= 9) {
    return { cols: 4, colsClass: 'daily-report-export-photo-wall--cols-4' }
  }
  if (totalCount >= 5) {
    return { cols: 3, colsClass: 'daily-report-export-photo-wall--cols-3' }
  }
  return { cols: 2, colsClass: 'daily-report-export-photo-wall--cols-2' }
}

function buildPhotoCaption(total: number, displayed: number, remaining: number): string {
  if (total <= 0) return ''
  if (remaining > 0) {
    return `共 ${total} 张发货前照片，本图展示 ${displayed} 张，剩余 ${remaining} 张可在系统内查看`
  }
  return `共 ${total} 张发货前照片`
}

function ExportAnchorCard({
  row,
  showAttendanceStatus,
}: {
  row: DailyReportAnchorRow
  showAttendanceStatus: boolean
}) {
  const late = readLateStatus(row)
  const liveTime =
    row.liveTimeRange && row.liveTimeRange !== '—'
      ? row.liveTimeRange
      : row.livePeriodText && row.livePeriodText !== '—'
        ? row.livePeriodText.replace(/~/g, '–')
        : '—'
  const scheduleText =
    showAttendanceStatus && row.scheduleMatched && row.scheduleTimeRange
      ? row.scheduleTimeRange
      : showAttendanceStatus && row.scheduleMatched && late.scheduledPeriodText
        ? late.scheduledPeriodText.replace(/~/g, '–')
        : null
  const timingDetail = showAttendanceStatus ? formatLateTimingLine(late) : null
  const alert = showAttendanceStatus && (late.isLate || late.isEarlyLeave)

  return (
    <div
      className={`daily-report-export-anchor-card${alert ? ' daily-report-export-anchor-card--alert' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-slate-900">
            {row.anchorName}｜{row.sessionLabel}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{row.shopName}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {showAttendanceStatus ? <AnchorLateStatusBadge row={late} /> : null}
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
            占比 {formatPercent(row.amountRatio)}
          </span>
        </div>
      </div>
      <div className="mt-2 space-y-0.5 text-[11px]">
        <p className={alert ? 'font-medium text-red-600' : 'text-slate-600'}>
          直播 {liveTime}
          {scheduleText ? (
            <span className="text-slate-400">（排班 {scheduleText}）</span>
          ) : null}
          {showAttendanceStatus && (late.isLate || late.isEarlyLeave) && timingDetail
            ? `｜${late.attendanceLabel || late.label}`
            : null}
        </p>
        <p className="text-slate-800">
          <span className="font-semibold text-slate-900">
            真实发货 {formatMoney(row.shippedAmountYuan)}
          </span>
          <span className="text-slate-400"> · </span>
          卖出 {formatOrderCount(row.soldOrderCount)}
          <span className="text-slate-400"> · </span>
          <span className={row.invalidOrderCount > 0 ? 'font-medium text-red-600' : ''}>
            关闭/退货 {formatOrderCount(row.invalidOrderCount)}
          </span>
        </p>
      </div>
    </div>
  )
}

export const DailyReportExportView = React.forwardRef<HTMLDivElement, Props>(
  function DailyReportExportView({ data, showAttendanceStatus = true, shipmentPhotos = [] }, ref) {
    const readyPhotos = shipmentPhotos.filter((photo) => photo.dataUrl)
    const totalPhotoCount = readyPhotos.length
    const displayedPhotos = readyPhotos.slice(0, EXPORT_MAX_PHOTOS)
    const displayedCount = displayedPhotos.length
    const remainingCount = Math.max(0, totalPhotoCount - displayedCount)
    const photoWall = resolvePhotoWall(displayedCount + (remainingCount > 0 ? 1 : 0))
    const photoCaption = buildPhotoCaption(totalPhotoCount, displayedCount, remainingCount)

    const anchorCols =
      data.anchors.length >= 4
        ? 'daily-report-export-grid--cols-3'
        : 'daily-report-export-grid--cols-2'

    const photoWallSizeClass =
      displayedCount <= 2
        ? 'daily-report-export-photo-wall--size-xl'
        : displayedCount <= 4
          ? 'daily-report-export-photo-wall--size-lg'
          : displayedCount <= 9
            ? 'daily-report-export-photo-wall--size-md'
            : 'daily-report-export-photo-wall--size-sm'

    return (
      <div
        ref={ref}
        data-daily-report-export
        className="daily-report-export"
      >
        <div className="daily-report-export-header">
          <div>
            <h1 className="text-[26px] font-bold tracking-wide text-slate-900">{data.title}</h1>
            <p className="mt-1 text-[14px] text-slate-500">{data.dateLabel}</p>
          </div>
          <p className="text-right text-[22px] font-bold text-slate-900">
            真实发货 {formatMoney(data.summary.totalShippedAmountYuan)}
          </p>
        </div>

        <div className="daily-report-export-summary">
          <div>
            <p className="text-[11px] text-slate-500">真实卖出</p>
            <p className="text-[15px] font-semibold text-slate-900">
              {formatOrderCount(data.summary.totalSoldOrderCount)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500">直播总时长</p>
            <p className="text-[15px] font-semibold text-slate-900">
              {formatDuration(data.summary.totalLiveDurationMinutes)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500">整体时均产出</p>
            <p className="text-[15px] font-semibold text-slate-900">
              {formatHourly(data.summary.overallHourlyAmountYuan)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500">关闭/退货单</p>
            <p
              className={`text-[15px] font-semibold ${
                data.summary.totalInvalidOrderCount > 0 ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {formatOrderCount(data.summary.totalInvalidOrderCount)}
            </p>
          </div>
          {(data.summary.liveRoomNewFollowers?.length ?? 0) > 0 ? (
            <div>
              <p className="text-[11px] text-slate-500">新增粉丝合计</p>
              <p className="text-[15px] font-semibold text-slate-900">
                {formatPeopleCount(data.summary.totalNewFollowerCount)}
              </p>
            </div>
          ) : (
            <div />
          )}
        </div>

        <div className="daily-report-export-body">
          <div className="daily-report-export-anchors">
            <div className={`daily-report-export-grid ${anchorCols}`}>
              {data.anchors.map((row) => (
                <ExportAnchorCard
                  key={`${row.anchorName}-${row.sessionLabel}`}
                  row={row}
                  showAttendanceStatus={showAttendanceStatus}
                />
              ))}
            </div>
          </div>
        </div>

        {displayedCount > 0 ? (
          <div className="daily-report-export-photos">
            <p className="text-[13px] font-semibold text-slate-900">发货前照片</p>
            {photoCaption ? (
              <p className="mt-1 text-[11px] leading-snug text-slate-500">{photoCaption}</p>
            ) : null}
            <div
              className={`daily-report-export-photo-wall ${photoWall.colsClass} ${photoWallSizeClass}`}
            >
              {displayedPhotos.map((photo) => (
                <div key={photo.id} className="daily-report-export-photo-item" data-shipment-photo-cell>
                  <img
                    data-shipment-photo-img
                    src={photo.dataUrl!}
                    alt={photo.caption ?? '发货前照片'}
                    decoding="sync"
                  />
                </div>
              ))}
              {remainingCount > 0 ? (
                <div className="daily-report-export-photo-more">
                  还有 {remainingCount} 张
                  <br />
                  系统内查看
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    )
  },
)
