import React from 'react'
import type { RankingConfidence } from '../../pages/operations/operationsReportTypes'

const CONF_LABEL: Record<RankingConfidence, string> = {
  high: '可靠',
  medium: '可参考',
  low: '谨慎参考',
  insufficient: '数据不足',
}

const CONF_CLASS: Record<RankingConfidence, string> = {
  high: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  medium: 'bg-sky-50 text-sky-800 border-sky-200',
  low: 'bg-amber-50 text-amber-800 border-amber-200',
  insufficient: 'bg-slate-100 text-slate-600 border-slate-200',
}

interface Props {
  reliable: boolean
  confidence: RankingConfidence
  warnings?: string[]
}

export const RankingQualityBadge: React.FC<Props> = ({ reliable, confidence, warnings }) => {
  const label = reliable ? CONF_LABEL[confidence] : CONF_LABEL.insufficient
  const cls = reliable ? CONF_CLASS[confidence] : CONF_CLASS.insufficient
  return (
    <div className="space-y-1">
      <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${cls}`}>
        {label}
      </span>
      {warnings && warnings.length > 0 ? (
        <ul className="text-xs text-amber-700">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
