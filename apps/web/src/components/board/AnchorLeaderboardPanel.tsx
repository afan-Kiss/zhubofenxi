import React, { useEffect, useState } from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import {
  anchorRowGmv,
  anchorRowNum,
  anchorRowPaidCount,
  anchorRowRate,
  anchorRowRefundAmount,
  anchorRowReturnCount,
  anchorRowReturnRefundCountDisplay,
  anchorRowRefundOnlyCount,
  anchorRowLivePeriodLines,
  anchorRowActualSignedAmount,
  isHighRefundRate,
  type AnchorLeaderboardRow,
} from '../../lib/anchor-leaderboard-row'
import { anchorCardTestId } from '../../lib/anchor-test-id'
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
  showLongPeriodRates?: boolean
  showLivePeriod?: boolean
  /** 单日：无成交主播也展示走势与对比 */
  includeZeroPerformance?: boolean
  startDate?: string
  endDate?: string
}

export const AnchorLeaderboardPanel: React.FC<Props> = ({
  rows,
  compareRows,
  emptyText = '暂无数据',
  onRowClick,
  onQualityCountClick,
  onReturnRefundCountClick,
  showLongPeriodRates: showRates = true,
  showLivePeriod = false,
  includeZeroPerformance = false,
  startDate: _startDate = '',
  endDate: _endDate = '',
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

  const colCount = showExtraColumns ? (showRates ? 11 : 10) : 6

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
        <div className="mb-4">
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
        showLongPeriodRates={showRates}
        showIndividualTrend
        showLivePeriod={showLivePeriod}
        includeZeroPerformance={includeZeroPerformance}
        className={cardClass}
      />

      <div className={`${tableWrapClass} overflow-x-auto md:px-0`}>
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="bg-rose-50/40 text-slate-500">
            <tr>
              <th className="py-2.5 pl-4 pr-2">主播</th>
              <th className="py-2 pr-2 text-right">支付金额</th>
              <th className="py-2 pr-2 text-right">已签收金额</th>
              <th className="py-2 pr-2 text-right">支付单数</th>
              <th className="py-2 pr-2 text-right">退款率</th>
              <th
                className="py-2 pr-4 text-right"
                title="品退与支付统一按订单下单时直播场次归属主播"
              >
                品退单数
              </th>
              {showExtraColumns ? (
                <>
                  <th className="py-2 pr-2 text-right">退款金额</th>
                  <th className="py-2 pr-2 text-right">退款订单数</th>
                  <th className="py-2 pr-2 text-right">退货退款单数</th>
                  <th className="py-2 pr-2 text-right">仅退款单数</th>
                  {showRates ? <th className="pr-4 py-2 text-right">签收率</th> : null}
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
                const qualityCount = anchorRowNum(a, 'qualityReturnCount')
                const liveLines = showLivePeriod ? anchorRowLivePeriodLines(a) : { primary: null, secondary: null }
                const livePeriodMultiline = liveLines.primary?.includes('\n') ?? false
                return (
                  <tr
                    key={String(a.anchorId ?? a.anchorName ?? idx)}
                    data-testid={anchorCardTestId(String(a.anchorName))}
                    style={{ ['--i' as string]: String(Math.min(idx, 12)) }}
                    className={`board-list-row-enter border-t border-rose-50/80 transition hover:bg-rose-50/40 ${
                      onRowClick ? 'cursor-pointer' : ''
                    }`}
                    onClick={onRowClick ? () => onRowClick(a) : undefined}
                  >
                    <td className="py-2.5 pl-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-rose-800">{String(a.anchorName)}</span>
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
                    <td className="py-2 text-right tabular-nums">{formatMoney(anchorRowGmv(a))}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(anchorRowActualSignedAmount(a))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowPaidCount(a))}
                    </td>
                    <td
                      className={`py-2 pr-2 text-right tabular-nums ${
                        isHighRefundRate(refundRate) ? 'font-semibold text-rose-600' : ''
                      }`}
                    >
                      {formatRate(refundRate)}
                    </td>
                    <td
                      className={`py-2 pr-4 text-right tabular-nums ${
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
                    {showExtraColumns ? (
                      <>
                        <td className="py-2 text-right font-medium text-rose-600 tabular-nums">
                          {formatMoney(anchorRowRefundAmount(a))}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatCount(anchorRowReturnCount(a))}
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${
                            onReturnRefundCountClick ? 'cursor-pointer hover:underline' : ''
                          }`}
                          title={
                            anchorRowReturnRefundCountDisplay(a) == null
                              ? '部分售后类型尚未同步，暂不能准确区分退货退款与仅退款。'
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
                        <td className="py-2 text-right tabular-nums">
                          {formatCount(anchorRowRefundOnlyCount(a))}
                        </td>
                        {showRates ? (
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {formatRate(anchorRowRate(a, 'signRate'))}
                          </td>
                        ) : null}
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
