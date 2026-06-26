import React from 'react'
import type { BossSummaryItem } from '../../pages/operations/operationsReportTypes'

interface Props {
  items: BossSummaryItem[]
}

export const RankingSummaryCards: React.FC<Props> = ({ items }) => {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">暂无可靠摘要数据</p>
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div
          key={item.title}
          className={`rounded-2xl border p-3 ${
            item.empty ? 'border-slate-200 bg-slate-50' : 'border-rose-100 bg-white'
          }`}
        >
          <p className="text-xs text-slate-500">{item.title}</p>
          <p className="mt-1 text-base font-semibold text-slate-900">{item.primaryText}</p>
          {item.metrics.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
              {item.metrics.map((m) => (
                <li key={m.label}>{m.label}：{m.value}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-slate-500">{item.reason}</p>
        </div>
      ))}
    </div>
  )
}
