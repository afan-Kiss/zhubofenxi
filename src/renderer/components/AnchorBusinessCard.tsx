import React from 'react'
import type { AnchorSummary } from '../types/business'
import { formatCentToMoney, formatRate } from '../lib/businessAnalyzer'

interface AnchorBusinessCardProps {
  data: AnchorSummary
  tone?: 'pink' | 'orange'
}

export const AnchorBusinessCard: React.FC<AnchorBusinessCardProps> = ({
  data,
  tone = 'pink',
}) => {
  const toneBg =
    tone === 'pink'
      ? 'from-[rgba(255,148,164,0.14)] to-[rgba(255,220,228,0.35)]'
      : 'from-[rgba(252,211,77,0.16)] to-[rgba(254,243,199,0.45)]'

  const rows = [
    ['GMV占比', formatRate(data.gmvShare)],
    ['订单', String(data.orderCount)],
    ['签收单', String(data.actualSignedCount)],
    ['签收额', formatCentToMoney(data.actualSignedAmountCent)],
    ['退货', `${data.returnCount} · ${formatRate(data.returnRate)}`],
    ['品退', `${data.qualityReturnCount} · ${formatCentToMoney(data.qualityReturnAmountCent)}`],
    ['已结算', formatCentToMoney(data.settledAmountCent)],
    ['待结算', formatCentToMoney(data.pendingAmountCent)],
    ['毛利', formatCentToMoney(data.grossProfitCent)],
  ]

  return (
    <div className="w-[148px] shrink-0 rounded-xl border border-white/70 bg-[var(--color-card)] shadow-sm">
      <div
        className={`flex items-center justify-between bg-gradient-to-r ${toneBg} px-2 py-1.5`}
      >
        <span className="text-[11px] font-semibold text-slate-800">{data.anchorName}</span>
        <span className="text-[10px] font-semibold text-slate-900">
          {formatCentToMoney(data.gmvCent)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-1 gap-y-0.5 px-2 py-1.5 text-[9px]">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-slate-400">{label}</div>
            <div className="truncate font-medium text-slate-800">{value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
