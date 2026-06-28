import React from 'react'

interface Props {
  loading: boolean
  refreshing: boolean
  children: React.ReactNode
}

export const OperationsReportLoadShell: React.FC<Props> = ({
  loading,
  refreshing,
  children,
}) => (
  <div className={`relative ${loading ? 'board-soft-swap' : ''}`}>
    {loading ? (
      <div className="board-soft-swap-progress" role="progressbar" aria-label="正在加载报表" />
    ) : null}

    {refreshing ? (
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50/90 px-3 py-2 text-xs text-rose-800">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-rose-300 border-t-rose-600" />
        正在按新日期重新计算…
      </div>
    ) : null}

    <div
      className={
        refreshing ? 'pointer-events-none select-none opacity-55 transition-opacity duration-150' : ''
      }
    >
      {children}
    </div>
  </div>
)
