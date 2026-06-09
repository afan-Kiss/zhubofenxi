import React, { useEffect, useRef, useState } from 'react'

const EXIT_MS = 160
const ENTER_MS = 260

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface Props {
  /** 数据切换 key（日期 / Tab / updatedAt） */
  transitionKey?: string
  /** @deprecated 请用 transitionKey */
  rangeKey?: string
  loading?: boolean
  /** @deprecated 请用 loading */
  isLoading?: boolean
  className?: string
  mode?: 'soft-swap' | 'instant'
  children: React.ReactNode
}

/** 经营卡片区域：transitionKey 变化时 soft exit → swap → soft enter */
export const MetricGridTransition: React.FC<Props> = ({
  transitionKey,
  rangeKey,
  loading,
  isLoading,
  className = '',
  mode = 'soft-swap',
  children,
}) => {
  const key = transitionKey ?? rangeKey ?? 'static'
  const isRefreshing = Boolean(loading ?? isLoading)
  const childrenRef = useRef(children)
  childrenRef.current = children

  const containerRef = useRef<HTMLDivElement>(null)
  const displayKeyRef = useRef(key)
  const [visibleChildren, setVisibleChildren] = useState(children)
  const [animPhase, setAnimPhase] = useState<'idle' | 'exit' | 'enter'>('idle')
  const [minHeight, setMinHeight] = useState<number | undefined>()
  const swapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSwapTimer = () => {
    if (swapTimerRef.current != null) {
      clearTimeout(swapTimerRef.current)
      swapTimerRef.current = null
    }
  }

  useEffect(() => {
    if (key === displayKeyRef.current && animPhase === 'idle') {
      setVisibleChildren(childrenRef.current)
    }
  }, [key, animPhase, children])

  useEffect(() => {
    if (key === displayKeyRef.current) return

    clearSwapTimer()

    const applyInstant = (nextKey: string) => {
      displayKeyRef.current = nextKey
      setVisibleChildren(childrenRef.current)
      setAnimPhase('idle')
      setMinHeight(undefined)
    }

    if (mode === 'instant' || prefersReducedMotion()) {
      applyInstant(key)
      return clearSwapTimer
    }

    if (containerRef.current) {
      setMinHeight(containerRef.current.offsetHeight)
    }
    setAnimPhase('exit')

    swapTimerRef.current = setTimeout(() => {
      displayKeyRef.current = key
      setVisibleChildren(childrenRef.current)
      setAnimPhase('enter')
      swapTimerRef.current = setTimeout(() => {
        setAnimPhase('idle')
        setMinHeight(undefined)
        swapTimerRef.current = null
      }, ENTER_MS)
    }, EXIT_MS)

    return clearSwapTimer
  }, [key, mode])

  const animClass =
    animPhase === 'exit' ? 'board-soft-exit' : animPhase === 'enter' ? 'board-soft-enter' : ''

  return (
    <div
      ref={containerRef}
      className={`board-soft-swap board-metrics-grid ${isRefreshing ? 'board-metrics-grid--loading' : ''} ${className}`.trim()}
      style={minHeight != null ? { minHeight } : undefined}
    >
      {isRefreshing ? <div className="board-soft-swap-progress" aria-hidden /> : null}
      <div className={animClass}>{visibleChildren}</div>
    </div>
  )
}

export const StaggerCard: React.FC<{
  index: number
  children: React.ReactNode
  className?: string
}> = ({ index, children, className = '' }) => (
  <div
    className={`board-stagger-item ${className}`}
    style={{ ['--i' as string]: String(Math.min(index, 12)) }}
  >
    {children}
  </div>
)
