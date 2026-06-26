import React from 'react'

export interface OperationsChartCardProps {
  title: string
  description?: string
  warning?: string
  hint?: string
  children: React.ReactNode
  onViewDetail?: () => void
  viewDetailLabel?: string
}

export const OperationsChartCard: React.FC<OperationsChartCardProps> = ({
  title,
  description,
  warning,
  hint,
  children,
  onViewDetail,
  viewDetailLabel = '查看明细',
}) => (
  <section
    className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 md:p-4"
    data-operations-chart
  >
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
        {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
      </div>
      {onViewDetail ? (
        <button
          type="button"
          onClick={onViewDetail}
          className="shrink-0 text-xs text-rose-700 hover:underline"
        >
          {viewDetailLabel}
        </button>
      ) : null}
    </div>
    {warning ? (
      <p className="mb-2 text-xs text-amber-700">{warning}</p>
    ) : null}
    <div className="w-full max-w-full overflow-x-auto">{children}</div>
  </section>
)
