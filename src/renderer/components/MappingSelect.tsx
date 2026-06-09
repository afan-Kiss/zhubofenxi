import React from 'react'
import type { MatchConfidence } from '../types/fieldMapping'

interface MappingSelectProps {
  value: string | null
  options: string[]
  confidence: MatchConfidence
  onChange: (value: string | null) => void
}

const confidenceBadge: Record<
  MatchConfidence,
  { label: string; className: string } | null
> = {
  exact: { label: '已识别', className: 'bg-emerald-50 text-emerald-700' },
  fuzzy: { label: '需确认', className: 'bg-amber-50 text-amber-700' },
  missing: { label: '缺失', className: 'bg-rose-50 text-rose-600' },
  manual: { label: '已识别', className: 'bg-emerald-50 text-emerald-700' },
}

export const MappingSelect: React.FC<MappingSelectProps> = ({
  value,
  options,
  confidence,
  onChange,
}) => {
  const badge = confidenceBadge[confidence]

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className={`w-full appearance-none rounded-xl border bg-white py-1.5 pl-2.5 pr-7 text-[11px] text-slate-800 shadow-sm outline-none transition-colors focus:border-[var(--color-xhs-red)] focus:ring-2 focus:ring-rose-100 ${
            confidence === 'missing'
              ? 'border-rose-200 bg-rose-50/30'
              : 'border-slate-100'
          }`}
        >
          <option value="">— 未选择 —</option>
          {options.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
          ▾
        </span>
      </div>
      {badge && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
      )}
    </div>
  )
}
