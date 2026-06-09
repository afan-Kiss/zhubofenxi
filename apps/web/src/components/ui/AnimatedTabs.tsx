import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface AnimatedTabItem {
  key: string
  label: React.ReactNode
}

interface Props {
  items: AnimatedTabItem[]
  activeKey: string
  onChange: (key: string) => void
  /** nav：白底 pill；pills：粉色 pill */
  variant?: 'pills' | 'nav'
  className?: string
  buttonClassName?: string
  /** 若设置，则为每个 tab 按钮生成 data-testid="{prefix}-{key}" */
  testIdPrefix?: string
}

export const AnimatedTabs: React.FC<Props> = ({
  items,
  activeKey,
  onChange,
  variant = 'pills',
  className = '',
  buttonClassName = '',
  testIdPrefix,
}) => {
  const trackRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false })

  const measure = useCallback(() => {
    const track = trackRef.current
    const btn = btnRefs.current.get(activeKey)
    if (!track || !btn) {
      setPill((p) => ({ ...p, ready: false }))
      return
    }
    const tr = track.getBoundingClientRect()
    const br = btn.getBoundingClientRect()
    setPill({ left: br.left - tr.left, width: br.width, ready: true })
  }, [activeKey])

  useLayoutEffect(() => {
    measure()
  }, [measure, items.length])

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(track)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  const isNav = variant === 'nav'
  const activeBtnClass = isNav ? 'board-tab-btn--nav-active' : 'board-tab-btn--active'

  return (
    <div
      ref={trackRef}
      className={`board-tab-pill-track flex flex-wrap gap-1 ${className}`}
      role="tablist"
    >
      <span
        className={`board-tab-pill ${isNav ? 'board-tab-pill--nav' : ''}`}
        style={{
          transform: `translateX(${pill.left}px)`,
          width: pill.ready ? pill.width : 0,
          opacity: pill.ready ? 1 : 0,
        }}
        aria-hidden
      />
      {items.map((item) => {
        const active = item.key === activeKey
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={testIdPrefix ? `${testIdPrefix}-${item.key}` : undefined}
            ref={(el) => {
              if (el) btnRefs.current.set(item.key, el)
              else btnRefs.current.delete(item.key)
            }}
            onClick={() => onChange(item.key)}
            className={`board-tab-btn rounded-full px-4 py-2.5 text-sm font-semibold ${buttonClassName} ${
              active
                ? activeBtnClass
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
