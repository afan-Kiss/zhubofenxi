import React, { useCallback, useState } from 'react'
import { apiRequest } from '../../lib/api'
import {
  formatIntegerMoney,
  formatOrderCount,
  formatRatePercent,
} from './operationsReportFormatters'
import type { OperationsBiDrillPayload, OperationsBiDrillOrderRow } from '../../pages/operations/operationsBiDrillTypes'
import { OperationsViewportModal } from './OperationsViewportModal'

interface Props {
  open: boolean
  loading: boolean
  payload: OperationsBiDrillPayload | null
  page: number
  onClose: () => void
  onPageChange: (page: number) => void
}

async function openQianfanDetail(orderNo: string) {
  const res = await apiRequest<{ openUrl: string }>('/api/board/qianfan-order-detail-ticket', {
    method: 'POST',
    body: JSON.stringify({ orderNo }),
  })
  window.open(res.openUrl, '_blank', 'noopener,noreferrer')
}

function displayDash(value: string | null | undefined): string {
  const t = value?.trim()
  return t ? t : '—'
}

function CopyOrderButton({ orderNo }: { orderNo: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(orderNo)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }, [orderNo])

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      className="mt-0.5 text-[11px] text-slate-500 hover:text-rose-700"
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function StatusTag({ text, tone }: { text: string; tone: 'rose' | 'slate' | 'amber' }) {
  const cls =
    tone === 'rose'
      ? 'bg-rose-50 text-rose-800 ring-rose-100'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-800 ring-amber-100'
        : 'bg-slate-100 text-slate-700 ring-slate-200'
  return (
    <span className={`inline-block max-w-full break-words rounded-full px-2 py-0.5 text-[11px] ring-1 ${cls}`}>
      {text}
    </span>
  )
}

