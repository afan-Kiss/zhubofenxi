import { useEffect, useRef, useState } from 'react'

interface DelayedVisibleOptions {
  delayMs?: number
  minVisibleMs?: number
}

/** loading 超过 delayMs 才显示；显示后至少保留 minVisibleMs，避免闪一下 */
export function useDelayedVisible(
  active: boolean,
  { delayMs = 300, minVisibleMs = 400 }: DelayedVisibleOptions = {},
): boolean {
  const [visible, setVisible] = useState(false)
  const shownAtRef = useRef<number | null>(null)
  const visibleRef = useRef(false)
  visibleRef.current = visible

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    if (active) {
      timer = setTimeout(() => {
        shownAtRef.current = Date.now()
        setVisible(true)
      }, delayMs)
      return () => {
        if (timer) clearTimeout(timer)
      }
    }

    if (!visibleRef.current) {
      shownAtRef.current = null
      return undefined
    }

    const elapsed =
      shownAtRef.current != null ? Date.now() - shownAtRef.current : minVisibleMs
    timer = setTimeout(() => {
      shownAtRef.current = null
      setVisible(false)
    }, Math.max(0, minVisibleMs - elapsed))

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [active, delayMs, minVisibleMs])

  return visible
}
