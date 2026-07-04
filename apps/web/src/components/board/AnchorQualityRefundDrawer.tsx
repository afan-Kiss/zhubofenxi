import React, { useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { Pagination } from '../ui/Pagination'
import { BoardDrawerShell } from './BoardDrawerShell'

interface QualityRefundDrillRow {
  orderNo: string
  buyerNickname: string
  orderTime: string
  qualityAttributionAnchorName?: string
  matchedLiveSessionStart?: string | null
  matchedLiveSessionEnd?: string | null
  qualitySourceLabel?: string
  qualityReasonText?: string
  qualityUnassignedReason?: string | null
  paymentAnchorName?: string
}

interface DrillData {
  anchorName: string
  attributionNote?: string
  stats: Record<string, unknown> | null
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  rows: QualityRefundDrillRow[]
}

interface Props {
  open: boolean
  onClose: () => void
  anchorName: string
  anchorId?: string
  preset?: string
  startDate: string
  endDate: string
}

export const AnchorQualityRefundDrawer: React.FC<Props> = ({
  open,
  onClose,
  anchorName,
  anchorId,
  preset,
  startDate,
  endDate,
}) => {
  const { formatCount } = useAmountDisplay()
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<DrillData | null>(null)
  const pageSize = 20

  useEffect(() => {
    if (!open) return
    setPage(1)
    setData(null)
    setError(null)
  }, [open, anchorName, anchorId, startDate, endDate, preset])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({
      startDate,
      endDate,
      page: String(page),
      pageSize: String(pageSize),
    })
    if (preset) qs.set('preset', preset)
    if (anchorId) qs.set('anchorId', anchorId)
    if (anchorName) qs.set('anchorName', anchorName)

    void apiRequest<DrillData>(`/api/board/anchor-quality-refund-drill?${qs}`, {
      signal: controller.signal,
    })
      .then((res) => setData(res))
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : '加载品退明细失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [open, anchorName, anchorId, preset, startDate, endDate, page])

  const qualityCount = Number(data?.stats?.qualityReturnCount ?? 0)

  return (
    <BoardDrawerShell
      open={open}
      onClose={onClose}
      title={`${anchorName} · 品退明细`}
      subtitle={`${startDate} ~ ${endDate}`}
      footer={
        data ? (
          <Pagination
            page={data.pagination.page}
            total={data.pagination.total}
            pageSize={data.pagination.pageSize}
            onPage={setPage}
          />
        ) : null
      }
    >
      {loading && !data ? (
        <p className="py-12 text-center text-sm text-slate-400">加载中…</p>
      ) : error ? (
        <p className="py-12 text-center text-sm text-red-600">{error}</p>
      ) : data ? (
        <div className="space-y-4">
          <div className="rounded-2xl bg-rose-50/60 p-4 text-xs text-slate-700">
            <p className="font-medium text-rose-900">
              品退订单数：{formatCount(qualityCount)}
            </p>
            <p className="mt-2 leading-relaxed">
              {data.attributionNote ??
                '品退按订单下单时间匹配主播开播场次归属，不按售后发生时间。'}
            </p>
          </div>
          {data.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">暂无品退订单</p>
          ) : (
            <ul className="space-y-3">
              {data.rows.map((row) => (
                <li
                  key={row.orderNo}
                  className="rounded-xl border border-rose-100 bg-white p-3 text-xs text-slate-700"
                >
                  <p className="font-medium text-slate-900">{row.orderNo}</p>
                  <p className="mt-1">买家：{row.buyerNickname || '—'}</p>
                  <p className="mt-1">下单时间：{row.orderTime || '—'}</p>
                  <p className="mt-1">
                    直播场次：
                    {row.matchedLiveSessionStart && row.matchedLiveSessionEnd
                      ? `${row.matchedLiveSessionStart} ~ ${row.matchedLiveSessionEnd}`
                      : '—'}
                  </p>
                  <p className="mt-1">归属主播：{row.qualityAttributionAnchorName || anchorName}</p>
                  <p className="mt-1">品退来源：{row.qualitySourceLabel || '—'}</p>
                  <p className="mt-1">品退原因：{row.qualityReasonText || '—'}</p>
                  {row.qualityUnassignedReason ? (
                    <p className="mt-1 text-amber-700">未归属原因：{row.qualityUnassignedReason}</p>
                  ) : null}
                  {row.paymentAnchorName ? (
                    <p className="mt-1 text-slate-500">支付归属主播：{row.paymentAnchorName}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </BoardDrawerShell>
  )
}
