import React, { useEffect, useMemo, useState } from 'react'

interface AnchorOption {
  id: string
  name: string
  label?: string
}

interface Props {
  dealId: string
  defaultAnchorName?: string | null
  anchorOptions: AnchorOption[]
  busyDealId?: string | null
  onAssign: (dealId: string, anchorName: string) => void
  onDelete: (dealId: string) => void
  compact?: boolean
}

function normalizeAnchorName(name: string | undefined | null): string {
  const trimmed = String(name ?? '').trim()
  return trimmed || '未归属'
}

export const OfflineDealManageControl: React.FC<Props> = ({
  dealId,
  defaultAnchorName,
  anchorOptions,
  busyDealId,
  onAssign,
  onDelete,
  compact = false,
}) => {
  const currentAnchor = normalizeAnchorName(defaultAnchorName)
  const mergedOptions = useMemo(() => {
    const seen = new Set<string>()
    const out: AnchorOption[] = []
    const add = (name: string, id?: string, label?: string) => {
      const trimmed = name.trim()
      if (!trimmed || seen.has(trimmed)) return
      seen.add(trimmed)
      out.push({ id: id ?? `anchor-${trimmed}`, name: trimmed, label })
    }
    add(currentAnchor, `current-${currentAnchor}`)
    for (const option of anchorOptions) add(option.name, option.id, option.label)
    return out
  }, [anchorOptions, currentAnchor])

  const [selected, setSelected] = useState(currentAnchor)

  useEffect(() => {
    setSelected(currentAnchor)
  }, [dealId, currentAnchor])

  const busy = busyDealId === dealId
  const changed = selected !== currentAnchor

  return (
    <div className={`flex ${compact ? 'flex-col gap-1' : 'flex-wrap items-center gap-1.5'}`}>
      <select
        value={selected}
        disabled={busy}
        onChange={(e) => setSelected(e.target.value)}
        className={`${compact ? 'w-full min-w-0' : 'max-w-[140px]'} rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[11px] text-slate-700 disabled:opacity-50`}
        aria-label={`为线下成交 ${dealId} 指派主播`}
      >
        {mergedOptions.map((a) => (
          <option key={a.id} value={a.name}>
            {a.label ?? a.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!changed || busy}
        onClick={() => onAssign(dealId, selected)}
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-800 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? '处理中…' : changed ? '指派' : '已指派'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!window.confirm('确认删除该笔线下成交？删除后不再计入经营数据。')) return
          onDelete(dealId)
        }}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        删除
      </button>
    </div>
  )
}
