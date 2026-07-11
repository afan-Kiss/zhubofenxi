import React, { useCallback, useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

export interface MainNavItem {
  to: string
  end?: boolean
  label: string
  icon?: LucideIcon
  dataTestId?: string
  /** 次级入口视觉弱化（如系统设置） */
  tone?: 'default' | 'muted'
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

const tabBase =
  'main-nav-tab relative z-[1] inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-200 md:gap-2 md:px-3 md:py-1.5 md:text-sm'

function tabClass(isActive: boolean, tone: MainNavItem['tone'] = 'default'): string {
  if (isActive) {
    return `${tabBase} main-nav-tab--active bg-white/95 font-semibold text-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.07)] ring-1 ring-slate-200/80 [&_svg]:opacity-100`
  }
  if (tone === 'muted') {
    return `${tabBase} text-slate-500 hover:bg-white/50 hover:text-slate-700`
  }
  return `${tabBase} text-slate-600 hover:bg-white/45 hover:text-slate-900`
}

export const MainNavTabs: React.FC<Props> = ({ items, onNavigate, onBeforeNavigate, className = '' }) => {
  const { pathname } = useLocation()
  const activeKey = resolveActiveKey(pathname, items)
  const scrollRef = useRef<HTMLDivElement>(null)
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map())

  const scrollActiveIntoView = useCallback(() => {
    const scroller = scrollRef.current
    const link = linkRefs.current.get(activeKey)
    if (!scroller || !link) return
    const scrollerRect = scroller.getBoundingClientRect()
    const linkRect = link.getBoundingClientRect()
    const linkCenter = linkRect.left + linkRect.width / 2
    const scrollerCenter = scrollerRect.left + scrollerRect.width / 2
    const delta = linkCenter - scrollerCenter
    scroller.scrollBy({ left: delta, behavior: 'smooth' })
  }, [activeKey])

  useEffect(() => {
    scrollActiveIntoView()
  }, [scrollActiveIntoView, pathname])

  return (
    <div className={`main-nav-shell relative min-w-0 w-full ${className}`}>
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-5 bg-gradient-to-r from-[var(--color-bg-warm)]/95 to-transparent md:hidden"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-5 bg-gradient-to-r from-transparent to-[var(--color-bg-warm)]/95 md:hidden"
        aria-hidden
      />

      <div
        ref={scrollRef}
        className="main-nav-scroll flex min-h-[42px] items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-xl border border-slate-200/40 bg-white/35 px-1 py-1 backdrop-blur-sm [-ms-overflow-style:none] [scrollbar-width:none] md:min-h-0 md:gap-1 md:overflow-x-auto md:px-1.5 md:py-1 [&::-webkit-scrollbar]:hidden"
        role="navigation"
        aria-label="主导航"
      >
        {items.map((item) => {
          const Icon = item.icon
          return (
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
              className={({ isActive }) => tabClass(isActive, item.tone)}
            >
              {Icon ? (
                <Icon
                  size={15}
                  className="shrink-0 opacity-[0.82]"
                  strokeWidth={2}
                  aria-hidden
                />
              ) : null}
              <span className="whitespace-nowrap leading-none">{item.label}</span>
            </NavLink>
          )
        })}
      </div>
    </div>
  )
}
