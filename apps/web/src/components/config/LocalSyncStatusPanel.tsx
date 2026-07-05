import React, { useState } from 'react'
import { BoardSyncStatusHeader } from '../board/BoardSyncStatusHeader'
import {
  BOARD_DATA_SOURCE_LABEL,
  formatBusinessSyncTime,
  resolveBusinessSyncScheduleLines,
} from '../../lib/business-sync-ui'
import { useBoardLiveQuery } from '../../providers/BoardLiveQueryProvider'
import { apiRequest } from '../../lib/api'

export const LocalSyncStatusPanel: React.FC = () => {
  const { syncMeta, displaySummary, totalRawOrders, reload, triggerBusinessSync, triggerSyncBusy } =
    useBoardLiveQuery()
  const biz = syncMeta?.businessSync
  const schedule = resolveBusinessSyncScheduleLines(biz ?? { enabled: false })
  const [toggleBusy, setToggleBusy] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)

  const onToggleAutoSync = async (nextEnabled: boolean) => {
    setToggleBusy(true)
    setToggleError(null)
    try {
      await apiRequest('/api/sync/settings', {
        method: 'POST',
        body: JSON.stringify({ apiSyncEnabled: nextEnabled }),
      })
      if (nextEnabled) {
        await triggerBusinessSync()
      }
      await reload()
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setToggleBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">自动同步状态</h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            schedule.autoSyncEnabled
              ? 'bg-emerald-50 text-emerald-800'
              : 'bg-amber-50 text-amber-900'
          }`}
        >
          {schedule.autoSyncEnabled ? '自动同步已开启' : '自动同步已关闭'}
        </span>
      </div>

      <p className="mt-2 text-xs font-medium text-slate-700">{schedule.headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{schedule.detail}</p>

      {biz?.lastSuccessAt ? (
        <p className="mt-2 text-xs text-slate-500">
          最近一次成功同步：
          <span className="font-medium text-slate-700">
            {formatBusinessSyncTime(biz.lastSuccessAt)}
          </span>
        </p>
      ) : null}

      {schedule.nextRunText ? (
        <p className="mt-1 text-xs text-slate-500">{schedule.nextRunText}</p>
      ) : null}

      {!schedule.autoSyncEnabled ? (
        <p className="mt-2 text-xs text-amber-800">
          当前不会自动从千帆更新数据；若页面数据偏旧，请开启自动同步或手动触发一次。
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={toggleBusy || triggerSyncBusy}
          onClick={() => void onToggleAutoSync(!schedule.autoSyncEnabled)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
            schedule.autoSyncEnabled ? 'bg-slate-600 hover:bg-slate-700' : 'bg-sky-600 hover:bg-sky-700'
          }`}
        >
          {toggleBusy
            ? '保存中…'
            : schedule.autoSyncEnabled
              ? '关闭自动同步'
              : '开启自动同步'}
        </button>
        <button
          type="button"
          disabled={triggerSyncBusy || toggleBusy}
          onClick={() => void triggerBusinessSync()}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {triggerSyncBusy ? '正在启动…' : '立即同步一次'}
        </button>
      </div>

      {toggleError ? <p className="mt-2 text-xs text-red-600">{toggleError}</p> : null}

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
