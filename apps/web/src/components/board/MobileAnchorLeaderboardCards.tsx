import React, { useState } from 'react'
import {
  formatAnchorDisplayName,
  isUnassignedAnchorName,
  UNASSIGNED_ANCHOR_HINT,
} from '../../lib/anchor-display-name'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import {
  anchorRowGmv,
  anchorRowNum,
  anchorRowPaidCount,
  anchorRowRate,
  anchorRowRefundAmount,
  anchorRowReturnCount,
  anchorRowReturnRefundCountDisplay,
  anchorRowLivePeriodLines,
  anchorRowActualSignedAmount,
  anchorRowSignedCount,
  isHighRefundRate,
  anchorRowTrend,
  anchorRowShopName,
  type AnchorLeaderboardRow,
} from '../../lib/anchor-leaderboard-row'
import { anchorCardTestId } from '../../lib/anchor-test-id'
import { resolveAnchorColor, resolveAnchorTheme } from '../../lib/anchor-theme'
import { AnchorTrendChart } from './AnchorTrendChart'
import { LeaveWatermark } from './LeaveWatermark'

interface Props {
  rows: AnchorLeaderboardRow[]
  emptyText?: string
  onSelect?: (row: AnchorLeaderboardRow) => void
  onQualityCountClick?: (row: AnchorLeaderboardRow) => void
  onReturnRefundCountClick?: (row: AnchorLeaderboardRow) => void
  onReturnCountClick?: (row: AnchorLeaderboardRow) => void
  showLongPeriodRates?: boolean
  /** 覆盖外层容器 className；默认手机端显示 */
  className?: string
  /** 是否在卡片内展示单主播走势图；默认展开 */
  showIndividualTrend?: boolean
  showLivePeriod?: boolean
  /** 单日：无成交也展示平线走势 */
  includeZeroPerformance?: boolean
}

