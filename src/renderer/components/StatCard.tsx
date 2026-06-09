import React from 'react'

interface StatCardProps {
  label: string
  value: string
  accent?: 'primary' | 'secondary'
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, accent = 'primary' }) => {
  const accentBar =
    accent === 'primary'
      ? 'bg-gradient-to-r from-[var(--color-xhs-red)] to-[var(--color-xhs-red-soft)]'
      : 'bg-gradient-to-r from-[#f97316] to-[#facc15]'

  return (
    <div className="flex h-[96px] flex-col justify-between rounded-2xl border border-white/70 bg-[var(--color-card)] px-3.5 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
      <div className={`h-0.5 w-8 rounded-full ${accentBar}`} />
      <div>
        <div className="text-[11px] font-medium text-slate-500">{label}</div>
        <div className="mt-1 text-xl font-semibold leading-tight tracking-tight text-slate-900">
          {value}
        </div>
      </div>
    </div>
  )
}
