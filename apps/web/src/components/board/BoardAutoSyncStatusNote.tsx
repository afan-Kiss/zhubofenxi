import React from 'react'
import type { BoardSyncMeta } from '../../lib/board-live-query'
import {
  formatBusinessSyncTime,
  resolveBusinessSyncScheduleLines,
} from '../../lib/business-sync-ui'

const BUSINESS_SYNC_FAILED_HINT =
  '最近一次自动同步失败，系统会自动重试。'

interface Props {
  syncMeta?: BoardSyncMeta | null
}

export const BoardAutoSyncStatusNote: React.FC<Props> = ({ syncMeta }) => {
  if (!syncMeta) return null

  const biz = syncMeta.businessSync
  const schedule = resolveBusinessSyncScheduleLines(biz)

  let lastSyncLine: React.ReactNode
  if (biz.lastSuccessAt) {
    lastSyncLine = (
      <p>
        数据最后同步：
        <span className="font-medium text-slate-700">
          {formatBusinessSyncTime(biz.lastSuccessAt)}
        </span>
      </p>
    )
  } else if (biz.status === 'running') {
    lastSyncLine = <p className="text-blue-700">首次同步进行中，请稍后查看。</p>
  } else if (biz.status === 'queued') {
    lastSyncLine = <p className="text-blue-700">系统已自动排队补齐数据。</p>
  } else {
    lastSyncLine = (
      <p>
        数据最后同步：<span className="font-medium text-slate-700">—</span>
      </p>
    )
  }

  return (
    <div className="mt-1 space-y-1 text-xs text-slate-500">
      {lastSyncLine}
      <p className={schedule.autoSyncEnabled ? 'text-slate-600' : 'text-amber-800'}>
        {schedule.headline}
      </p>
      {schedule.autoSyncEnabled && schedule.nextRunText ? (
        <p>{schedule.nextRunText}</p>
      ) : null}
      {!schedule.autoSyncEnabled ? (
        <p className="text-amber-800">
          自动同步已关闭，页面不会自动更新；请到系统设置开启或手动同步。
        </p>
      ) : null}
      <p>当前展示：最近一次成功同步后的本地数据</p>
      <p className="text-slate-400">
        数据来源：订单、直播场次、售后、商品问题售后接口的本地同步结果
      </p>
      {biz.status === 'running' && biz.lastSuccessAt ? (
        <p className="text-blue-700">经营数据同步进行中，请稍后查看。</p>
      ) : null}
      {biz.status === 'failed' ? (
        <p className="text-amber-700">
          {BUSINESS_SYNC_FAILED_HINT}
          {biz.lastError ? `（${biz.lastError}）` : null}
        </p>
      ) : null}
    </div>
  )
}

export { BUSINESS_SYNC_FAILED_HINT }
