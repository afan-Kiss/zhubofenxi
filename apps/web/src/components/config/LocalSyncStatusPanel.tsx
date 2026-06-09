import React from 'react'
import { BoardSyncStatusHeader } from '../board/BoardSyncStatusHeader'
import { BOARD_DATA_SOURCE_LABEL } from '../../lib/business-sync-ui'
import { useBoardLiveQuery } from '../../providers/BoardLiveQueryProvider'

export const LocalSyncStatusPanel: React.FC = () => {
  const { syncMeta, displaySummary, totalRawOrders } = useBoardLiveQuery()
  const intervalMinutes = syncMeta?.businessSync.intervalMinutes ?? 180

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">自动同步状态</h3>
      <p className="mt-1 text-xs text-slate-500">
        经营数据每 {intervalMinutes} 分钟自动同步；买家排行每天凌晨 3 点自动更新。页面只读取本地已同步数据，不会手动触发远程同步。
      </p>
      <div className="mt-3">
        <BoardSyncStatusHeader
          syncMeta={syncMeta}
          hasDisplayData={Boolean(displaySummary)}
          totalRawOrders={totalRawOrders}
        />
        <p className="mt-2 text-xs text-slate-400">{BOARD_DATA_SOURCE_LABEL}</p>
      </div>
    </section>
  )
}
