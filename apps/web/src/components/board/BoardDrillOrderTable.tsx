import React, { useMemo, useState } from 'react'
import { formatAnchorDisplayName } from '../../lib/anchor-display-name'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import {
  displayCell,
  boardRowDisplayOrderNo,
  normalizeBoardOrderRow,
  displayAfterSaleReason,
  formatAttributionBasis,
  type BoardDrillOrderRow,
} from '../../lib/board-order-row'
import {
  afterSaleToneClass,
  deriveAfterSaleDisplay,
  earnedAmountForRow,
  orderStatusLabelForRow,
  warnBuyerOrderAnomalies,
  type BuyerOrderRowExt,
} from '../../lib/derive-after-sale-display'
import { MetricInfoTooltip } from './MetricInfoTooltip'
import { getMetricExplain } from '../../lib/metricExplain'
import { BuyerDisplay } from './BuyerDisplay'
import { MobileBuyerOrderCards } from './MobileBuyerOrderCards'
import { MobileBoardOrderCards } from './MobileBoardOrderCards'
import { normalizeBuyerDrawerOrderRow } from '../../lib/buyer-drawer-order-row'
import { formatRefundSourceLabel } from '../../lib/refund-source-label'
import { ListViewToggle, type ListViewMode } from '../ui/ListViewToggle'
import { OrderAnchorAssignControl } from './OrderAnchorAssignControl'
import { QianfanOrderDetailButton } from './QianfanOrderDetailButton'

export type { BoardDrillOrderRow }

const BOARD_COLUMN_COUNT = 17
const BOARD_COLUMN_COUNT_WITH_ASSIGN = 18
const BUYER_COLUMN_COUNT = 7

interface Props {
  rows: BoardDrillOrderRow[] | Array<Record<string, unknown>>
  blacklistedBuyerIds?: string[]
  loading?: boolean
  emptyText?: string
  listKey?: string
  /** 买家 Drawer 明细表：拆分金额列 */
  variant?: 'board' | 'buyer'
  headerRefundOrderCount?: number
  /** 已签收金额抽屉：主金额列展示 signedAmount */
  amountMode?: 'default' | 'signed'
  manualAnchorAssign?: {
    anchorOptions: Array<{ id: string; name: string }>
    assigningOrderNo?: string | null
    onAssign: (orderNo: string, anchorName: string) => void
    onClearManualOverride?: (orderNo: string) => void
  }
}

function refundSourceLabel(
  source: string | undefined,
  pending: boolean,
  sourceText?: string | null,
): string {
  return formatRefundSourceLabel(source, pending, sourceText)
}

function QualityReturnBadge({ isQuality }: { isQuality: boolean }) {
  return isQuality ? (
    <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
      品退
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
      非品退
    </span>
  )
}

