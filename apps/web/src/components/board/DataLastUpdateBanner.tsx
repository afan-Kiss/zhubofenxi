import React from 'react'
import {
  formatDataFreshnessTime,
  resolveDataSyncStaleness,
  type DataFreshnessInfo,
} from '../../lib/data-freshness'

interface Props {
  freshness: DataFreshnessInfo | null
  loading?: boolean
  className?: string
}

export const DataLastUpdateBanner: React.FC<Props> = ({ freshness, loading = false, className = '' }) => {
  const staleness = resolveDataSyncStaleness(freshness?.lastQianfanSyncAt)

  const alert =
    staleness === 'stale' ? (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        数据可能不是最新，请先同步。
      </p>
    ) : staleness === 'expired' || staleness === 'never' ? (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        数据已过期，不能用于经营判断。
      </p>
    ) : null

  return (
    <div className={`mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-600 ${className}`}>
      <p className="font-medium text-slate-800">数据最后更新时间</p>
      {loading && !freshness ? (
        <p className="text-slate-500">正在读取…</p>
      ) : (
        <>
          <p>
            本报表最新订单：
            <span className="ml-1 font-medium text-slate-800">
              {formatDataFreshnessTime(freshness?.latestOrderTime)}
            </span>
          </p>
          <p>
            最近从小红书拉取：
            <span className="ml-1 font-medium text-slate-800">
              {formatDataFreshnessTime(freshness?.lastQianfanSyncAt)}
            </span>
          </p>
        </>
      )}
      {alert}
    </div>
  )
}
