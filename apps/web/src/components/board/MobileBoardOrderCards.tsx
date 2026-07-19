import React, { useState } from 'react'
import { formatAnchorDisplayName, isUnassignedAnchorName } from '../../lib/anchor-display-name'
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
    <div className="flex items-start justify-between gap-2 py-0.5">
      <span className="shrink-0 text-[11px] text-slate-500">{label}</span>
      <span className="min-w-0 text-right text-[11px] leading-snug text-slate-800">{children}</span>
    </div>
  )
}

function Tag({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-flex max-w-full truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
      {children}
    </span>
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
  className = '',
  amountMode = 'default',
  offlineMode = false,
  manualAnchorAssign,
}) => {
  const { formatMoney } = useAmountDisplay()
  const blacklistSet = new Set(blacklistedBuyerIds)
  const [expandedOrderNos, setExpandedOrderNos] = useState<Set<string>>(() => new Set())

  const toggleExpand = (key: string) => {
    setExpandedOrderNos((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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
      {rows.map((r, idx) => {
        const orderNo = boardRowDisplayOrderNo(r)
        const dealKey = displayCell(r.offlineDealKey ?? orderNo)
        const expandKey = offlineMode ? `${dealKey}-${idx}` : orderNo
        const expanded = expandedOrderNos.has(expandKey)
        const buyerKey = displayCell(r.buyerKey)
        const nick = displayCell(r.buyerNickname)
        const rowBlocked =
          Boolean(r.isBlacklistedBuyer) ||
          (buyerKey !== '—' && blacklistSet.has(buyerKey))
        const reason = displayAfterSaleReason(r)
        const pay = Number(r.merchantReceivableAmount ?? r.paymentBaseAmount ?? r.statPaidAmount ?? 0)
        const refund = Number(r.refundAmount ?? r.productRefundAmount ?? 0)
        const net = Math.round((pay - refund) * 100) / 100
        const anchorName = formatAnchorDisplayName(r.anchorName)
        const unassigned = isUnassignedAnchorName(String(r.anchorName ?? ''))
        const manual = r.attributionSource === 'manual_override'

        if (offlineMode) {
          return (
            <article
              key={expandKey}
              className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-rose-100/80 bg-white p-3 shadow-sm shadow-rose-100/30"
            >
              <div className="min-w-0 border-b border-rose-50 pb-2">
                <p className="truncate font-mono text-[12px] font-semibold text-slate-900" title={dealKey}>
                  {dealKey}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">{displayCell(r.payTime ?? r.orderTime)}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Tag className="bg-indigo-50 text-indigo-700">线下成交</Tag>
                  <Tag className="bg-violet-50 text-violet-700">{anchorName}</Tag>
                </div>
              </div>
              <div className="mt-2 flex flex-1 flex-col gap-0.5">
                <FieldRow label="客户">
                  <BuyerDisplay nickname={nick === '—' ? '未知' : nick} />
                </FieldRow>
                <FieldRow label="支付金额">
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(pay)}</span>
                </FieldRow>
                <FieldRow label="退款金额">
                  <span className="font-semibold text-rose-600">{formatMoney(refund)}</span>
                </FieldRow>
                <FieldRow label="净金额">{formatMoney(net)}</FieldRow>
                <FieldRow label="状态">{displayCell(r.orderStatus)}</FieldRow>
              </div>
              {r.attributedBy ? (
                <div className="mt-2 border-t border-rose-50 pt-2">
                  <button
                    type="button"
                    className="text-[11px] font-medium text-rose-700"
                    onClick={() => toggleExpand(expandKey)}
                  >
                    {expanded ? '收起详情' : '展开详情'}
                  </button>
                  {expanded ? (
                    <div className="mt-1">
                      <FieldRow label="操作人">{String(r.attributedBy)}</FieldRow>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          )
        }

        return (
          <article
            key={`${orderNo}-${idx}`}
            className={`flex h-full min-w-0 flex-col overflow-hidden rounded-xl border p-3 shadow-sm ${
              rowBlocked
                ? 'border-red-200 bg-red-50/30 shadow-red-100/30'
                : 'border-rose-100/80 bg-white shadow-rose-100/30'
            }`}
          >
            <div className="flex min-w-0 items-start justify-between gap-2 border-b border-rose-50 pb-2">
              <div className="min-w-0 flex-1">
                <p
                  className="truncate font-mono text-[12px] font-semibold text-slate-900"
                  title={displayCell(orderNo)}
                >
                  {displayCell(orderNo)}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">{displayCell(r.orderTime)}</p>
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
              {!r.includedInGmv ? (
                <Tag className="bg-slate-100 text-slate-600">状态未成交</Tag>
              ) : (
                <Tag className="bg-emerald-50 text-emerald-700">正常订单</Tag>
              )}
              {Boolean(r.afterSaleStatus && displayCell(r.afterSaleStatus) !== '—') ? (
                <Tag className="bg-amber-50 text-amber-800">售后</Tag>
              ) : null}
              {r.isQualityReturn ? <Tag className="bg-rose-100 text-rose-700">品退</Tag> : null}
              {unassigned ? <Tag className="bg-amber-100 text-amber-900">未归属</Tag> : null}
              {manual ? <Tag className="bg-violet-50 text-violet-700">手动指定</Tag> : null}
            </div>

            <div className="mt-2 flex flex-1 flex-col gap-0.5">
              <FieldRow label="买家">
                <BuyerDisplay nickname={nick === '—' ? '未知' : nick} />
              </FieldRow>
              <FieldRow label="商品">
                <span className="line-clamp-2 break-words text-right" title={displayCell(r.productName)}>
                  {displayCell(r.productName)}
                </span>
              </FieldRow>
              <FieldRow label={amountMode === 'signed' ? '已签收金额' : '支付金额'}>
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {formatMoney(
                    Number(
                      amountMode === 'signed'
                        ? (r.signedAmount ?? 0)
                        : (r.merchantReceivableAmount ?? 0),
                    ),
                  )}
                </span>
              </FieldRow>
              <FieldRow label="退款金额">
                <span className="font-semibold text-rose-600">
                  {formatMoney(Number(r.refundAmount ?? r.productRefundAmount ?? 0))}
                </span>
              </FieldRow>
              <FieldRow label="订单状态">{displayCell(r.orderStatus)}</FieldRow>
              <FieldRow label="售后状态">{displayCell(r.afterSaleStatus)}</FieldRow>
              <FieldRow label="来源直播号">
                <span className="truncate" title={displayCell(r.liveAccountName)}>
                  {displayCell(r.liveAccountName)}
                </span>
              </FieldRow>
              <FieldRow label="归属主播">
                <span className="truncate" title={anchorName}>
                  {anchorName}
                </span>
              </FieldRow>
            </div>

            <div className="mt-2 border-t border-rose-50 pt-2">
              <button
                type="button"
                className="text-[11px] font-medium text-rose-700"
                onClick={() => toggleExpand(expandKey)}
              >
                {expanded ? '收起详情' : '展开详情'}
              </button>
              {expanded ? (
                <div className="mt-1.5 space-y-0.5">
                  {amountMode === 'signed' ? (
                    <FieldRow label="支付金额">
                      {formatMoney(Number(r.merchantReceivableAmount ?? 0))}
                    </FieldRow>
                  ) : null}
                  <FieldRow label="售后原因">
                    <span className="break-words text-right">{reason || '—'}</span>
                  </FieldRow>
                  <FieldRow label="状态说明">{displayCell(r.gmvExcludeReason)}</FieldRow>
                  <FieldRow label="销售状态">
                    {r.includedInGmv ? '本期支付有效' : '状态未成交'}
                  </FieldRow>
                  {r.isQualityReturn ? (
                    <FieldRow label="品退归属主播">
                      {formatAnchorDisplayName(r.qualityAttributionAnchorName || r.anchorName)}
                    </FieldRow>
                  ) : null}
                  <FieldRow label="归属来源">
                    <span className="break-words text-right">
                      {formatAttributionBasis(r.attributionSource, r.attributionExplain)}
                    </span>
                  </FieldRow>
                </div>
              ) : null}
              {manualAnchorAssign ? (
                <div className="mt-2 min-w-0">
                  <p className="mb-1 text-[11px] text-slate-500">指定主播</p>
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
                </div>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
