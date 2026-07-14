import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { apiRequest } from '../../lib/api'
import { ScheduleTimePicker } from '../ui/ScheduleTimePicker'

interface TimeRule {
  id: string
  startTime: string
  endTime: string
  enabled: boolean
  sortOrder: number
}

interface AnchorRow {
  id: string
  name: string
  externalId: string | null
  defaultLiveRoomName: string | null
  color: string | null
  enabled: boolean
  sortOrder: number
  deletedAt?: string | null
  timeRules: TimeRule[]
}

type FlashMessage = { type: 'success' | 'error'; text: string }

function normalizeTimeForInput(value: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!m) return '00:00'
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function mapAnchorFromApi(row: AnchorRow): AnchorRow {
  return {
    ...row,
    color: row.color ?? '#94a3b8',
    timeRules: (row.timeRules ?? []).map((r) => ({
      ...r,
      startTime: normalizeTimeForInput(r.startTime),
      endTime: normalizeTimeForInput(r.endTime),
    })),
  }
}

function buildSavePayload(anchor: AnchorRow) {
  return {
    name: anchor.name.trim(),
    externalId: anchor.externalId?.trim() || null,
    defaultLiveRoomName: anchor.defaultLiveRoomName?.trim() || null,
    color: anchor.color?.trim() || '#94a3b8',
    enabled: anchor.enabled,
    sortOrder: anchor.sortOrder,
    timeRules: anchor.timeRules.map((r, i) => ({
      startTime: normalizeTimeForInput(r.startTime),
      endTime: normalizeTimeForInput(r.endTime),
      enabled: r.enabled,
      sortOrder: i,
    })),
  }
}

