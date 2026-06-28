import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { apiRequest, ApiError } from '../../lib/api'
import {
  DRILL_RANGE_TOO_LONG_MESSAGE,
  isDrillRangeTooLong,
} from '../../lib/operations-date-range'
import { OperationsBiDrillDrawer } from './OperationsBiDrillDrawer'
import { OperationsFloatingToast } from './OperationsViewportModal'
import type {
  OperationsBiDrillPayload,
  OperationsBiDrillRequest,
} from '../../pages/operations/operationsBiDrillTypes'

interface OperationsBiDrillContextValue {
  openDrill: (request: OperationsBiDrillRequest) => void
  closeDrill: () => void
}

const OperationsBiDrillContext = createContext<OperationsBiDrillContextValue | null>(null)

export function useOperationsBiDrill(): OperationsBiDrillContextValue {
  const ctx = useContext(OperationsBiDrillContext)
  if (!ctx) {
    throw new Error('useOperationsBiDrill 需在 OperationsBiDrillProvider 内使用')
  }
  return ctx
}

function OperationsToast({ message }: { message: string | null }) {
  return <OperationsFloatingToast message={message} />
}

export const OperationsBiDrillProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [request, setRequest] = useState<OperationsBiDrillRequest | null>(null)
  const [payload, setPayload] = useState<OperationsBiDrillPayload | null>(null)
  const [page, setPage] = useState(1)
  const [toast, setToast] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200)
  }, [])

  const load = useCallback(
    async (req: OperationsBiDrillRequest, nextPage = 1, signal?: AbortSignal) => {
      setLoading(true)
      try {
        const qs = new URLSearchParams()
        for (const [k, v] of Object.entries({ ...req, page: nextPage })) {
          if (v != null && v !== '') qs.set(k, String(v))
        }
        const data = await apiRequest<OperationsBiDrillPayload>(
          `/api/board/operations-bi-drill?${qs.toString()}`,
          { signal },
        )
        if (signal?.aborted) return
        setPayload(data)
        setPage(nextPage)
      } catch (e) {
        if (signal?.aborted) return
        abortRef.current = null
        setOpen(false)
        setPayload(null)
        setRequest(null)
        if (e instanceof ApiError) {
          showToast(e.message)
        } else {
          showToast(e instanceof Error ? e.message : '加载订单明细失败')
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
        }
      }
    },
    [showToast],
  )

  const openDrill = useCallback(
    (req: OperationsBiDrillRequest) => {
      if (isDrillRangeTooLong(req.startDate, req.endDate)) {
        showToast(DRILL_RANGE_TOO_LONG_MESSAGE)
        return
      }

      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      setRequest(req)
      setOpen(true)
      setPayload(null)
      void load(req, 1, ac.signal)
    },
    [load, showToast],
  )

  const closeDrill = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setOpen(false)
    setPayload(null)
    setRequest(null)
    setLoading(false)
  }, [])

  const value = useMemo(() => ({ openDrill, closeDrill }), [openDrill, closeDrill])

  return (
    <OperationsBiDrillContext.Provider value={value}>
      {children}
      <OperationsToast message={toast} />
      <OperationsBiDrillDrawer
        open={open}
        loading={loading}
        payload={payload}
        page={page}
        onClose={closeDrill}
        onPageChange={(p) => {
          if (!request) return
          abortRef.current?.abort()
          const ac = new AbortController()
          abortRef.current = ac
          void load(request, p, ac.signal)
        }}
      />
    </OperationsBiDrillContext.Provider>
  )
}

export const OperationsBiDrillLinkButton: React.FC<{
  request: OperationsBiDrillRequest
  label?: string
  className?: string
}> = ({ request, label = '查看组成订单', className = '' }) => {
  const { openDrill } = useOperationsBiDrill()
  return (
    <button
      type="button"
      onClick={() => openDrill(request)}
      className={`text-xs text-rose-700 hover:underline ${className}`.trim()}
    >
      {label}
    </button>
  )
}
