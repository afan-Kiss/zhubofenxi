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
import { LeaveWatermark } from './LeaveWatermark'

const STATUS_TEXT_CLASS: Record<DailyReportImageSessionStatus, string> = {
  qualified: 'text-emerald-700',
  warning: 'text-amber-700',
  unqualified: 'text-rose-700',
  missing: 'text-slate-500',
}

function MetricCell({
  label,
  value,
  emphasize,
}: {
  label: string
  value: React.ReactNode
  emphasize?: boolean
}) {
  if (emphasize) {
    return (
      <div className="min-w-0 rounded-lg border border-sky-100 bg-sky-50/80 px-1.5 py-1">
        <div className="text-[10px] font-medium leading-4 text-sky-700/80">{label}</div>
        <div className="mt-0.5 truncate text-[15px] font-bold tabular-nums leading-5 text-slate-900">
          {value}
        </div>
      </div>
    )
  }
  return (
    <div className="min-w-0">
      <div className="text-[10px] leading-4 text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-semibold tabular-nums leading-5 text-slate-900">
        {value}
      </div>
    </div>
  )
}

function CoverClickRateValue({
  session,
  onLeave,
}: {
  session: DailyReportImageSession
  onLeave?: boolean
}) {
  if (session.coverClickRate == null) {
    // 请假卡：不展示「数据缺失」，避免与休假水印抢语义
    return <span className={STATUS_TEXT_CLASS.missing}>{onLeave ? '—' : '数据缺失'}</span>
  }
  const statusLabel = dailyReportImageStatusLabel(session.status)
  const statusClass = STATUS_TEXT_CLASS[session.status]
  return (
    <span>
      <span className="text-slate-900">{formatRatePercent(session.coverClickRate)}</span>
      {onLeave ? null : (
        <span className={`ml-1 text-[11px] font-semibold ${statusClass}`}>{statusLabel}</span>
      )}
    </span>
  )
}

function SessionCard({ session }: { session: DailyReportImageSession }) {
  const onLeave = Boolean(session.isOnLeave)
  const missingOrDash = (value: string) =>
    onLeave && value === '数据缺失' ? '—' : value
  return (
    <div className="relative flex min-h-[168px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {onLeave ? <LeaveWatermark offsetY="22%" /> : null}
      <div className="relative z-10 border-b border-slate-100 bg-slate-50/90 px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-slate-900">{session.shopName}</div>
          <div className="mt-0.5 truncate text-[12px] font-medium text-slate-800">
            主播：{formatAnchorDisplayName(session.anchorName)}
          </div>
          <div className="mt-0.5 text-[11px] tabular-nums text-slate-600">
            直播时段：{session.liveTimeRange}
          </div>
          {!onLeave && session.liveDurationText && session.liveDurationText !== '—' ? (
            <div className="mt-0.5 text-[11px] tabular-nums text-slate-600">
              直播时长：{session.liveDurationText}
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative z-[1] flex flex-1 flex-col gap-3 px-3 py-3">
        <div className="grid grid-cols-4 gap-2">
          <MetricCell label="GMV" value={formatMoney(session.gmvYuan)} />
          <MetricCell
            label="发货金额"
            emphasize
            value={formatMoney(session.shipmentAmountYuan)}
          />
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
            emphasize
            value={<CoverClickRateValue session={session} onLeave={onLeave} />}
          />
          <MetricCell
            label="60s停留人数"
            value={missingOrDash(formatPeopleCountOrMissing(session.stay60sUserCount))}
          />
          <MetricCell
            label="人均停留"
            value={
              session.avgStayDurationSeconds != null &&
              Number.isFinite(session.avgStayDurationSeconds) &&
              session.avgStayDurationSeconds > 0
                ? formatStayDurationSeconds(session.avgStayDurationSeconds)
                : onLeave
                  ? '—'
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
