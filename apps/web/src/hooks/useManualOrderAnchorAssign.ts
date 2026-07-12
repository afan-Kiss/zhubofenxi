import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../lib/api'
import { mergeAnchorAssignOptions } from '../lib/anchor-session-assign-options'
import { invalidateBoardLiveQueryCache } from '../lib/board-live-query-cache'

function normalizeAnchorName(name: string | undefined | null): string {
  const trimmed = String(name ?? '').trim()
  return trimmed || '未归属'
}

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
          '/api/board/order-anchor-assign-options',
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        setAnchorOptions(
          mergeAnchorAssignOptions(
            (res.anchors ?? []).filter((a) => a.name.trim() && a.name !== '未归属'),
          ),
        )
      } catch {
        if (!controller.signal.aborted) setAnchorOptions(mergeAnchorAssignOptions([]))
      }
    })()
    return () => controller.abort()
  }, [enabled])

  const handleManualAssign = useCallback(
    async (orderNo: string, targetAnchorName: string, currentAnchorName?: string) => {
      const target = targetAnchorName.trim()
      const current = normalizeAnchorName(currentAnchorName)
      if (!orderNo || !target) return
      if (target === current) return
      if (target === '未归属') return
      setAssignError(null)
      setAssigningOrderNo(orderNo)
      try {
        await apiRequest('/api/board/order-anchor-manual-assign', {
          method: 'POST',
          body: JSON.stringify({ orderNo, anchorName: target }),
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

  const handleClearManualOverride = useCallback(
    async (orderNo: string) => {
      const key = orderNo.trim()
      if (!key) return
      setAssignError(null)
      setAssigningOrderNo(key)
      try {
        await apiRequest('/api/board/order-anchor-manual-clear', {
          method: 'POST',
          body: JSON.stringify({ orderKey: key }),
        })
        invalidateBoardLiveQueryCache('order-anchor-manual-clear')
        onAssigned?.()
      } catch (e) {
        setAssignError(e instanceof Error ? e.message : '清除手动指定失败')
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
    handleClearManualOverride,
    clearAssignError,
  }
}