export const AnchorManagementPanel: React.FC = () => {
  const [anchors, setAnchors] = useState<AnchorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<FlashMessage | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#94a3b8')
  const [newExternalId, setNewExternalId] = useState('')
  const [newLiveRoom, setNewLiveRoom] = useState('')
  const [newManualOnly, setNewManualOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await apiRequest<AnchorRow[]>('/api/anchors')
      setAnchors(list.map(mapAnchorFromApi))
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '加载主播失败',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    const name = newName.trim()
    if (!name) {
      setMessage({ type: 'error', text: '请输入主播名称' })
      return
    }
    setMessage(null)
    setCreating(true)
    try {
      await apiRequest('/api/anchors', {
        method: 'POST',
        body: JSON.stringify({
          name,
          color: newColor,
          externalId: newExternalId.trim() || undefined,
          defaultLiveRoomName: newManualOnly ? undefined : newLiveRoom.trim() || undefined,
          manualOnly: newManualOnly || undefined,
          timeRules: newManualOnly
            ? []
            : [{ startTime: '00:00', endTime: '23:59', enabled: true }],
        }),
      })
      setNewName('')
      setNewExternalId('')
      setNewLiveRoom('')
      setNewManualOnly(false)
      await load()
      setMessage({ type: 'success', text: '已新增主播' })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '新增失败',
      })
    } finally {
      setCreating(false)
    }
  }

  const save = async (id: string) => {
    const anchor = anchors.find((a) => a.id === id)
    if (!anchor) return
    if (!anchor.name.trim()) {
      setMessage({ type: 'error', text: '主播名称不能为空' })
      return
    }
    setMessage(null)
    setSavingId(id)
    try {
      await apiRequest(`/api/anchors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(buildSavePayload(anchor)),
      })
      await load()
      setMessage({ type: 'success', text: `已保存「${anchor.name.trim()}」` })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '保存失败',
      })
    } finally {
      setSavingId(null)
    }
  }

  const disable = async (id: string) => {
    if (!window.confirm('确定停用该主播？停用后筛选与归属不再使用，历史明细仍保留原名称。')) return
    try {
      await apiRequest(`/api/anchors/${id}/disable`, { method: 'POST' })
      await load()
      setMessage({ type: 'success', text: '已停用主播' })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '停用失败',
      })
    }
  }

  const remove = async (id: string) => {
    if (
      !window.confirm(
        '确定删除该主播？此为逻辑删除，历史订单/统计中的主播名称不会改动。',
      )
    ) {
      return
    }
    try {
      await apiRequest(`/api/anchors/${id}/delete`, { method: 'POST' })
      await load()
      setMessage({ type: 'success', text: '已删除主播' })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '删除失败',
      })
    }
  }

  const move = async (index: number, dir: -1 | 1) => {
    const next = index + dir
    if (next < 0 || next >= anchors.length) return
    const reordered = [...anchors]
    const [item] = reordered.splice(index, 1)
    reordered.splice(next, 0, item)
    setAnchors(reordered)
    try {
      await apiRequest('/api/anchors/reorder', {
        method: 'POST',
        body: JSON.stringify({ ids: reordered.map((a) => a.id) }),
      })
      await load()
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '排序失败',
      })
      await load()
    }
  }

  const updateLocal = (id: string, patch: Partial<AnchorRow>) => {
    setAnchors((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  const updateTimeRule = (
    anchorId: string,
    ruleIndex: number,
    patch: Partial<TimeRule>,
  ) => {
    setAnchors((prev) =>
      prev.map((a) => {
        if (a.id !== anchorId) return a
        const rules = a.timeRules.map((r, i) =>
          i === ruleIndex ? { ...r, ...patch } : r,
        )
        return { ...a, timeRules: rules }
      }),
    )
  }

  const addRule = (anchorId: string) => {
    setAnchors((prev) =>
      prev.map((a) => {
        if (a.id !== anchorId) return a
        return {
          ...a,
          timeRules: [
            ...a.timeRules,
            {
              id: `new-${Date.now()}`,
              startTime: '00:00',
              endTime: '23:59',
              enabled: true,
              sortOrder: a.timeRules.length,
            },
          ],
        }
      }),
    )
  }

  const removeRule = (anchorId: string, ruleIndex: number) => {
    setAnchors((prev) =>
      prev.map((a) => {
        if (a.id !== anchorId) return a
        const rules = a.timeRules.filter((_, i) => i !== ruleIndex)
        return { ...a, timeRules: rules }
      }),
    )
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">主播管理</h3>
      <p className="mt-1 text-xs text-slate-500">
        配置主播名称、ID、默认直播间与归属时间段。无时间段的主播仅通过订单抽屉「手动指定」计入业绩（如逸凡）。
      </p>

      {message && (
        <p
          className={`mt-2 rounded-lg border px-2 py-1 text-xs ${
            message.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          名称
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="mt-0.5 block rounded border border-slate-200 px-2 py-1 text-sm"
            placeholder="新主播"
          />
        </label>
        <label className="text-xs text-slate-600">
          主播ID（可选）
          <input
            value={newExternalId}
            onChange={(e) => setNewExternalId(e.target.value)}
            className="mt-0.5 block w-28 rounded border border-slate-200 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          默认直播间（可选）
          <input
            value={newLiveRoom}
            onChange={(e) => setNewLiveRoom(e.target.value)}
            className="mt-0.5 block w-36 rounded border border-slate-200 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          颜色
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="mt-0.5 block h-8 w-12 cursor-pointer"
          />
        </label>
        <label className="inline-flex items-center gap-1.5 pb-1 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={newManualOnly}
            onChange={(e) => setNewManualOnly(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          仅手动归属（不匹配场次/时段）
        </label>
        <button
          type="button"
          disabled={creating}
          onClick={() => void create()}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {creating ? '新增中…' : '新增主播'}
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-xs text-slate-500">加载中…</p>
      ) : (
        <div className="mt-4 space-y-4">
          {anchors.map((a, index) => (
            <div
              key={a.id}
              className={`rounded-xl border p-3 ${
                a.enabled ? 'border-slate-100' : 'border-slate-200 bg-slate-50/50'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => void move(index, -1)}
                    className="rounded border border-slate-200 p-0.5 disabled:opacity-30"
                    title="上移"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={index === anchors.length - 1}
                    onClick={() => void move(index, 1)}
                    className="rounded border border-slate-200 p-0.5 disabled:opacity-30"
                    title="下移"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <input
                  value={a.name}
                  onChange={(e) => updateLocal(a.id, { name: e.target.value })}
                  className="rounded border border-slate-200 px-2 py-1 text-sm font-medium"
                />
                <input
                  value={a.externalId ?? ''}
                  onChange={(e) => updateLocal(a.id, { externalId: e.target.value })}
                  placeholder="主播ID"
                  className="w-24 rounded border border-slate-200 px-2 py-1 text-xs"
                />
                <input
                  value={a.defaultLiveRoomName ?? ''}
                  onChange={(e) =>
                    updateLocal(a.id, { defaultLiveRoomName: e.target.value })
                  }
                  placeholder="默认直播间"
                  className="w-32 rounded border border-slate-200 px-2 py-1 text-xs"
                />
                <input
                  type="color"
                  value={a.color ?? '#94a3b8'}
                  onChange={(e) => updateLocal(a.id, { color: e.target.value })}
                  className="h-8 w-10"
                />
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={a.enabled}
                    onChange={(e) => updateLocal(a.id, { enabled: e.target.checked })}
                  />
                  启用
                </label>
                <button
                  type="button"
                  disabled={savingId === a.id}
                  onClick={() => void save(a.id)}
                  className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 disabled:opacity-50"
                >
                  {savingId === a.id ? '保存中…' : '保存'}
                </button>
                {a.enabled && (
                  <button
                    type="button"
                    onClick={() => void disable(a.id)}
                    className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800"
                  >
                    停用
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void remove(a.id)}
                  className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700"
                >
                  删除
                </button>
              </div>

              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium text-slate-600">默认归属时间段</p>
                {a.timeRules.length === 0 ? (
                  <p className="text-[11px] text-slate-400">
                    暂无时间段：该主播不会自动匹配场次，仅在订单抽屉里手动指定后计入业绩
                  </p>
                ) : (
                  a.timeRules.map((r, idx) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <ScheduleTimePicker
                        value={r.startTime}
                        onChange={(startTime) => updateTimeRule(a.id, idx, { startTime })}
                        aria-label="开始时间"
                      />
                      <span className="text-slate-400">至</span>
                      <ScheduleTimePicker
                        value={r.endTime}
                        onChange={(endTime) => updateTimeRule(a.id, idx, { endTime })}
                        allowMidnight
                        aria-label="结束时间"
                      />
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={r.enabled}
                          onChange={(e) =>
                            updateTimeRule(a.id, idx, { enabled: e.target.checked })
                          }
                        />
                        启用
                      </label>
                      <button
                        type="button"
                        onClick={() => removeRule(a.id, idx)}
                        className="text-rose-600"
                      >
                        删除
                      </button>
                    </div>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => addRule(a.id)}
                  className="text-xs text-rose-600"
                >
                  + 添加时间段
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