export const BoardDrillOrderTable: React.FC<Props> = ({
  rows: rawRows,
  blacklistedBuyerIds = [],
  loading = false,
  emptyText = '暂无明细',
  listKey,
  variant = 'board',
  headerRefundOrderCount,
  amountMode = 'default',
  manualAnchorAssign,
}) => {
  const { formatMoney } = useAmountDisplay()
  const blacklistSet = useMemo(() => new Set(blacklistedBuyerIds), [blacklistedBuyerIds])
  const isBuyer = variant === 'buyer'
  const showManualAssign = Boolean(manualAnchorAssign)
  const columnCount = isBuyer
    ? BUYER_COLUMN_COUNT
    : showManualAssign
      ? BOARD_COLUMN_COUNT_WITH_ASSIGN
      : BOARD_COLUMN_COUNT
  const [viewMode, setViewMode] = useState<ListViewMode>('cards')

  const showCardsOnDesktop = viewMode === 'cards'
  const cardClass = showCardsOnDesktop ? 'block' : 'hidden'
  const tableWrapClass = showCardsOnDesktop ? 'hidden' : 'block'

  const rows = useMemo(
    () =>
      rawRows.map((r) =>
        isBuyer
          ? normalizeBuyerDrawerOrderRow(r as Record<string, unknown>)
          : 'orderNo' in r && typeof (r as BoardDrillOrderRow).orderTime === 'string'
            ? (r as BoardDrillOrderRow)
            : normalizeBoardOrderRow(r as Record<string, unknown>),
      ),
    [rawRows, isBuyer],
  )

  const tableKey =
    listKey ?? (rows.length > 0 ? `rows-${boardRowDisplayOrderNo(rows[0]!)}` : 'empty')

  if (loading) {
    return (
      <div
        data-testid="drawer-order-skeleton"
        className="animate-in fade-in space-y-2 py-4 duration-300"
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded-xl bg-rose-50/80"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
    )
  }

  if (isBuyer) {
    return (
      <div key={tableKey} className="animate-in fade-in duration-300">
        <div className="mb-3 flex justify-end">
          <ListViewToggle mode={viewMode} onChange={setViewMode} />
        </div>
        <MobileBuyerOrderCards
          rows={rows}
          emptyText={emptyText}
          className={cardClass}
          headerRefundOrderCount={headerRefundOrderCount}
        />
        <div className={tableWrapClass}>{renderBuyerTable()}</div>
      </div>
    )
  }

  return (
    <div key={tableKey} data-testid="drawer-order-table" className="animate-in fade-in duration-300">
      <div className="mb-3 flex justify-end">
        <ListViewToggle mode={viewMode} onChange={setViewMode} />
      </div>
      <MobileBoardOrderCards
        rows={rows}
        emptyText={emptyText}
        blacklistedBuyerIds={blacklistedBuyerIds}
        className={cardClass}
        amountMode={amountMode}
        manualAnchorAssign={manualAnchorAssign}
      />
      <div className={tableWrapClass}>{renderBoardTable()}</div>
    </div>
  )

  function renderBuyerTable() {
    return (
      <div className="max-h-[min(70dvh,680px)] overflow-auto rounded-2xl border border-rose-100/60 bg-white">
        <table className="w-full min-w-[720px] text-left text-[11px]">
          <thead className="sticky top-0 z-10 bg-rose-50/95 text-slate-500 shadow-[0_1px_0_rgba(244,63,94,0.08)]">
            <tr>
              <th className="sticky left-0 z-10 min-w-[180px] whitespace-nowrap bg-rose-50/95 px-2 py-2">
                订单号
              </th>
              <th className="whitespace-nowrap px-2 py-2 text-right">
                <span className="inline-flex items-center gap-0.5">
                  赚到金额
                  <MetricInfoTooltip text={getMetricExplain('earnedAmount')} />
                </span>
              </th>
              <th className="whitespace-nowrap px-2 py-2">订单状态</th>
              <th className="whitespace-nowrap px-2 py-2">售后状态</th>
              <th className="whitespace-nowrap px-2 py-2">售后类型</th>
              <th className="min-w-[120px] px-2 py-2">售后原因</th>
              <th className="whitespace-nowrap px-2 py-2">退款来源</th>
            </tr>
          </thead>
          <tbody>{renderBuyerRows()}</tbody>
        </table>
      </div>
    )
  }

  function renderBoardTable() {
    return (
      <div className="max-h-[min(70dvh,680px)] overflow-auto rounded-2xl border border-rose-100/60 bg-white">
        <table className="w-full min-w-[1280px] text-left text-[11px]">
          <thead className="sticky top-0 z-10 bg-rose-50/95 text-slate-500 shadow-[0_1px_0_rgba(244,63,94,0.08)]">
            <tr>
              <th className="whitespace-nowrap px-2 py-2">订单号</th>
              <th className="whitespace-nowrap px-2 py-2">下单时间</th>
              <th className="whitespace-nowrap px-2 py-2">来源直播号</th>
              <th className="whitespace-nowrap px-2 py-2">主播</th>
              <th className="whitespace-nowrap px-2 py-2">买家昵称</th>
              <th className="whitespace-nowrap px-2 py-2">商品名称</th>
              <th className="whitespace-nowrap px-2 py-2">
                {amountMode === 'signed' ? '已签收金额' : '商家应收/支付金额'}
              </th>
              <th className="whitespace-nowrap px-2 py-2">退款金额</th>
              <th className="whitespace-nowrap px-2 py-2">订单状态</th>
              <th className="whitespace-nowrap px-2 py-2">售后状态</th>
              <th className="whitespace-nowrap px-2 py-2">售后原因</th>
              <th className="whitespace-nowrap px-2 py-2">品退来源</th>
              <th className="whitespace-nowrap px-2 py-2">售后印证</th>
              <th className="whitespace-nowrap px-2 py-2">销售状态</th>
              <th className="whitespace-nowrap px-2 py-2">状态说明</th>
              <th className="whitespace-nowrap px-2 py-2">品退标记</th>
              {showManualAssign ? (
                <th className="min-w-[140px] whitespace-nowrap px-2 py-2">指定主播</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columnCount}
                  data-testid="drawer-empty-state"
                  className="py-10 text-center text-slate-400"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const buyerKey = displayCell(r.buyerKey)
                const nick = displayCell(r.buyerNickname)
                const rowBlocked =
                  Boolean(r.isBlacklistedBuyer) ||
                  (buyerKey !== '—' && blacklistSet.has(buyerKey))
                return (
                  <tr
                    key={`${boardRowDisplayOrderNo(r)}-${idx}`}
                    className={`border-t ${rowBlocked ? 'bg-red-50/40' : 'border-slate-50 hover:bg-rose-50/30'}`}
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-mono">{displayCell(boardRowDisplayOrderNo(r))}</div>
                      <QianfanOrderDetailButton orderNo={boardRowDisplayOrderNo(r)} compact />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{displayCell(r.orderTime)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{displayCell(r.liveAccountName)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <span>{formatAnchorDisplayName(r.anchorName)}</span>
                        {String(r.dealSource ?? '') === 'offline' ||
                        String(r.orderNo ?? '').startsWith('OFF-') ? (
                          <span className="rounded bg-indigo-50 px-1 py-0.5 text-[10px] text-indigo-700">
                            线下成交
                          </span>
                        ) : null}
                        {r.attributionSource === 'offline_manual' ||
                        r.attributionSource === 'manual_override' ? (
                          <span className="rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-800">
                            手动归属
                          </span>
                        ) : null}
                        {!r.anchorName || r.anchorName === '未归属' ? (
                          <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-600">
                            待归属主播
                          </span>
                        ) : null}
                      </div>
                      {(r.paymentAnchorName != null ||
                        r.qualityAttributionAnchorName != null ||
                        r.attributionSource != null ||
                        r.attributionExplain != null ||
                        r.attributedBy != null) && (
                        <div className="mt-0.5 space-y-0.5 text-[10px] leading-snug text-slate-500">
                          <div>
                            主播：
                            {formatAnchorDisplayName(r.paymentAnchorName || r.anchorName)}
                          </div>
                          <div>
                            品退归属主播：
                            {formatAnchorDisplayName(r.qualityAttributionAnchorName || r.anchorName)}
                          </div>
                          <div
                            className="max-w-[160px] truncate"
                            title={formatAttributionBasis(
                              r.attributionSource,
                              r.attributionExplain,
                              120,
                            )}
                          >
                            归属来源：
                            {formatAttributionBasis(
                              r.attributionSource,
                              r.attributionExplain,
                            )}
                          </div>
                          {r.attributedBy ? <div>操作人：{String(r.attributedBy)}</div> : null}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <BuyerDisplay nickname={nick === '—' ? '未知' : nick} />
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-1.5" title={displayCell(r.productName)}>
                      {displayCell(r.productName)}
                    </td>
                    <td className="px-2 py-1.5 font-medium">
                      {amountMode === 'signed' ? (
                        <div>
                          <div>{formatMoney(Number(r.signedAmount ?? 0))}</div>
                          <div className="text-[10px] font-normal text-slate-400">
                            支付金额 {formatMoney(Number(r.merchantReceivableAmount ?? 0))}
                          </div>
                        </div>
                      ) : (
                        formatMoney(Number(r.merchantReceivableAmount ?? 0))
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-rose-600">
                      {formatMoney(Number(r.refundAmount ?? r.productRefundAmount ?? 0))}
                    </td>
                    <td className="px-2 py-1.5">{displayCell(r.orderStatus)}</td>
                    <td className="px-2 py-1.5">{displayCell(r.afterSaleStatus)}</td>
                    <td className="max-w-[120px] truncate px-2 py-1.5" title={displayAfterSaleReason(r)}>
                      {displayAfterSaleReason(r)}
                    </td>
                    <td className="max-w-[140px] truncate px-2 py-1.5 text-slate-600" title={displayCell(r.qualitySourceLabel)}>
                      {r.isQualityReturn
                        ? displayCell(r.officialReasonText ?? r.qualityReasonText)
                        : r.qualityVerifyStatus === 'after_sale_only'
                          ? '官方未命中'
                          : '—'}
                    </td>
                    <td className="max-w-[160px] truncate px-2 py-1.5 text-slate-600" title={displayCell(r.qualityVerifyDisplayLabel ?? r.qualitySourceLabel)}>
                      {displayCell(r.qualityVerifyDisplayLabel ?? r.qualitySourceLabel ?? '—')}
                    </td>
                    <td className="px-2 py-1.5">{r.includedInGmv ? '本期支付有效' : '状态未成交'}</td>
                    <td className="max-w-[120px] truncate px-2 py-1.5 text-slate-500" title={displayCell(r.gmvExcludeReason)}>
                      {displayCell(r.gmvExcludeReason)}
                    </td>
                    <td className="px-2 py-1.5">
                      <QualityReturnBadge isQuality={Boolean(r.isQualityReturn)} />
                    </td>
                    {showManualAssign && manualAnchorAssign ? (
                      <td className="px-2 py-1.5">
                        <OrderAnchorAssignControl
                          orderNo={boardRowDisplayOrderNo(r)}
                          defaultAnchorName={r.anchorName}
                          attributionSource={r.attributionSource}
                          anchorOptions={manualAnchorAssign.anchorOptions}
                          assigningOrderNo={manualAnchorAssign.assigningOrderNo}
                          onAssign={manualAnchorAssign.onAssign}
                          onClearManualOverride={manualAnchorAssign.onClearManualOverride}
                        />
                      </td>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    )
  }

  function renderBuyerRows() {
    if (rows.length === 0) {
      return (
        <tr>
          <td colSpan={BUYER_COLUMN_COUNT} className="py-10 text-center text-slate-400">
            {emptyText}
          </td>
        </tr>
      )
    }

    return rows.map((rawRow, idx) => {
      const r = rawRow as BuyerOrderRowExt
      const refundPending = Boolean(r.refundAmountPending)
      const refundSource = refundSourceLabel(
        r.refundAmountSource,
        refundPending,
        r.refundSourceText,
      )
      const reason = displayAfterSaleReason(r)
      const afterSale = deriveAfterSaleDisplay(r)
      const orderStatus = orderStatusLabelForRow(r)
      const earned = earnedAmountForRow(r)
      const afterSaleTypeLabel =
        r.afterSaleDisplayType && r.afterSaleDisplayType !== '—'
          ? r.afterSaleDisplayType
          : r.isQualityReturn
            ? '品退'
            : '—'

      warnBuyerOrderAnomalies(r, { headerRefundOrderCount })

      return (
        <tr
          key={`${boardRowDisplayOrderNo(r)}-${idx}`}
          className="border-t border-slate-50 hover:bg-rose-50/30"
        >
          <td className="sticky left-0 z-10 min-w-[180px] bg-white px-2 py-1.5 text-[10px] group-hover:bg-rose-50/30">
            <div className="font-mono">{displayCell(boardRowDisplayOrderNo(r))}</div>
            <QianfanOrderDetailButton orderNo={boardRowDisplayOrderNo(r)} compact />
          </td>
          <td className="px-2 py-1.5 text-right text-[12px] font-bold text-rose-900 tabular-nums">
            {formatMoney(earned)}
          </td>
          <td className="px-2 py-1.5">{orderStatus}</td>
          <td className="px-2 py-1.5">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${afterSaleToneClass(afterSale.tone)}`}
            >
              {afterSale.label}
            </span>
          </td>
          <td className="px-2 py-1.5">{afterSaleTypeLabel}</td>
          <td className="max-w-[140px] truncate px-2 py-1.5" title={reason}>
            {reason}
          </td>
          <td className="px-2 py-1.5 text-slate-500">{refundSource}</td>
        </tr>
      )
    })
  }
}
