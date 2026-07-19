import React, { useEffect, useState } from 'react'
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
  anchorRowShopName,
  isHighRefundRate,
  type AnchorLeaderboardRow,
} from '../../lib/anchor-leaderboard-row'
import { anchorCardTestId } from '../../lib/anchor-test-id'
import { resolveAnchorTheme } from '../../lib/anchor-theme'
import { ListViewToggle, type ListViewMode } from '../ui/ListViewToggle'
import { MobileAnchorLeaderboardCards } from './MobileAnchorLeaderboardCards'
import { AnchorTrendCompareChart } from './AnchorTrendCompareChart'

interface Props {
  rows: AnchorLeaderboardRow[]
  /** 对比图候选主播；列表可用筛选后的 rows */
  compareRows?: AnchorLeaderboardRow[]
  emptyText?: string
  onRowClick?: (row: AnchorLeaderboardRow) => void
  onQualityCountClick?: (row: AnchorLeaderboardRow) => void
  onReturnRefundCountClick?: (row: AnchorLeaderboardRow) => void
  onReturnCountClick?: (row: AnchorLeaderboardRow) => void
  showLongPeriodRates?: boolean
  showLivePeriod?: boolean
  /** 单日：无成交主播也展示走势与对比 */
  includeZeroPerformance?: boolean
  startDate?: string
  endDate?: string
  allowLeaveToggle?: boolean
  leaveToggleBusyKey?: string | null
  onLeaveToggle?: (row: AnchorLeaderboardRow, isOnLeave: boolean) => void
}

