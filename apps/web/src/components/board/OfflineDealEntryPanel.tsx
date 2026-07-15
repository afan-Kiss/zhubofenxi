import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../../lib/api'

type AnchorOption = {
  id: string
  name: string
  label: string
  attributionMode?: string
}

type Flash = { type: 'success' | 'error'; text: string }

function todayShanghaiInput(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export const OfflineDealEntryPanel: React.FC<{
  defaultAnchorName?: string
  onCreated?: () => void
}> = ({ onCreated }) => {
  const [open, setOpen] = useState(false)
  const [yifan, setYifan] = useState<AnchorOption | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [amount, setAmount] = useState('')
  const [dealAt, setDealAt] = useState(todayShanghaiInput)
  const [customerLabel, setCustomerLabel] = useState('')
  const [externalKey, setExternalKey] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'confirmed' | 'draft'>('confirmed')

  const loadOptions = useCallback(async () => {
    setLoadingOptions(true)
    try {
      const res = await apiRequest<{ anchors: AnchorOption[] }>('/api/offline-deals/anchor-options')
      const hit = (res.anchors ?? [])[0] ?? null
      setYifan(hit)
    } catch (e) {
      setFlash({
        type: 'error',
        text: e instanceof Error ? e.message : '加载主播选项失败',
      })
    } finally {
      setLoadingOptions(false)
    }
  }, [])

  useEffect(() => {
    if (open) void loadOptions()
  }, [open, loadOptions])

  const canSubmit = useMemo(() => {
    if (saving || loadingOptions) return false
    if (!yifan?.name) return false
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return false
    return true
  }, [amount, loadingOptions, saving, yifan])

  const submit = async () => {
    if (!canSubmit || !yifan) return
    setSaving(true)
    setFlash(null)
    const idempotencyKey =
      externalKey.trim() ||
      `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      const res = await apiRequest<{ message?: string }>('/api/offline-deals', {
        method: 'POST',
        body: JSON.stringify({
          amountYuan: Number(amount),
          dealAt: new Date(dealAt).toISOString(),
          anchorId: yifan.id,
          anchorName: yifan.name,
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
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">线下成交录入</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            已确认的线下成交固定归属逸凡，并计入总支付金额与该主播 GMV（自生效日起）。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700"
        >
          {open ? '收起' : '录入线下成交'}
        </button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          {flash ? (
            <p
              className={`rounded-lg border px-2 py-1 text-xs ${
                flash.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
            >
              {flash.text}
            </p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
              <div className="mt-0.5 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-800">
                {loadingOptions
                  ? '加载中…'
                  : yifan
                    ? `${yifan.name}（固定）`
                    : '系统线下主播未就绪'}
              </div>
            </label>
            <label className="text-xs text-slate-600">
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
              外部单号 / 幂等键
              <input
                value={externalKey}
                onChange={(e) => setExternalKey(e.target.value)}
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
            <label className="text-xs text-slate-600 sm:col-span-2 lg:col-span-3">
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
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? '提交中…' : '确认录入'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
