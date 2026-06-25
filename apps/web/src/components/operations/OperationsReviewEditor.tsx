import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../lib/api'
import type { OpsReviewNotePayload } from '../../pages/operations/operationsReportTypes'

interface Props {
  reportDate: string
  reportType: 'daily' | 'weekly'
  initialNote: OpsReviewNotePayload | null
  onSaved?: (note: OpsReviewNotePayload) => void
}

export const OperationsReviewEditor: React.FC<Props> = ({
  reportDate,
  reportType,
  initialNote,
  onSaved,
}) => {
  const [problemText, setProblemText] = useState(initialNote?.problemText ?? '')
  const [reasonText, setReasonText] = useState(initialNote?.reasonText ?? '')
  const [trafficProducts, setTrafficProducts] = useState(
    (initialNote?.trafficProducts ?? []).join('\n'),
  )
  const [mainProducts, setMainProducts] = useState((initialNote?.mainProducts ?? []).join('\n'))
  const [profitProducts, setProfitProducts] = useState(
    (initialNote?.profitProducts ?? []).join('\n'),
  )
  const [scriptText, setScriptText] = useState(initialNote?.scriptText ?? '')
  const [ownerName, setOwnerName] = useState(initialNote?.ownerName ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setProblemText(initialNote?.problemText ?? '')
    setReasonText(initialNote?.reasonText ?? '')
    setTrafficProducts((initialNote?.trafficProducts ?? []).join('\n'))
    setMainProducts((initialNote?.mainProducts ?? []).join('\n'))
    setProfitProducts((initialNote?.profitProducts ?? []).join('\n'))
    setScriptText(initialNote?.scriptText ?? '')
    setOwnerName(initialNote?.ownerName ?? '')
  }, [initialNote])

  const splitLines = (text: string) =>
    text
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean)

  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      const saved = await apiRequest<OpsReviewNotePayload>('/api/board/operations-report/review-note', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportDate,
          reportType,
          problemText,
          reasonText,
          trafficProducts: splitLines(trafficProducts),
          mainProducts: splitLines(mainProducts),
          profitProducts: splitLines(profitProducts),
          scriptText,
          ownerName,
        }),
      })
      onSaved?.(saved)
      setMessage('复盘笔记已保存')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [
    reportDate,
    reportType,
    problemText,
    reasonText,
    trafficProducts,
    mainProducts,
    profitProducts,
    scriptText,
    ownerName,
    onSaved,
  ])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">每日复盘</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block text-xs text-slate-600">
          问题描述
          <textarea
            value={problemText}
            onChange={(e) => setProblemText(e.target.value)}
            className="mt-1 h-20 w-full rounded-xl border border-slate-200 p-2 text-sm"
          />
        </label>
        <label className="block text-xs text-slate-600">
          原因分析
          <textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            className="mt-1 h-20 w-full rounded-xl border border-slate-200 p-2 text-sm"
          />
        </label>
        <label className="block text-xs text-slate-600">
          引流款（每行一个）
          <textarea
            value={trafficProducts}
            onChange={(e) => setTrafficProducts(e.target.value)}
            className="mt-1 h-20 w-full rounded-xl border border-slate-200 p-2 text-sm"
          />
        </label>
        <label className="block text-xs text-slate-600">
          主推款（每行一个）
          <textarea
            value={mainProducts}
            onChange={(e) => setMainProducts(e.target.value)}
            className="mt-1 h-20 w-full rounded-xl border border-slate-200 p-2 text-sm"
          />
        </label>
        <label className="block text-xs text-slate-600 md:col-span-2">
          利润款 / 高客单（每行一个）
          <textarea
            value={profitProducts}
            onChange={(e) => setProfitProducts(e.target.value)}
            className="mt-1 h-20 w-full rounded-xl border border-slate-200 p-2 text-sm"
          />
        </label>
        <label className="block text-xs text-slate-600 md:col-span-2">
          话术 / 行动计划
          <textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            className="mt-1 h-24 w-full rounded-xl border border-slate-200 p-2 text-sm"
          />
        </label>
        <label className="block text-xs text-slate-600">
          负责人
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 p-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="rounded-full border border-rose-200 bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存复盘'}
        </button>
        {message ? <span className="text-sm text-slate-600">{message}</span> : null}
      </div>
    </div>
  )
}
