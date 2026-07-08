import React from 'react'
import {
  formatDensity,
  formatDuration,
  formatHourly,
  formatIntegerMoney,
  formatMoney,
  formatOrderCount,
  formatPeopleCount,
  formatRatePercent,
  formatShippedSharePercent,
  formatStayDurationSeconds,
} from './dailyReportFormatters'
import type { AnchorLivePeriodView } from '../../lib/anchor-live-period'
import { AnchorTrendChart } from './AnchorTrendChart'
import { AnchorTrendCompareChart } from './AnchorTrendCompareChart'
import type { AnchorLeaderboardRow, AnchorTrend } from '../../lib/anchor-leaderboard-row'

export interface DailyReportShippedOrderLine {
  orderNo: string
  productTitle: string
  amountYuan: number
  anchorName?: string
}

export interface DailyReportAnchorRow extends AnchorLivePeriodView {
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
  gmvYuan?: number
  trend?: AnchorTrend
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
  }
  anchors: DailyReportAnchorRow[]
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

function toCompareLeaderboardRows(anchors: DailyReportAnchorRow[]): AnchorLeaderboardRow[] {
  return anchors.map((row) => ({
    anchorName: row.anchorName,
    trend: row.trend,
    gmv: row.gmvYuan ?? 0,
    totalGmv: row.gmvYuan ?? 0,
    orderCount: row.soldOrderCount,
    paidOrderCount: row.soldOrderCount,
  }))
}

/** 日报截图用淡金色表格线，便于多卡片字段对齐阅读 */
const GOLDEN_TABLE_BORDER = 'border-[#E5D9BC]'
const GOLDEN_TABLE_LINE = 'border-[#F0E8D6]'

function MetricTable({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-lg border bg-white/60 ${GOLDEN_TABLE_BORDER} ${className}`}
    >
      {children}
    </div>
  )
}

function MetricLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] border-b ${GOLDEN_TABLE_LINE} last:border-b-0`}>
      <div
        className={`border-r px-3 py-1.5 text-[13px] leading-6 text-slate-500 ${GOLDEN_TABLE_LINE}`}
      >
        {label}
      </div>
      <div
        className={`px-3 py-1.5 text-right text-[13px] leading-6 tabular-nums ${
          strong ? 'text-[15px] font-semibold text-slate-900' : 'text-slate-800'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function MetricTableNote({ children }: { children: React.ReactNode }) {
  return (
    <div className={`border-b px-3 py-1.5 text-[10px] leading-snug text-slate-400 ${GOLDEN_TABLE_LINE}`}>
      {children}
    </div>
  )
}

function AnchorNameBadge({
  name,
  compact = false,
}: {
  name: string
  compact?: boolean
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md border border-rose-200/90 bg-gradient-to-b from-rose-50 to-white px-1.5 font-sans font-medium leading-none text-rose-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] ${
        compact ? 'py-0.5 text-[9px]' : 'py-[3px] text-[10px]'
      }`}
    >
      {name}
    </span>
  )
}

function LiveRoomFollowerLine({
  liveAccountName,
  anchorNames,
  newFollowerCount,
}: {
  liveAccountName: string
  anchorNames?: string[]
  newFollowerCount: number
}) {
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] border-b ${GOLDEN_TABLE_LINE} last:border-b-0`}>
      <div
        className={`flex min-w-0 flex-wrap items-center gap-1.5 border-r px-3 py-1.5 text-[13px] leading-6 ${GOLDEN_TABLE_LINE}`}
      >
        <span className="text-slate-600">{liveAccountName}</span>
        {(anchorNames ?? []).map((name) => (
          <AnchorNameBadge key={`${liveAccountName}-${name}`} name={name} />
        ))}
      </div>
      <span className="shrink-0 px-3 py-1.5 text-right text-[13px] leading-6 tabular-nums text-slate-800">
        {formatPeopleCount(newFollowerCount)}
      </span>
    </div>
  )
}

function compareShippedOrderLines(
  a: DailyReportShippedOrderLine,
  b: DailyReportShippedOrderLine,
): number {
  const anchorCmp = (a.anchorName ?? '').localeCompare(b.anchorName ?? '', 'zh-CN')
  if (anchorCmp !== 0) return anchorCmp
  return (a.productTitle ?? '').localeCompare(b.productTitle ?? '', 'zh-CN')
}

function ShippedOrdersBlock({
  orders,
  compact = false,
  showAnchorName = true,
}: {
  orders: DailyReportShippedOrderLine[] | undefined
  compact?: boolean
  showAnchorName?: boolean
}) {
  const list = [...(orders ?? [])].sort(compareShippedOrderLines)
  if (list.length === 0) {
    return (
      <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-400`}>
        真实发货订单：暂无（已剔除售后、关闭与取消单）
      </p>
    )
  }
  return (
    <div>
      <div
        className={`border-b px-3 py-1.5 ${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-500 ${GOLDEN_TABLE_LINE}`}
      >
        真实发货订单（{list.length} 单，已剔除售后/关闭/取消）
      </div>
      {list.map((order) => (
        <div
          key={order.orderNo}
          className={`grid grid-cols-[minmax(0,1fr)_auto] border-b ${GOLDEN_TABLE_LINE} last:border-b-0`}
        >
          <div
            className={`flex min-w-0 flex-wrap items-center gap-1.5 border-r px-3 py-1 ${compact ? 'text-[10px]' : 'text-[11px]'} leading-5 ${GOLDEN_TABLE_LINE}`}
          >
            {showAnchorName && order.anchorName ? (
              <AnchorNameBadge name={order.anchorName} compact={compact} />
            ) : null}
            <span className="min-w-0 text-slate-700">{order.productTitle || '商品名称未同步'}</span>
          </div>
          <span
            className={`shrink-0 px-3 py-1 text-right tabular-nums text-slate-700 ${compact ? 'text-[10px]' : 'text-[11px]'} leading-5`}
          >
            {formatMoney(order.amountYuan)}
          </span>
        </div>
      ))}
    </div>
  )
}

