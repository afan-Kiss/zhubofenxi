import React from 'react'
import type { BoardSyncMeta } from '../../lib/board-live-query'

function fmt(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

const BUSINESS_SYNC_FAILED_HINT =
  '最近一次自动同步失败，系统会自动重试。'

interface Props {
  syncMeta?: BoardSyncMeta | null
}

export const BoardAutoSyncStatusNote: React.FC<Props> = ({ syncMeta }) => {
  if (!syncMeta) return null

  const biz = syncMeta.businessSync
  const intervalMinutes = biz.intervalMinutes ?? 180

  let lastSyncLine: React.ReactNode
  if (biz.lastSuccessAt) {
    lastSyncLine = (
      <p>
        数据最后同步：<span className="font-medium text-slate-700">{fmt(biz.lastSuccessAt)}</span>
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
      <p>
        下次自动同步：<span className="font-medium text-slate-700">{fmt(biz.nextRunAt)}</span>
      </p>
      <p>当前展示：最近一次成功同步后的本地数据</p>
      <p>同步频率：经营数据每 {intervalMinutes} 分钟自动同步</p>
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
