import React from 'react'
import { Link } from 'react-router-dom'
import { Activity } from 'lucide-react'
import type { BoardActiveSyncJob } from '../../lib/board-live-query'
import {
  buildCookieBannerMessage,
  buildCookieHealthSummaryLine,
  type CookieHealthPayload,
} from '../../lib/live-account'
import { formatDataFreshnessTime } from '../../lib/data-freshness'
import {
  formatPageProgress,
  formatReadingPrefix,
  resolveReadingStepLabel,
  type BoardSyncUiMode,
} from '../../lib/business-sync-ui'

interface Props {
  boardSyncUiMode: BoardSyncUiMode
  staleMessage: string | null
  activeSyncJob: BoardActiveSyncJob | null
  lastSyncedAt: string | null
  lastSuccessAt: string | null
  totalRawOrders: number
  totalRawLiveSessions: number
  totalAfterSaleRecords: number
  totalQualityCases: number
  cookieHealth: CookieHealthPayload | null
  className?: string
}

type HealthTone = 'ok' | 'syncing' | 'warning' | 'cookie'

function resolveHealthPresentation(input: {
  boardSyncUiMode: BoardSyncUiMode
  staleMessage: string | null
  cookieHealth: CookieHealthPayload | null
}): { tone: HealthTone; headline: string } {
  const cannotSync = input.cookieHealth?.summary.cannotSyncCount ?? 0
  const hasCookieIssue = cannotSync > 0

  if (input.boardSyncUiMode === 'syncing_with_data') {
    return {
      tone: 'syncing',
      headline: '数据正在更新，当前先展示上一次成功结果。',
    }
  }

  if (input.staleMessage?.trim()) {
    return {
      tone: 'warning',
      headline: input.staleMessage.trim(),
    }
  }

  if (hasCookieIssue) {
    return {
      tone: 'cookie',
      headline: '有店铺 Cookie 不可同步，新订单可能不同步',
    }
  }

  return {
    tone: 'ok',
    headline: '数据可放心看',
  }
}

const toneClasses: Record<HealthTone, string> = {
  ok: 'border-emerald-200/80 bg-gradient-to-r from-emerald-50/80 to-white text-emerald-900',
  syncing: 'border-sky-200/80 bg-gradient-to-r from-sky-50/80 to-white text-sky-900',
  warning: 'border-amber-200/80 bg-gradient-to-r from-amber-50/80 to-white text-amber-900',
  cookie: 'border-rose-200/80 bg-gradient-to-r from-rose-50/80 to-white text-rose-900',
}

const headlineToneClasses: Record<HealthTone, string> = {
  ok: 'text-emerald-800',
  syncing: 'text-sky-800',
  warning: 'text-amber-800',
  cookie: 'text-rose-800',
}

function formatCountLine(label: string, count: number, unit: string, lowHint = false): React.ReactNode {
  return (
    <div className="text-[11px] leading-relaxed text-slate-600">
      <span>
        {label}：{count.toLocaleString('zh-CN')} {unit}
      </span>
      {lowHint && count === 0 ? (
        <span className="ml-1 text-amber-700">可能偏低，请确认是否已同步</span>
      ) : null}
    </div>
  )
}

export const DataHealthPanel: React.FC<Props> = ({
  boardSyncUiMode,
  staleMessage,
  activeSyncJob,
  lastSyncedAt,
  lastSuccessAt,
  totalRawOrders,
  totalRawLiveSessions,
  totalAfterSaleRecords,
  totalQualityCases,
  cookieHealth,
  className = '',
}) => {
  const { tone, headline } = resolveHealthPresentation({
    boardSyncUiMode,
    staleMessage,
    cookieHealth,
  })
  const syncTime = lastSuccessAt ?? lastSyncedAt
  const cookieSummary = buildCookieHealthSummaryLine(cookieHealth)
  const cookieDetail = buildCookieBannerMessage(cookieHealth)
  const showCookieDetail =
    Boolean(cookieDetail) &&
    tone !== 'warning' &&
    !(tone === 'syncing' && staleMessage)

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 shadow-sm ${toneClasses[tone]} ${className}`}
      data-testid="data-health-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/70 text-current">
            <Activity className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-800">数据健康</div>
            <p className={`mt-0.5 text-sm font-medium ${headlineToneClasses[tone]}`}>{headline}</p>
          </div>
        </div>
        {(cookieHealth?.summary.cannotSyncCount ?? 0) > 0 ? (
          <Link
            to="/settings#live-account-cookie"
            className="shrink-0 text-xs font-medium text-current underline underline-offset-2"
          >
            去系统设置
          </Link>
        ) : null}
      </div>

      {boardSyncUiMode === 'syncing_with_data' && activeSyncJob ? (
        <div className="mt-2 space-y-1 rounded-lg border border-sky-100/80 bg-white/60 px-2.5 py-2 text-[11px] leading-relaxed text-slate-700">
          <p>
            当前步骤：{formatReadingPrefix(activeSyncJob.currentStep)} ·{' '}
            {resolveReadingStepLabel(activeSyncJob)}
          </p>
          {formatPageProgress(activeSyncJob) ? (
            <p>当前页数：{formatPageProgress(activeSyncJob)}</p>
          ) : null}
          <p>已获取订单数：{activeSyncJob.orderCount.toLocaleString('zh-CN')} 笔</p>
          <p>已获取直播场次数：{activeSyncJob.liveSessionCount.toLocaleString('zh-CN')} 场</p>
          <p>
            请求：成功 {activeSyncJob.successRequestCount} 次 · 失败{' '}
            {activeSyncJob.failedRequestCount} 次
          </p>
        </div>
      ) : null}

      <div className="mt-2 grid gap-0.5 sm:grid-cols-2">
        <div className="text-[11px] text-slate-600">
          最近同步：{syncTime ? formatDataFreshnessTime(syncTime) : '暂无'}
        </div>
        {formatCountLine('订单数据', totalRawOrders, '笔')}
        {formatCountLine('直播场次', totalRawLiveSessions, '场')}
        {formatCountLine('售后数据', totalAfterSaleRecords, '条', true)}
        {formatCountLine('官方品退', totalQualityCases, '条', true)}
        {cookieSummary ? (
          <div className="text-[11px] leading-relaxed text-slate-600 sm:col-span-2">
            Cookie：{cookieSummary}
          </div>
        ) : null}
      </div>

      {showCookieDetail ? (
        <p className="mt-2 text-[11px] leading-relaxed text-rose-800">{cookieDetail}</p>
      ) : null}
    </div>
  )
}
