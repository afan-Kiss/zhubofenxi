import React, { useState } from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import {
  anchorRowGmv,
  anchorRowNum,
  anchorRowPaidCount,
  anchorRowRate,
  anchorRowRefundAmount,
  anchorRowReturnRefundCount,
  anchorRowReturnRefundRate,
  anchorRowLivePeriodLines,
  anchorRowLivePeriodText,
  anchorRowSignedCount,
  anchorRowValidSales,
  isHighRefundRate,
  type AnchorLeaderboardRow,
} from '../../lib/anchor-leaderboard-row'
import { anchorCardTestId } from '../../lib/anchor-test-id'
import { ListViewToggle, type ListViewMode } from '../ui/ListViewToggle'
import { MobileAnchorLeaderboardCards } from './MobileAnchorLeaderboardCards'
import { AnchorTrendCompareChart } from './AnchorTrendCompareChart'

type TrendViewMode = 'single' | 'compare'

interface Props {
  rows: AnchorLeaderboardRow[]
  emptyText?: string
  onRowClick?: (row: AnchorLeaderboardRow) => void
  onQualityCountClick?: (row: AnchorLeaderboardRow) => void
  showLongPeriodRates?: boolean
  showLivePeriod?: boolean
  startDate?: string
  endDate?: string
}

export const AnchorLeaderboardPanel: React.FC<Props> = ({
  rows,
  emptyText = '暂无数据',
  onRowClick,
  onQualityCountClick,
  showLongPeriodRates: showRates = true,
  showLivePeriod = false,
  startDate: _startDate = '',
  endDate: _endDate = '',
}) => {
  const { formatMoney, formatCount, formatRate } = useAmountDisplay()
  const [viewMode, setViewMode] = useState<ListViewMode>('cards')
  const [trendViewMode, setTrendViewMode] = useState<TrendViewMode>('single')

  const showCardsOnDesktop = viewMode === 'cards'
  const showTableOnDesktop = viewMode === 'table'
  const showCompareTrend = trendViewMode === 'compare'

  const cardClass = showCardsOnDesktop ? 'block' : 'block md:hidden'
  const tableWrapClass = showTableOnDesktop ? 'hidden md:block' : 'hidden'

  const colCount = showRates ? 14 : 12

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 md:px-4">
        <div
          className="inline-flex items-center gap-1 rounded-full border border-rose-100 bg-white p-0.5"
          role="tablist"
          aria-label="走势展示方式"
        >
          <button
            type="button"
            role="tab"
            aria-selected={trendViewMode === 'single'}
            onClick={() => setTrendViewMode('single')}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              trendViewMode === 'single'
                ? 'bg-rose-500 text-white shadow-sm'
                : 'text-slate-600 hover:bg-rose-50'
            }`}
          >
            单人走势
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={trendViewMode === 'compare'}
            onClick={() => setTrendViewMode('compare')}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              trendViewMode === 'compare'
                ? 'bg-rose-500 text-white shadow-sm'
                : 'text-slate-600 hover:bg-rose-50'
            }`}
          >
            开播节奏对比
          </button>
        </div>
        <ListViewToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {showCompareTrend ? (
        <div className="mb-3 px-1 md:px-4">
          <AnchorTrendCompareChart rows={rows} formatMoney={formatMoney} />
        </div>
      ) : null}

      <MobileAnchorLeaderboardCards
        rows={rows}
        emptyText={emptyText}
        onSelect={onRowClick}
        onQualityCountClick={onQualityCountClick}
        showLongPeriodRates={showRates}
        showIndividualTrend={!showCompareTrend}
        showLivePeriod={showLivePeriod}
        className={cardClass}
      />

      <p className={`mb-2 px-1 text-[11px] leading-relaxed text-slate-500 ${showTableOnDesktop ? 'md:px-4' : ''}`}>
        品退按订单下单时间匹配主播开播场次归属，不按售后发生时间。品退率 = 该主播品退单数 ÷ 支付订单数。
      </p>

      <div className={`${tableWrapClass} overflow-x-auto md:px-0`}>
        <table className="w-full min-w-[1280px] text-left text-[13px]">
          <thead className="bg-rose-50/40 text-slate-500">
            <tr>
              <th className="py-2.5 pl-4 pr-2">主播</th>
              <th className="py-2 pr-2 text-right">本期销售额</th>
              <th className="py-2 pr-2 text-right">有效成交额</th>
              {showRates ? <th className="py-2 pr-2 text-right">签收金额</th> : null}
              <th className="py-2 pr-2 text-right">退款金额</th>
              <th className="py-2 pr-2 text-right">本期订单数</th>
              <th className="py-2 pr-2 text-right">支付订单数</th>
              {showRates ? <th className="py-2 pr-2 text-right">签收单数</th> : null}
              <th className="py-2 pr-2 text-right">退款单数</th>
              <th className="py-2 pr-2 text-right">退货退款单数</th>
              <th className="py-2 pr-2 text-right" title="品退按订单下单时间匹配主播开播场次归属">
                品退单数
              </th>
              <th className="py-2 pr-2 text-right">退款率</th>
              {showRates && <th className="py-2 pr-2 text-right">退货率</th>}
              {showRates && <th className="py-2 pr-2 text-right">品退率</th>}
              {showRates && <th className="pr-4 py-2 text-right">签收率</th>}
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
                const livePeriod = anchorRowLivePeriodText(a)
                const liveLines = showLivePeriod ? anchorRowLivePeriodLines(a) : { primary: null, secondary: null }
                const livePeriodMultiline =
                  (liveLines.primary?.includes('\n') ?? false) ||
                  (livePeriod?.includes('\n') ?? false)
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
                      {formatMoney(anchorRowValidSales(a))}
                    </td>
                    {showRates ? (
                      <td className="py-2 text-right tabular-nums">
                        {formatMoney(anchorRowNum(a, 'actualSignedAmount'))}
                      </td>
                    ) : null}
                    <td className="py-2 text-right font-medium text-rose-600 tabular-nums">
                      {formatMoney(anchorRowRefundAmount(a))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowNum(a, 'periodOrderCount'))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowPaidCount(a))}
                    </td>
                    {showRates ? (
                      <td className="py-2 text-right tabular-nums">
                        {formatCount(anchorRowSignedCount(a))}
                      </td>
                    ) : null}
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowNum(a, 'returnCount'))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowReturnRefundCount(a))}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${onQualityCountClick ? 'cursor-pointer text-rose-700 hover:underline' : ''}`}
                      onClick={
                        onQualityCountClick
                          ? (e) => {
                              e.stopPropagation()
                              onQualityCountClick(a)
                            }
                          : undefined
                      }
                    >
                      {formatCount(anchorRowNum(a, 'qualityReturnCount'))}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        isHighRefundRate(refundRate) ? 'font-semibold text-rose-600' : ''
                      }`}
                    >
                      {formatRate(refundRate)}
                    </td>
                    {showRates && (
                      <td className="py-2 text-right tabular-nums">
                        {formatRate(anchorRowReturnRefundRate(a))}
                      </td>
                    )}
                    {showRates && (
                      <td className="py-2 text-right tabular-nums">
                        {formatRate(anchorRowRate(a, 'qualityReturnRate'))}
                      </td>
                    )}
                    {showRates && (
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatRate(anchorRowRate(a, 'signRate'))}
                      </td>
                    )}
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
