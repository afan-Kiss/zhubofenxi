import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { apiRequest } from '../../lib/api'
import { OperationsBiDrillDrawer } from './OperationsBiDrillDrawer'
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

export const OperationsBiDrillProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState<OperationsBiDrillRequest | null>(null)
  const [payload, setPayload] = useState<OperationsBiDrillPayload | null>(null)
  const [page, setPage] = useState(1)

  const load = useCallback(async (req: OperationsBiDrillRequest, nextPage = 1) => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries({ ...req, page: nextPage })) {
        if (v != null && v !== '') qs.set(k, String(v))
      }
      const data = await apiRequest<OperationsBiDrillPayload>(
        `/api/board/operations-bi-drill?${qs.toString()}`,
      )
      setPayload(data)
      setPage(nextPage)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载数据来源失败')
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const openDrill = useCallback(
    (req: OperationsBiDrillRequest) => {
      setRequest(req)
      setOpen(true)
      void load(req, 1)
    },
    [load],
  )

  const closeDrill = useCallback(() => {
    setOpen(false)
    setError(null)
    setPayload(null)
    setRequest(null)
  }, [])

  const value = useMemo(() => ({ openDrill, closeDrill }), [openDrill, closeDrill])

  return (
    <OperationsBiDrillContext.Provider value={value}>
      {children}
      <OperationsBiDrillDrawer
        open={open}
        loading={loading}
        error={error}
        payload={payload}
        page={page}
        onClose={closeDrill}
        onPageChange={(p) => {
          if (request) void load(request, p)
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