export const OperationsBiDrillDrawer: React.FC<Props> = ({
  open,
  loading,
  payload,
  page,
  onClose,
  onPageChange,
}) => {
  const [openingOrder, setOpeningOrder] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  const handleOpenQianfan = async (orderNo: string) => {
    setOpeningOrder(orderNo)
    setOpenError(null)
    try {
      await openQianfanDetail(orderNo)
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : '打开千帆订单详情失败')
    } finally {
      setOpeningOrder(null)
    }
  }

  const isAfterSaleDrill =
    payload?.title.includes('退货') ||
    payload?.title.includes('退款') ||
    payload?.title.includes('售后')

  return (
    <OperationsViewportModal
      open={open}
      onClose={onClose}
      labelledBy="ops-bi-drill-title"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 pr-2">
            <h2 id="ops-bi-drill-title" className="text-base font-semibold text-slate-900">
              {payload?.title ?? '订单明细'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{payload?.subtitle}</p>
            {payload?.explanation ? (
              <p className="mt-2 text-xs text-slate-600">{payload.explanation}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600"
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
          {loading && !payload ? (
            <p className="py-8 text-center text-sm text-slate-500">正在加载订单明细…</p>
          ) : null}
          {openError ? <p className="mb-3 text-sm text-amber-700">{openError}</p> : null}

          {payload ? (
            <div className="space-y-3">
              {payload.filters.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {payload.filters.map((f) => (
                    <span
                      key={`${f.label}-${f.value}`}
                      className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700"
                    >
                      {f.label}：{f.value}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Metric label="订单数" value={formatOrderCount(payload.summary.orderCount)} />
                <Metric
                  label="有效成交金额"
                  value={formatIntegerMoney(payload.summary.validAmountYuan)}
                />
                {isAfterSaleDrill ? (
                  <>
                    <Metric
                      label="退款/退货订单"
                      value={formatOrderCount(payload.summary.productReturnOrderCount)}
                    />
                    <Metric
                      label="退货单率"
                      value={formatRatePercent(payload.summary.productReturnRate)}
                    />
                  </>
                ) : null}
              </div>

              {payload.dataQuality.warnings.map((w) => (
                <p key={w} className="text-xs text-amber-700">
                  {w}
                </p>
              ))}

              {payload.rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
                  没有找到符合条件的订单
                </div>
              ) : (
                <>
                  <div className="space-y-2 md:hidden">
                    {payload.rows.map((row) => (
                      <MobileOrderCard
                        key={row.orderId}
                        row={row}
                        openingOrder={openingOrder}
                        onOpenQianfan={handleOpenQianfan}
                      />
                    ))}
                  </div>

                  <div className="hidden overflow-hidden rounded-xl border border-slate-200 md:block">
                    <div className="max-h-[min(52vh,520px)] overflow-y-auto overflow-x-hidden">
                      <table className="w-full table-fixed border-collapse text-left text-xs">
                        <colgroup>
                          <col className="w-[10%]" />
                          <col className="w-[9%]" />
                          <col className="w-[11%]" />
                          <col className="w-[7%]" />
                          <col className="w-[7%]" />
                          <col className="w-[16%]" />
                          <col className="w-[8%]" />
                          <col className="w-[8%]" />
                          <col className="w-[8%]" />
                          <col className="w-[10%]" />
                          <col className="w-[6%]" />
                        </colgroup>
                        <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 shadow-[0_1px_0_#e2e8f0]">
                          <tr>
                            <th className="px-2 py-2 font-medium">支付时间</th>
                            <th className="px-2 py-2 font-medium">买家昵称</th>
                            <th className="px-2 py-2 font-medium">订单号</th>
                            <th className="px-2 py-2 font-medium">主播</th>
                            <th className="px-2 py-2 font-medium">店铺</th>
                            <th className="px-2 py-2 font-medium">商品</th>
                            <th className="px-2 py-2 text-right font-medium">成交金额</th>
                            <th className="px-2 py-2 text-right font-medium">退款金额</th>
                            <th className="px-2 py-2 font-medium">售后状态</th>
                            <th className="px-2 py-2 font-medium">售后原因</th>
                            <th className="px-2 py-2 font-medium">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payload.rows.map((row) => (
                            <tr key={row.orderId} className="border-t border-slate-100 align-top">
                              <td className="px-2 py-2 break-words text-slate-700">
                                {displayDash(row.payTime)}
                              </td>
                              <td className="px-2 py-2 break-words text-slate-800">
                                {displayDash(row.buyerNickname ?? row.buyerDisplayName)}
                              </td>
                              <td className="px-2 py-2">
                                <div className="break-all font-mono text-[11px] text-slate-700">
                                  {row.orderNo}
                                </div>
                                <CopyOrderButton orderNo={row.orderNo} />
                              </td>
                              <td className="px-2 py-2 break-words">{displayDash(row.anchorName)}</td>
                              <td className="px-2 py-2 break-words">{displayDash(row.shopName)}</td>
                              <td className="px-2 py-2 break-words text-slate-700">
                                {row.productName}
                                {row.skuName && row.skuName !== '—' ? (
                                  <span className="text-slate-500"> / {row.skuName}</span>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 text-right font-medium text-slate-900">
                                {formatIntegerMoney(row.validAmountYuan ?? 0)}
                              </td>
                              <td className="px-2 py-2 text-right font-semibold text-rose-700">
                                {(row.productRefundAmountYuan ?? 0) > 0
                                  ? formatIntegerMoney(row.productRefundAmountYuan ?? 0)
                                  : '—'}
                              </td>
                              <td className="px-2 py-2">
                                {row.afterSaleStatus ? (
                                  <StatusTag text={row.afterSaleStatus} tone="amber" />
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-2 py-2 break-words">
                                {row.normalizedAfterSalesReason ? (
                                  <StatusTag text={row.normalizedAfterSalesReason} tone="slate" />
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-2 py-2">
                                <QianfanButton
                                  row={row}
                                  openingOrder={openingOrder}
                                  onOpen={handleOpenQianfan}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {payload.pagination.totalPages > 1 ? (
                <div className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    disabled={page <= 1 || loading}
                    onClick={() => onPageChange(page - 1)}
                    className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
                  >
                    上一页
                  </button>
                  <span className="text-slate-600">
                    第 {page} / {payload.pagination.totalPages} 页（共 {payload.pagination.total} 条）
                  </span>
                  <button
                    type="button"
                    disabled={page >= payload.pagination.totalPages || loading}
                    onClick={() => onPageChange(page + 1)}
                    className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </OperationsViewportModal>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}

const QianfanButton: React.FC<{
  row: OperationsBiDrillOrderRow
  openingOrder: string | null
  onOpen: (orderNo: string) => void
}> = ({ row, openingOrder, onOpen }) =>
  row.qianfanDetailAvailable ? (
    <button
      type="button"
      disabled={openingOrder === row.orderNo}
      onClick={() => void onOpen(row.orderNo)}
      className="whitespace-nowrap text-rose-700 hover:underline disabled:opacity-50"
    >
      {openingOrder === row.orderNo ? '打开中…' : '打开详情'}
    </button>
  ) : (
    <span className="text-slate-400">暂不可用</span>
  )

const MobileOrderCard: React.FC<{
  row: OperationsBiDrillOrderRow
  openingOrder: string | null
  onOpenQianfan: (orderNo: string) => void
}> = ({ row, openingOrder, onOpenQianfan }) => (
  <div className="rounded-xl border border-slate-200 p-3 text-xs">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{displayDash(row.payTime)}</p>
        <p className="mt-1 text-slate-600">
          买家：{displayDash(row.buyerNickname ?? row.buyerDisplayName)}
        </p>
        <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{row.orderNo}</p>
        <p className="mt-1 break-words text-slate-700">{row.productName ?? '—'}</p>
        <p className="mt-1 font-semibold text-slate-900">
          成交 {formatIntegerMoney(row.validAmountYuan ?? 0)}
        </p>
        {(row.productRefundAmountYuan ?? 0) > 0 ? (
          <p className="mt-0.5 font-semibold text-rose-700">
            退款 {formatIntegerMoney(row.productRefundAmountYuan ?? 0)}
          </p>
        ) : null}
      </div>
      <QianfanButton row={row} openingOrder={openingOrder} onOpen={onOpenQianfan} />
    </div>
    {row.afterSaleStatus ? (
      <p className="mt-2">
        <StatusTag text={row.afterSaleStatus} tone="amber" />
      </p>
    ) : null}
    {row.normalizedAfterSalesReason ? (
      <p className="mt-1">
        <StatusTag text={row.normalizedAfterSalesReason} tone="slate" />
      </p>
    ) : null}
  </div>
)
