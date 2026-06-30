import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { apiRequest } from '../../lib/api'

export interface EffectiveScheduleRowView {
  rowId: string
  source: 'manual' | 'generated_default' | 'virtual_template'
  anchorName: string
  shopName: string
  liveRoomName: string
  startTime: string
  endTime: string
  enabled: boolean
  confirmed: boolean
  note?: string
}

export interface EffectiveScheduleTableView {
  date: string
  confirmed: boolean
  sourceSummary: {
    manualCount: number
    generatedCount: number
    virtualCount: number
  }
  rows: EffectiveScheduleRowView[]
  warnings: string[]
}

function sourceLabel(source: EffectiveScheduleRowView['source']): string {
  if (source === 'manual') return '人工排班'
  if (source === 'generated_default') return '默认排班'
  return '系统模板补齐'
}

function DayBlock({ table }: { table: EffectiveScheduleTableView }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-slate-800"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {table.date.replace(/-/g, '/')} · {table.confirmed ? '已确认' : '未确认'} · 人工{' '}
          {table.sourceSummary.manualCount} / 默认 {table.sourceSummary.generatedCount} / 模板补齐{' '}
          {table.sourceSummary.virtualCount}
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open ? (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1.5 text-left">主播</th>
                <th className="px-2 py-1.5 text-left">店铺</th>
                <th className="px-2 py-1.5 text-left">直播号</th>
                <th className="px-2 py-1.5 text-left">时段</th>
                <th className="px-2 py-1.5 text-left">来源</th>
                <th className="px-2 py-1.5 text-left">说明</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.rowId} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">{row.anchorName}</td>
                  <td className="px-2 py-1.5">{row.shopName}</td>
                  <td className="px-2 py-1.5">{row.liveRoomName}</td>
                  <td className="px-2 py-1.5">
                    {row.startTime}-{row.endTime}
                  </td>
                  <td className="px-2 py-1.5">{sourceLabel(row.source)}</td>
                  <td className="px-2 py-1.5 text-slate-500">{row.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

export const AnchorEffectiveSchedulePanel: React.FC<{
  startDate?: string
  endDate?: string
}> = ({ startDate, endDate }) => {
  const [tables, setTables] = useState<EffectiveScheduleTableView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const rangeKey = useMemo(
    () => `${startDate ?? ''}|${endDate ?? ''}`,
    [startDate, endDate],
  )

  useEffect(() => {
    if (!startDate || !endDate) {
      setTables([])
      return
    }
    setLoading(true)
    setError('')
    void apiRequest<{ tables: EffectiveScheduleTableView[] }>(
      `/anchor-performance/effective-schedules?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    )
      .then((res) => setTables(res.tables ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : '加载排班表失败'))
      .finally(() => setLoading(false))
  }, [rangeKey, startDate, endDate])

  if (!startDate || !endDate) return null

  return (
    <section className="rounded-2xl border border-rose-100 bg-white p-4 shadow-sm" data-testid="anchor-effective-schedule-panel">
      <h3 className="text-sm font-semibold text-slate-900">本次业绩使用的排班</h3>
      <p className="mt-1 text-xs text-slate-500">
        以下排班表与系统计算主播业绩时使用的生效排班一致，可按日期追溯订单为何归属某主播。
      </p>
      {loading ? <p className="mt-3 text-sm text-slate-500">加载排班表…</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}
      {!loading && !error ? (
        <div className="mt-3 space-y-2">
          {tables.map((table) => (
            <DayBlock key={table.date} table={table} />
          ))}
        </div>
      ) : null}
    </section>
  )
}
