import React from 'react'
import { BOARD_RANGE_PRESETS, type BoardRangePreset } from '../../lib/board-range'
import { AnimatedTabs } from '../ui/AnimatedTabs'

interface Props {
  preset: BoardRangePreset
  onPreset: (p: BoardRangePreset) => void
  customStart: string
  customEnd: string
  onCustomStart: (v: string) => void
  onCustomEnd: (v: string) => void
  onQuery?: () => void
  customQueried?: boolean
  showCustomQuery?: boolean
}

export const RangeBar: React.FC<Props> = ({
  preset,
  onPreset,
  customStart,
  customEnd,
  onCustomStart,
  onCustomEnd,
  onQuery,
  customQueried,
  showCustomQuery = true,
}) => {
  const validCustom = Boolean(customStart && customEnd && customStart <= customEnd)

  const tabItems = BOARD_RANGE_PRESETS.map((p) => ({ key: p.key, label: p.label }))

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-2xl border border-slate-100/90 bg-white/90 p-1.5 shadow-sm">
        <AnimatedTabs
          items={tabItems}
          activeKey={preset}
          onChange={(key) => onPreset(key as BoardRangePreset)}
          variant="pills"
          testIdPrefix="range-preset"
        />
      </div>
      {preset === 'custom' && (
        <div className="board-custom-panel-enter flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white p-3 text-xs">
          <input
            type="date"
            value={customStart}
            onChange={(e) => onCustomStart(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 transition focus:border-rose-300 focus:outline-none"
          />
          <span className="text-slate-400">至</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => onCustomEnd(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 transition focus:border-rose-300 focus:outline-none"
          />
          {showCustomQuery && (
            <button
              type="button"
              disabled={!validCustom}
              onClick={onQuery}
              className="rounded-full bg-slate-900 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              查询
            </button>
          )}
          {preset === 'custom' && !customQueried && validCustom && (
            <span className="text-slate-400">请选择日期后点击查询</span>
          )}
        </div>
      )}
    </div>
  )
}
