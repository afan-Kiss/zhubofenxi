import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Calendar, Copy, Plus, RefreshCw, Save, Wand2 } from 'lucide-react'
import { apiRequest } from '../../lib/api'

interface ScheduleRow {
  id?: string
  anchorName: string
  shopName: string
  liveRoomName: string
  startTime: string
  endTime: string
  source?: string
  enabled: boolean
  note?: string | null
}

interface ScheduleResponse {
  ok: boolean
  date: string
  schedules: Array<
    ScheduleRow & {
      startAt: string
      endAt: string
    }
  >
  warnings: string[]
}

const SHOP_OPTIONS = ['XY祥钰珠宝', '和田雅玉', '拾玉居和田玉', '祥钰珠宝']

export const AnchorSchedulePage: React.FC = () => {
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }))
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiRequest<ScheduleResponse>(`/anchor-schedules?date=${encodeURIComponent(date)}`)
      setRows(
        data.schedules.map((s) => ({
          anchorName: s.anchorName,
          shopName: s.shopName,
          liveRoomName: s.liveRoomName,
          startTime: s.startTime,
          endTime: s.endTime,
          source: s.source,
          enabled: s.enabled,
          note: s.note,
        })),
      )
      setWarnings(data.warnings ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载排班失败')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  const handleGenerateDefault = async () => {
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const data = await apiRequest<ScheduleResponse>('/anchor-schedules/generate-default', {
        method: 'POST',
        body: JSON.stringify({ date, overwrite: false }),
      })
      setRows(
        data.schedules.map((s) => ({
          anchorName: s.anchorName,
          shopName: s.shopName,
          liveRoomName: s.liveRoomName,
          startTime: s.startTime,
          endTime: s.endTime,
          source: s.source,
          enabled: s.enabled,
          note: s.note,
        })),
      )
      setWarnings(data.warnings ?? [])
      setMessage('已生成当天默认排班')
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCopyYesterday = async () => {
    const fromDate = new Date(`${date}T12:00:00+08:00`)
    fromDate.setDate(fromDate.getDate() - 1)
    const fromKey = fromDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    setSaving(true)
    setError(null)
    try {
      const data = await apiRequest<ScheduleResponse>('/anchor-schedules/copy', {
        method: 'POST',
        body: JSON.stringify({ fromDate: fromKey, toDate: date }),
      })
      setRows(
        data.schedules.map((s) => ({
          anchorName: s.anchorName,
          shopName: s.shopName,
          liveRoomName: s.liveRoomName,
          startTime: s.startTime,
          endTime: s.endTime,
          source: s.source,
          enabled: s.enabled,
          note: s.note,
        })),
      )
      setWarnings(data.warnings ?? [])
      setMessage(`已从 ${fromKey} 复制排班`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '复制失败')
    } finally {
      setSaving(false)
    }
  }

  const handleValidate = async () => {
    setError(null)
    try {
      const result = await apiRequest<{ ok: boolean; conflicts: Array<{ message: string }>; warnings: string[] }>(
        '/anchor-schedules/validate',
        {
          method: 'POST',
          body: JSON.stringify({ date, schedules: rows }),
        },
      )
      setWarnings([...(result.warnings ?? []), ...(result.conflicts?.map((c) => c.message) ?? [])])
      if (result.ok) setMessage('排班校验通过，无冲突')
      else setError('存在排班冲突，请修改后保存')
    } catch (e) {
      setError(e instanceof Error ? e.message : '校验失败')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const data = await apiRequest<ScheduleResponse>('/anchor-schedules', {
        method: 'POST',
        body: JSON.stringify({ date, schedules: rows }),
      })
      setRows(
        data.schedules.map((s) => ({
          anchorName: s.anchorName,
          shopName: s.shopName,
          liveRoomName: s.liveRoomName,
          startTime: s.startTime,
          endTime: s.endTime,
          source: s.source,
          enabled: s.enabled,
          note: s.note,
        })),
      )
      setWarnings(data.warnings ?? [])
      setMessage('排班已保存，当天主播数据将按新排班计算')
      await apiRequest('/board/anchor-pocket-summary/recalculate', {
        method: 'POST',
        body: JSON.stringify({ date }),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const updateRow = (index: number, patch: Partial<ScheduleRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        anchorName: '',
        shopName: 'XY祥钰珠宝',
        liveRoomName: 'XY祥钰珠宝',
        startTime: '14:30',
        endTime: '18:00',
        enabled: true,
        note: '',
      },
    ])
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4" data-testid="anchor-schedule-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link to="/anchors" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
            <ArrowLeft size={16} />
            返回主播业绩
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">每日直播排班</h1>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <Calendar size={16} />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleGenerateDefault()}
          disabled={saving || loading}
          className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200 disabled:opacity-50"
        >
          <Wand2 size={14} />
          生成默认排班
        </button>
        <button
          type="button"
          onClick={() => void handleCopyYesterday()}
          disabled={saving || loading}
          className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200 disabled:opacity-50"
        >
          <Copy size={14} />
          复制昨天
        </button>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200"
        >
          <Plus size={14} />
          新增排班
        </button>
        <button
          type="button"
          onClick={() => void handleValidate()}
          className="inline-flex items-center gap-1 rounded bg-amber-50 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-100"
        >
          检查冲突
        </button>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200"
        >
          <RefreshCw size={14} />
          刷新
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || loading}
          className="inline-flex items-center gap-1 rounded bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-50"
        >
          <Save size={14} />
          保存当天排班
        </button>
      </div>

      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
      {warnings.length > 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">主播</th>
              <th className="px-3 py-2">店铺/直播间</th>
              <th className="px-3 py-2">开始</th>
              <th className="px-3 py-2">结束</th>
              <th className="px-3 py-2">来源</th>
              <th className="px-3 py-2">备注</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.anchorName}-${index}`} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <input
                    value={row.anchorName}
                    onChange={(e) => updateRow(index, { anchorName: e.target.value })}
                    className="w-24 rounded border border-slate-200 px-2 py-1"
                    placeholder="主播名"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={row.liveRoomName}
                    onChange={(e) => {
                      const v = e.target.value
                      updateRow(index, { liveRoomName: v, shopName: v })
                    }}
                    className="rounded border border-slate-200 px-2 py-1"
                  >
                    {SHOP_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="time"
                    value={row.startTime}
                    onChange={(e) => updateRow(index, { startTime: e.target.value })}
                    className="rounded border border-slate-200 px-2 py-1"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="time"
                    value={row.endTime === '24:00' ? '23:59' : row.endTime}
                    onChange={(e) => {
                      const v = e.target.value === '23:59' ? '24:00' : e.target.value
                      updateRow(index, { endTime: v })
                    }}
                    className="rounded border border-slate-200 px-2 py-1"
                  />
                  {row.endTime === '24:00' ? <span className="ml-1 text-xs text-slate-500">24:00</span> : null}
                </td>
                <td className="px-3 py-2 text-slate-500">{row.source === 'manual' ? '手动' : '默认'}</td>
                <td className="px-3 py-2">
                  <input
                    value={row.note ?? ''}
                    onChange={(e) => updateRow(index, { note: e.target.value })}
                    className="w-full min-w-[8rem] rounded border border-slate-200 px-2 py-1"
                    placeholder="备注"
                  />
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  当天暂无排班，可点击「生成默认排班」
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
