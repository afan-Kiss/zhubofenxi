import { useEffect, useState } from 'react'
import { apiRequest } from '../lib/api'
import type { DataFreshnessInfo } from '../lib/data-freshness'

export function useDataFreshness(startDate: string | null | undefined, endDate: string | null | undefined) {
  const [data, setData] = useState<DataFreshnessInfo | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!startDate || !endDate) {
      setData(null)
      return
    }

    let cancelled = false
    setLoading(true)

    void apiRequest<DataFreshnessInfo>(
      `/api/board/data-freshness?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    )
      .then((payload) => {
        if (!cancelled) setData(payload)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [startDate, endDate])

  return { data, loading }
}