function MetricCell({
  label,
  value,
  danger,
  onClick,
}: {
  label: string
  value: string
  danger?: boolean
  onClick?: () => void
}) {
  return (
    <div
      className={`rounded-xl bg-rose-50/40 px-2.5 py-2 ${onClick ? 'cursor-pointer hover:bg-rose-100/60' : ''}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={
        onClick
          ? (e) => {
              e.stopPropagation()
              onClick()
            }
          : undefined
      }
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
                onClick()
              }
            }
          : undefined
      }
    >
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
  onQualityCountClick,
  onReturnRefundCountClick,
  onReturnCountClick,
  showLongPeriodRates: showRates = true,
  className = 'block md:hidden',
  showIndividualTrend = true,
  showLivePeriod = false,
  includeZeroPerformance = false,
}) => {
  const { formatMoney, formatCount, formatRate } = useAmountDisplay()
  const [expandedTrendKeys, setExpandedTrendKeys] = useState<Record<string, boolean>>({})
  const [expandedMetricKeys, setExpandedMetricKeys] = useState<Record<string, boolean>>({})

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
        const name = formatAnchorDisplayName(String(a.anchorName ?? ''))
        const isUnassigned = isUnassignedAnchorName(String(a.anchorName ?? ''))
        const rowKey = String(a.anchorId ?? name ?? idx)
        const refundRate = anchorRowRate(a, 'returnRate')
        const signRate = anchorRowRate(a, 'signRate')
        const qualityCount = anchorRowNum(a, 'qualityReturnCount')
        const liveLines = showLivePeriod ? anchorRowLivePeriodLines(a) : { primary: null, secondary: null }
        const livePeriodMultiline = liveLines.primary?.includes('\n') ?? false
        const trend = anchorRowTrend(a)
        const showTrend = showIndividualTrend || (expandedTrendKeys[rowKey] ?? true)
        const showExtraMetrics = expandedMetricKeys[rowKey] ?? false
        const theme = resolveAnchorTheme({
          id: typeof a.anchorId === 'string' ? a.anchorId : null,
          name: typeof a.anchorName === 'string' ? a.anchorName : null,
          color: typeof a.color === 'string' ? a.color : null,
        })
        const chartColor = resolveAnchorColor({
          id: typeof a.anchorId === 'string' ? a.anchorId : null,
          name: typeof a.anchorName === 'string' ? a.anchorName : null,
          color: typeof a.color === 'string' ? a.color : null,
        })

        const onLeave = Boolean((a as { isOnLeave?: boolean }).isOnLeave)

        return (
          <article
            key={rowKey}
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
            className={`board-list-row-enter relative overflow-hidden rounded-2xl border p-4 shadow-sm ${
              isUnassigned
                ? 'border-amber-200 bg-amber-50/60 shadow-amber-100/40'
                : 'border-rose-100 bg-white shadow-rose-100/40'
            } ${onSelect ? 'cursor-pointer transition active:scale-[0.99] hover:shadow-md' : ''}`}
            style={{
              ['--i' as string]: String(Math.min(idx, 12)),
              ...(isUnassigned
                ? {}
                : {
                    borderLeftWidth: 3,
                    borderLeftColor: theme.main,
                  }),
            }}
          >
            {onLeave ? <LeaveWatermark /> : null}
            <div className="relative z-10 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-slate-500">主播</p>
                <p
                  className={`flex items-center gap-2 text-lg font-semibold ${
                    isUnassigned ? 'text-amber-900' : 'text-slate-900'
                  }`}
                >
                  {!isUnassigned ? (
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: theme.main }}
                      aria-hidden
                    />
                  ) : null}
                  {name}
                  {(() => {
                    const shop = anchorRowShopName(a)
                    if (!shop || isUnassigned) return null
                    return <span className="font-normal text-slate-500"> · {shop}</span>
                  })()}
                </p>
                {isUnassigned ? (
                  <p className="mt-1 text-[11px] leading-snug text-amber-800/90">{UNASSIGNED_ANCHOR_HINT}</p>
                ) : null}
                {isUnassigned && onSelect ? (
                  <p className="mt-0.5 text-[11px] font-medium text-amber-700">查看归属异常明细</p>
                ) : null}
                {showLivePeriod && liveLines.primary ? (
                  <p
                    className={`mt-1 text-[12px] ${
                      liveLines.primary.includes('未') ? 'text-slate-500' : 'text-slate-600'
                    }${livePeriodMultiline ? ' whitespace-pre-line' : ''}`}
                  >
                    {liveLines.primary}
                  </p>
                ) : null}
                {showLivePeriod && liveLines.secondary ? (
                  <p className="mt-0.5 text-[11px] text-slate-400">{liveLines.secondary}</p>
                ) : null}
              </div>
            </div>

            <div className="relative z-[1] mt-3 grid grid-cols-2 gap-2">
              <MetricCell label="GMV" value={formatMoney(anchorRowGmv(a))} />
              <MetricCell label="已签收金额" value={formatMoney(anchorRowActualSignedAmount(a))} />
              <MetricCell label="支付单数" value={formatCount(anchorRowPaidCount(a))} />
              <MetricCell label="已签收单数" value={formatCount(anchorRowSignedCount(a))} />
              <MetricCell
                label="退款单数"
                value={formatCount(anchorRowReturnCount(a))}
                onClick={onReturnCountClick ? () => onReturnCountClick(a) : undefined}
              />
              <MetricCell
                label="退款率"
                value={formatRate(refundRate)}
                danger={isHighRefundRate(refundRate)}
              />
            </div>

            {showExtraMetrics ? (
              <div className="relative z-[1] mt-2 grid grid-cols-2 gap-2">
                <MetricCell label="退款金额" value={formatMoney(anchorRowRefundAmount(a))} danger />
                <MetricCell
                  label="退货退款单数"
                  value={
                    anchorRowReturnRefundCountDisplay(a) == null
                      ? '—'
                      : formatCount(anchorRowReturnRefundCountDisplay(a)!)
                  }
                  onClick={
                    onReturnRefundCountClick && anchorRowReturnRefundCountDisplay(a) != null
                      ? () => onReturnRefundCountClick(a)
                      : undefined
                  }
                />
                <MetricCell
                  label="品退单数"
                  value={qualityCount > 0 ? `品退 ${formatCount(qualityCount)} 单` : formatCount(qualityCount)}
                  danger={qualityCount > 0}
                  onClick={onQualityCountClick ? () => onQualityCountClick(a) : undefined}
                />
                <MetricCell label="签收率" value={formatRate(signRate)} />
              </div>
            ) : null}

            {showTrend && trend ? (
              <div
                className="mt-3 rounded-xl border border-rose-50 bg-rose-50/20 p-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <p className="mb-1 px-1 text-[11px] font-medium text-slate-500">开播节奏</p>
                <AnchorTrendChart
                  variant="page"
                  trend={trend}
                  color={chartColor}
                  includeZeroPerformance={includeZeroPerformance}
                  formatMoney={formatMoney}
                  formatCount={(n) => `${formatCount(n)} 单`}
                />
              </div>
            ) : showTrend && includeZeroPerformance ? (
              <div className="mt-3 rounded-xl border border-dashed border-rose-100 bg-rose-50/20 px-3 py-4 text-center">
                <p className="text-[12px] text-slate-500">暂无走势数据</p>
                <p className="mt-1 text-[11px] text-slate-400">请先设置排班或同步直播场次</p>
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-2 border-t border-rose-50 pt-2.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setExpandedMetricKeys((prev) => ({
                    ...prev,
                    [rowKey]: !(prev[rowKey] ?? false),
                  }))
                }}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
              >
                {showExtraMetrics ? '收起更多指标' : '更多指标'}
              </button>
              {!showIndividualTrend && trend ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setExpandedTrendKeys((prev) => ({
                      ...prev,
                      [rowKey]: !(prev[rowKey] ?? true),
                    }))
                  }}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                >
                  {showTrend ? '收起走势' : '查看走势'}
                </button>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
