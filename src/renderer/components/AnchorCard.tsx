import React from 'react'

export interface AnchorStats {
  name: string
  gmv: string
  orders: string
  signed: string
  returned: string
  returnRate: string
  validAmount: string
  billAmount: string
  diff: string
}

interface AnchorCardProps {
  data: AnchorStats
  tone?: 'pink' | 'orange'
}

export const AnchorCard: React.FC<AnchorCardProps> = ({ data, tone = 'pink' }) => {
  const toneBg =
    tone === 'pink'
      ? 'from-[rgba(255,148,164,0.14)] to-[rgba(255,220,228,0.35)]'
      : 'from-[rgba(252,211,77,0.16)] to-[rgba(254,243,199,0.45)]'

  const fields = [
    { label: '订单', value: data.orders },
    { label: '签收', value: data.signed, valueClass: 'text-emerald-600' },
    { label: '退货率', value: data.returnRate, valueClass: 'text-rose-500' },
    { label: '有效签收', value: data.validAmount },
    { label: '账单差额', value: data.diff, valueClass: 'text-amber-600' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/70 bg-[var(--color-card)] shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
      <div
        className={`flex shrink-0 items-center justify-between bg-gradient-to-r ${toneBg} px-3 py-2`}
      >
        <span className="rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-slate-800">
          {data.name}
        </span>
        <div className="text-right">
          <span className="text-[10px] text-slate-500">GMV</span>
          <div className="text-base font-semibold leading-tight text-slate-900">{data.gmv}</div>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-3 gap-x-2 gap-y-1.5 px-3 py-2 text-[11px]">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <div className="truncate text-slate-400">{f.label}</div>
            <div className={`truncate font-semibold text-slate-800 ${f.valueClass ?? ''}`}>
              {f.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
