import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Calendar, ChevronDown, Copy, MoreHorizontal, Plus, RefreshCw, Save, Trash2, Wand2 } from 'lucide-react'
import { apiRequest, API_PREFIX } from '../../lib/api'
import {
  conflictIndexes,
  rowConflictMessages,
  validateScheduleRows,
} from '../../lib/anchor-schedule-conflicts'
import { invalidateBoardLiveQueryCache } from '../../lib/board-live-query-cache'
import { useBoardLiveQuery } from '../../providers/BoardLiveQueryProvider'

function afterScheduleMutation(): void {
  invalidateBoardLiveQueryCache('anchor-schedule')
}

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
      confirmed?: boolean
    }
  >
  warnings: string[]
  hasManualDay?: boolean
  effectiveTable?: {
    date: string
    confirmed: boolean
    sourceSummary: { manualCount: number; generatedCount: number; virtualCount: number }
    rows: Array<ScheduleRow & { rowId: string; source: string }>
    warnings: string[]
  }
  shouldRefreshPerformance?: boolean
}

interface ConfirmStatus {
  date: string
  hasSchedule: boolean
  confirmed: boolean
  confirmedAt: string | null
  confirmedBy: string | null
}

const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
const yesterdayKey = () => {
  const d = new Date(`${todayKey()}T12:00:00+08:00`)
  d.setDate(d.getDate() - 1)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}

const SHOP_OPTIONS = ['XY祥钰珠宝', '和田雅玉', '拾玉居和田玉', '祥钰珠宝']
const DEFAULT_SHOP = 'XY祥钰珠宝'

function sourceLabel(source?: string): string {
  if (source === 'manual') return '人工排班'
  if (source === 'virtual_template') return '系统模板补齐'
  return '默认排班'
}

function defaultEndFromStart(startTime: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim())
  if (!m) return '18:00'
  const mins = Number(m[1]) * 60 + Number(m[2])
  if (mins >= 24 * 60) return '24:00'
  return '24:00'
}

