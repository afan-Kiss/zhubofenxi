import React from 'react'
import type { BoardSyncMeta } from '../../lib/board-live-query'
import {
  BOARD_DATA_SOURCE_LABEL,
  compactSyncHint,
  deriveBoardSyncUiMode,
  resolveSyncingHeaderMessage,
} from '../../lib/business-sync-ui'

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

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

  const biz = syncMeta.businessSync
  const intervalMinutes = biz.intervalMinutes ?? 180
  return (
    <div className="mt-1 space-y-1 text-xs text-slate-500">
      <p className="font-medium text-slate-700">数据已同步</p>
      <p>
        最近同步：<span className="font-medium text-slate-700">{fmt(biz.lastSuccessAt)}</span>
      </p>
      <p>
        下次自动同步：<span className="font-medium text-slate-700">{fmt(biz.nextRunAt)}</span>
      </p>
      <p>同步频率：经营数据每 {intervalMinutes} 分钟自动同步</p>
      <p className="text-slate-400">{BOARD_DATA_SOURCE_LABEL}</p>
      {biz.status === 'failed' && biz.lastError ? (
        <p className="text-amber-700">
          最近一次自动同步失败，系统会自动重试。（{biz.lastError}）
        </p>
      ) : null}
    </div>
  )
}
