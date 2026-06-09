import React from 'react'

export interface QualityFeedbackStatus {
  lastSyncedAt: string | null
  autoSyncStatus: 'idle' | 'running' | 'failed'
  statusMessage: string
  caseCount?: number
  windowDays?: number
}

function formatSyncedAt(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

interface Props {
  qualityFeedback?: QualityFeedbackStatus | null
  showLastUpdated?: boolean
}

export const OfficialQualitySyncNote: React.FC<Props> = ({
  qualityFeedback,
  showLastUpdated = true,
}) => {
  if (!qualityFeedback) return null

  const lastUpdated = formatSyncedAt(qualityFeedback.lastSyncedAt)
  const isRunning = qualityFeedback.autoSyncStatus === 'running'
  const isFailed = qualityFeedback.autoSyncStatus === 'failed'
  const hasMessage = Boolean(qualityFeedback.statusMessage)

  if (!showLastUpdated && !isRunning && !isFailed && !hasMessage) return null

  return (
    <div className="space-y-1 text-xs text-slate-500">
      {showLastUpdated && lastUpdated ? (
        <p>官方品质反馈更新时间：{lastUpdated}</p>
      ) : showLastUpdated && !lastUpdated ? (
        <p>官方品质反馈：系统将在后台自动同步</p>
      ) : null}
      {isRunning ? (
        <p className="text-sky-700">数据正在自动更新，稍后会刷新品退明细。</p>
      ) : null}
      {isFailed && qualityFeedback.statusMessage ? (
        <p className="text-amber-700">{qualityFeedback.statusMessage}</p>
      ) : null}
    </div>
  )
}

export const UNMATCHED_OFFICIAL_QUALITY_HINT =
  '有 {count} 条官方品质反馈暂未匹配到系统订单，暂不计入核心品退率。系统正在自动同步订单数据，稍后会刷新品退明细。'
