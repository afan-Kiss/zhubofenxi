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
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [assigningOrderNo, setAssigningOrderNo] = useState<string | null>(null)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null)
  const [optionsReloadKey, setOptionsReloadKey] = useState(0)

  const reloadOptions = useCallback(() => {
    setOptionsReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!enabled) {
      setAnchorOptions([])
      setOptionsError(null)
      setAssignError(null)
      setAssignSuccess(null)
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
        setOptionsError(null)
        setAnchorOptions(
          mergeAnchorAssignOptions(
            (res.anchors ?? []).filter((a) => a.name.trim() && a.name !== '未归属'),
          ),
        )
      } catch (e) {
        if (controller.signal.aborted) return
        setAnchorOptions([])
        setOptionsError(e instanceof Error ? e.message : '加载主播选项失败')
      }
    })()
    return () => controller.abort()
  }, [enabled, optionsReloadKey])

  const handleManualAssign = useCallback(
    async (orderNo: string, targetAnchorName: string, currentAnchorName?: string) => {
      const target = targetAnchorName.trim()
      const current = normalizeAnchorName(currentAnchorName)
      if (!orderNo || !target) return
      if (target === current) return
      if (target === '未归属') return
      if (assigningOrderNo) return
      setAssignError(null)
      setAssignSuccess(null)
      setAssigningOrderNo(orderNo)
      try {
        const result = await apiRequest<{
          ok?: boolean
          anchorName?: string
          assignedBy?: string | null
          updatedAt?: string | null
        }>('/api/board/order-anchor-manual-assign', {
          method: 'POST',
          body: JSON.stringify({ orderNo, anchorName: target }),
        })
        invalidateBoardLiveQueryCache('order-anchor-manual-assign')
        const resolved = result.anchorName?.trim() || target
        let msg = `已将订单 ${orderNo} 手动指定给${resolved}`
        if (result.assignedBy || result.updatedAt) {
          const parts: string[] = []
          if (result.assignedBy) parts.push(`操作人 ${result.assignedBy}`)
          if (result.updatedAt) {
            try {
              parts.push(
                new Date(result.updatedAt).toLocaleString('zh-CN', {
                  hour12: false,
                  timeZone: 'Asia/Shanghai',
                }),
              )
            } catch {
              parts.push(result.updatedAt)
            }
          }
          if (parts.length) msg += `（${parts.join(' · ')}）`
        }
        setAssignSuccess(msg)
        onAssigned?.()
      } catch (e) {
        setAssignError(e instanceof Error ? e.message : '指定主播失败')
      } finally {
        setAssigningOrderNo(null)
      }
    },
    [onAssigned, assigningOrderNo],
  )

  const handleClearManualOverride = useCallback(
    async (orderNo: string) => {
      const key = orderNo.trim()
      if (!key) return
      if (assigningOrderNo) return
      setAssignError(null)
      setAssignSuccess(null)
      setAssigningOrderNo(key)
      try {
        await apiRequest('/api/board/order-anchor-manual-clear', {
          method: 'POST',
          body: JSON.stringify({ orderKey: key }),
        })
        invalidateBoardLiveQueryCache('order-anchor-manual-clear')
        setAssignSuccess(`已清除订单 ${key} 的手动指定`)
        onAssigned?.()
      } catch (e) {
        setAssignError(e instanceof Error ? e.message : '清除手动指定失败')
      } finally {
        setAssigningOrderNo(null)
      }
    },
    [onAssigned, assigningOrderNo],
  )

  const clearAssignError = useCallback(() => setAssignError(null), [])
  const clearAssignSuccess = useCallback(() => setAssignSuccess(null), [])

  return {
    anchorOptions,
    optionsError,
    reloadOptions,
    assigningOrderNo,
    assignError,
    assignSuccess,
    handleManualAssign,
    handleClearManualOverride,
    clearAssignError,
    clearAssignSuccess,
  }
}
