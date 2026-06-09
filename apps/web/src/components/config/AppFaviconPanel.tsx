import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { applyAppFavicon } from '../../lib/app-favicon'

export const AppFaviconPanel: React.FC = () => {
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiRequest<{ appFaviconPath: string }>('/api/settings/app-favicon')
      setPath(res.appFaviconPath ?? '')
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : '加载失败' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await apiRequest<{ appFaviconPath: string; message?: string }>(
        '/api/settings/app-favicon',
        {
          method: 'PUT',
          body: JSON.stringify({ appFaviconPath: path.trim() }),
        },
      )
      setPath(res.appFaviconPath ?? '')
      applyAppFavicon(Date.now())
      setMessage({ type: 'ok', text: res.message ?? '已保存' })
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof Error ? e.message : '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">网页标签页图标</h3>
      <p className="mt-1 text-xs text-slate-500">
        填写本机图标文件的绝对路径，浏览器通过服务端接口读取，不会把 file:// 路径写进页面。
      </p>
      <p className="mt-1 text-[10px] text-slate-400">
        支持 .ico .png .jpg .jpeg .svg .webp。示例：C:\Users\Administrator\Desktop\logo.ico
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

      {loading ? (
        <p className="mt-3 text-xs text-slate-500">加载中…</p>
      ) : (
        <div className="mt-3 space-y-2">
          <label className="text-xs text-slate-600">本地图标路径</label>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="例如 E:\主播分析软件\assets\logo.ico"
            className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存图标路径'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                applyAppFavicon(Date.now())
                setMessage({ type: 'ok', text: '已刷新标签页图标预览' })
              }}
              className="rounded border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              刷新预览
            </button>
          </div>
          <p className="text-[10px] text-slate-400">
            接口地址：GET /api/app/favicon（保存后自动带时间戳刷新）
          </p>
        </div>
      )}
    </section>
  )
}
