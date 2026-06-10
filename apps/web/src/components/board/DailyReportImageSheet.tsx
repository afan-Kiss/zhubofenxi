import React from 'react'
import {
  formatDensity,
  formatDuration,
  formatHourly,
  formatIntegerMoney,
  formatMoney,
  formatOrderCount,
  formatPercent,
} from './dailyReportFormatters'

export interface DailyReportAnchorRow {
  anchorName: string
  sessionLabel: string
  livePeriodText: string
  liveDurationText: string
  liveDurationMinutes: number
  shippedAmountYuan: number
  soldOrderCount: number
  invalidOrderCount: number
  avgOrderAmountYuan: number | null
  hourlyAmountYuan: number | null
  dealDensityMinutes: number | null
  amountRatio: number | null
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
    totalLiveDurationMinutes: number
    overallHourlyAmountYuan: number | null
  }
  anchors: DailyReportAnchorRow[]
}

interface Props {
  data: DailyReportPayload
  aiSuggestionLines: string[]
}

function MetricLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] leading-6">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? 'text-[15px] font-semibold text-slate-900' : 'text-slate-800'}>
        {value}
      </span>
    </div>
  )
}

function AnchorCard({ row }: { row: DailyReportAnchorRow }) {
  return (
    <div className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold text-slate-900">
            {row.anchorName}｜{row.sessionLabel}
          </p>
          <p className="mt-1 text-[12px] text-slate-500">
            {row.livePeriodText}｜{row.liveDurationText}
          </p>
        </div>
        <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700">
          占比 {formatPercent(row.amountRatio)}
        </span>
      </div>
      <div className="mt-3 space-y-1">
        <MetricLine label="真实发货" value={formatMoney(row.shippedAmountYuan)} strong />
        <MetricLine label="真实卖出" value={formatOrderCount(row.soldOrderCount)} />
        <MetricLine label="客单价" value={formatIntegerMoney(row.avgOrderAmountYuan)} />
        <MetricLine label="时均产出" value={formatHourly(row.hourlyAmountYuan)} />
        <MetricLine label="成交密度" value={formatDensity(row.dealDensityMinutes)} />
        <MetricLine
          label="关闭/退货单"
          value={formatOrderCount(row.invalidOrderCount)}
          strong={row.invalidOrderCount > 0}
        />
      </div>
    </div>
  )
}

export const DailyReportImageSheet = React.forwardRef<HTMLDivElement, Props>(function DailyReportImageSheet(
  { data, aiSuggestionLines },
  ref,
) {
  const hasAiSuggestions = aiSuggestionLines.length > 0

  return (
    <div
      ref={ref}
      className="w-[700px] bg-white p-6 text-slate-900"
      style={{ fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif' }}
    >
      <div className="text-center">
        <h1 className="text-[22px] font-bold tracking-wide text-slate-900">{data.title}</h1>
      </div>

      <div className="mt-5 rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50/80 to-white p-5">
        <p className="text-[13px] text-slate-500">昨日总览</p>
        <p className="mt-2 text-[28px] font-bold leading-none text-slate-900">
          真实发货 {formatMoney(data.summary.totalShippedAmountYuan)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
          <MetricLine label="真实卖出" value={formatOrderCount(data.summary.totalSoldOrderCount)} />
          <MetricLine
            label="直播总时长"
            value={formatDuration(data.summary.totalLiveDurationMinutes)}
          />
          <MetricLine
            label="整体时均产出"
            value={formatHourly(data.summary.overallHourlyAmountYuan)}
          />
          <MetricLine
            label="关闭/退货单"
            value={formatOrderCount(data.summary.totalInvalidOrderCount)}
            strong={data.summary.totalInvalidOrderCount > 0}
          />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {data.anchors.map((row) => (
          <AnchorCard key={`${row.anchorName}-${row.sessionLabel}`} row={row} />
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <p className="text-[14px] font-semibold text-slate-900">AI建议</p>
        {hasAiSuggestions ? (
          <ol className="mt-3 space-y-2 text-[13px] leading-6 text-slate-700">
            {aiSuggestionLines.map((item, idx) => (
              <li key={`${idx}-${item.slice(0, 24)}`} className="break-words">
                {idx + 1}. {item}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-[13px] leading-6 text-slate-500">
            AI建议待填写，点击「复制原始数据给 ChatGPT」生成建议后填入。
          </p>
        )}
      </div>
    </div>
  )
})