export const AnchorSchedulePage: React.FC = () => {
  const { reload } = useBoardLiveQuery()
  const tableEndRef = useRef<HTMLTableRowElement>(null)
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }))
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmStatus, setConfirmStatus] = useState<ConfirmStatus | null>(null)
  const [todayStatus, setTodayStatus] = useState<ConfirmStatus | null>(null)
  const [yesterdayStatus, setYesterdayStatus] = useState<ConfirmStatus | null>(null)
  const [effectiveSummary, setEffectiveSummary] = useState<string | null>(null)
  const [scrollToNewRow, setScrollToNewRow] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  const validation = useMemo(() => validateScheduleRows(rows), [rows])
  const conflictRowSet = useMemo(() => conflictIndexes(validation.conflicts), [validation.conflicts])
  const hasBlockingIssues = validation.fieldErrors.length > 0 || validation.conflicts.length > 0

  const applyScheduleResponse = (data: ScheduleResponse) => {
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
    if (data.effectiveTable) {
      const t = data.effectiveTable
      setEffectiveSummary(
        `生效排班 ${t.rows.length} 条（人工 ${t.sourceSummary.manualCount} / 默认 ${t.sourceSummary.generatedCount} / 模板补齐 ${t.sourceSummary.virtualCount}）· ${t.confirmed ? '已确认' : '未确认'}`,
      )
    }
    if (data.shouldRefreshPerformance) {
      void reload()
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiRequest<ScheduleResponse>(`/anchor-schedules?date=${encodeURIComponent(date)}`)
      applyScheduleResponse(data)
      const cs = await apiRequest<ConfirmStatus>(`/anchor-schedules/confirm-status?date=${encodeURIComponent(date)}`)
      setConfirmStatus(cs)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载排班失败')
    } finally {
      setLoading(false)
    }
  }, [date, reload])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!scrollToNewRow) return
    tableEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setScrollToNewRow(false)
  }, [scrollToNewRow, rows.length])

  useEffect(() => {
    if (!moreOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [moreOpen])

  useEffect(() => {
    void (async () => {
      try {
        const [t, y] = await Promise.all([
          apiRequest<ConfirmStatus>(`/anchor-schedules/confirm-status?date=${todayKey()}`),
          apiRequest<ConfirmStatus>(`/anchor-schedules/confirm-status?date=${yesterdayKey()}`),
        ])
        setTodayStatus(t)
        setYesterdayStatus(y)
      } catch {
        // ignore
      }
    })()
  }, [date, message])

  const handleGenerateDefault = async () => {
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      const data = await apiRequest<ScheduleResponse>('/anchor-schedules/generate-default', {
        method: 'POST',
        body: JSON.stringify({ date, overwrite: false }),
      })
      applyScheduleResponse(data)
      setMessage('已生成当天默认排班')
      afterScheduleMutation()
      void reload()
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
      applyScheduleResponse(data)
      setMessage(`已从 ${fromKey} 复制排班`)
      afterScheduleMutation()
      void reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : '复制失败')
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async (confirm = false) => {
    if (hasBlockingIssues) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`${API_PREFIX}/anchor-schedules`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          schedules: rows.map((r) => ({
            ...r,
            source: 'manual',
          })),
          confirm,
        }),
      })
      const body = (await res.json()) as ScheduleResponse & {
        ok?: boolean
        message?: string
        conflicts?: Array<{ message: string }>
        data?: ScheduleResponse
      }
      const payload = body.data ?? body
      if (!res.ok || body.ok === false) {
        const conflictMsg = body.conflicts?.map((c) => c.message).join('；')
        throw new Error(conflictMsg || body.message || '保存失败')
      }
      applyScheduleResponse(payload as ScheduleResponse)
      setMessage(
        confirm
          ? '排班已保存并确认，系统已按新排班重新计算当天业绩。'
          : '排班已保存，系统已按新排班重新计算当天业绩。',
      )
      afterScheduleMutation()
      void reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirm = async (targetDate: string) => {
    setSaving(true)
    setError(null)
    try {
      await apiRequest('/anchor-schedules/confirm', {
        method: 'POST',
        body: JSON.stringify({ date: targetDate }),
      })
      if (targetDate === date) await load()
      setMessage(`${targetDate} 排班已确认`)
      afterScheduleMutation()
      void reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : '确认失败')
    } finally {
      setSaving(false)
    }
  }

  const updateRow = (index: number, patch: Partial<ScheduleRow>) => {
    setWarnings([])
    setRows((prev) =>
      prev.map((r, i) =>
        i === index
          ? {
              ...r,
              ...patch,
              source: 'manual',
            }
          : r,
      ),
    )
  }

  const deleteRow = (index: number) => {
    const row = rows[index]
    if (!row) return
    const label = row.anchorName.trim() || row.liveRoomName || '这条排班'
    if (
      !window.confirm(
        `确定删除「${label}」吗？保存后当天业绩会按新排班重算。`,
      )
    ) {
      return
    }
    setRows((prev) => prev.filter((_, i) => i !== index))
    setWarnings([])
  }

  const addRow = () => {
    setWarnings([])
    const last = rows[rows.length - 1]
    const shop = last?.shopName?.trim() || last?.liveRoomName?.trim() || DEFAULT_SHOP
    const startTime = last?.endTime === '24:00' ? '18:00' : last?.endTime?.trim() || '09:00'
    const endTime = last ? defaultEndFromStart(startTime) : '18:00'
    setRows((prev) => [
      ...prev,
      {
        anchorName: '',
        shopName: shop,
        liveRoomName: shop,
        startTime,
        endTime,
        enabled: true,
        note: '',
        source: 'manual',
      },
    ])
    setScrollToNewRow(true)
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
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            title="重新加载"
            className="rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </label>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-600">
        <span className="rounded border border-slate-200 px-2 py-1">
          当前日期：{confirmStatus?.confirmed ? '已确认' : '未确认'}
        </span>
        {date !== todayKey() ? (
          <span className="rounded border border-slate-200 px-2 py-1">
            今日：{todayStatus?.confirmed ? '已确认' : '未确认'}
          </span>
        ) : null}
      </div>

      <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
        编辑下方排班后点「保存并确认」，系统会按新排班重算当天业绩，并用于日报迟到判断。
        {effectiveSummary ? <span className="mt-1 block text-sky-800">{effectiveSummary}</span> : null}
      </div>

      {validation.conflicts.length > 0 ? (
        <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          当前排班有冲突，不能保存。请先调整或删除冲突行。
        </div>
      ) : null}

      {validation.fieldErrors.length > 0 ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {validation.fieldErrors.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200"
          >
            <Plus size={14} />
            新增
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
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200"
            >
              <MoreHorizontal size={14} />
              更多
              <ChevronDown size={14} />
            </button>
            {moreOpen ? (
              <div className="absolute left-0 top-full z-20 mt-1 min-w-[10rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false)
                    void handleGenerateDefault()
                  }}
                  disabled={saving || loading}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Wand2 size={14} />
                  生成默认排班
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false)
                    void handleSave(false)
                  }}
                  disabled={saving || loading || hasBlockingIssues}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Save size={14} />
                  仅保存（不确认）
                </button>
                {!confirmStatus?.confirmed ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false)
                      void handleConfirm(date)
                    }}
                    disabled={saving || rows.length === 0}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    仅确认当前日期
                  </button>
                ) : null}
                {date !== yesterdayKey() && !yesterdayStatus?.confirmed ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false)
                      void handleConfirm(yesterdayKey())
                    }}
                    disabled={saving}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    确认昨日排班
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleSave(true)}
          disabled={saving || loading || hasBlockingIssues}
          className="inline-flex items-center gap-1 rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          <Save size={14} />
          保存并确认
        </button>
      </div>

      {message ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div>
      ) : null}
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
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const isConflict = conflictRowSet.has(index)
              const rowTips = rowConflictMessages(index, validation.conflicts)
              const tip = rowTips.join('\n')
              return (
                <tr
                  key={`${row.anchorName}-${index}-${row.startTime}`}
                  ref={index === rows.length - 1 ? tableEndRef : undefined}
                  className={`border-t border-slate-100 ${isConflict ? 'bg-rose-50/80' : ''}`}
                  title={tip || undefined}
                >
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
                  <td className="px-3 py-2 text-slate-500">{sourceLabel(row.source)}</td>
                  <td className="px-3 py-2" title={tip || undefined}>
                    <input
                      value={row.note ?? ''}
                      onChange={(e) => updateRow(index, { note: e.target.value })}
                      className="w-full min-w-[8rem] rounded border border-slate-200 px-2 py-1"
                      placeholder={tip || '备注'}
                    />
                    {tip ? <p className="mt-1 text-xs text-rose-600">{tip}</p> : null}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => deleteRow(index)}
                      className="inline-flex items-center gap-1 rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </td>
                </tr>
              )
            })}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  当天暂无排班，可点「更多 → 生成默认排班」或「新增」
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
