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

function ExpandableReason({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (!text || text === '—') return <span className="text-slate-400">—</span>
  const long = text.length > 28
  return (
    <button
      type="button"
      className="max-w-[58%] text-left text-[11px] text-slate-800"
      onClick={() => long && setOpen((v) => !v)}
    >
      <span className={open ? '' : 'line-clamp-2'}>{text}</span>
      {long && !open ? <span className="ml-1 text-[10px] text-rose-500">展开</span> : null}
    </button>
  )
}

function copyOrderNo(orderNo: string) {
  if (!orderNo || orderNo === '—') return
  void navigator.clipboard?.writeText(orderNo).catch(() => {})
}

function StatusBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${className}`}>
      {label}
    </span>
  )
}

export const MobileBuyerOrderCards: React.FC<Props> = ({
  rows,
  emptyText = '暂无明细',
  className = 'block md:hidden',
  headerRefundOrderCount,
}) => {
  const { formatMoney } = useAmountDisplay()

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
    <div className={`space-y-3 ${className}`}>
      {rows.map((rawRow, idx) => {
        const r = rawRow as BuyerOrderRowExt
        const orderNo = boardRowDisplayOrderNo(r)
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
            className="rounded-2xl border border-rose-100/80 bg-white p-3.5 shadow-sm shadow-rose-100/40"
          >
            <div className="flex items-start justify-between gap-2 border-b border-rose-50 pb-2.5">
              <div className="min-w-0 flex-1">
                <p className="break-all font-mono text-[12px] font-semibold leading-snug text-slate-900">
                  {displayCell(orderNo)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => copyOrderNo(orderNo)}
                className="shrink-0 rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[10px] font-medium text-rose-700"
              >
                复制
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
              <StatusBadge label={orderStatus} className="bg-slate-100 text-slate-700" />
              {afterSale.label !== '无售后' ? (
                <StatusBadge
                  label={afterSale.label}
                  className={afterSaleToneClass(afterSale.tone)}
                />
              ) : null}
            </div>

            <div className="mt-2.5 space-y-0.5 text-[11px]">
              <div className="flex items-start justify-between gap-3 py-1">
                <span className="inline-flex shrink-0 items-center gap-0.5 text-slate-500">
                  赚到金额
                  <MetricInfoTooltip text={getMetricExplain('earnedAmount')} />
                </span>
                <span className="text-[14px] font-bold text-rose-900">{formatMoney(earned)}</span>
              </div>
              <div className="flex items-start justify-between gap-3 py-1">
                <span className="shrink-0 text-slate-500">订单状态</span>
                <span className="text-slate-800">{orderStatus}</span>
              </div>
              <div className="flex items-start justify-between gap-3 py-1">
                <span className="shrink-0 text-slate-500">售后状态</span>
                <span className="text-slate-800">{afterSale.label}</span>
              </div>
              <div className="flex items-start justify-between gap-3 py-1">
                <span className="shrink-0 text-slate-500">售后类型</span>
                <span className="text-slate-800">{afterSaleTypeLabel}</span>
              </div>
              <div className="flex items-start justify-between gap-3 py-1">
                <span className="shrink-0 text-slate-500">售后原因</span>
                <ExpandableReason text={reason} />
              </div>
              <div className="flex items-start justify-between gap-3 py-1">
                <span className="shrink-0 text-slate-500">退款来源</span>
                <span className="text-slate-800">
                  {refundSourceLabel(r.refundAmountSource, refundPending, r.refundSourceText)}
                </span>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
