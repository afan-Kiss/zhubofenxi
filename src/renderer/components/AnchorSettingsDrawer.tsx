import React, { useState } from 'react'
import { Plus, RotateCcw, Trash2, X } from 'lucide-react'
import type { Anchor, AnchorConfig, TimeRule } from '../types/anchor'
import { findTimeRuleConflicts, parseTimeString } from '../lib/anchorRules'

interface AnchorSettingsDrawerProps {
  open: boolean
  onClose: () => void
  config: AnchorConfig
  saveError: string | null
  onAddAnchor: (name: string, color: string) => Promise<boolean>
  onUpdateAnchor: (
    id: string,
    patch: Partial<Pick<Anchor, 'name' | 'color' | 'enabled'>>,
  ) => Promise<boolean>
  onRemoveAnchor: (id: string) => Promise<boolean>
  onAddTimeRule: (rule: Omit<TimeRule, 'id'>) => Promise<boolean>
  onUpdateTimeRule: (id: string, patch: Partial<Omit<TimeRule, 'id'>>) => Promise<boolean>
  onRemoveTimeRule: (id: string) => Promise<boolean>
  onReset: () => Promise<AnchorConfig>
}

export const AnchorSettingsDrawer: React.FC<AnchorSettingsDrawerProps> = ({
  open,
  onClose,
  config,
  saveError,
  onAddAnchor,
  onUpdateAnchor,
  onRemoveAnchor,
  onAddTimeRule,
  onUpdateTimeRule,
  onRemoveTimeRule,
  onReset,
}) => {
  const [newAnchorName, setNewAnchorName] = useState('')
  const [newAnchorColor, setNewAnchorColor] = useState('#FF2442')
  const [draftRule, setDraftRule] = useState({
    name: '',
    startTime: '09:00',
    endTime: '17:00',
    anchorId: config.anchors[0]?.id ?? '',
  })

  if (!open) return null

  const boundRulesCount = (anchorId: string) =>
    config.timeRules.filter((r) => r.anchorId === anchorId).length

  const handleDeleteAnchor = async (anchor: Anchor) => {
    const bound = boundRulesCount(anchor.id)
    const msg =
      bound > 0
        ? `主播「${anchor.name}」已绑定 ${bound} 条时间规则，删除后相关订单可能变成未归属，是否继续？`
        : `确定删除主播「${anchor.name}」？`
    if (!window.confirm(msg)) return
    await onRemoveAnchor(anchor.id)
  }

  const handleAddRule = async () => {
    if (!draftRule.name.trim()) {
      window.alert('请填写规则名称')
      return
    }
    if (!parseTimeString(draftRule.startTime).ok || !parseTimeString(draftRule.endTime).ok) {
      window.alert('时间格式应为 HH:mm')
      return
    }
    const trial = [
      ...config.timeRules,
      { ...draftRule, id: '__draft__', enabled: true, name: draftRule.name.trim() },
    ]
    const conflict = findTimeRuleConflicts(trial)
    if (conflict) {
      window.alert(conflict)
      return
    }
    const ok = await onAddTimeRule({
      name: draftRule.name.trim(),
      startTime: draftRule.startTime,
      endTime: draftRule.endTime,
      anchorId: draftRule.anchorId,
      enabled: true,
    })
    if (ok) setDraftRule((d) => ({ ...d, name: '' }))
  }

  const handleRuleField = async (
    rule: TimeRule,
    patch: Partial<Omit<TimeRule, 'id'>>,
  ) => {
    const next = config.timeRules.map((r) =>
      r.id === rule.id ? { ...r, ...patch } : r,
    )
    const conflict = findTimeRuleConflicts(next)
    if (conflict) {
      window.alert(conflict)
      return
    }
    await onUpdateTimeRule(rule.id, patch)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30">
      <button type="button" className="flex-1" aria-label="关闭" onClick={onClose} />
      <aside className="flex h-full w-[400px] flex-col border-l border-rose-100 bg-[var(--color-bg-warm)] shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-rose-100 bg-white/90 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">主播与时间规则</h2>
            <p className="text-[10px] text-slate-500">直播场次优先，时间规则兜底</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-slate-100">
            <X size={18} />
          </button>
        </header>

        <div className="xhs-scroll flex-1 space-y-3 overflow-y-auto p-3">
          {saveError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700">
              {saveError}
            </div>
          )}

          <section className="rounded-2xl border border-white/80 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold text-slate-800">主播管理</h3>
              <button
                type="button"
                onClick={() => void onReset().then(() => window.alert('已恢复默认配置'))}
                className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700"
              >
                <RotateCcw size={12} />
                恢复默认
              </button>
            </div>

            <div className="space-y-2">
              {config.anchors.map((anchor) => (
                <div
                  key={anchor.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/50 px-2 py-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={anchor.color}
                      onChange={(e) => void onUpdateAnchor(anchor.id, { color: e.target.value })}
                      className="h-7 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent"
                    />
                    <input
                      value={anchor.name}
                      onChange={(e) => void onUpdateAnchor(anchor.id, { name: e.target.value })}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px]"
                    />
                    <label className="flex items-center gap-1 text-[10px] text-slate-500">
                      <input
                        type="checkbox"
                        checked={anchor.enabled}
                        onChange={(e) =>
                          void onUpdateAnchor(anchor.id, { enabled: e.target.checked })
                        }
                      />
                      启用
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleDeleteAnchor(anchor)}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2 flex gap-2">
              <input
                value={newAnchorName}
                onChange={(e) => setNewAnchorName(e.target.value)}
                placeholder="新主播名称"
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px]"
              />
              <input
                type="color"
                value={newAnchorColor}
                onChange={(e) => setNewAnchorColor(e.target.value)}
                className="h-8 w-8 rounded border-0"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newAnchorName.trim()) return
                  void onAddAnchor(newAnchorName, newAnchorColor).then((ok) => {
                    if (ok) setNewAnchorName('')
                  })
                }}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--color-xhs-red)] px-2.5 py-1 text-[10px] text-white"
              >
                <Plus size={12} />
                新增
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/80 bg-white p-3 shadow-sm">
            <h3 className="mb-2 text-[11px] font-semibold text-slate-800">时间区间规则</h3>
            <p className="mb-2 text-[10px] leading-snug text-slate-500">
              同一天内已启用规则不可重叠。跨天如 22:00-02:00 表示当天 22:00 至次日 02:00。
            </p>

            <div className="space-y-2">
              {config.timeRules.map((rule) => (
                <div
                  key={rule.id}
                  className={`rounded-xl border px-2 py-2 ${
                    rule.enabled ? 'border-slate-100 bg-slate-50/50' : 'border-slate-100 bg-slate-100/50 opacity-70'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <input
                      value={rule.name}
                      onChange={(e) => void handleRuleField(rule, { name: e.target.value })}
                      className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px]"
                    />
                    <label className="flex items-center gap-0.5 text-[9px] text-slate-500">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => void handleRuleField(rule, { enabled: e.target.checked })}
                      />
                      启用
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`删除规则「${rule.name}」？`)) void onRemoveTimeRule(rule.id)
                      }}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                    <input
                      value={rule.startTime}
                      onChange={(e) => void handleRuleField(rule, { startTime: e.target.value })}
                      className="w-14 rounded border border-slate-200 bg-white px-1 py-0.5"
                    />
                    <span className="text-slate-400">—</span>
                    <input
                      value={rule.endTime}
                      onChange={(e) => void handleRuleField(rule, { endTime: e.target.value })}
                      className="w-14 rounded border border-slate-200 bg-white px-1 py-0.5"
                    />
                    <select
                      value={rule.anchorId}
                      onChange={(e) => void handleRuleField(rule, { anchorId: e.target.value })}
                      className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1 py-0.5"
                    >
                      {config.anchors.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/30 p-2">
              <div className="text-[10px] font-medium text-slate-600">新增规则</div>
              <input
                value={draftRule.name}
                onChange={(e) => setDraftRule((d) => ({ ...d, name: e.target.value }))}
                placeholder="规则名称，如下午场"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-[10px]"
              />
              <div className="mt-1 flex gap-1">
                <input
                  value={draftRule.startTime}
                  onChange={(e) => setDraftRule((d) => ({ ...d, startTime: e.target.value }))}
                  className="w-16 rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                />
                <span className="self-center text-slate-400">—</span>
                <input
                  value={draftRule.endTime}
                  onChange={(e) => setDraftRule((d) => ({ ...d, endTime: e.target.value }))}
                  className="w-16 rounded border border-slate-200 px-1 py-0.5 text-[10px]"
                />
                <select
                  value={draftRule.anchorId}
                  onChange={(e) => setDraftRule((d) => ({ ...d, anchorId: e.target.value }))}
                  className="min-w-0 flex-1 rounded border border-slate-200 text-[10px]"
                >
                  {config.anchors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => void handleAddRule()}
                className="mt-2 w-full rounded-full bg-[var(--color-xhs-red)] py-1 text-[10px] font-medium text-white"
              >
                添加时间规则
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  )
}
