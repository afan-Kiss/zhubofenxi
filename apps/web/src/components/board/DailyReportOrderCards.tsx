import React from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import {
  boardRowDisplayOrderNo,
  displayAfterSaleReason,
  displayCell,
  normalizeBoardOrderRow,
  type BoardDrillOrderRow,
} from '../../lib/board-order-row'
import { BuyerDisplay } from './BuyerDisplay'

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-[11px] text-slate-800">{children}</span>
    </div>
  )
}

interface Props {
  rows: Array<Record<string, unknown>>
  blacklistedBuyerIds?: string[]
}

export const DailyReportOrderCards: React.FC<Props> = ({ rows, blacklistedBuyerIds = [] }) => {
  const { formatMoney } = useAmountDisplay()
  const blacklistSet = new Set(blacklistedBuyerIds)
  const normalized = rows.map((r) => normalizeBoardOrderRow(r))

  if (normalized.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-rose-100 bg-rose-50/30 py-8 text-center text-sm text-slate-400">
        当前范围暂无该主播订单
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {normalized.map((r, idx) => {
        const orderNo = boardRowDisplayOrderNo(r)
        const buyerKey = displayCell(r.buyerKey)
        const nick = displayCell(r.buyerNickname)
        const rowBlocked =
          Boolean(r.isBlacklistedBuyer) || (buyerKey !== '—' && blacklistSet.has(buyerKey))
        const reason = displayAfterSaleReason(r)

        return (
          <article
            key={`${orderNo}-${idx}`}
            className={`rounded-2xl border p-3.5 shadow-sm ${
              rowBlocked
                ? 'border-red-200 bg-red-50/30 shadow-red-100/30'
                : 'border-rose-100/80 bg-white shadow-rose-100/40'
            }`}
          >
            <div className="border-b border-rose-50 pb-2.5">
              <p className="break-all font-mono text-[12px] font-semibold leading-snug text-slate-900">
                {displayCell(orderNo)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{displayCell(r.orderTime)}</p>
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                来源直播号 {displayCell(r.liveAccountName)}
              </span>
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-slate-600">
                主播 {displayCell(r.anchorName)}
              </span>
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-slate-600">
                {displayCell(r.orderStatus)}
              </span>
            </div>

            <div className="mt-2.5 space-y-0.5">
              <FieldRow label="买家昵称">
                <BuyerDisplay nickname={nick === '—' ? '未知' : nick} />
              </FieldRow>
              <FieldRow label="商品名称">
                <span className="line-clamp-3 text-right">{displayCell(r.productName)}</span>
              </FieldRow>
              <FieldRow label="商家应收/支付金额">
                <span className="font-medium">
                  {formatMoney(Number(r.merchantReceivableAmount ?? 0))}
                </span>
              </FieldRow>
              <FieldRow label="退款金额">
                <span className="text-[12px] font-semibold text-rose-600">
                  {formatMoney(Number(r.refundAmount ?? r.productRefundAmount ?? 0))}
                </span>
              </FieldRow>
              <FieldRow label="售后状态">{displayCell(r.afterSaleStatus)}</FieldRow>
              <FieldRow label="售后原因">
                <span className="line-clamp-3 text-right">{reason}</span>
              </FieldRow>
              <FieldRow label="销售状态">{r.includedInGmv ? '本期支付有效' : '状态未成交'}</FieldRow>
              <FieldRow label="状态说明">{displayCell(r.gmvExcludeReason)}</FieldRow>
            </div>
          </article>
        )
      })}
    </div>
  )
}

export type { BoardDrillOrderRow }
