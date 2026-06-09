import React from 'react'
import { Loader2 } from 'lucide-react'
import { useBoardLiveQuery } from '../../providers/BoardLiveQueryProvider'

export const BoardLiveProgressBanner: React.FC = () => {
  const { status, error, isLoading, staleMessage } = useBoardLiveQuery()

  if (status === 'failed' && error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-100 bg-rose-50/80 px-4 py-2.5 text-xs text-rose-800">
        <Loader2 size={14} className="shrink-0 animate-spin" />
        <span>正在加载本地数据…</span>
      </div>
    )
  }

  if (staleMessage) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {staleMessage}
      </div>
    )
  }

  return null
}
