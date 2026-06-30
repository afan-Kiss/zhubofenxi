import React, { useCallback, useEffect, useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import { apiRequest } from '../../lib/api'

interface ExportMeta {
  earliestOrderDate: string | null
  today: string
  defaultStartDate: string | null
  defaultEndDate: string
  orderCountInRange: number
  afterSalesPendingCount: number
}

interface Props {
  startDate: string
  endDate: string
}

export const AnchorAuditExportPanel: React.FC<Props> = ({ startDate, endDate }) => {
  const [meta, setMeta] = useState<ExportMeta | null>(null)
  const [exportStart, setExportStart] = useState(startDate)
  const [exportEnd, setExportEnd] = useState(endDate)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const loadMeta = useCallback(async () => {
    try {
      const data = await apiRequest<ExportMeta>(
        `/export/anchor-audit/meta?startDate=${encodeURIComponent(exportStart)}&endDate=${encodeURIComponent(exportEnd)}`,
      )
      setMeta(data)
    } catch {
      setMeta(null)
    }
  }, [exportStart, exportEnd])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    setExportEnd(endDate)
  }, [endDate])

  const useEarliestToToday = () => {
    if (meta?.earliestOrderDate) {
      setExportStart(meta.earliestOrderDate)
      setExportEnd(meta.today)
    }
  }

  const download = async (kind: 'xlsx' | 'json') => {
    setLoading(true)
    setMessage(null)
    try {
      const qs = `startDate=${encodeURIComponent(exportStart)}&endDate=${encodeURIComponent(exportEnd)}`
      if (kind === 'json') {
        const data = await apiRequest<Record<string, unknown>>(`/export/anchor-audit.json?${qs}`)
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `核算导出_${exportStart}_${exportEnd}.json`
        a.click()
        URL.revokeObjectURL(url)
        setMessage('JSON 已下载')
      } else {
        const res = await fetch(`/api/export/anchor-audit.xlsx?${qs}`, { credentials: 'include' })
        if (!res.ok) throw new Error(`导出失败 HTTP ${res.status}`)
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `核算导出_${exportStart}_${exportEnd}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
        setMessage('Excel 已下载')
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '导出失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4"
      data-testid="anchor-audit-export"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">导出核算数据</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            导出的数据包含订单、售后、主播归属、排班和实际到账，用来人工复核。默认从系统最早订单开始导出。
            实际到账按订单支付日期归属并扣累计退款；经营总览退款按退款发生日期统计，两数可能不同。
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">
          开始日期
          <input
            type="date"
            value={exportStart}
            onChange={(e) => setExportStart(e.target.value)}
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          结束日期
          <input
            type="date"
            value={exportEnd}
            onChange={(e) => setExportEnd(e.target.value)}
            className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={useEarliestToToday}
          className="rounded bg-slate-100 px-3 py-1.5 text-xs hover:bg-slate-200"
        >
          从最早日期到今天
        </button>
      </div>

      {meta ? (
        <div className="mb-3 text-xs text-slate-500">
          数据库最早订单：{meta.earliestOrderDate ?? '—'} · 当前范围订单约 {meta.orderCountInRange} 笔
          {meta.afterSalesPendingCount > 0
            ? ` · 售后待确认 ${meta.afterSalesPendingCount} 笔`
            : ''}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading || !exportStart}
          onClick={() => void download('xlsx')}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <FileSpreadsheet size={14} />
          导出 Excel
        </button>
        <button
          type="button"
          disabled={loading || !exportStart}
          onClick={() => void download('json')}
          className="inline-flex items-center gap-1 rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
        >
          <Download size={14} />
          导出 JSON
        </button>
      </div>

      {message ? <p className="mt-2 text-xs text-slate-600">{message}</p> : null}
    </section>
  )
}
