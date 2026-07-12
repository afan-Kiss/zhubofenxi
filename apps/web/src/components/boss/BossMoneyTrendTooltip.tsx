import React from 'react'
import {
  BOSS_TREND_KEYS,
  BOSS_TREND_LABELS,
  centToDisplayYuan,
} from '../../lib/boss-dashboard-api'

type TrendRow = Record<string, string | number | null | undefined>

interface Props {
  label: string
  payload: TrendRow[]
  activeKey?: string
  visible: Record<string, boolean>
}

export const BossMoneyTrendTooltip: React.FC<Props> = ({ label, payload, activeKey, visible }) => {
  if (!payload?.length) return null
  const row = payload[0] as TrendRow
  const fullMonth = String(row.fullMonth ?? label)

  return (
    <div className="max-w-[390px] rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 text-xs shadow-lg backdrop-blur-sm">
      <div className="mb-2 font-medium text-slate-900">
        {fullMonth.includes('年') ? fullMonth : `${fullMonth.slice(0, 4)}年${fullMonth.slice(5)}月`}
      </div>
      <div className="space-y-1">
        {BOSS_TREND_KEYS.map((key) => {
          const raw = row[key]
          const cent = raw == null || raw === '' ? null : Number(raw)
          const hidden = visible[key] === false
          const isActive = activeKey === key
          return (
            <div
              key={key}
              className={`flex items-center justify-between gap-3 ${
                hidden ? 'opacity-45' : ''
              } ${isActive ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
            >
              <span className="min-w-0 truncate">
                {BOSS_TREND_LABELS[key]}
                {hidden ? '（已隐藏）' : ''}
              </span>
              <span className="shrink-0 tabular-nums">{centToDisplayYuan(cent)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
