import React from 'react'
import type { OperationsBiDrillRequest } from '../../pages/operations/operationsBiDrillTypes'
import { OperationsBiDrillLinkButton } from './OperationsBiDrillProvider'

interface Props {
  label: string
  value: React.ReactNode
  drillRequest?: OperationsBiDrillRequest | null
  footer?: React.ReactNode
}

export const OperationsMetricDrillCard: React.FC<Props> = ({
  label,
  value,
  drillRequest,
  footer,
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-3">
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-base font-semibold text-slate-900">{value}</p>
    {footer}
    {drillRequest ? (
      <div className="mt-2">
        <OperationsBiDrillLinkButton request={drillRequest} label="查看组成订单" />
      </div>
    ) : null}
  </div>
)
