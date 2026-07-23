import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { apiRequest } from '../../lib/api'
import { ScheduleTimeRangePicker } from '../ui/ScheduleTimePicker'

const SHOP_OPTIONS = ['XY祥钰珠宝', '和田雅玉', '拾玉居和田玉', '祥钰珠宝'] as const

type TemplateRow = {
  id?: string
  localKey: string
  anchorId: string | null
  anchorName: string
  shopName: string
  liveRoomName: string
  startTime: string
  endTime: string
  note: string
  sortOrder: number
}

type AnchorOption = {
  id: string
  name: string
  enabled: boolean
  attributionMode?: string | null
  systemKey?: string | null
}

type Flash = { type: 'success' | 'error'; text: string }

function makeLocalKey(): string {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function resolveSelectAnchorId(
  row: Pick<TemplateRow, 'anchorId' | 'anchorName'>,
  anchors: AnchorOption[],
): string {
  if (row.anchorId && anchors.some((a) => a.id === row.anchorId)) return row.anchorId
  const byName = anchors.find((a) => a.name === row.anchorName)
  if (byName) return byName.id
  return row.anchorName || ''
}

export const DefaultScheduleTemplatePanel: React.FC = () => {
  const [rows, setRows] = useState<TemplateRow[]>([])
  const [anchors, setAnchors] = useState<AnchorOption[]>([])
  const [asOfDate, setAsOfDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const savingRef = React.useRef(false)
  const [message, setMessage] = useState<Flash | null>(null)

  const scheduleAnchors = useMemo(
    () =>
      anchors
        .filter(
          (a) =>
            a.enabled &&
            !a.systemKey &&
            a.attributionMode !== 'manual',
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [anchors],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const [tpl, list] = await Promise.all([
        apiRequest<{ date: string; templates: Array<Omit<TemplateRow, 'localKey'>> }>(
          '/api/anchor-schedule-templates',
        ),
        apiRequest<AnchorOption[]>('/api/anchors'),
      ])
      setAsOfDate(tpl.date)
      const anchorList = Array.isArray(list) ? list : []
      setAnchors(anchorList)
      setRows(
        (tpl.templates ?? []).map((t, i) => {
          const name = t.anchorName
          const byName = anchorList.find((a) => a.name === name)
          return {
            id: t.id,
            localKey: t.id || makeLocalKey(),
            anchorId: t.anchorId ?? byName?.id ?? null,
            anchorName: name,
            shopName: t.shopName,
            liveRoomName: t.liveRoomName || t.shopName,
            startTime: t.startTime,
            endTime: t.endTime,
            note: t.note ?? '',
            sortOrder: t.sortOrder ?? (i + 1) * 10,
          }
        }),
      )
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : '加载默认排班失败',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateRow = (localKey: string, patch: Partial<TemplateRow>) => {
    setRows((prev) => prev.map((r) => (r.localKey === localKey ? { ...r, ...patch } : r)))
  }

  const addRow = () => {
    const first = scheduleAnchors[0]
    const shop = SHOP_OPTIONS[0]
    setRows((prev) => [
      ...prev,
      {
        localKey: makeLocalKey(),
        anchorId: first?.id ?? null,
        anchorName: first?.name ?? '',
        shopName: shop,
        liveRoomName: shop,
        startTime: '09:30',
        endTime: '14:00',
        note: '',
        sortOrder: (prev.length + 1) * 10,
      },
    ])
  }

  const removeRow = (localKey: string) => {
    setRows((prev) => prev.filter((r) => r.localKey !== localKey))
  }

  const save = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setMessage(null)
    try {
      const saved = await apiRequest<{ date: string; templates: Array<Omit<TemplateRow, 'localKey'>> }>(
        '/api/anchor-schedule-templates',
        {
          method: 'PUT',
          body: JSON.stringify({
            date: asOfDate || undefined,
            templates: rows.map((r, i) => ({
              id: r.id,
              anchorId: r.anchorId,
              anchorName: r.anchorName,
              shopName: r.shopName,
              liveRoomName: r.liveRoomName || r.shopName,
              startTime: r.startTime,
              endTime: r.endTime,
              note: r.note || null,
              sortOrder: (i + 1) * 10,
            })),
          }),
        },
      )
      setAsOfDate(saved.date)
      setRows(
        (saved.templates ?? []).map((t, i) => {
          const byName = scheduleAnchors.find((a) => a.name === t.anchorName)
          return {
            id: t.id,
            localKey: t.id || makeLocalKey(),
            anchorId: t.anchorId ?? byName?.id ?? null,
            anchorName: t.anchorName,
            shopName: t.shopName,
            liveRoomName: t.liveRoomName || t.shopName,
            startTime: t.startTime,
            endTime: t.endTime,
            note: t.note ?? '',
            sortOrder: t.sortOrder ?? (i + 1) * 10,
          }
        }),
      )
      setMessage({
        type: 'success',
        text: `已保存默认排班 ${saved.templates.length} 条（影响此后「生成默认排班」）`,
      })
    } catch (e) {
      setMessage({
        type: 'error',
        text: e instanceof Error ? e.message : '保存失败',
      })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="default-schedule-templates">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">默认排班</h3>
          <p className="mt-1 text-xs text-slate-500">
            配置日常「生成默认排班」用的主播、班次与直播间
            {asOfDate ? `（当前按 ${asOfDate} 生效）` : ''}。改完后保存，之后新生成的日排班会按此模板。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            <Plus size={14} />
            新增一行
          </button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void save()}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存默认排班'}
          </button>
        </div>
      </div>

      {message ? (
        <p
          className={`mt-2 rounded-lg border px-2 py-1 text-xs ${
            message.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-3 text-xs text-slate-500">加载中…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">暂无默认排班，请点「新增一行」后保存。</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-100">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2">主播</th>
                <th className="px-3 py-2">班次</th>
                <th className="px-3 py-2">直播间</th>
                <th className="px-3 py-2">备注</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.localKey} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <select
                      value={resolveSelectAnchorId(row, scheduleAnchors)}
                      onChange={(e) => {
                        const v = e.target.value
                        const hit = scheduleAnchors.find((a) => a.id === v || a.name === v)
                        if (hit) {
                          updateRow(row.localKey, {
                            anchorId: hit.id,
                            anchorName: hit.name,
                          })
                          return
                        }
                        updateRow(row.localKey, { anchorId: null, anchorName: v })
                      }}
                      className="min-w-[6.5rem] rounded border border-slate-200 px-2 py-1 text-sm"
                    >
                      {!row.anchorName ? <option value="">请选择</option> : null}
                      {row.anchorName &&
                      !scheduleAnchors.some(
                        (a) => a.id === row.anchorId || a.name === row.anchorName,
                      ) ? (
                        <option value={row.anchorName}>{row.anchorName}（当前）</option>
                      ) : null}
                      {scheduleAnchors.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <ScheduleTimeRangePicker
                      startTime={row.startTime}
                      endTime={row.endTime}
                      onStartChange={(startTime) => updateRow(row.localKey, { startTime })}
                      onEndChange={(endTime) => updateRow(row.localKey, { endTime })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={row.liveRoomName || row.shopName}
                      onChange={(e) => {
                        const v = e.target.value
                        updateRow(row.localKey, { shopName: v, liveRoomName: v })
                      }}
                      className="min-w-[8rem] rounded border border-slate-200 px-2 py-1 text-sm"
                    >
                      {SHOP_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                      {row.liveRoomName &&
                      !(SHOP_OPTIONS as readonly string[]).includes(row.liveRoomName) ? (
                        <option value={row.liveRoomName}>{row.liveRoomName}</option>
                      ) : null}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={row.note}
                      onChange={(e) => updateRow(row.localKey, { note: e.target.value })}
                      className="w-full min-w-[6rem] rounded border border-slate-200 px-2 py-1 text-sm"
                      placeholder="可选"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(row.localKey)}
                      className="inline-flex items-center gap-1 rounded border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 size={12} />
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
