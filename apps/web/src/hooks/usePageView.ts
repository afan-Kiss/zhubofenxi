import { useEffect, useRef } from 'react'
import { apiRequest } from '../lib/api'

const HEARTBEAT_MS = 30_000

export function usePageView(page: string, path?: string): void {
  const viewIdRef = useRef<string | null>(null)

  useEffect(() => {
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let ended = false

    const endView = () => {
      const id = viewIdRef.current
      if (!id || ended) return
      ended = true
      viewIdRef.current = null
      void apiRequest('/api/audit/page-view/end', {
        method: 'POST',
        body: JSON.stringify({ viewId: id }),
      }).catch(() => undefined)
    }

    const start = async () => {
      try {
        const res = await apiRequest<{ viewId: string }>('/api/audit/page-view/start', {
          method: 'POST',
          body: JSON.stringify({ page, path }),
        })
        viewIdRef.current = res.viewId
        heartbeatTimer = setInterval(() => {
          if (!viewIdRef.current) return
          void apiRequest('/api/audit/page-view/heartbeat', {
            method: 'POST',
            body: JSON.stringify({ viewId: viewIdRef.current }),
          }).catch(() => undefined)
        }, HEARTBEAT_MS)
      } catch {
        /* 页面统计失败不影响主流程 */
      }
    }

    void start()
    window.addEventListener('beforeunload', endView)

    return () => {
      window.removeEventListener('beforeunload', endView)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      endView()
    }
  }, [page, path])
}
