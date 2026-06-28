import React from 'react'
import type { BoardSyncMeta } from '../../lib/board-live-query'
import {
  BOARD_DATA_SOURCE_LABEL,
  compactSyncHint,
  deriveBoardSyncUiMode,
  resolveSyncingHeaderMessage,
} from '../../lib/business-sync-ui'

interface Props {
  syncMeta?: BoardSyncMeta | null
  hasDisplayData: boolean
  totalRawOrders?: number
}

/** 经营总览顶部：状态 A（已同步）/ 状态 B（有数据后台同步轻提示） */
export const BoardSyncStatusHeader: React.FC<Props> = ({
  syncMeta,
  hasDisplayData,
  totalRawOrders = 0,
}) => {
  if (!syncMeta) return null

  const mode = deriveBoardSyncUiMode({
    hasDisplayData,
    businessSync: syncMeta.businessSync,
    activeSyncJob: syncMeta.activeSyncJob,
    totalRawOrders,
  })

  if (mode === 'first_sync' || mode === 'empty_idle' || mode === 'empty_failed') {
    return null
  }

  if (mode === 'syncing_with_data') {
    const job = syncMeta.activeSyncJob ?? null
    const hint = compactSyncHint(job)
    return (
      <div className="mt-1 space-y-1">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {resolveSyncingHeaderMessage(job)}
          {hint ? <span className="mt-1 block text-amber-800">{hint}</span> : null}
        </p>
        <p className="text-xs text-slate-400">{BOARD_DATA_SOURCE_LABEL}</p>
      </div>
    )
  }

  return null
}
