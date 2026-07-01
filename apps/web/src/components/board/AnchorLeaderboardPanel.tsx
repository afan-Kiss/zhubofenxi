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
  anchorRowSignedCount,
  anchorRowValidSales,
  isHighRefundRate,
  type AnchorLeaderboardRow,
} from '../../lib/anchor-leaderboard-row'
import { anchorCardTestId } from '../../lib/anchor-test-id'
import { ListViewToggle, type ListViewMode } from '../ui/ListViewToggle'
import { MobileAnchorLeaderboardCards } from './MobileAnchorLeaderboardCards'
import { AnchorLateStatusBadge } from './AnchorLateStatusBadge'
import { AnchorLateMultiDayNote } from './AnchorLateMultiDayNote'
import { formatLateTimingLine, readLateStatus } from '../../lib/anchor-late-status'

interface Props {
  rows: AnchorLeaderboardRow[]
  emptyText?: string
  onRowClick?: (row: AnchorLeaderboardRow) => void
  showLongPeriodRates?: boolean
  startDate?: string
  endDate?: string
}

export const AnchorLeaderboardPanel: React.FC<Props> = ({
  rows,
  emptyText = '暂无数据',
  onRowClick,
  showLongPeriodRates: showRates = true,
  startDate = '',
  endDate = '',
}) => {
  const { formatMoney, formatCount, formatRate } = useAmountDisplay()
  const [viewMode, setViewMode] = useState<ListViewMode>('cards')

  const showCardsOnDesktop = viewMode === 'cards'
  const showTableOnDesktop = viewMode === 'table'

  const cardClass = showCardsOnDesktop ? 'block' : 'block md:hidden'
  const tableWrapClass = showTableOnDesktop ? 'hidden md:block' : 'hidden'

  const colCount = showRates ? 14 : 12

  return (
    <div>
      <AnchorLateMultiDayNote startDate={startDate} endDate={endDate} className="mb-2 px-1 md:px-4" />
      <div className="mb-3 flex items-center justify-end px-1 md:px-4">
        <ListViewToggle mode={viewMode} onChange={setViewMode} />
      </div>

      <MobileAnchorLeaderboardCards
        rows={rows}
        emptyText={emptyText}
        onSelect={onRowClick}
        showLongPeriodRates={showRates}
        className={cardClass}
      />

      <div className={`${tableWrapClass} overflow-x-auto md:px-0`}>
        <table className="w-full min-w-[1280px] text-left text-[13px]">
          <thead className="bg-rose-50/40 text-slate-500">
            <tr>
              <th className="py-2.5 pl-4 pr-2">主播</th>
              <th className="py-2 pr-2 text-right">本期销售额</th>
              <th className="py-2 pr-2 text-right">有效成交额</th>
              <th className="py-2 pr-2 text-right">签收金额</th>
              <th className="py-2 pr-2 text-right">退款金额</th>
              <th className="py-2 pr-2 text-right">本期订单数</th>
              <th className="py-2 pr-2 text-right">支付订单数</th>
              <th className="py-2 pr-2 text-right">签收单数</th>
              <th className="py-2 pr-2 text-right">退款单数</th>
              <th className="py-2 pr-2 text-right">退货退款单数</th>
              <th className="py-2 pr-2 text-right">商品问题单数</th>
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
                const late = readLateStatus(a)
                const timingLine = formatLateTimingLine(late)
                return (
                  <tr
                    key={String(a.anchorId ?? a.anchorName ?? idx)}
                    data-testid={anchorCardTestId(String(a.anchorName))}
                    style={{ ['--i' as string]: String(Math.min(idx, 12)) }}
                    className={`board-list-row-enter border-t transition hover:bg-rose-50/40 ${
                      late.isLate || late.isEarlyLeave
                        ? late.isLate && late.isEarlyLeave
                          ? 'border-orange-100 bg-orange-50/30'
                          : late.isLate
                            ? 'border-red-100 bg-red-50/30'
                            : 'border-amber-100 bg-amber-50/30'
                        : 'border-rose-50/80'
                    } ${onRowClick ? 'cursor-pointer' : ''}`}
                    onClick={onRowClick ? () => onRowClick(a) : undefined}
                  >
                    <td className="py-2.5 pl-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-rose-800">{String(a.anchorName)}</span>
                          <AnchorLateStatusBadge row={late} />
                        </div>
                        {timingLine ? (
                          <span className={`text-[12px] ${late.isLate || late.isEarlyLeave ? 'text-red-600' : 'text-slate-500'}`}>
                            {timingLine}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatMoney(anchorRowGmv(a))}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(anchorRowValidSales(a))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatMoney(anchorRowNum(a, 'actualSignedAmount'))}
                    </td>
                    <td className="py-2 text-right font-medium text-rose-600 tabular-nums">
                      {formatMoney(anchorRowRefundAmount(a))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowNum(a, 'periodOrderCount'))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowPaidCount(a))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowSignedCount(a))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowNum(a, 'returnCount'))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCount(anchorRowReturnRefundCount(a))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
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
