import React, { useState } from 'react'
import { Trash2, RefreshCw } from 'lucide-react'
import { apiRequest } from '../../lib/api'

export const BusinessDataMaintenancePanel: React.FC = () => {
  const [clearing, setClearing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const handleClear = async () => {
    const ok = window.confirm(
      '确定清空全部业务数据？\n\n将清空订单、直播、售后、品退与经营缓存，但会保留直播号名称与 Cookie。',
    )
    if (!ok) return

    setClearing(true)
    setMessage(null)
    try {
      const res = await apiRequest<{
        ok: boolean
        syncTriggered?: boolean
        cleared: Record<string, number>
        preserved: { liveAccounts: number; cookies: number }
      }>('/api/settings/data-maintenance/clear-business-data', {
        method: 'POST',
        body: JSON.stringify({ confirmPhrase: '清空' }),
      })
      window.dispatchEvent(new Event('business-data-cleared'))
      setMessage({
        type: 'ok',
        text: res.syncTriggered
          ? '业务数据已清空，直播号 Cookie 已保留。经营同步已自动启动，请到经营总览查看进度。'
          : '业务数据已清空，直播号 Cookie 已保留。请到经营总览点击「立即同步经营数据」。',
      })
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : '清空失败' })
    } finally {
      setClearing(false)
    }
  }

  const handleTriggerSync = async () => {
    setSyncing(true)
    try {
      const res = await apiRequest<{ message?: string }>(
        '/api/settings/data-maintenance/trigger-business-sync',
        { method: 'POST' },
      )
      setMessage({ type: 'ok', text: res.message ?? '经营同步已触发' })
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : '触发同步失败' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">数据维护</h3>
      <p className="mt-1 text-xs text-slate-500">
        清空订单、直播场次、售后、品退、经营缓存、买家排行缓存等业务数据，但保留直播号配置与 Cookie。
      </p>

      {message && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            message.type === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={clearing}
          onClick={() => void handleClear()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          <Trash2 size={14} />
          {clearing ? '清空中…' : '清空全部业务数据'}
        </button>
        <button
          type="button"
          disabled={syncing}
          onClick={() => void handleTriggerSync()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          {syncing ? '触发中…' : '立即同步经营数据'}
        </button>
      </div>
    </section>
  )
}
