import React from 'react'
import type { OperationsBiDrillRequest } from '../../pages/operations/operationsBiDrillTypes'
import { OperationsBiDrillLinkButton } from './OperationsBiDrillProvider'
import { OperationsFloatingToast } from './OperationsViewportModal'

interface Props {
  label: string
  value: React.ReactNode
  drillRequest?: OperationsBiDrillRequest | null
  drillUnavailableMessage?: string
  footer?: React.ReactNode
}

export const OperationsMetricDrillCard: React.FC<Props> = ({
  label,
  value,
  drillRequest,
  drillUnavailableMessage,
  footer,
}) => {
  const [toast, setToast] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(t)
  }, [toast])

  return (
    <div className="relative rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
      {footer}
      {drillRequest ? (
        <div className="mt-2">
          <OperationsBiDrillLinkButton request={drillRequest} label="查看组成订单" />
        </div>
      ) : drillUnavailableMessage ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setToast(drillUnavailableMessage)}
            className="text-xs text-rose-700 hover:underline"
          >
            查看明细
          </button>
        </div>
      ) : null}
      <OperationsFloatingToast message={toast} />
    </div>
  )
}
