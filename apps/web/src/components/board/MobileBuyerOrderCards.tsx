import React, { useState } from 'react'

import { useAmountDisplay } from '../../providers/AmountDisplayProvider'

import { formatRefundSourceLabel } from '../../lib/refund-source-label'
import {
  boardRowDisplayOrderNo,
  displayAfterSaleReason,
  displayCell,
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
import { QianfanOrderDetailButton } from './QianfanOrderDetailButton'

interface Props {
  rows: BoardDrillOrderRow[]
  emptyText?: string
  className?: string
  headerRefundOrderCount?: number
}

function refundSourceLabel(
  source: string | undefined,
  pending: boolean,
  sourceText?: string | null,
): string {
  return formatRefundSourceLabel(source, pending, sourceText)
}

function copyOrderNo(orderNo: string) {
  if (!orderNo || orderNo === '—') return
  void navigator.clipboard?.writeText(orderNo).catch(() => {})
}

function StatusBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex max-w-full truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[11px] text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-[11px] leading-snug text-slate-800">{children}</span>
    </div>
  )
}

export const MobileBuyerOrderCards: React.FC<Props> = ({
  rows,
  emptyText = '暂无明细',
  className = '',
  headerRefundOrderCount,
}) => {
  const { formatMoney } = useAmountDisplay()
  const [expandedOrderNos, setExpandedOrderNos] = useState<Set<string>>(() => new Set())

  const toggleExpand = (orderNo: string) => {
    setExpandedOrderNos((prev) => {
      const next = new Set(prev)
      if (next.has(orderNo)) next.delete(orderNo)
      else next.add(orderNo)
      return next
    })
  }

  if (rows.length === 0) {
    return (
      <div
        className={`rounded-2xl border border-dashed border-rose-100 bg-rose-50/30 py-12 text-center text-sm text-slate-400 ${className}`}
      >
        {emptyText}
      </div>
    )
  }

  return (
    <div className={`grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 ${className}`}>
      {rows.map((rawRow, idx) => {
        const r = rawRow as BuyerOrderRowExt
        const orderNo = boardRowDisplayOrderNo(r)
        const expanded = expandedOrderNos.has(orderNo)
        const refundPending = Boolean(r.refundAmountPending)
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
          <article
            key={`${orderNo}-${idx}`}
            className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-rose-100/80 bg-white p-3 shadow-sm shadow-rose-100/30"
          >
            <div className="flex min-w-0 items-start justify-between gap-2 border-b border-rose-50 pb-2">
              <div className="min-w-0 flex-1">
                <p
                  className="truncate font-mono text-[12px] font-semibold text-slate-900"
                  title={displayCell(orderNo)}
                >
                  {displayCell(orderNo)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => copyOrderNo(orderNo)}
                  className="rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700"
                >
                  复制
                </button>
                <QianfanOrderDetailButton orderNo={orderNo} compact />
              </div>
            </div>

            <div className="mt-1.5 flex flex-wrap gap-1">
              <StatusBadge label={orderStatus} className="bg-slate-100 text-slate-700" />
              {afterSale.label !== '无售后' ? (
                <StatusBadge
                  label={afterSale.label}
                  className={afterSaleToneClass(afterSale.tone)}
                />
              ) : null}
              {r.isQualityReturn ? (
                <StatusBadge label="品退" className="bg-rose-100 text-rose-700" />
              ) : null}
            </div>

            <div className="mt-2 flex flex-1 flex-col gap-0.5">
              <FieldRow label="赚到金额">
                <span className="inline-flex items-center gap-0.5 text-sm font-semibold tabular-nums text-rose-900">
                  {formatMoney(earned)}
                  <MetricInfoTooltip text={getMetricExplain('earnedAmount')} />
                </span>
              </FieldRow>
              <FieldRow label="订单状态">{orderStatus}</FieldRow>
              <FieldRow label="售后状态">{afterSale.label}</FieldRow>
              <FieldRow label="售后类型">{afterSaleTypeLabel}</FieldRow>
            </div>

            <div className="mt-2 border-t border-rose-50 pt-2">
              <button
                type="button"
                className="text-[11px] font-medium text-rose-700"
                onClick={() => toggleExpand(orderNo)}
              >
                {expanded ? '收起详情' : '展开详情'}
              </button>
              {expanded ? (
                <div className="mt-1.5 space-y-0.5">
                  <FieldRow label="售后原因">
                    <span className="break-words text-right">{reason || '—'}</span>
                  </FieldRow>
                  <FieldRow label="退款来源">
                    {refundSourceLabel(r.refundAmountSource, refundPending, r.refundSourceText)}
                  </FieldRow>
                </div>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
