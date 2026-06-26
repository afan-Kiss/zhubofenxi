import React, { useState } from 'react'

interface Props {
  core: React.ReactNode
  more: React.ReactNode
}

export const OperationsCoreMetrics: React.FC<Props> = ({ core, more }) => {
  const [expanded, setExpanded] = useState(false)
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">核心指标</h3>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{core}</div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs text-slate-500 underline"
      >
        {expanded ? '收起更多指标' : '更多指标'}
      </button>
      {expanded ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{more}</div>
      ) : null}
    </section>
  )
}

interface CollapsibleProps {
  children: React.ReactNode
  totalCount: number
  defaultVisible?: number
  expandLabel?: string
}

export const CollapsibleTableSection: React.FC<CollapsibleProps> = ({
  children,
  totalCount,
  defaultVisible = 5,
  expandLabel = '查看完整榜单',
}) => {
  const [expanded, setExpanded] = useState(false)
  if (totalCount <= defaultVisible) return <>{children}</>
  return (
    <div>
      {children}
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-xs text-rose-700 hover:underline"
        >
          {expandLabel}（共 {totalCount} 条）
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2 text-xs text-slate-500 underline"
        >
          收起
        </button>
      )}
    </div>
  )
}

interface LimitedRowsProps<T> {
  rows: T[]
  limit: number
  expanded: boolean
  render: (rows: T[]) => React.ReactNode
}

export function LimitedRows<T>({ rows, limit, expanded, render }: LimitedRowsProps<T>) {
  const visible = expanded ? rows : rows.slice(0, limit)
  return <>{render(visible)}</>
}

interface WarningsProps {
  warnings: string[]
  max?: number
}

export const CollapsibleWarnings: React.FC<WarningsProps> = ({ warnings, max = 5 }) => {
  const [expanded, setExpanded] = useState(false)
  if (warnings.length === 0) return null
  const visible = expanded ? warnings : warnings.slice(0, max)
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <p className="mb-1 text-xs font-medium text-amber-800">数据提醒</p>
      <ul className="space-y-0.5 text-xs text-amber-800">
        {visible.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      {warnings.length > max ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-amber-700 underline"
        >
          {expanded ? '收起' : `还有 ${warnings.length - max} 条提醒`}
        </button>
      ) : null}
    </div>
  )
}
