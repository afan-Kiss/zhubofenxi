import React from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import {
  anchorRowGmv,
  anchorRowNum,
  anchorRowPaidCount,
  anchorRowRate,
  anchorRowRefundAmount,
  anchorRowReturnRefundCount,
  anchorRowReturnRefundRate,
  anchorRowLivePeriodText,
  anchorRowSignedCount,
  anchorRowValidSales,
  isHighRefundRate,
  type AnchorLeaderboardRow,
} from '../../lib/anchor-leaderboard-row'
import { anchorCardTestId } from '../../lib/anchor-test-id'
import { AnchorLateStatusBadge } from './AnchorLateStatusBadge'
import {
  formatLateTimingLine,
  lateCardBorderClass,
  readLateStatus,
} from '../../lib/anchor-late-status'

interface Props {
  rows: AnchorLeaderboardRow[]
  emptyText?: string
  onSelect?: (row: AnchorLeaderboardRow) => void
  showLongPeriodRates?: boolean
  /** 覆盖外层容器 className；默认手机端显示 */
  className?: string
}

function MetricCell({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl bg-rose-50/40 px-2.5 py-2">
      <p className="text-[12px] leading-snug text-slate-500">{label}</p>
      <p
        className={`mt-0.5 text-base font-semibold tabular-nums ${
          danger ? 'text-rose-600' : 'text-slate-900'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

export const MobileAnchorLeaderboardCards: React.FC<Props> = ({
  rows,
  emptyText = '暂无数据',
  onSelect,
  showLongPeriodRates: showRates = true,
  className = 'block md:hidden',
}) => {
  const { formatMoney, formatCount, formatRate } = useAmountDisplay()

  if (rows.length === 0) {
    return (
      <div
        className={`rounded-2xl border border-dashed border-rose-100 bg-rose-50/30 py-10 text-center text-sm text-slate-400 ${className}`}
      >
        {emptyText}
      </div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {rows.map((a, idx) => {
        const name = String(a.anchorName ?? '—')
        const refundRate = anchorRowRate(a, 'returnRate')
        const returnRate = anchorRowReturnRefundRate(a)
        const qualityRate = anchorRowRate(a, 'qualityReturnRate')
        const signRate = anchorRowRate(a, 'signRate')
        const late = readLateStatus(a)
        const timingLine = formatLateTimingLine(late)
        const livePeriod = anchorRowLivePeriodText(a)
        const livePeriodMultiline = livePeriod?.includes('\n') ?? false

        return (
          <article
            key={String(a.anchorId ?? name ?? idx)}
            data-testid={anchorCardTestId(name)}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onClick={onSelect ? () => onSelect(a) : undefined}
            onKeyDown={
              onSelect
                ? (e) => {
                    if (e.key === 'Enter') onSelect(a)
                  }
                : undefined
            }
            className={`board-list-row-enter rounded-2xl border p-4 shadow-sm ${
              lateCardBorderClass(late.isLate, late.isEarlyLeave)
            } shadow-rose-100/40 ${
              onSelect ? 'cursor-pointer transition active:scale-[0.99] hover:shadow-md' : ''
            }`}
            style={{ ['--i' as string]: String(Math.min(idx, 12)) }}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[12px] text-slate-500">主播</p>
                <p className="text-lg font-semibold text-rose-800">{name}</p>
                {livePeriod ? (
                  <p className={`mt-1 text-[12px] text-slate-600${livePeriodMultiline ? ' whitespace-pre-line' : ''}`}>
                    直播 {livePeriod}
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] text-slate-500">未读取到直播场次</p>
                )}
                {timingLine ? (
                  <p className={`mt-1 text-[12px] ${late.isLate || late.isEarlyLeave ? 'font-medium text-red-600' : 'text-slate-500'}`}>
                    {timingLine}
                  </p>
                ) : null}
              </div>
              <AnchorLateStatusBadge row={late} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <MetricCell label="本期销售额" value={formatMoney(anchorRowGmv(a))} />
              <MetricCell label="有效成交额" value={formatMoney(anchorRowValidSales(a))} />
              {showRates ? (
                <MetricCell
                  label="签收金额"
                  value={formatMoney(anchorRowNum(a, 'actualSignedAmount'))}
                />
              ) : null}
              <MetricCell label="退款金额" value={formatMoney(anchorRowRefundAmount(a))} danger />
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <MetricCell label="订单数" value={formatCount(anchorRowNum(a, 'periodOrderCount'))} />
              <MetricCell label="支付订单数" value={formatCount(anchorRowPaidCount(a))} />
              {showRates ? (
                <MetricCell label="签收单数" value={formatCount(anchorRowSignedCount(a))} />
              ) : null}
              <MetricCell label="退款单数" value={formatCount(anchorRowNum(a, 'returnCount'))} />
              <MetricCell
                label="退货退款单数"
                value={formatCount(anchorRowReturnRefundCount(a))}
              />
              <MetricCell
                label="商品问题单数"
                value={formatCount(anchorRowNum(a, 'qualityReturnCount'))}
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-2 border-t border-rose-50 pt-2.5">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  isHighRefundRate(refundRate)
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                退款率 {formatRate(refundRate)}
              </span>
              {showRates && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-medium text-slate-600">
                  退货率 {formatRate(returnRate)}
                </span>
              )}
              {showRates && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-medium text-slate-600">
                  品退率 {formatRate(qualityRate)}
                </span>
              )}
              {showRates && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-medium text-slate-600">
                  签收率 {formatRate(signRate)}
                </span>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
