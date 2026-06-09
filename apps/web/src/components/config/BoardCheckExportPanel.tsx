import React, { useCallback, useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { apiRequest } from '../../lib/api'

interface ExportMeta {
  startTime: string | null
  endTime: string | null
  orderCount: number
  afterSaleCount: number
  qualityIssueCount: number
  liveSessionCount: number
  lastSyncedAt: string | null
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatSyncedRange(meta: ExportMeta | null): string {
  if (!meta) return '正在读取同步范围…'
  if (meta.orderCount <= 0) return '暂无已同步订单数据'
  const range =
    meta.startTime && meta.endTime ? `${meta.startTime} ~ ${meta.endTime}` : '时间范围未知'
  return `${range} · 共 ${meta.orderCount} 单`
}

export const BoardCheckExportPanel: React.FC = () => {
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<ExportMeta | null>(null)
  const [metaError, setMetaError] = useState<string | null>(null)

  const loadMeta = useCallback(async () => {
    try {
      const data = await apiRequest<ExportMeta>('/api/board/export-all-synced-check/meta')
      setMeta(data)
      setMetaError(null)
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : '读取同步范围失败')
    }
  }, [])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  const exportAllSynced = async () => {
    setExporting(true)
    setMessage('正在生成全部已同步数据核对包…')
    setError(null)
    try {
      const res = await fetch('/api/board/export-all-synced-check', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'allSynced' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { message?: string }).message ?? `导出失败（HTTP ${res.status}）`)
      }
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = /filename\*=UTF-8''([^;]+)/i.exec(cd)
      const filename = match
        ? decodeURIComponent(match[1])
        : `全部已同步数据核对包_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.xlsx`
      downloadBlob(blob, filename)
      setMessage('全部已同步数据核对包已下载')
      void loadMeta()
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出核对包失败')
      setMessage(null)
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-rose-100/60 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">数据核对导出</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        导出系统当前已同步到本地的全部数据，生成 Excel 核对包。你可以把这个核对包和官方后台导出的订单、售后、直播场次等
        Excel 一起交给外部核对，检查系统统计是否准确。
      </p>
      <p className="mt-2 text-[11px] text-slate-600">
        系统已同步数据范围：
        <span className="font-medium text-slate-800">{formatSyncedRange(meta)}</span>
      </p>
      {metaError ? (
        <p className="mt-1 text-[11px] text-amber-700">{metaError}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={exporting || (meta != null && meta.orderCount <= 0)}
          onClick={() => void exportAllSynced()}
          className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-2 text-xs font-medium text-white shadow-sm hover:bg-rose-600 disabled:opacity-50"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {exporting ? '正在生成核对包…' : '导出全部已同步数据核对包'}
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
        不受当前页面日期筛选影响。导出内容来自本地已同步数据，不会重新请求小红书接口。
      </p>
      {exporting ? (
        <p className="mt-2 animate-pulse text-xs text-rose-600">正在生成全部已同步数据核对包…</p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
      {message && !error ? <p className="mt-2 text-xs text-emerald-700">{message}</p> : null}
    </section>
  )
}