function AnchorCard({ row }: { row: DailyReportAnchorRow }) {
  const liveTime =
    row.liveTimeRange && row.liveTimeRange !== '—' && row.liveTimeRange !== '未读取到直播场次'
      ? row.liveTimeRange
      : row.livePeriodText && row.livePeriodText !== '—'
        ? row.livePeriodText.replace(/~/g, '–')
        : '未读取到直播场次'
  const scheduleLine = row.scheduleTimeRange ? `排班 ${row.scheduleTimeRange}` : null
  const liveTimeMultiline = liveTime.includes('\n')

  return (
    <div className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-slate-900">
            {row.anchorName}
            {row.shopName ? ` · ${row.shopName}` : ''}
          </p>
          {row.sessionLabel ? (
            <p className="mt-0.5 text-[12px] text-slate-500">{row.sessionLabel}</p>
          ) : null}
          {scheduleLine ? (
            <p className="mt-1 text-[13px] text-slate-600">{scheduleLine}</p>
          ) : null}
          <p className={`mt-1 text-[13px] text-slate-600${liveTimeMultiline ? ' whitespace-pre-line' : ''}`}>
            直播 {liveTime}
          </p>
          <p className="mt-1 text-[12px] text-slate-500">{row.liveDurationText}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
            发货占比 {formatShippedSharePercent(row.amountRatio, row.shippedAmountYuan)}
          </span>
        </div>
      </div>
      <div className="mt-3">
        <AnchorTrendChart
          variant="report"
          trend={row.trend}
          formatMoney={(v) => formatMoney(v)}
          formatCount={(n) => formatOrderCount(n)}
        />
      </div>
      <MetricTable className="mt-3">
        <MetricLine label="真实发货" value={formatMoney(row.shippedAmountYuan)} strong />
        {(row.shippedOrders?.length ?? 0) > 0 ? (
          <ShippedOrdersBlock orders={row.shippedOrders} showAnchorName={false} />
        ) : null}
        <MetricLine label="归属支付金额" value={formatMoney(row.gmvYuan)} />
        <MetricTableNote>归属支付按主播时段统计；真实发货已剔除售后、关闭与取消单</MetricTableNote>
        <MetricLine label="真实卖出" value={formatOrderCount(row.soldOrderCount)} />
        <MetricLine label="客单价" value={formatIntegerMoney(row.avgOrderAmountYuan)} />
        <MetricLine label="场观人数" value={formatPeopleCount(row.viewSessionCount)} />
        <MetricLine label="进房人数" value={formatPeopleCount(row.joinUserCount)} />
        <MetricLine
          label="平均在线"
          value={
            row.avgOnlineUserCount != null ? formatPeopleCount(row.avgOnlineUserCount) : '--'
          }
        />
        <MetricLine label="停留时长" value={formatStayDurationSeconds(row.avgViewDurationSeconds)} />
        <MetricLine label="新增粉丝" value={formatPeopleCount(row.newFollowerCount)} />
        <MetricLine label="成交率" value={formatRatePercent(row.dealConversionRate)} />
        <MetricLine label="新增粉丝率" value={formatRatePercent(row.newFollowerRate)} />
        <MetricLine label="时均产出" value={formatHourly(row.hourlyAmountYuan)} />
        <MetricLine label="成交密度" value={formatDensity(row.dealDensityMinutes)} />
        <MetricLine
          label="本场关闭/退货单"
          value={formatOrderCount(row.invalidOrderCount)}
          strong={row.invalidOrderCount > 0}
        />
        <MetricTableNote>含本场关闭、取消、售后订单，不计入真实发货</MetricTableNote>
      </MetricTable>
    </div>
  )
}

