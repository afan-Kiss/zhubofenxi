import React, { forwardRef } from 'react'
import type { DailyOperationsReportPayload } from '../../pages/operations/operationsReportTypes'
import {
  formatDuration,
  formatHourly,
  formatIntegerMoney,
  formatOrderCount,
  formatPeopleCount,
  formatRatePercent,
} from './operationsReportFormatters'

interface Props {
  data: DailyOperationsReportPayload
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}

export const OperationsReportImageSheet = forwardRef<HTMLDivElement, Props>(({ data }, ref) => {
  return (
    <div ref={ref} className="w-[720px] bg-white p-6 text-slate-900">
      <h1 className="text-xl font-bold">{data.title}</h1>
      <p className="mt-1 text-sm text-slate-500">全店有效成交与直播经营数据</p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MetricCard label="全店有效成交" value={formatIntegerMoney(data.summary.validAmountYuan)} />
        <MetricCard label="有效成交订单" value={formatOrderCount(data.summary.soldOrderCount)} />
        <MetricCard label="全店无效/刷单" value={formatOrderCount(data.summary.invalidOrderCount)} />
        <MetricCard label="退货单率" value={formatRatePercent(data.summary.returnOrderRate)} />
        <MetricCard label="成交人数" value={formatPeopleCount(data.summary.dealUserCount)} />
        <MetricCard label="成交率" value={formatRatePercent(data.summary.dealConversionRate)} />
        <MetricCard label="客单价" value={formatIntegerMoney(data.summary.avgOrderAmountYuan)} />
        <MetricCard
          label="直播时长"
          value={formatDuration(data.summary.totalLiveDurationMinutes)}
        />
        <MetricCard label="每小时成交" value={formatHourly(data.summary.hourlyAmountYuan)} />
        <MetricCard
          label="新增粉丝"
          value={formatPeopleCount(data.summary.totalNewFollowerCount)}
        />
      </div>

      {data.summary.liveRoomNewFollowers.length > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-semibold text-slate-700">各直播号新增粉丝</p>
          <div className="mt-2 space-y-1 text-xs text-slate-600">
            {data.summary.liveRoomNewFollowers.map((row) => (
              <p key={row.liveAccountName}>
                {row.liveAccountName}：{formatPeopleCount(row.newFollowerCount)}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <p className="mb-2 text-sm font-semibold">主播表现</p>
        {data.anchors.map((row) => {
          const liveTime =
            row.liveTimeRange && row.liveTimeRange !== '—'
              ? row.liveTimeRange
              : row.livePeriodText?.replace(/~/g, '–') ?? '—'
          const scheduleHint =
            row.scheduleTimeRange && row.scheduleMatched
              ? ` · 排班 ${row.scheduleTimeRange}`
              : ''
          return (
            <div key={row.anchorName} className="mb-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
              <p className="text-sm font-semibold">
                {row.anchorName} · {row.sessionLabel}
              </p>
              <p className="mt-1 text-slate-600">
                直播 {liveTime}
                {scheduleHint}
                {' · '}
                归属有效成交 {formatIntegerMoney(row.validAmountYuan)} · 订单{' '}
                {formatOrderCount(row.soldOrderCount)} · 直播 {row.liveDurationText}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
})

OperationsReportImageSheet.displayName = 'OperationsReportImageSheet'
