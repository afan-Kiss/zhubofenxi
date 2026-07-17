import React, { useMemo } from 'react'
import { formatAnchorDisplayName } from '../../lib/anchor-display-name'
import { formatMoney } from './dailyReportFormatters'
import {
  buildDailyReportTimelineRows,
  formatMinuteLabel,
  resolveDailyReportTimelineView,
  type DailyReportImageSession,
  type DailyReportTimelineBar,
} from './dailyReportImageModel'

const AXIS_HEIGHT = 28
/** 预留发货气泡高度，避免被父级 overflow 裁切 */
const ROW_HEIGHT = 64
const LABEL_WIDTH = 112

function barLeftPercent(startMin: number, viewStart: number, viewSpan: number): number {
  return ((startMin - viewStart) / viewSpan) * 100
}

function barWidthPercent(startMin: number, endMin: number, viewSpan: number): number {
  return (Math.max(endMin - startMin, 15) / viewSpan) * 100
}

function TimelineBarBlock({
  bar,
  viewStart,
  viewSpan,
}: {
  bar: DailyReportTimelineBar
  viewStart: number
  viewSpan: number
}) {
  const left = barLeftPercent(bar.startMin, viewStart, viewSpan)
  const width = barWidthPercent(bar.startMin, bar.endMin, viewSpan)
  const label = `${formatAnchorDisplayName(bar.session.anchorName)} ${bar.session.liveTimeRange}`

  return (
    <div
      className="absolute top-5 bottom-2 overflow-visible rounded-md border px-1.5 py-0.5 shadow-sm"
      style={{
        left: `${left}%`,
        width: `${Math.max(width, 4)}%`,
        backgroundColor: `${bar.color}22`,
        borderColor: bar.color,
      }}
      title={label}
    >
      {/* 发货金额小标签：放在行高内，避免父级 overflow 裁切 */}
      <div className="pointer-events-none absolute -top-[18px] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap">
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-700 shadow-sm">
          发货 {formatMoney(bar.session.shipmentAmountYuan)}
        </span>
      </div>
      <div className="flex h-full min-w-0 flex-col justify-center overflow-hidden">
        <div
          className="truncate text-[11px] font-semibold leading-tight"
          style={{ color: bar.color }}
        >
          {formatAnchorDisplayName(bar.session.anchorName)}
        </div>
        <div className="truncate text-[10px] tabular-nums text-slate-600">
          {bar.session.liveTimeRange}
        </div>
      </div>
    </div>
  )
}

/** 展示型直播时间轴（非编辑器） */
export function DailyReportImageTimeline({
  sessions,
}: {
  sessions: DailyReportImageSession[]
}) {
  const rows = useMemo(() => buildDailyReportTimelineRows(sessions), [sessions])
  const view = useMemo(() => resolveDailyReportTimelineView(rows), [rows])
  const viewSpan = Math.max(60, view.viewEnd - view.viewStart)

  const ticks = useMemo(() => {
    const out: number[] = []
    for (let m = view.viewStart; m <= view.viewEnd; m += 60) out.push(m)
    return out
  }, [view.viewStart, view.viewEnd])

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
        当日暂无直播场次可展示
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-800">直播时间轴总览</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">按店铺分行，仅展示当日有实际直播场次的店铺</p>
      </div>

      <div className="flex">
        <div
          className="shrink-0 border-r border-slate-100 bg-slate-50/80"
          style={{ width: LABEL_WIDTH }}
        >
          <div
            className="flex items-end px-2 pb-1 text-[10px] font-medium text-slate-500"
            style={{ height: AXIS_HEIGHT }}
          >
            店铺 / 直播间
          </div>
          {rows.map((row) => (
            <div
              key={row.shopName}
              className="flex items-center border-t border-slate-100 px-2 text-[12px] font-medium leading-snug text-slate-700"
              style={{ height: ROW_HEIGHT }}
            >
              <span className="line-clamp-2">{row.shopName}</span>
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="relative border-b border-slate-100" style={{ height: AXIS_HEIGHT }}>
            {ticks.map((m) => {
              const left = ((m - view.viewStart) / viewSpan) * 100
              return (
                <div
                  key={m}
                  className="absolute top-0 bottom-0 border-l border-slate-100"
                  style={{ left: `${left}%` }}
                >
                  <span className="absolute left-0.5 top-1 text-[10px] tabular-nums text-slate-400">
                    {formatMinuteLabel(m)}
                  </span>
                </div>
              )
            })}
          </div>

          {rows.map((row) => (
            <div
              key={row.shopName}
              className="relative border-t border-slate-100 bg-[linear-gradient(to_right,transparent_0,transparent_calc(100%-1px),#f1f5f9_calc(100%-1px))]"
              style={{ height: ROW_HEIGHT }}
            >
              {ticks.map((m) => {
                const left = ((m - view.viewStart) / viewSpan) * 100
                return (
                  <div
                    key={`${row.shopName}-${m}`}
                    className="absolute inset-y-0 border-l border-slate-50"
                    style={{ left: `${left}%` }}
                  />
                )
              })}
              {row.bars.map((bar) => (
                <TimelineBarBlock
                  key={bar.session.id}
                  bar={bar}
                  viewStart={view.viewStart}
                  viewSpan={viewSpan}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
