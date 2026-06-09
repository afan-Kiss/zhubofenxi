import React, { useEffect, useRef, useState } from 'react'

interface Props {
  value: number
  format: (n: number) => string
  durationMs?: number
  className?: string
  /** 与日期/Tab 切换联动，触发数字 pop */
  transitionKey?: string
}

export const AnimatedStatValue: React.FC<Props> = ({
  value,
  format,
  durationMs = 380,
  className = '',
  transitionKey = 'stat',
}) => {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number | null>(null)
  const [popTick, setPopTick] = useState(0)

  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) return

    setPopTick((t) => t + 1)
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - (1 - t) ** 3
      setDisplay(from + (to - from) * eased)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [value, durationMs, transitionKey])

  useEffect(() => {
    fromRef.current = value
    setDisplay(value)
  }, [])

  return (
    <span
      key={`${transitionKey}-${value}-${popTick}`}
      className={`board-number-pop ${className}`.trim()}
    >
      {format(display)}
    </span>
  )
}
