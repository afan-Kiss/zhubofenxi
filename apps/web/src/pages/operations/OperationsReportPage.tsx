import React, { useState } from 'react'
import { BarChart3, Download } from 'lucide-react'
import { apiRequest } from '../../lib/api'

/**
 * 原运营报表入口：日报/周报/月报/榜单 UI 已停用（代码保留在同目录其他文件）。
 * 菜单更名为「上月对比」；提供 ChatGPT 分析 JSON 导出。
 */
export function OperationsReportPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastMeta, setLastMeta] = useState<string | null>(null)

  async function handleExport() {
    setLoading(true)
    setError(null)
    try {
      const data = await apiRequest<Record<string, unknown>>('/api/board/month-compare/ai-export')
      const meta = (data.meta ?? {}) as { asOfDate?: string; generatedAt?: string }
      const dateKey = meta.asOfDate ?? new Date().toISOString().slice(0, 10)
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `business-analysis-${dateKey}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setLastMeta(`已导出 business-analysis-${dateKey}.json（生成于 ${meta.generatedAt ?? ''}）`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6" data-testid="month-compare-placeholder">
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
          <BarChart3 className="h-6 w-6" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-slate-900">上月对比</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          系统负责算准经营与直播场次数据；导出 JSON 后交给 ChatGPT 做深度分析。原运营报表展示已停用。
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            type="button"
            data-testid="export-ai-analysis-json"
            disabled={loading}
            onClick={() => void handleExport()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <Download className="h-4 w-4" aria-hidden />
            {loading ? '正在生成…' : '导出 AI 分析数据'}
          </button>
          {lastMeta ? <p className="text-xs text-emerald-700">{lastMeta}</p> : null}
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-400">
          JSON 含本月同期 vs 上月同天数、近 7 天对比、场次/笔记/封面流量、异常场次与数据质量说明。不含主播能力评价文案。
        </p>
      </div>
    </div>
  )
}
