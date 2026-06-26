import { useEffect, useState } from 'react'

export function useChartTopLimit(): number {
  const [limit, setLimit] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 5 : 10,
  )

  useEffect(() => {
    const onResize = () => setLimit(window.innerWidth < 768 ? 5 : 10)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return limit
}
