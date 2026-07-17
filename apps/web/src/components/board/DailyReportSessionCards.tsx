import React from 'react'
import { formatAnchorDisplayName } from '../../lib/anchor-display-name'
import {
  formatMoney,
  formatOrderCount,
  formatPeopleCountOrMissing,
  formatRatePercent,
  formatStayDurationSeconds,
} from './dailyReportFormatters'
import {
  dailyReportImageStatusLabel,
  type DailyReportImageSession,
  type DailyReportImageSessionStatus,
} from './dailyReportImageModel'

const STATUS_CLASS: Record<DailyReportImageSessionStatus, string> = {
  qualified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  unqualified: 'bg-rose-50 text-rose-700 border-rose-200',
  missing: 'bg-slate-100 text-slate-500 border-slate-200',
}

function MetricCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] leading-4 text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-semibold tabular-nums leading-5 text-slate-900">
        {value}
      </div>
    </div>
  )
}

function SessionCard({ session }: { session: DailyReportImageSession }) {
  return (
    <div className="flex min-h-[168px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-slate-800">{session.shopName}</div>
            <div className="mt-0.5 truncate text-[12px] text-slate-600">
              主播：{formatAnchorDisplayName(session.anchorName)}
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">
              直播时段：{session.liveTimeRange}
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[session.status]}`}
          >
            {dailyReportImageStatusLabel(session.status)}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-3 py-3">
        <div className="grid grid-cols-4 gap-2">
          <MetricCell label="GMV" value={formatMoney(session.gmvYuan)} />
          <MetricCell label="发货金额" value={formatMoney(session.shipmentAmountYuan)} />
          <MetricCell label="订单数" value={formatOrderCount(session.orderCount)} />
          <MetricCell
            label="退款金额"
            value={
              session.refundAmountYuan != null ? formatMoney(session.refundAmountYuan) : '—'
            }
          />
        </div>
        <div className="grid grid-cols-4 gap-2 border-t border-slate-100 pt-3">
          <MetricCell
            label="封面点击率"
            value={
              session.coverClickRate != null
                ? formatRatePercent(session.coverClickRate)
                : '数据缺失'
            }
          />
          <MetricCell
            label="60s停留人数"
            value={formatPeopleCountOrMissing(session.stay60sUserCount)}
          />
          <MetricCell
            label="人均停留"
            value={
              session.avgStayDurationSeconds != null &&
              Number.isFinite(session.avgStayDurationSeconds) &&
              session.avgStayDurationSeconds > 0
                ? formatStayDurationSeconds(session.avgStayDurationSeconds)
                : '数据缺失'
            }
          />
          <MetricCell label="直播时长" value={session.liveDurationText || '—'} />
        </div>
      </div>
    </div>
  )
}

/** 两列场次卡片网格：一场直播一张卡 */
export function DailyReportSessionCardGrid({
  sessions,
}: {
  sessions: DailyReportImageSession[]
}) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        当日暂无场次卡片
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">场次数据卡片</h3>
        <span className="text-[11px] text-slate-400">共 {sessions.length} 场 · 两列布局</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {sessions.map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
      </div>
    </div>
  )
}
