import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../lib/api'

export interface UseOperationsReportFetchResult<T> {
  data: T | null
  setData: React.Dispatch<React.SetStateAction<T | null>>
  loading: boolean
  refreshing: boolean
  error: string | null
  load: () => Promise<void>
}

export function useOperationsReportFetch<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: React.DependencyList,
): UseOperationsReportFetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const reqIdRef = useRef(0)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const reqId = ++reqIdRef.current

    setLoading(true)
    setError(null)

    try {
      const result = await loader(ac.signal)
      if (reqId !== reqIdRef.current || ac.signal.aborted) return
      setData(result)
    } catch (e) {
      if (ac.signal.aborted) return
      if (e instanceof DOMException && e.name === 'AbortError') return
      if (reqId !== reqIdRef.current) return
      if (e instanceof ApiError) {
        setError(e.message)
      } else if (e instanceof Error) {
        setError(e.message)
      } else {
        setError('加载失败')
      }
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false)
      }
    }
  }, deps)

  useEffect(() => {
    void load()
    return () => {
      abortRef.current?.abort()
    }
  }, [load])

  return {
    data,
    setData,
    loading,
    refreshing: loading && data != null,
    error,
    load,
  }
}
