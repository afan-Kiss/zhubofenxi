import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { Pagination } from '../ui/Pagination'
import { BoardDrawerShell } from './BoardDrawerShell'
import { UNMATCHED_OFFICIAL_QUALITY_HINT } from './OfficialQualitySyncNote'

interface MetricDetailData {
  metric: string
  title: string
  formulaText: string
  summary: {
    totalOrders: number
    matchedOrders: number
    rate: number
    rateText: string
    unmatchedOfficialQualityCount?: number
    description: string
  }
  tabs: Array<{ key: string; label: string; count: number }>
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  rows: Array<Record<string, string | number | boolean | null>>
}

interface Props {
  open: boolean
  onClose: () => void
  anchorId: string
  metric: 'qualityRefundRate' | 'signRate'
  startDate: string
  endDate: string
}

export const MetricDetailDrawer: React.FC<Props> = ({
  open,
  onClose,
  anchorId,
  metric,
  startDate,
  endDate,
}) => {
  const { formatMoney } = useAmountDisplay()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<MetricDetailData | null>(null)
  const [tab, setTab] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const load = useCallback(async () => {
    if (!open || !startDate || !endDate) return
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        metric,
        startDate,
        endDate,
        page: String(page),
        pageSize: String(pageSize),
      })
      if (tab) qs.set('tab', tab)
      const res = await apiRequest<MetricDetailData>(
        `/api/anchors/${encodeURIComponent(anchorId)}/metric-detail?${qs}`,
      )
      setData(res)
      if (!tab && res.tabs[0]) setTab(res.tabs[0].key)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [open, anchorId, metric, startDate, endDate, page, tab])

  useEffect(() => {
    setPage(1)
  }, [tab, metric, startDate, endDate])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <BoardDrawerShell open={open} onClose={onClose} title={data?.title ?? '指标明细'}>
      {loading && !data ? (
        <p className="py-8 text-center text-xs text-slate-400">加载中…</p>
      ) : data ? (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
            <p className="font-medium">{data.formulaText}</p>
            <p className="mt-2">{data.summary.description}</p>
            {metric === 'qualityRefundRate' &&
            Number(data.summary.unmatchedOfficialQualityCount ?? 0) > 0 ? (
              <p className="mt-2 text-amber-700">
                {UNMATCHED_OFFICIAL_QUALITY_HINT.replace(
                  '{count}',
                  String(data.summary.unmatchedOfficialQualityCount),
                )}
              </p>
            ) : null}
          </div>
          {data.tabs.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {data.tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    tab === t.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-2">下单时间</th>
                  <th className="px-2 py-2">订单号</th>
                  <th className="px-2 py-2">买家</th>
                  <th className="px-2 py-2">商品</th>
                  <th className="px-2 py-2">支付金额</th>
                  <th className="px-2 py-2">退款金额</th>
                  <th className="px-2 py-2">实际成交</th>
                  <th className="px-2 py-2">订单状态</th>
                  <th className="px-2 py-2">售后情况</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      {metric === 'signRate' && tab === 'unsigned'
                        ? '本期暂无未签收或售后订单'
                        : metric === 'qualityRefundRate'
                          ? '本期暂无品退订单'
                          : '暂无订单'}
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={String(row.displayOrderNo ?? row.orderNo)} className="border-t">
                      <td className="px-2 py-1.5">{String(row.orderTime)}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px]">
                        {String(row.displayOrderNo ?? row.officialOrderNo ?? row.orderNo)}
                      </td>
                      <td className="px-2 py-1.5">
                        <div>{String(row.buyerNickname)}</div>
                        <div className="text-[10px] text-slate-400">{String(row.buyerId)}</div>
                      </td>
                      <td className="max-w-[100px] truncate px-2 py-1.5">{String(row.productName)}</td>
                      <td className="px-2 py-1.5">{formatMoney(Number(row.payAmount))}</td>
                      <td className="px-2 py-1.5">{formatMoney(Number(row.refundAmount))}</td>
                      <td className="px-2 py-1.5">{formatMoney(Number(row.actualAmount))}</td>
                      <td className="px-2 py-1.5">{String(row.orderStatus)}</td>
                      <td className="px-2 py-1.5">{String(row.afterSaleStatus)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            total={data.pagination.total}
            pageSize={pageSize}
            onPage={setPage}
            disabled={loading}
          />
        </div>
      ) : (
        <p className="py-8 text-center text-xs text-red-600">加载失败</p>
      )}
    </BoardDrawerShell>
  )
}
