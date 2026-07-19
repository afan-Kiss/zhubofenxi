import React, { useEffect, useMemo, useState } from 'react'
import { attributionSourceShortLabel } from '../../lib/board-order-row'

interface AnchorOption {
  id: string
  name: string
}

interface Props {
  orderNo: string
  /** 系统当前归属主播（默认选中，未改时不提交） */
  defaultAnchorName?: string
  attributionSource?: string | null
  anchorOptions: AnchorOption[]
  assigningOrderNo?: string | null
  onAssign: (orderNo: string, anchorName: string) => void
  onClearManualOverride?: (orderNo: string) => void
  compact?: boolean
}

function normalizeAnchorName(name: string | undefined | null): string {
  const trimmed = String(name ?? '').trim()
  return trimmed || '未归属'
}

export const OrderAnchorAssignControl: React.FC<Props> = ({
  orderNo,
  defaultAnchorName,
  attributionSource,
  anchorOptions,
  assigningOrderNo,
  onAssign,
  onClearManualOverride,
  compact = false,
}) => {
  const currentAnchor = normalizeAnchorName(defaultAnchorName)
  const mergedOptions = useMemo(() => {
    const seen = new Set<string>()
    const out: AnchorOption[] = []
    const add = (name: string, id?: string) => {
      const trimmed = name.trim()
      if (!trimmed || seen.has(trimmed)) return
      seen.add(trimmed)
      out.push({ id: id ?? `anchor-${trimmed}`, name: trimmed })
    }
    add(currentAnchor, `current-${currentAnchor}`)
    for (const option of anchorOptions) add(option.name, option.id)
    return out
  }, [anchorOptions, currentAnchor])

  const [selected, setSelected] = useState(currentAnchor)

  useEffect(() => {
    setSelected(currentAnchor)
  }, [orderNo, currentAnchor])

  const busy = assigningOrderNo === orderNo
  const changed = selected !== currentAnchor
  const statusLabel = attributionSourceShortLabel(attributionSource)
  const showClear =
    attributionSource === 'manual_override' && typeof onClearManualOverride === 'function'

  const handleAssign = () => {
    if (!selected || busy || !changed) return
    onAssign(orderNo, selected)
  }

  return (
    <div className={`flex ${compact ? 'flex-col gap-1' : 'flex-wrap items-center gap-1.5'}`}>
      <select
        value={selected}
        disabled={busy}
        onChange={(e) => setSelected(e.target.value)}
        className={`${compact ? 'w-full min-w-0' : 'max-w-[140px]'} rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] text-slate-700 disabled:opacity-50`}
        aria-label={`为订单 ${orderNo} 指定主播`}
      >
        {mergedOptions.map((a) => (
          <option key={a.id} value={a.name}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!changed || busy}
        onClick={handleAssign}
        className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? '保存中…' : changed ? '保存' : statusLabel}
      </button>
      {showClear ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onClearManualOverride?.(orderNo)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          清除手动指定
        </button>
      ) : null}
    </div>
  )
}
