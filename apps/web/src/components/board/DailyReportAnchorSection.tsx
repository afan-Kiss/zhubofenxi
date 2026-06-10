import React from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import {
  buildAnchorDrawerSummaryText,
  formatShippedOrderCountLabel,
} from '../../lib/anchor-drawer-summary'
import { DailyReportOrderCards } from './DailyReportOrderCards'

const STAT_FONT =
  "font-['Microsoft_YaHei','微软雅黑',sans-serif] text-sm leading-relaxed text-slate-700"

function statNum(stats: Record<string, unknown> | null | undefined, key: string): number {
  return Number(stats?.[key] ?? 0)
}

export interface DailyReportSectionData {
  anchorId: string
  anchorName: string
  stats: Record<string, unknown> | null
  liveSessions: Array<{
    liveId: string
    liveName: string
    startTime: string
    endTime: string
    durationMinutes: number
    durationText: string
  }>
  liveSummaryText: string
  blacklistedBuyerIds: string[]
  rows: Array<Record<string, unknown>>
  orderTotal: number
}

interface Props {
  startDate: string
  endDate: string
  section: DailyReportSectionData
}

export const DailyReportAnchorSection: React.FC<Props> = ({ startDate, endDate, section }) => {
  const { formatMoney, formatCount, formatRate } = useAmountDisplay()
  const stats = section.stats
  const shippedOrderAmount =
    statNum(stats, 'validSalesAmount') || statNum(stats, 'effectiveGmv')
  const shippedOrderCount = statNum(stats, 'shippedOrderCount')

  const summaryText = stats
    ? buildAnchorDrawerSummaryText({
        startDate,
        endDate,
        anchorName: section.anchorName,
        orderCount: statNum(stats, 'orderCount'),
        refundOrderCount: statNum(stats, 'returnCount') || statNum(stats, 'refundOrderCount'),
        shippedOrderAmountYuan: shippedOrderAmount,
        formatMoney,
      })
    : ''

  const statItems = [
    `支付金额 ${formatMoney(statNum(stats, 'gmv') || statNum(stats, 'totalGmv'))}`,
    `发货单金额 ${formatMoney(shippedOrderAmount)}`,
    `发出单数 ${formatShippedOrderCountLabel(shippedOrderCount)}`,
    `订单 ${formatCount(statNum(stats, 'orderCount'))}`,
    `退款金额 ${formatMoney(statNum(stats, 'returnAmount') || statNum(stats, 'refundAmount'))}`,
    `退款订单 ${formatCount(statNum(stats, 'returnCount'))}`,
    `退款率 ${formatRate(stats?.returnRate == null ? null : statNum(stats, 'returnRate'))}`,
  ]

  return (
    <section className="overflow-hidden rounded-3xl border border-rose-100 bg-white shadow-sm">
      <div className="border-b border-rose-50 bg-gradient-to-r from-rose-50/80 to-white px-4 py-4">
        <h3 className="text-lg font-semibold text-slate-900">{section.anchorName}</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          {startDate} ~ {endDate} · 主播订单明细
        </p>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {statItems.map((text) => (
            <span key={text} className={STAT_FONT}>
              {text}
            </span>
          ))}
        </div>
        {section.liveSummaryText ? (
          <div className="mt-3 rounded-xl border border-rose-100/80 bg-white/80 px-3 py-2">
            <p className={STAT_FONT}>{section.liveSummaryText}</p>
            {section.liveSessions.length > 1 ? (
              <ul className="mt-2 space-y-1 border-t border-rose-50 pt-2 text-xs text-slate-600">
                {section.liveSessions.map((session) => {
                  const start = session.startTime.slice(11, 16)
                  const end = session.endTime.slice(11, 16)
                  return (
                    <li key={`${session.liveId}-${session.startTime}`}>
                      {start}~{end}（{session.durationText}）
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-3 bg-slate-50/40 p-4">
        <DailyReportOrderCards
          rows={section.rows}
          blacklistedBuyerIds={section.blacklistedBuyerIds}
        />
        {summaryText ? (
          <div className={`rounded-2xl border border-rose-100/80 bg-rose-50/40 px-4 py-3 ${STAT_FONT}`}>
            <p className="leading-relaxed text-slate-800">{summaryText}</p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