export const AnchorLeaderboardPanel: React.FC<Props> = ({
  rows,
  compareRows,
  emptyText = '暂无数据',
  onRowClick,
  onQualityCountClick,
  onReturnRefundCountClick,
  onReturnCountClick,
  showLongPeriodRates: showRates = true,
  showLivePeriod = false,
  includeZeroPerformance = false,
  startDate: _startDate = '',
  endDate: _endDate = '',
  allowLeaveToggle = false,
  leaveToggleBusyKey = null,
  onLeaveToggle,
}) => {
  const { formatMoney, formatCount, formatRate } = useAmountDisplay()
  const [viewMode, setViewMode] = useState<ListViewMode>('cards')
  const [showCompareTrend, setShowCompareTrend] = useState(true)
  const [showExtraColumns, setShowExtraColumns] = useState(false)

  useEffect(() => {
    if (showLivePeriod) setViewMode('cards')
  }, [showLivePeriod])

  const trendCompareRows = compareRows ?? rows
  const canCompareTrend = trendCompareRows.length >= 2
  const showCardsOnDesktop = viewMode === 'cards'
  const showTableOnDesktop = viewMode === 'table'

  const cardClass = showCardsOnDesktop ? 'block' : 'block md:hidden'
  const tableWrapClass = showTableOnDesktop ? 'hidden md:block' : 'hidden'

  const colCount = (showExtraColumns ? 11 : 7) + (allowLeaveToggle ? 1 : 0)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {canCompareTrend ? (
            <button
              type="button"
              onClick={() => setShowCompareTrend((open) => !open)}
              className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
            >
              {showCompareTrend ? '收起开播节奏对比' : '看开播节奏对比'}
            </button>
          ) : null}
          {showTableOnDesktop ? (
            <button
              type="button"
              onClick={() => setShowExtraColumns((open) => !open)}
              className="hidden rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 md:inline-flex"
            >
              {showExtraColumns ? '收起更多列' : '展开更多列'}
            </button>
          ) : null}
        </div>
        <ListViewToggle mode={viewMode} onChange={setViewMode} />
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        品退接口用于确认哪些订单发生品退。主播归属以订单下单时所在直播场次为准，支付、签收、退款和品退统一归到该订单主播。
      </p>

      {showCompareTrend && canCompareTrend ? (
        <div className="mb-4 max-w-3xl">
          <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
            {includeZeroPerformance
              ? '单日展示全部固定主播，无成交显示平线；可手动隐藏不想看的主播。'
              : '默认展示有成交的主播，可手动隐藏不想看的主播；下面列表可单独筛选。'}
          </p>
          <AnchorTrendCompareChart
            rows={trendCompareRows}
            formatMoney={formatMoney}
            includeZeroPerformance={includeZeroPerformance}
          />
        </div>
      ) : null}

      <MobileAnchorLeaderboardCards
        rows={rows}
        emptyText={emptyText}
        onSelect={onRowClick}
        onQualityCountClick={onQualityCountClick}
        onReturnRefundCountClick={onReturnRefundCountClick}
        onReturnCountClick={onReturnCountClick}
        showLongPeriodRates={showRates}
        showIndividualTrend
        showLivePeriod={showLivePeriod}
        includeZeroPerformance={includeZeroPerformance}
        allowLeaveToggle={allowLeaveToggle}
        leaveToggleBusyKey={leaveToggleBusyKey}
        onLeaveToggle={onLeaveToggle}
        className={cardClass}
      />

      <div className={`${tableWrapClass} overflow-x-auto md:px-0`}>
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="bg-rose-50/40 text-slate-500">
            <tr>
              <th className="py-2.5 pl-4 pr-2">主播</th>
              {allowLeaveToggle ? <th className="py-2 pr-2 text-center">休假</th> : null}
              <th className="py-2 pr-2 text-right">GMV</th>
              <th className="py-2 pr-2 text-right">已签收金额</th>
              <th className="py-2 pr-2 text-right">支付单数</th>
              <th className="py-2 pr-2 text-right">已签收单数</th>
              <th className="py-2 pr-2 text-right">退款单数</th>
              <th className="py-2 pr-4 text-right">退款率</th>
              {showExtraColumns ? (
                <>
                  <th className="py-2 pr-2 text-right">退款金额</th>
                  <th className="py-2 pr-2 text-right">退货退款单数</th>
                  <th
                    className="py-2 pr-2 text-right"
                    title="品退与支付统一按订单下单时直播场次归属主播"
                  >
                    品退单数
                  </th>
                  <th className="pr-4 py-2 text-right">签收率</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-8 text-center text-slate-400">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((a, idx) => {
                const refundRate = anchorRowRate(a, 'returnRate')
                const signRate = anchorRowRate(a, 'signRate')
                const qualityCount = anchorRowNum(a, 'qualityReturnCount')
                const liveLines = showLivePeriod ? anchorRowLivePeriodLines(a) : { primary: null, secondary: null }
                const livePeriodMultiline = liveLines.primary?.includes('\n') ?? false
                const isUnassigned = isUnassignedAnchorName(String(a.anchorName ?? ''))
                const rowKey = String(a.anchorId ?? a.anchorName ?? idx)
                const onLeave = Boolean((a as { isOnLeave?: boolean }).isOnLeave)
                const isOffboarded = Boolean((a as { isOffboarded?: boolean }).isOffboarded)
                const leaveBusyKey =
                  String(a.anchorId ?? '').trim() || String(a.anchorName ?? '').trim()
                const theme = resolveAnchorTheme({
                  id: typeof a.anchorId === 'string' ? a.anchorId : null,
                  name: typeof a.anchorName === 'string' ? a.anchorName : null,
                  color: typeof a.color === 'string' ? a.color : null,
                })
                return (
                  <tr
                    key={rowKey}
                    data-testid={anchorCardTestId(String(a.anchorName))}
                    style={{ ['--i' as string]: String(Math.min(idx, 12)) }}
                    className={`board-list-row-enter border-t transition ${
                      isUnassigned
                        ? 'border-amber-200/80 bg-amber-50/50 hover:bg-amber-50/80'
                        : 'border-rose-50/80 hover:bg-rose-50/40'
                    } ${onRowClick ? 'cursor-pointer' : ''}`}
                    onClick={onRowClick ? () => onRowClick(a) : undefined}
                  >
                    <td className="py-2.5 pl-4">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex flex-wrap items-center gap-2 font-medium ${
                            isUnassigned ? 'text-amber-900' : 'text-slate-800'
                          }`}
                        >
                          {!isUnassigned ? (
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: theme.main }}
                              aria-hidden
                            />
                          ) : null}
                          {formatAnchorDisplayName(String(a.anchorName))}
                          {(() => {
                            const shop = anchorRowShopName(a)
                            if (!shop || isUnassigned) return null
                            return (
                              <span className="font-normal text-slate-500"> · {shop}</span>
                            )
                          })()}
                          {onLeave ? (
                            <span className="rounded px-1.5 py-0.5 text-[11px] font-bold text-red-600">
                              休假
                            </span>
                          ) : null}
                          {!onLeave && isOffboarded && !showLivePeriod ? (
                            <button
                              type="button"
                              className="rounded px-1.5 py-0.5 text-[11px] font-bold text-red-600 underline-offset-2 hover:underline"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                onRowClick?.(a)
                              }}
                            >
                              已离职
                            </button>
                          ) : null}
                        </span>
                        {isUnassigned ? (
                          <>
                            <span className="text-[11px] leading-snug text-amber-800/90">
                              {UNASSIGNED_ANCHOR_HINT}
                            </span>
                            {onRowClick ? (
                              <span className="text-[11px] font-medium text-amber-700 underline-offset-2 hover:underline">
                                查看归属异常明细
                              </span>
                            ) : null}
                          </>
                        ) : null}
                        {showLivePeriod && liveLines.primary ? (
                          <span
                            className={`text-[12px] ${
                              liveLines.primary.includes('未') ? 'text-slate-500' : 'text-slate-600'
                            }${livePeriodMultiline ? ' whitespace-pre-line' : ''}`}
                          >
                            {liveLines.primary}
                          </span>
                        ) : null}
                        {showLivePeriod && liveLines.secondary ? (
                          <span className="text-[11px] text-slate-400">{liveLines.secondary}</span>
                        ) : null}
                      </div>
                    </td>
                    {allowLeaveToggle ? (
                      <td
                        className="py-2 text-center"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        {!isUnassigned && onLeaveToggle ? (
                          <button
                            type="button"
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] transition ${
                              onLeave
                                ? 'border-rose-300 bg-rose-50 font-semibold text-rose-700'
                                : 'border-slate-200 bg-white text-slate-600'
                            } ${leaveToggleBusyKey === leaveBusyKey ? 'opacity-70' : 'hover:border-rose-200'}`}
                            disabled={Boolean(leaveToggleBusyKey)}
                            aria-busy={leaveToggleBusyKey === leaveBusyKey}
                            aria-pressed={onLeave}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (leaveToggleBusyKey) return
                              onLeaveToggle(a, !onLeave)
                            }}
                          >
                            <span
                              className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px] ${
                                leaveToggleBusyKey === leaveBusyKey
                                  ? 'animate-pulse border-rose-400 bg-rose-100 text-rose-600'
                                  : onLeave
                                    ? 'border-rose-600 bg-rose-600 text-white'
                                    : 'border-slate-300 bg-white'
                              }`}
                              aria-hidden
                            >
                              {leaveToggleBusyKey === leaveBusyKey ? '…' : onLeave ? '✓' : ''}
                            </span>
                            {leaveToggleBusyKey === leaveBusyKey ? '保存中' : '休假'}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    ) : null}
                    <td className="py-2 text-right tabular-nums">{formatMoney(anchorRowGmv(a))}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(anchorRowActualSignedAmount(a))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowPaidCount(a))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowSignedCount(a))}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        onReturnCountClick ? 'cursor-pointer hover:underline' : ''
                      }`}
                      onClick={
                        onReturnCountClick
                          ? (e) => {
                              e.stopPropagation()
                              onReturnCountClick(a)
                            }
                          : undefined
                      }
                    >
                      {formatCount(anchorRowReturnCount(a))}
                    </td>
                    <td
                      className={`py-2 pr-4 text-right tabular-nums ${
                        isHighRefundRate(refundRate) ? 'font-semibold text-rose-600' : ''
                      }`}
                    >
                      {formatRate(refundRate)}
                    </td>
                    {showExtraColumns ? (
                      <>
                        <td className="py-2 text-right font-medium text-rose-600 tabular-nums">
                          {formatMoney(anchorRowRefundAmount(a))}
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${
                            onReturnRefundCountClick ? 'cursor-pointer hover:underline' : ''
                          }`}
                          title={
                            anchorRowReturnRefundCountDisplay(a) == null
                              ? '售后明细尚未完整同步，暂不能区分退货退款与仅退款；退款单数仍可参考。'
                              : undefined
                          }
                          onClick={
                            onReturnRefundCountClick && anchorRowReturnRefundCountDisplay(a) != null
                              ? (e) => {
                                  e.stopPropagation()
                                  onReturnRefundCountClick(a)
                                }
                              : undefined
                          }
                        >
                          {anchorRowReturnRefundCountDisplay(a) == null
                            ? '—'
                            : formatCount(anchorRowReturnRefundCountDisplay(a)!)}
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${
                            qualityCount > 0 ? 'font-medium text-rose-700' : ''
                          } ${onQualityCountClick ? 'cursor-pointer hover:underline' : ''}`}
                          onClick={
                            onQualityCountClick
                              ? (e) => {
                                  e.stopPropagation()
                                  onQualityCountClick(a)
                                }
                              : undefined
                          }
                        >
                          {formatCount(qualityCount)}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {formatRate(signRate)}
                        </td>
                      </>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