export const DailyReportImageSheet = React.forwardRef<HTMLDivElement, Props>(function DailyReportImageSheet(
  { data, shipmentPhotos = [] },
  ref,
) {
  const readyPhotos = shipmentPhotos.filter((photo) => photo.dataUrl).slice(0, 12)
  const extraPhotoCount = Math.max(0, shipmentPhotos.filter((photo) => photo.dataUrl).length - readyPhotos.length)
  const photoGridCols = readyPhotos.length <= 2 ? 'grid-cols-1' : 'grid-cols-2'
  const photoCellHeight = readyPhotos.length <= 2 ? 'min-h-[480px]' : 'min-h-[360px]'
  const sheetWidthClass = readyPhotos.length > 0 ? 'w-[960px]' : 'w-[700px]'

  return (
    <div
      ref={ref}
      data-daily-report-sheet
      className={`${sheetWidthClass} bg-white p-6 text-slate-900`}
      style={{ fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif' }}
    >
      <div className="text-center">
        <h1 className="text-[22px] font-bold tracking-wide text-slate-900">{data.title}</h1>
      </div>

      <div className="mt-5 rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50/80 to-white p-5">
        <p className="text-[13px] text-slate-500">{data.dateLabel} 总览</p>
        <p className="mt-2 text-[28px] font-bold leading-none text-slate-900">
          真实发货 {formatMoney(data.summary.totalShippedAmountYuan)}
        </p>
        <MetricTable className="mt-4">
          <div className="grid grid-cols-2">
            <div className={`border-r ${GOLDEN_TABLE_LINE}`}>
              <MetricLine label="真实卖出" value={formatOrderCount(data.summary.totalSoldOrderCount)} />
              <MetricLine
                label="整体时均产出"
                value={formatHourly(data.summary.overallHourlyAmountYuan)}
              />
            </div>
            <div>
              <MetricLine
                label="直播总时长"
                value={formatDuration(data.summary.totalLiveDurationMinutes)}
              />
              <MetricLine
                label="本场关闭/退货单"
                value={formatOrderCount(data.summary.totalInvalidOrderCount)}
                strong={data.summary.totalInvalidOrderCount > 0}
              />
            </div>
          </div>
          <MetricTableNote>
            关闭/退货单与真实发货同基础池，已剔除低价刷单；含关闭、取消、售后，不计入真实发货
          </MetricTableNote>
          {(data.summary.shippedOrders?.length ?? 0) > 0 ? (
            <ShippedOrdersBlock orders={data.summary.shippedOrders} compact />
          ) : null}
        </MetricTable>
        {data.summary.liveSessionAttributionNote ? (
          <p className="mt-3 border-t border-rose-100 pt-3 text-[12px] leading-relaxed text-amber-800">
            {data.summary.liveSessionAttributionNote}
          </p>
        ) : null}
        {data.summary.unassignedShippedNote ? (
          <p className="mt-3 border-t border-rose-100 pt-3 text-[12px] leading-relaxed text-amber-800">
            {data.summary.unassignedShippedNote}
          </p>
        ) : null}
        {(data.summary.liveRoomNewFollowers?.length ?? 0) > 0 && (
          <div className="mt-4 border-t border-rose-100 pt-3">
            <p className="mb-2 text-[12px] text-slate-500">各直播号新增粉丝</p>
            <MetricTable>
              {data.summary.liveRoomNewFollowers.map((row) => (
                <LiveRoomFollowerLine
                  key={row.liveAccountName}
                  liveAccountName={row.liveAccountName}
                  anchorNames={row.anchorNames}
                  newFollowerCount={row.newFollowerCount}
                />
              ))}
              {data.summary.liveRoomNewFollowers.length > 1 && (
                <MetricLine
                  label="合计"
                  value={formatPeopleCount(data.summary.totalNewFollowerCount)}
                  strong
                />
              )}
            </MetricTable>
          </div>
        )}
      </div>

      <div className="mt-4">
        <AnchorTrendCompareChart
          variant="report"
          rows={toCompareLeaderboardRows(data.anchors)}
          formatMoney={(v) => formatMoney(v)}
          formatCount={(n) => formatOrderCount(n)}
        />
      </div>

      <div className="mt-4 space-y-3">
        {data.anchors.map((row) => (
            <AnchorCard key={`${row.anchorName}-${row.sessionLabel}`} row={row} />
        ))}
      </div>

      {readyPhotos.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-4">
          <p className="text-[14px] font-semibold text-slate-900">发货前照片</p>
          <div className={`mt-3 grid ${photoGridCols} gap-3`}>
            {readyPhotos.map((photo) => (
                <div
                  key={photo.id}
                  data-shipment-photo-cell
                  className={`flex flex-col overflow-hidden rounded-lg border border-slate-100 bg-slate-50 ${photoCellHeight}`}
                >
                  <div className="flex min-h-0 flex-1 items-center justify-center p-1">
                    <img
                      data-shipment-photo-img
                      src={photo.dataUrl!}
                      alt={photo.caption ?? '发货前照片'}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  {photo.caption ? (
                    <p className="truncate px-2 py-1 text-[11px] text-slate-600">{photo.caption}</p>
                  ) : null}
                </div>
              ))}
          </div>
          {extraPhotoCount > 0 ? (
            <p className="mt-2 text-[12px] text-slate-500">另有 {extraPhotoCount} 张发货前照片</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
