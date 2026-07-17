import React, { useState } from 'react'
import { formatAnchorDisplayName } from '../../lib/anchor-display-name'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import {
  boardRowDisplayOrderNo,
  displayAfterSaleReason,
  displayCell,
  formatAttributionBasis,
  type BoardDrillOrderRow,
} from '../../lib/board-order-row'
import { BuyerDisplay } from './BuyerDisplay'
import { OrderAnchorAssignControl } from './OrderAnchorAssignControl'
import { QianfanOrderDetailButton } from './QianfanOrderDetailButton'

interface Props {
  rows: BoardDrillOrderRow[]
  emptyText?: string
  blacklistedBuyerIds?: string[]
  className?: string
  amountMode?: 'default' | 'signed'
  /** 线下 GMV 下钻：不展示直播号 / 千帆跳转 / 改归属 */
  offlineMode?: boolean
  manualAnchorAssign?: {
    anchorOptions: Array<{ id: string; name: string }>
    assigningOrderNo?: string | null
    onAssign: (orderNo: string, anchorName: string) => void
    onClearManualOverride?: (orderNo: string) => void
  }
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-[11px] text-slate-800">{children}</span>
    </div>
  )
}

function QualityReturnBadge({ isQuality }: { isQuality: boolean }) {
  return isQuality ? (
    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
      品退
    </span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
      非品退
    </span>
  )
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

export const MobileBoardOrderCards: React.FC<Props> = ({
  rows,
  emptyText = '暂无明细',
  blacklistedBuyerIds = [],
  className = 'block md:hidden',
  amountMode = 'default',
  offlineMode = false,
  manualAnchorAssign,
}) => {
  const { formatMoney } = useAmountDisplay()
  const blacklistSet = new Set(blacklistedBuyerIds)

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
      {rows.map((r, idx) => {
        const orderNo = boardRowDisplayOrderNo(r)
        const dealKey = displayCell(r.offlineDealKey ?? orderNo)
        const buyerKey = displayCell(r.buyerKey)
        const nick = displayCell(r.buyerNickname)
        const rowBlocked =
          Boolean(r.isBlacklistedBuyer) ||
          (buyerKey !== '—' && blacklistSet.has(buyerKey))
        const reason = displayAfterSaleReason(r)
        const pay = Number(r.merchantReceivableAmount ?? r.paymentBaseAmount ?? r.statPaidAmount ?? 0)
        const refund = Number(r.refundAmount ?? r.productRefundAmount ?? 0)
        const net = Math.round((pay - refund) * 100) / 100

        if (offlineMode) {
          return (
            <article
              key={`${dealKey}-${idx}`}
              className="rounded-2xl border border-rose-100/80 bg-white p-3.5 shadow-sm shadow-rose-100/40"
            >
              <div className="border-b border-rose-50 pb-2.5">
                <p className="break-all font-mono text-[12px] font-semibold leading-snug text-slate-900">
                  {dealKey}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {displayCell(r.payTime ?? r.orderTime)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
                    线下成交
                  </span>
                  <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
                    {formatAnchorDisplayName(r.anchorName)}
                  </span>
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                    线下手动归属
                  </span>
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                    已确认
                  </span>
                </div>
              </div>
              <div className="mt-2.5 space-y-0.5">
                <FieldRow label="归属主播">{formatAnchorDisplayName(r.anchorName)}</FieldRow>
                <FieldRow label="客户/订单标识">
                  <BuyerDisplay nickname={nick === '—' ? '未知' : nick} />
                </FieldRow>
                <FieldRow label="支付金额">
                  <span className="font-medium">{formatMoney(pay)}</span>
                </FieldRow>
                <FieldRow label="退款金额">
                  <span className="font-semibold text-rose-600">{formatMoney(refund)}</span>
                </FieldRow>
                <FieldRow label="净金额">{formatMoney(net)}</FieldRow>
                <FieldRow label="状态">{displayCell(r.orderStatus)}</FieldRow>
                {r.attributedBy ? (
                  <FieldRow label="操作人">{String(r.attributedBy)}</FieldRow>
                ) : null}
              </div>
            </article>
          )
        }

        return (
          <article
            key={`${orderNo}-${idx}`}
            className={`rounded-2xl border p-3.5 shadow-sm ${
              rowBlocked
                ? 'border-red-200 bg-red-50/30 shadow-red-100/30'
                : 'border-rose-100/80 bg-white shadow-rose-100/40'
            }`}
          >
            <div className="flex items-start justify-between gap-2 border-b border-rose-50 pb-2.5">
              <div className="min-w-0 flex-1">
                <p className="break-all font-mono text-[12px] font-semibold leading-snug text-slate-900">
                  {displayCell(orderNo)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">{displayCell(r.orderTime)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={() => copyOrderNo(orderNo)}
                  className="rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[10px] font-medium text-rose-700"
                >
                  复制
                </button>
                <QianfanOrderDetailButton orderNo={orderNo} compact />
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                来源直播号 {displayCell(r.liveAccountName)}
              </span>
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-slate-600">
                主播 {formatAnchorDisplayName(r.anchorName)}
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
                <span className="line-clamp-2 text-right">{displayCell(r.productName)}</span>
              </FieldRow>
              <FieldRow label={amountMode === 'signed' ? '已签收金额' : '商家应收/支付金额'}>
                <span className="font-medium">
                  {formatMoney(
                    Number(
                      amountMode === 'signed'
                        ? (r.signedAmount ?? 0)
                        : (r.merchantReceivableAmount ?? 0),
                    ),
                  )}
                </span>
              </FieldRow>
              {amountMode === 'signed' ? (
                <FieldRow label="支付金额">
                  <span className="text-[11px] text-slate-500">
                    {formatMoney(Number(r.merchantReceivableAmount ?? 0))}
                  </span>
                </FieldRow>
              ) : null}
              <FieldRow label="退款金额">
                <span className="text-[12px] font-semibold text-rose-600">
                  {formatMoney(Number(r.refundAmount ?? r.productRefundAmount ?? 0))}
                </span>
              </FieldRow>
              <FieldRow label="售后状态">{displayCell(r.afterSaleStatus)}</FieldRow>
              <FieldRow label="售后原因">
                <ExpandableReason text={reason} />
              </FieldRow>
              <FieldRow label="销售状态">{r.includedInGmv ? '本期支付有效' : '状态未成交'}</FieldRow>
              <FieldRow label="状态说明">{displayCell(r.gmvExcludeReason)}</FieldRow>
              <FieldRow label="品退标记">
                <QualityReturnBadge isQuality={Boolean(r.isQualityReturn)} />
              </FieldRow>
              {(r.paymentAnchorName != null ||
                r.qualityAttributionAnchorName != null ||
                r.attributionSource != null ||
                r.attributionExplain != null) && (
                <>
                  <FieldRow label="订单归属主播">
                    {formatAnchorDisplayName(r.paymentAnchorName || r.anchorName)}
                  </FieldRow>
                  {r.isQualityReturn ? (
                    <FieldRow label="品退归属主播">
                      {formatAnchorDisplayName(r.qualityAttributionAnchorName || r.anchorName)}
                    </FieldRow>
                  ) : null}
                  <FieldRow label="归属来源">
                    <span
                      className="line-clamp-2 text-right"
                      title={formatAttributionBasis(
                        r.attributionSource,
                        r.attributionExplain,
                        120,
                      )}
                    >
                      {formatAttributionBasis(r.attributionSource, r.attributionExplain)}
                    </span>
                  </FieldRow>
                </>
              )}
              {manualAnchorAssign ? (
                <FieldRow label="指定主播">
                  <OrderAnchorAssignControl
                    orderNo={orderNo}
                    defaultAnchorName={r.anchorName}
                    attributionSource={r.attributionSource}
                    anchorOptions={manualAnchorAssign.anchorOptions}
                    assigningOrderNo={manualAnchorAssign.assigningOrderNo}
                    onAssign={manualAnchorAssign.onAssign}
                    onClearManualOverride={manualAnchorAssign.onClearManualOverride}
                    compact
                  />
                </FieldRow>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
