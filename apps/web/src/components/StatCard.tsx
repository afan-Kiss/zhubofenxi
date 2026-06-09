import React from 'react'

interface StatCardProps {
  label: string
  value: React.ReactNode
  accent?: 'primary' | 'secondary'
  onClick?: () => void
  hint?: string
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, accent = 'primary', onClick, hint }) => {
  const accentBar =
    accent === 'primary'
      ? 'bg-gradient-to-r from-[var(--color-xhs-red)] to-[var(--color-xhs-red-soft)]'
      : 'bg-gradient-to-r from-[#f97316] to-[#facc15]'

  const clickable = Boolean(onClick)
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick?.()
            }
          : undefined
      }
      className={`group flex min-h-[96px] min-w-0 flex-col justify-between rounded-2xl border border-white/70 bg-[var(--color-card)] px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)] transition ${
        clickable ? 'card-clickable cursor-pointer hover:-translate-y-0.5 hover:border-rose-200 hover:shadow-lg' : ''
      }`}
    >
      <div className={`h-0.5 w-8 rounded-full ${accentBar}`} />
      <div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 transition-transform group-hover:scale-[1.02]">
          {value}
        </div>
        {hint && clickable && (
          <div className="mt-1 text-[10px] text-rose-500 opacity-0 transition group-hover:opacity-100">
            {hint}
          </div>
        )}
      </div>
    </div>
  )
}
