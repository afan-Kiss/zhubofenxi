import React, { useState } from 'react'

interface AnchorOption {
  id: string
  name: string
}

interface Props {
  orderNo: string
  anchorOptions: AnchorOption[]
  assigningOrderNo?: string | null
  onAssign: (orderNo: string, anchorName: string) => void
  compact?: boolean
}

export const OrderAnchorAssignControl: React.FC<Props> = ({
  orderNo,
  anchorOptions,
  assigningOrderNo,
  onAssign,
  compact = false,
}) => {
  const [selected, setSelected] = useState('')
  const busy = assigningOrderNo === orderNo

  const handleAssign = () => {
    if (!selected || busy) return
    onAssign(orderNo, selected)
  }

  return (
    <div className={`flex ${compact ? 'flex-col gap-1' : 'flex-wrap items-center gap-1.5'}`}>
      <select
        value={selected}
        disabled={busy}
        onChange={(e) => setSelected(e.target.value)}
        className="max-w-[120px] rounded-lg border border-rose-200 bg-white px-2 py-1 text-[11px] text-slate-700 disabled:opacity-50"
        aria-label={`为订单 ${orderNo} 指定主播`}
      >
        <option value="">选择主播</option>
        {anchorOptions.map((a) => (
          <option key={a.id} value={a.name}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!selected || busy}
        onClick={handleAssign}
        className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? '保存中…' : '指定'}
      </button>
    </div>
  )
}
