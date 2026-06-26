import React, { useState } from 'react'
import { apiRequest } from '../../lib/api'
import {
  formatIntegerMoney,
  formatOrderCount,
  formatRatePercent,
} from './operationsReportFormatters'
import type { OperationsBiDrillPayload, OperationsBiDrillOrderRow } from '../../pages/operations/operationsBiDrillTypes'

interface Props {
  open: boolean
  loading: boolean
  error: string | null
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

export const OperationsBiDrillDrawer: React.FC<Props> = ({
  open,
  loading,
  error,
  payload,
  page,
  onClose,
  onPageChange,
}) => {
  const [openingOrder, setOpeningOrder] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (!open) return null

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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-stretch md:justify-end">
      <div className="flex h-[92vh] w-full max-w-full flex-col rounded-t-2xl bg-white shadow-xl md:h-full md:max-w-4xl md:rounded-none">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 pr-2">
            <h2 className="text-base font-semibold text-slate-900">
              {payload?.title ?? '数据来源'}
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

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {loading && !payload ? (
            <p className="text-sm text-slate-500">正在加载组成订单…</p>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {openError ? <p className="text-sm text-amber-700">{openError}</p> : null}

          {payload ? (
            <>
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
                <Metric
                  label="商品退货订单"
                  value={formatOrderCount(payload.summary.productReturnOrderCount)}
                />
                <Metric
                  label="商品退货率"
                  value={formatRatePercent(payload.summary.productReturnRate)}
                />
              </div>

              {payload.dataQuality.warnings.map((w) => (
                <p key={w} className="text-xs text-amber-700">
                  {w}
                </p>
              ))}

              {payload.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">没有找到组成订单。</p>
              ) : (
                <>
                  <div className="space-y-2 md:hidden">
                    {payload.rows.map((row) => (
                      <MobileOrderCard
                        key={row.orderId}
                        row={row}
                        expanded={expandedId === row.orderId}
                        onToggle={() =>
                          setExpandedId((id) => (id === row.orderId ? null : row.orderId))
                        }
                        openingOrder={openingOrder}
                        onOpenQianfan={handleOpenQianfan}
                      />
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
                    <table className="min-w-[900px] w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-2 py-2">支付时间</th>
                          <th className="px-2 py-2">订单号</th>
                          <th className="px-2 py-2">主播</th>
                          <th className="px-2 py-2">店铺</th>
                          <th className="px-2 py-2">商品</th>
                          <th className="px-2 py-2">有效成交金额</th>
                          <th className="px-2 py-2">商品退款</th>
                          <th className="px-2 py-2">售后原因</th>
                          <th className="px-2 py-2">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payload.rows.map((row) => (
                          <tr key={row.orderId} className="border-t border-slate-100">
                            <td className="px-2 py-2">{row.payTime ?? '—'}</td>
                            <td className="px-2 py-2 font-mono">{row.orderNo}</td>
                            <td className="px-2 py-2">{row.anchorName ?? '—'}</td>
                            <td className="px-2 py-2">{row.shopName ?? '—'}</td>
                            <td className="px-2 py-2">
                              {row.productName}
                              {row.skuName ? ` / ${row.skuName}` : ''}
                            </td>
                            <td className="px-2 py-2">
                              {formatIntegerMoney(row.validAmountYuan ?? 0)}
                            </td>
                            <td className="px-2 py-2">
                              {formatIntegerMoney(row.productRefundAmountYuan ?? 0)}
                            </td>
                            <td className="px-2 py-2">{row.normalizedAfterSalesReason ?? '—'}</td>
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
                    第 {page} / {payload.pagination.totalPages} 页
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
            </>
          ) : null}
        </div>
      </div>
    </div>
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
      className="text-rose-700 hover:underline disabled:opacity-50"
    >
      {openingOrder === row.orderNo ? '打开中…' : '打开千帆订单详情'}
    </button>
  ) : (
    <span className="text-slate-400">暂不可用</span>
  )

const MobileOrderCard: React.FC<{
  row: OperationsBiDrillOrderRow
  expanded: boolean
  onToggle: () => void
  openingOrder: string | null
  onOpenQianfan: (orderNo: string) => void
}> = ({ row, expanded, onToggle, openingOrder, onOpenQianfan }) => (
  <div className="rounded-xl border border-slate-200 p-3 text-xs">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{row.payTime ?? '—'}</p>
        <p className="mt-1 truncate text-slate-700">{row.productName ?? '—'}</p>
        <p className="mt-1 font-semibold text-slate-900">
          {formatIntegerMoney(row.validAmountYuan ?? 0)}
        </p>
      </div>
      <QianfanButton row={row} openingOrder={openingOrder} onOpen={onOpenQianfan} />
    </div>
    <button type="button" onClick={onToggle} className="mt-2 text-slate-500 underline">
      {expanded ? '收起详情' : '展开详情'}
    </button>
    {expanded ? (
      <div className="mt-2 space-y-1 text-slate-600">
        <p>订单号：{row.orderNo}</p>
        <p>主播：{row.anchorName ?? '—'}</p>
        <p>店铺：{row.shopName ?? '—'}</p>
        <p>商品退款：{formatIntegerMoney(row.productRefundAmountYuan ?? 0)}</p>
        <p>售后原因：{row.normalizedAfterSalesReason ?? '—'}</p>
      </div>
    ) : null}
  </div>
)
