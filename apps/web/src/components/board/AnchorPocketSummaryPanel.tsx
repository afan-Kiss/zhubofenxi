import React, { useEffect, useState } from 'react'
import { useAmountDisplay } from '../../providers/AmountDisplayProvider'
import { apiRequest } from '../../lib/api'
import { BOARD_LIVE_QUERY_INVALIDATE_EVENT } from '../../lib/board-live-query-cache'

export interface AnchorPocketRow {
  anchorName: string
  shopName: string
  sessionName: string
  performanceAmount: number
  refundFinishedAmount: number
  refundProcessingAmount: number
  pendingReceiveAmount: number
  actualPocketAmount: number
  brushAmount: number
  refundRate: number | null
  explainText: string
  actualStartText?: string | null
  actualEndText?: string | null
  detail?: {
    rawOrderCount: number
    performanceOrderCount: number
    brushOrderCount: number
    refundFinishedOrderCount: number
    refundProcessingOrderCount: number
    pendingReceiveOrderCount: number
  }
}

interface PocketSummary {
  caliber: {
    brushThreshold: number
    note: string
    settlementNote: string
  }
  anchors: AnchorPocketRow[]
  dataQualityWarnings: Array<{ type: string; message: string; count: number }>
}

interface Props {
  preset: string
  startDate: string
  endDate: string
}

function formatPocketLiveClock(row: AnchorPocketRow): string {
  const start = row.actualStartText?.trim()
  const end = row.actualEndText?.trim()
  if (start && end) return `${start}~${end}`
  if (start) return start
  const session = row.sessionName?.trim()
  return session || '—'
}

export const AnchorPocketSummaryPanel: React.FC<Props> = ({ preset, startDate, endDate }) => {
  const { formatMoney, formatRate } = useAmountDisplay()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<PocketSummary | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const bump = () => setRefreshKey((k) => k + 1)
    window.addEventListener(BOARD_LIVE_QUERY_INVALIDATE_EVENT, bump)
    return () => window.removeEventListener(BOARD_LIVE_QUERY_INVALIDATE_EVENT, bump)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({
      preset,
      startDate,
      endDate,
    })
    apiRequest<PocketSummary>(`/board/anchor-pocket-summary?${qs}`)
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败')
          setSummary(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [preset, startDate, endDate, refreshKey])

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="anchor-pocket-summary">
        <p className="text-sm text-slate-500">加载主播实际到账…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="rounded-xl border border-rose-200 bg-rose-50 p-4" data-testid="anchor-pocket-summary">
        <p className="text-sm text-rose-700">{error}</p>
      </section>
    )
  }

  const rows = summary?.anchors ?? []
  const caliber = summary?.caliber

  return (
    <section className="rounded-xl border border-slate-200 bg-white" data-testid="anchor-pocket-summary">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-base font-semibold text-slate-900">订单侧预计留下金额</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {caliber?.note ??
            '这是订单侧预计留下金额，不是平台结算到账金额；平台佣金、服务费、账期差异未计入。'}
        </p>
        {caliber?.settlementNote ? (
          <p className="mt-1 text-xs text-slate-400">{caliber.settlementNote}</p>
        ) : null}
      </div>

      {summary?.dataQualityWarnings?.length ? (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {summary.dataQualityWarnings.map((w) => (
            <p key={w.type}>{w.message}</p>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[12px] text-slate-500">
              <th className="px-3 py-2 font-medium">主播</th>
              <th className="px-3 py-2 font-medium">店铺</th>
              <th className="px-3 py-2 font-medium">场次</th>
              <th className="px-3 py-2 font-medium">开播</th>
              <th className="px-3 py-2 font-medium text-right">业绩内金额</th>
              <th className="px-3 py-2 font-medium text-right">已退款</th>
              <th className="px-3 py-2 font-medium text-right">售后处理中</th>
              <th className="px-3 py-2 font-medium text-right">未签收待确认</th>
              <th className="px-3 py-2 font-medium text-right">预计留下金额</th>
              <th className="px-3 py-2 font-medium text-right">刷单金额</th>
              <th className="px-3 py-2 font-medium text-right">退款率</th>
              <th className="px-3 py-2 font-medium">说明</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                  暂无数据
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.anchorName}
                  className="border-b border-slate-50 hover:bg-slate-50/80"
                  title={
                    row.detail
                      ? `业绩内 ${row.detail.performanceOrderCount} 单 · 刷单 ${row.detail.brushOrderCount} 单 · 退款完成 ${row.detail.refundFinishedOrderCount} 单`
                      : undefined
                  }
                >
                  <td className="px-3 py-2 font-medium text-slate-900">{row.anchorName}</td>
                  <td className="px-3 py-2 text-slate-600">{row.shopName}</td>
                  <td className="px-3 py-2 text-slate-600">{row.sessionName}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{formatPocketLiveClock(row)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.performanceAmount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-600">
                    {formatMoney(row.refundFinishedAmount)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                    {formatMoney(row.refundProcessingAmount)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {formatMoney(row.pendingReceiveAmount)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">
                    {formatMoney(row.actualPocketAmount)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                    {formatMoney(row.brushAmount)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatRate(row.refundRate)}
                  </td>
                  <td className="max-w-[12rem] px-3 py-2 text-xs leading-snug text-slate-500">
                    {row.explainText}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
