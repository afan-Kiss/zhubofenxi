import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Clock3 } from 'lucide-react'
import {
  formatScheduleTime,
  normalizeScheduleTimeInput,
  parseScheduleTime,
  SCHEDULE_END_PRESETS,
  SCHEDULE_HOUR_OPTIONS,
  SCHEDULE_MINUTE_OPTIONS,
  SCHEDULE_START_PRESETS,
} from '../../lib/schedule-time'

export interface ScheduleTimePickerProps {
  value: string
  onChange: (value: string) => void
  /** 结束时间可选 24:00 */
  allowMidnight?: boolean
  /** 常用时间快捷项 */
  presets?: readonly string[]
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

function displayLabel(value: string): string {
  const parts = parseScheduleTime(value)
  if (!parts) return '选择时间'
  if (parts.hour === 24) return '24:00'
  return formatScheduleTime(parts.hour, parts.minute)
}

export const ScheduleTimePicker: React.FC<ScheduleTimePickerProps> = ({
  value,
  onChange,
  allowMidnight = false,
  presets,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
}) => {
  const listId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
  const normalized = normalizeScheduleTimeInput(value, allowMidnight)
  const parts = parseScheduleTime(normalized) ?? { hour: 9, minute: 0 }
  const quickPresets =
    presets ?? (allowMidnight ? SCHEDULE_END_PRESETS : SCHEDULE_START_PRESETS)

  const updatePanelPosition = useCallback(() => {
    const btn = buttonRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const panelWidth = 248
    const panelHeight = panelRef.current?.offsetHeight ?? 300
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - panelWidth - 8)
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const placeBelow = spaceBelow >= panelHeight || spaceBelow >= spaceAbove

    setPanelStyle({
      position: 'fixed',
      left,
      width: panelWidth,
      zIndex: 9999,
      ...(placeBelow
        ? { top: rect.bottom + 6 }
        : { top: Math.max(8, rect.top - panelHeight - 6) }),
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updatePanelPosition()
    const raf = window.requestAnimationFrame(() => updatePanelPosition())
    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener('resize', updatePanelPosition)
      window.removeEventListener('scroll', updatePanelPosition, true)
    }
  }, [open, updatePanelPosition, parts.hour, parts.minute, allowMidnight])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const applyParts = (hour: number, minute: number) => {
    if (hour === 24) {
      onChange('24:00')
      return
    }
    onChange(formatScheduleTime(hour, minute))
  }

  const hourOptions = allowMidnight ? [...SCHEDULE_HOUR_OPTIONS, 24] : SCHEDULE_HOUR_OPTIONS

  const panel = open ? (
    <div
      ref={panelRef}
      id={listId}
      role="dialog"
      aria-label="选择时间"
      style={panelStyle}
      className="rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-200/60"
    >
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">常用</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {quickPresets.map((preset) => {
          const active = normalized === preset
          return (
            <button
              key={preset}
              type="button"
              onClick={() => {
                onChange(preset)
                setOpen(false)
              }}
              className={[
                'rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors',
                active
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-sky-100 hover:text-sky-900',
              ].join(' ')}
            >
              {preset}
            </button>
          )
        })}
      </div>

      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">小时</p>
      <div className="mb-3 grid grid-cols-6 gap-1">
        {hourOptions.map((hour) => {
          const active = parts.hour === hour
          const label = hour === 24 ? '24' : String(hour).padStart(2, '0')
          return (
            <button
              key={hour}
              type="button"
              onClick={() => {
                if (hour === 24) {
                  onChange('24:00')
                  setOpen(false)
                  return
                }
                applyParts(hour, parts.hour === 24 ? 0 : parts.minute)
              }}
              className={[
                'rounded-md py-1 text-xs font-medium tabular-nums transition-colors',
                active
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-50 text-slate-700 hover:bg-sky-100',
              ].join(' ')}
            >
              {label}
            </button>
          )
        })}
      </div>

      {parts.hour !== 24 ? (
        <>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">分钟</p>
          <div className="grid grid-cols-6 gap-1">
            {SCHEDULE_MINUTE_OPTIONS.map((minute) => {
              const active = parts.minute === minute
              return (
                <button
                  key={minute}
                  type="button"
                  onClick={() => {
                    applyParts(parts.hour, minute)
                    setOpen(false)
                  }}
                  className={[
                    'rounded-md py-1 text-xs font-medium tabular-nums transition-colors',
                    active
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-50 text-slate-700 hover:bg-sky-100',
                  ].join(' ')}
                >
                  {String(minute).padStart(2, '0')}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-500">已选至当天 24:00（午夜）</p>
      )}
    </div>
  ) : null

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel ?? `选择时间，当前 ${displayLabel(normalized)}`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={[
          'inline-flex min-w-[5.5rem] items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5',
          'text-sm font-semibold tabular-nums tracking-wide text-slate-800',
          'border-slate-200 bg-white shadow-sm transition-colors',
          'hover:border-sky-300 hover:bg-sky-50/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
          disabled ? 'cursor-not-allowed opacity-50' : '',
          open ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-400/30' : '',
        ].join(' ')}
      >
        <Clock3 size={14} className="shrink-0 text-sky-600" aria-hidden />
        {displayLabel(normalized)}
      </button>

      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </div>
  )
}

/** 排班表：开始—结束时段 */
export const ScheduleTimeRangePicker: React.FC<{
  startTime: string
  endTime: string
  onStartChange: (value: string) => void
  onEndChange: (value: string) => void
  disabled?: boolean
}> = ({ startTime, endTime, onStartChange, onEndChange, disabled }) => (
  <div className="inline-flex flex-wrap items-center gap-1.5">
    <ScheduleTimePicker
      value={startTime}
      onChange={onStartChange}
      disabled={disabled}
      aria-label="开始时间"
    />
    <span className="text-xs font-medium text-slate-400" aria-hidden>
      至
    </span>
    <ScheduleTimePicker
      value={endTime}
      onChange={onEndChange}
      allowMidnight
      disabled={disabled}
      aria-label="结束时间"
    />
  </div>
)
