import React from 'react'
import { Link } from 'react-router-dom'
import type { BoardActiveSyncJob } from '../../lib/board-live-query'
import {
  formatElapsedFromJob,
  formatPageProgress,
  formatReadingPrefix,
  formatSyncedCounts,
  resolveBusinessSyncCardDescription,
  resolveBusinessSyncCardTitle,
  resolveReadingStepLabel,
  resolveSyncProgressPercent,
  type BusinessSyncCardVariant,
} from '../../lib/business-sync-ui'

interface Props {
  variant: BusinessSyncCardVariant
  job?: BoardActiveSyncJob | null
  lastError?: string | null
  onTriggerSync?: () => void
  triggerSyncBusy?: boolean
  compact?: boolean
  totalRawOrders?: number
  lastSuccessAt?: string | null
}

export const BusinessSyncProgressCard: React.FC<Props> = ({
  variant,
  job,
  lastError,
  onTriggerSync,
  triggerSyncBusy,
  compact = false,
  totalRawOrders = 0,
  lastSuccessAt = null,
}) => {
  const showProgress = variant === 'first_sync' || variant === 'syncing_update'
  const pct = resolveSyncProgressPercent(job ?? null)
  const stepLabel = resolveReadingStepLabel(job ?? null)
  const readingPrefix = job ? formatReadingPrefix(job.currentStep) : '正在读取'
  const pageText = formatPageProgress(job ?? null)

  return (
    <div
      className={`rounded-2xl border bg-white ${
        variant === 'failed'
          ? 'border-red-200'
          : variant === 'empty_idle'
            ? 'border-dashed border-slate-200'
            : 'border-sky-200'
      } ${compact ? 'p-4' : 'p-6'}`}
    >
      <h3 className="text-base font-semibold text-slate-900">
        {resolveBusinessSyncCardTitle(variant, { totalRawOrders, lastSuccessAt })}
      </h3>
      <p className="mt-2 text-sm text-slate-600">{resolveBusinessSyncCardDescription(variant)}</p>
      {lastError && variant === 'failed' ? (
        <p className="mt-2 text-xs text-red-700">{lastError}</p>
      ) : null}

      {showProgress && job ? (
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-600">
              <span>同步进度</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-sky-500 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
          </div>
          <p className="text-sm text-slate-800">
            {readingPrefix}：{stepLabel}
          </p>
          {pageText ? <p className="text-xs text-slate-500">{pageText}</p> : null}
          <p className="text-xs text-slate-600">{formatSyncedCounts(job)}</p>
          <p className="text-[11px] text-slate-400">
            请求：成功 {job.successRequestCount} 次 · 失败 {job.failedRequestCount} 次
          </p>
          <p className="text-[11px] text-slate-400">已用时：{formatElapsedFromJob(job)}</p>
        </div>
      ) : null}

      {(variant === 'empty_idle' || variant === 'failed') && (
        <div className="mt-4 flex flex-wrap gap-2">
          {variant === 'empty_idle' && onTriggerSync ? (
            <button
              type="button"
              disabled={triggerSyncBusy}
              onClick={onTriggerSync}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {triggerSyncBusy ? '正在启动…' : '立即同步经营数据'}
            </button>
          ) : null}
          {variant === 'failed' ? (
            <>
              <Link
                to="/settings"
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                去系统设置
              </Link>
              {onTriggerSync ? (
                <button
                  type="button"
                  disabled={triggerSyncBusy}
                  onClick={onTriggerSync}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {triggerSyncBusy ? '正在启动…' : '重新同步'}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
