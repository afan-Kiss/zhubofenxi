import React, { useMemo } from 'react'
import { formatMoney, formatOrderCount } from './dailyReportFormatters'
import type { AnchorLivePeriodView } from '../../lib/anchor-live-period'
import type { AnchorTrend } from '../../lib/anchor-leaderboard-row'
import { DailyReportImageTimeline } from './DailyReportImageTimeline'
import { DailyReportSessionCardGrid } from './DailyReportSessionCards'
import type { DailyReportImageSession } from './dailyReportImageModel'

export interface DailyReportShippedOrderLine {
  orderNo: string
  productTitle: string
  amountYuan: number
  anchorName?: string
}

export interface DailyReportAnchorRow extends AnchorLivePeriodView {
  anchorId?: string
  systemKey?: string | null
  attributionMode?: string | null
  color?: string | null
  anchorName: string
  sessionLabel: string
  shopName: string
  livePeriodText: string
  liveTimeRange?: string
  liveStartTime?: string | null
  liveEndTime?: string | null
  scheduleTimeRange?: string | null
  scheduleMatched?: boolean
  scheduleMatchReason?: string | null
  liveDurationText: string
  liveSessionPlatformNote?: string | null
  liveDurationMinutes: number
  shippedAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  shippedOrders?: DailyReportShippedOrderLine[]
  avgOrderAmountYuan: number | null
  hourlyAmountYuan: number | null
  dealDensityMinutes: number | null
  amountRatio: number | null
  viewSessionCount: number | null
  joinUserCount: number | null
  avgOnlineUserCount: number | null
  avgViewDurationSeconds: number | null
  newFollowerCount: number | null
  dealUserCount: number | null
  dealConversionRate: number | null
  newFollowerRate: number | null
  coverClickRate?: number | null
  stay60sUserCount?: number | null
  impressionCount?: number | null
  viewPayRate?: number | null
  gmvYuan?: number
  trend?: AnchorTrend
  isTemporaryAnchor?: boolean
}

export interface DailyReportPayload {
  dateLabel: string
  title: string
  startDate: string
  endDate: string
  summary: {
    totalShippedAmountYuan: number
    totalSoldOrderCount: number
    totalInvalidOrderCount: number
    shippedOrders?: DailyReportShippedOrderLine[]
    totalLiveDurationMinutes: number
    assignedLiveDurationMinutes?: number
    unassignedLiveDurationMinutes?: number
    unassignedLiveSessionCount?: number
    liveSessionAttributionNote?: string | null
    unassignedShippedOrderCount?: number
    unassignedShippedNote?: string | null
    overallHourlyAmountYuan: number | null
    liveRoomNewFollowers: Array<{
      liveAccountName: string
      newFollowerCount: number
      anchorNames?: string[]
    }>
    totalNewFollowerCount: number
    onlineGmvYuan?: number
    offlineGmvYuan?: number
    offlineDealCount?: number
    totalGmvYuan?: number
  }
  anchors: DailyReportAnchorRow[]
  /** 长图场次列表；缺省时时间轴/卡片为空（不回退写死四店） */
  imageSessions?: DailyReportImageSession[]
}

interface Props {
  data: DailyReportPayload
  shipmentPhotos?: Array<{
    id: string
    publicUrl: string
    caption: string | null
    dataUrl?: string | null
  }>
}

function weekdayFromDateKey(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim())
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 4, 0, 0))
  const names = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  return names[d.getUTCDay()] ?? ''
}

export const DailyReportImageSheet = React.forwardRef<HTMLDivElement, Props>(
  function DailyReportImageSheet({ data, shipmentPhotos }, ref) {
    const sessions = useMemo(
      () => (Array.isArray(data.imageSessions) ? data.imageSessions : []),
      [data.imageSessions],
    )
    const weekday = weekdayFromDateKey(data.startDate)
    const dateLine = weekday ? `${data.startDate} ${weekday}` : data.startDate || data.dateLabel
    const showOffline =
      (data.summary.offlineGmvYuan ?? 0) > 0 || (data.summary.offlineDealCount ?? 0) > 0
    const liveSessionCount = sessions.filter((s) => !s.isOfflineDeal && !s.isOnLeave).length

    return (
      <div
        ref={ref}
        data-daily-report-image-sheet="1"
        className="box-border w-[980px] bg-[#f8fafc] p-5 text-slate-800"
        style={{ fontFamily: '"PingFang SC","Microsoft YaHei",sans-serif' }}
      >
        <header className="mb-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="text-[11px] font-medium tracking-wide text-slate-400">主播业绩日报</div>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">{dateLine}</h1>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-slate-600">
            <span>
              真实发货{' '}
              <strong className="tabular-nums text-slate-900">
                {formatMoney(data.summary.totalShippedAmountYuan)}
              </strong>
            </span>
            <span>
              真实卖出{' '}
              <strong className="tabular-nums text-slate-900">
                {formatOrderCount(data.summary.totalSoldOrderCount)}
              </strong>
            </span>
            {showOffline ? (
              <span>
                线下 GMV{' '}
                <strong className="tabular-nums text-slate-900">
                  {formatMoney(data.summary.offlineGmvYuan ?? 0)}
                </strong>
              </span>
            ) : null}
            <span>
              直播场次{' '}
              <strong className="tabular-nums text-slate-900">{liveSessionCount}</strong>
            </span>
          </div>
          {data.summary.liveSessionAttributionNote || data.summary.unassignedShippedNote ? (
            <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
              {[data.summary.liveSessionAttributionNote, data.summary.unassignedShippedNote]
                .filter(Boolean)
                .join(' ')}
            </p>
          ) : null}
        </header>

        <section className="mb-4">
          <DailyReportImageTimeline sessions={sessions} />
        </section>

        <section className="mb-4">
          <DailyReportSessionCardGrid sessions={sessions} />
        </section>

        {shipmentPhotos && shipmentPhotos.length > 0 ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">发货前照片</h3>
            <div className="grid grid-cols-4 gap-2">
              {shipmentPhotos.map((photo) => (
                <figure key={photo.id} className="overflow-hidden rounded-lg border border-slate-100">
                  <img
                    src={photo.dataUrl || photo.publicUrl}
                    alt={photo.caption || '发货照片'}
                    className="h-28 w-full object-cover"
                    crossOrigin="anonymous"
                  />
                  {photo.caption ? (
                    <figcaption className="truncate px-1.5 py-1 text-[10px] text-slate-500">
                      {photo.caption}
                    </figcaption>
                  ) : null}
                </figure>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    )
  },
)
