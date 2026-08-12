import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../../lib/api'
import {
  defaultOfflineDealAtInput,
  offlineDealAtToIso,
} from '../../lib/offline-deal-entry-time'

type AnchorOption = {
  id: string
  name: string
  label: string
  attributionMode?: string
}

type Flash = { type: 'success' | 'error'; text: string }

/** 仅按钮；展开后显示录入表单。用于放在日期栏「自定义」右侧。 */
export const OfflineDealEntryPanel: React.FC<{
  /** 页面当前单日范围（今日/昨日）YYYY-MM-DD；多日可不传 */
  defaultDealDate?: string | null
  defaultAnchorName?: string
  onCreated?: () => void
}> = ({ defaultDealDate, defaultAnchorName, onCreated }) => {
  const [open, setOpen] = useState(false)
  const [anchors, setAnchors] = useState<AnchorOption[]>([])
  const [selectedName, setSelectedName] = useState('未归属')
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [amount, setAmount] = useState('')
  const [dealAt, setDealAt] = useState(() => defaultOfflineDealAtInput(defaultDealDate))
  const [customerLabel, setCustomerLabel] = useState('')
  const [externalKey, setExternalKey] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'confirmed' | 'draft'>('confirmed')

  // 打开表单或切换今日/昨日时，成交时间跟页面日期对齐
  useEffect(() => {
    if (!open) return
    setDealAt(defaultOfflineDealAtInput(defaultDealDate))
  }, [open, defaultDealDate])

  const loadOptions = useCallback(async () => {
    setLoadingOptions(true)
    try {
      const res = await apiRequest<{ anchors: AnchorOption[] }>('/api/offline-deals/anchor-options')
      const list = res.anchors ?? []
      setAnchors(list)
      const preferred =
        (defaultAnchorName &&
          list.find((a) => a.name === defaultAnchorName || a.label === defaultAnchorName)) ||
        list.find((a) => a.name === '未归属') ||
        list[0]
      if (preferred) setSelectedName(preferred.name)
    } catch (e) {
      setFlash({
        type: 'error',
        text: e instanceof Error ? e.message : '加载主播选项失败',
      })
    } finally {
      setLoadingOptions(false)
    }
  }, [defaultAnchorName])

  useEffect(() => {
    if (open) void loadOptions()
  }, [open, loadOptions])

  const selected = useMemo(
    () => anchors.find((a) => a.name === selectedName) ?? null,
    [anchors, selectedName],
  )

  const canSubmit = useMemo(() => {
    if (saving || loadingOptions) return false
    if (!selected) return false
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return false
    return true
  }, [amount, loadingOptions, saving, selected])

  const submit = async () => {
    if (!canSubmit || !selected) return
    setSaving(true)
    setFlash(null)
    const idempotencyKey =
      externalKey.trim() ||
      `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const pending = selected.name === '未归属' || !selected.id
    try {
      const dealAtIso = offlineDealAtToIso(dealAt)
      const res = await apiRequest<{ message?: string }>('/api/offline-deals', {
        method: 'POST',
        body: JSON.stringify({
          amountYuan: Number(amount),
          dealAt: dealAtIso,
          ...(pending
            ? { allowPending: true, anchorName: '未归属' }
            : { anchorId: selected.id, anchorName: selected.name }),
          customerLabel: customerLabel.trim() || undefined,
          note: note.trim() || undefined,
          externalKey: externalKey.trim() || undefined,
          idempotencyKey,
          status,
        }),
      })
      setFlash({ type: 'success', text: res.message || '已录入线下成交' })
      setAmount('')
      setCustomerLabel('')
      setExternalKey('')
      setNote('')
      setDealAt(defaultOfflineDealAtInput(defaultDealDate))
      onCreated?.()
    } catch (e) {
      setFlash({
        type: 'error',
        text: e instanceof Error ? e.message : '录入失败',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative shrink-0" data-testid="offline-deal-entry">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
          open
            ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        {open ? '收起录入' : '线下录入'}
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[min(100vw-2rem,28rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg sm:w-[28rem]">
          <p className="text-[11px] text-slate-500">
            线下成交可指定任意主播或暂不归属；自 2026-07-14 起计入总支付与线下 GMV。成交时间默认跟上方日期（今日/昨日）一致。
          </p>

          {flash ? (
            <p
              className={`mt-2 rounded-lg border px-2 py-1 text-xs ${
                flash.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
            >
              {flash.text}
            </p>
          ) : null}

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-600">
              成交金额（元）*
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-0.5 block w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="3000"
              />
            </label>
            <label className="text-xs text-slate-600">
              归属主播
              <select
                value={selectedName}
                disabled={loadingOptions || anchors.length === 0}
                onChange={(e) => setSelectedName(e.target.value)}
                className="mt-0.5 block w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              >
                {loadingOptions ? (
                  <option>加载中…</option>
                ) : (
                  anchors.map((a) => (
                    <option key={`${a.id}-${a.name}`} value={a.name}>
                      {a.label || a.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="text-xs text-slate-600 sm:col-span-2">
              成交时间*
              <input
                type="datetime-local"
                value={dealAt}
                onChange={(e) => setDealAt(e.target.value)}
                className="mt-0.5 block w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              客户备注
              <input
                value={customerLabel}
                onChange={(e) => setCustomerLabel(e.target.value)}
                className="mt-0.5 block w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="可选"
              />
            </label>
            <label className="text-xs text-slate-600">
              状态
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'confirmed' | 'draft')}
                className="mt-0.5 block w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              >
                <option value="confirmed">已确认</option>
                <option value="draft">草稿</option>
              </select>
            </label>
            <label className="text-xs text-slate-600 sm:col-span-2">
              外部单号 / 幂等键
              <input
                value={externalKey}
                onChange={(e) => setExternalKey(e.target.value)}
                className="mt-0.5 block w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="可选"
              />
            </label>
            <label className="text-xs text-slate-600 sm:col-span-2">
              备注
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-0.5 block w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="可选"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? '提交中…' : '确认录入'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
