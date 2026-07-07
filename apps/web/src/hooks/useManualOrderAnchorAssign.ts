import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../lib/api'
import { invalidateBoardLiveQueryCache } from '../lib/board-live-query-cache'

export function useManualOrderAnchorAssign(params: {
  enabled: boolean
  onAssigned?: () => void
}) {
  const { enabled, onAssigned } = params
  const [anchorOptions, setAnchorOptions] = useState<Array<{ id: string; name: string }>>([])
  const [assigningOrderNo, setAssigningOrderNo] = useState<string | null>(null)
  const [assignError, setAssignError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setAnchorOptions([])
      setAssignError(null)
      setAssigningOrderNo(null)
      return
    }
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await apiRequest<{ anchors: Array<{ id: string; name: string }> }>(
          '/api/anchors/options',
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        setAnchorOptions(
          (res.anchors ?? []).filter((a) => a.name.trim() && a.name !== '未归属'),
        )
      } catch {
        if (!controller.signal.aborted) setAnchorOptions([])
      }
    })()
    return () => controller.abort()
  }, [enabled])

  const handleManualAssign = useCallback(
    async (orderNo: string, targetAnchorName: string) => {
      if (!orderNo || !targetAnchorName) return
      setAssignError(null)
      setAssigningOrderNo(orderNo)
      try {
        await apiRequest('/api/board/order-anchor-manual-assign', {
          method: 'POST',
          body: JSON.stringify({ orderNo, anchorName: targetAnchorName }),
        })
        invalidateBoardLiveQueryCache('order-anchor-manual-assign')
        onAssigned?.()
      } catch (e) {
        setAssignError(e instanceof Error ? e.message : '指定主播失败')
      } finally {
        setAssigningOrderNo(null)
      }
    },
    [onAssigned],
  )

  const clearAssignError = useCallback(() => setAssignError(null), [])

  return {
    anchorOptions,
    assigningOrderNo,
    assignError,
    handleManualAssign,
    clearAssignError,
  }
}
