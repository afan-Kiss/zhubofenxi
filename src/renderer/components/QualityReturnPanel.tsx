import React from 'react'
import type { QualityReturnInsight } from '../types/business'
import { formatCentToMoney, formatRate } from '../lib/businessAnalyzer'

interface QualityReturnPanelProps {
  insight: QualityReturnInsight
}

export const QualityReturnPanel: React.FC<QualityReturnPanelProps> = ({ insight: q }) => {
  return (
    <div className="rounded-xl border border-white/70 bg-[var(--color-card)] px-2.5 py-2 shadow-sm">
      <div className="text-[10px] font-medium text-slate-600">品退分析</div>
      {q.reasonMissing ? (
        <p className="mt-1 text-[10px] text-amber-600">原因缺失，无法判断</p>
      ) : null}
      <div className="mt-1 grid grid-cols-3 gap-x-2 gap-y-1 text-[9px]">
        <div>
          <span className="text-slate-400">品退单数</span>
          <div className="font-semibold text-slate-800">{q.qualityReturnCount}</div>
        </div>
        <div>
          <span className="text-slate-400">品退金额</span>
          <div className="font-semibold text-slate-800">
            {formatCentToMoney(q.qualityReturnAmountCent)}
          </div>
        </div>
        <div>
          <span className="text-slate-400">品退率</span>
          <div className="font-semibold text-rose-500">{formatRate(q.qualityReturnRate)}</div>
        </div>
        <div>
          <span className="text-slate-400">涉及买家</span>
          <div className="font-semibold text-slate-800">{q.buyerCount}</div>
        </div>
        <div className="col-span-2">
          <span className="text-slate-400">最高买家</span>
          <div className="truncate font-semibold text-slate-800">
            {q.topBuyerId} · {formatCentToMoney(q.topBuyerAmountCent)}
          </div>
        </div>
      </div>
    </div>
  )
}
