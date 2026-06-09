import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

export interface MainNavItem {
  to: string
  end?: boolean
  label: React.ReactNode
  dataTestId?: string
  requiresUnlock?: boolean
}

interface Props {
  items: MainNavItem[]
  onNavigate?: () => void
  onBeforeNavigate?: (to: string) => boolean
  className?: string
}

function resolveActiveKey(pathname: string, items: MainNavItem[]): string {
  const sorted = [...items].sort((a, b) => b.to.length - a.to.length)
  for (const item of sorted) {
    if (item.to === '/') {
      if (pathname === '/') return item.to
      continue
    }
    if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return item.to
  }
  return items[0]?.to ?? '/'
}

export const MainNavTabs: React.FC<Props> = ({ items, onNavigate, onBeforeNavigate, className = '' }) => {
  const { pathname } = useLocation()
  const activeKey = resolveActiveKey(pathname, items)
  const trackRef = useRef<HTMLDivElement>(null)
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map())
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false })

  const measure = useCallback(() => {
    const track = trackRef.current
    const link = linkRefs.current.get(activeKey)
    if (!track || !link) {
      setPill((p) => ({ ...p, ready: false }))
      return
    }
    const tr = track.getBoundingClientRect()
    const br = link.getBoundingClientRect()
    setPill({ left: br.left - tr.left, width: br.width, ready: true })
  }, [activeKey])

  useLayoutEffect(() => {
    measure()
  }, [measure, pathname])

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

  return (
    <div
      ref={trackRef}
      className={`board-tab-pill-track flex min-w-0 flex-col gap-1.5 md:flex-row md:flex-wrap md:items-center ${className}`}
    >
      <span
        className="board-tab-pill board-tab-pill--nav hidden md:block"
        style={{
          transform: `translateX(${pill.left}px)`,
          width: pill.ready ? pill.width : 0,
          opacity: pill.ready ? 1 : 0,
        }}
        aria-hidden
      />
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          data-testid={item.dataTestId}
          ref={(el) => {
            if (el) linkRefs.current.set(item.to, el)
            else linkRefs.current.delete(item.to)
          }}
          onClick={(e) => {
            if (onBeforeNavigate && !onBeforeNavigate(item.to)) {
              e.preventDefault()
              return
            }
            onNavigate?.()
          }}
          className={({ isActive }) =>
            `board-tab-btn relative z-[1] inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors md:w-auto md:py-2 ${
              isActive
                ? 'board-tab-btn--nav-active bg-white text-slate-900 shadow-md ring-2 ring-rose-100 md:bg-transparent md:shadow-none md:ring-0'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </div>
  )
}
