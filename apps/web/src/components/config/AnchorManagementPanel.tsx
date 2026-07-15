import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { apiRequest } from '../../lib/api'
import {
  ANCHOR_COLOR_PALETTE,
  colorsTooSimilar,
  isValidAnchorColor,
  resolveAnchorColor,
} from '../../lib/anchor-theme'
import { ScheduleTimePicker } from '../ui/ScheduleTimePicker'

type AnchorListFilter = 'all' | 'enabled' | 'disabled' | 'schedule' | 'manual'

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
  systemKey?: string | null
  attributionMode?: 'schedule' | 'manual'
  effectiveFrom?: string | null
  effectiveTo?: string | null
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
    attributionMode: row.attributionMode === 'manual' ? 'manual' : 'schedule',
    timeRules: (row.timeRules ?? []).map((r) => ({
      ...r,
      startTime: normalizeTimeForInput(r.startTime),
      endTime: normalizeTimeForInput(r.endTime),
    })),
  }
}

function isManualMode(anchor: AnchorRow): boolean {
  return anchor.attributionMode === 'manual' || Boolean(anchor.systemKey)
}

function buildSavePayload(anchor: AnchorRow) {
  const manual = isManualMode(anchor)
  return {
    name: anchor.name.trim(),
    externalId: anchor.externalId?.trim() || null,
    defaultLiveRoomName: manual ? null : anchor.defaultLiveRoomName?.trim() || null,
    color: anchor.color?.trim() || '#94a3b8',
    enabled: anchor.enabled,
    sortOrder: anchor.sortOrder,
    attributionMode: manual ? 'manual' : 'schedule',
    effectiveFrom: manual ? null : anchor.effectiveFrom?.trim() || null,
    effectiveTo: manual ? null : anchor.effectiveTo?.trim() || null,
    timeRules: manual
      ? undefined
      : anchor.timeRules.map((r, i) => ({
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
  const [newColor, setNewColor] = useState(ANCHOR_COLOR_PALETTE[0] ?? '#94a3b8')
  const [newExternalId, setNewExternalId] = useState('')
  const [newLiveRoom, setNewLiveRoom] = useState('')
  const [newManualOnly, setNewManualOnly] = useState(false)
  const [newEffectiveFrom, setNewEffectiveFrom] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
  )
  const [listFilter, setListFilter] = useState<AnchorListFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredAnchors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return anchors.filter((a) => {
      if (listFilter === 'enabled' && !a.enabled) return false
      if (listFilter === 'disabled' && a.enabled) return false
      if (listFilter === 'schedule' && isManualMode(a)) return false
      if (listFilter === 'manual' && !isManualMode(a)) return false
      if (q && !a.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [anchors, listFilter, searchQuery])

  const colorConflictHint = useMemo(() => {
    if (!isValidAnchorColor(newColor)) return null
    const hit = anchors.find((a) => colorsTooSimilar(newColor, resolveAnchorColor(a)))
    return hit ? `与「${hit.name}」颜色接近，保存后图表可能不易区分` : null
  }, [anchors, newColor])

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
    if (!newManualOnly && !newEffectiveFrom.trim()) {
      setMessage({ type: 'error', text: '排班主播须填写上岗日期（effectiveFrom）' })
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
          attributionMode: newManualOnly ? 'manual' : 'schedule',
          manualOnly: newManualOnly || undefined,
          // 不默认创建全日时段；排班在「每日排班」配置
          timeRules: [],
          effectiveFrom: newManualOnly ? undefined : newEffectiveFrom.trim(),
        }),
      })
      setNewName('')
      setNewExternalId('')
      setNewLiveRoom('')
      setNewManualOnly(false)
      setNewColor(ANCHOR_COLOR_PALETTE[0] ?? '#94a3b8')
      await load()
      setMessage({
        type: 'success',
        text: newManualOnly
          ? `已新增「${name}」（仅手动归属）`
          : `已新增「${name}」（自动归属 · 自上岗日起可排班）`,
      })
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
      const saved = await apiRequest<AnchorRow>(`/api/anchors/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(buildSavePayload(anchor)),
      })
      await load()
      const modeLabel =
        saved.attributionMode === 'manual' || isManualMode(mapAnchorFromApi(saved))
          ? '仅手动归属'
          : '自动归属'
      setMessage({
        type: 'success',
        text: `已保存「${saved.name.trim()}」· ${modeLabel}`,
      })
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
    const target = anchors.find((a) => a.id === id)
    if (target?.systemKey) {
      setMessage({ type: 'error', text: '系统主播不可删除，如需停用请使用停用' })
      return
    }
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
        配置主播档案（名称、颜色、上岗日、归属模式）。日常默认班次与直播间请到下方「默认排班」修改。「仅手动归属」主播不参与场次/排班自动匹配。
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
        {!newManualOnly ? (
          <label className="text-xs text-slate-600">
            默认直播间（可选）
            <input
              value={newLiveRoom}
              onChange={(e) => setNewLiveRoom(e.target.value)}
              className="mt-0.5 block w-36 rounded border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
        ) : null}
        {!newManualOnly ? (
          <label className="text-xs text-slate-600">
            上岗日期*
            <input
              type="date"
              value={newEffectiveFrom}
              onChange={(e) => setNewEffectiveFrom(e.target.value)}
              className="mt-0.5 block rounded border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
        ) : null}
        <label className="text-xs text-slate-600">
          颜色
          <input
            type="color"
            value={isValidAnchorColor(newColor) ? newColor : '#94a3b8'}
            onChange={(e) => setNewColor(e.target.value)}
            className="mt-0.5 block h-8 w-12 cursor-pointer"
          />
        </label>
        <div className="flex flex-wrap items-center gap-1 pb-1">
          {ANCHOR_COLOR_PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              title={swatch}
              onClick={() => setNewColor(swatch)}
              className={`h-5 w-5 rounded-full border ${
                newColor.toLowerCase() === swatch.toLowerCase()
                  ? 'border-slate-700 ring-1 ring-slate-400'
                  : 'border-slate-200'
              }`}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
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
      {colorConflictHint ? (
        <p className="mt-1 text-[11px] text-amber-700">{colorConflictHint}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <p className="text-xs text-slate-600">
          共加载 <span className="font-semibold tabular-nums text-slate-900">{anchors.length}</span> 名主播
          {filteredAnchors.length !== anchors.length ? (
            <span className="text-slate-400">
              {' '}
              · 当前显示 {filteredAnchors.length} 名
            </span>
          ) : null}
        </p>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="按名称搜索"
          className="rounded border border-slate-200 px-2 py-1 text-xs"
        />
        {(
          [
            ['all', '全部'],
            ['enabled', '启用'],
            ['disabled', '停用'],
            ['schedule', '自动归属'],
            ['manual', '仅手动'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setListFilter(key)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
              listFilter === key
                ? 'border-rose-200 bg-rose-50 text-rose-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-4 text-xs text-slate-500">加载中…</p>
      ) : filteredAnchors.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500">
          {anchors.length === 0 ? '暂无主播，请先新增' : '没有符合筛选条件的主播'}
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {filteredAnchors.map((a) => {
            const index = anchors.findIndex((row) => row.id === a.id)
            const manual = isManualMode(a)
            return (
              <div
                key={a.id}
                className={`rounded-xl border p-3 ${
                  a.enabled ? 'border-slate-100' : 'border-slate-200 bg-slate-50/50'
                }`}
                style={{ borderLeftWidth: 3, borderLeftColor: resolveAnchorColor(a) }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={index <= 0}
                      onClick={() => void move(index, -1)}
                      className="rounded border border-slate-200 p-0.5 disabled:opacity-30"
                      title="上移"
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={index < 0 || index >= anchors.length - 1}
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
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      manual
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {manual ? '仅手动归属' : '自动归属'}
                  </span>
                  {a.systemKey ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                      系统主播
                    </span>
                  ) : null}
                  <input
                    value={a.externalId ?? ''}
                    onChange={(e) => updateLocal(a.id, { externalId: e.target.value })}
                    placeholder="主播ID"
                    className="w-24 rounded border border-slate-200 px-2 py-1 text-xs"
                  />
                  {!manual ? (
                    <input
                      value={a.defaultLiveRoomName ?? ''}
                      onChange={(e) =>
                        updateLocal(a.id, { defaultLiveRoomName: e.target.value })
                      }
                      placeholder="默认直播间"
                      className="w-32 rounded border border-slate-200 px-2 py-1 text-xs"
                    />
                  ) : null}
                  {!manual ? (
                    <label className="text-[11px] text-slate-500">
                      上岗
                      <input
                        type="date"
                        value={a.effectiveFrom ?? ''}
                        onChange={(e) =>
                          updateLocal(a.id, { effectiveFrom: e.target.value || null })
                        }
                        className="ml-1 rounded border border-slate-200 px-1.5 py-1 text-xs"
                      />
                    </label>
                  ) : null}
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
                  {!a.systemKey ? (
                    <button
                      type="button"
                      onClick={() => void remove(a.id)}
                      className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700"
                    >
                      删除
                    </button>
                  ) : null}
                </div>

                {manual ? (
                  <p className="mt-2 text-[11px] text-slate-500">
                    该主播仅通过订单明细手动指定计入业绩，不参与直播场次、排班与时段自动匹配。
                  </p>
                ) : (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium text-slate-600">旧版归属时段（可选）</p>
                    <p className="text-[11px] text-slate-400">
                      优先使用下方「默认排班」。此处仅兼容历史时段规则。
                    </p>
                    {a.timeRules.length === 0 ? (
                      <p className="text-[11px] text-slate-400">暂无时间段</p>
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
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
