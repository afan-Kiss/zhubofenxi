import React from 'react'
import type { OperationsReportCacheMeta } from '../../pages/operations/operationsReportTypes'

interface Props {
  cacheMeta?: OperationsReportCacheMeta | null
  cacheWarning?: string | null
  className?: string
}

function resolveHintText(cacheMeta?: OperationsReportCacheMeta | null): string | null {
  if (cacheMeta?.message) return cacheMeta.message
  if (cacheMeta?.refreshing) {
    return '正在后台重算，先显示上次算好的数据。'
  }
  if (cacheMeta?.hit && cacheMeta.stale) {
    return '正在后台更新，当前先显示上次算好的数据。'
  }
  if (cacheMeta?.hit) {
    return '数据已提前算好，打开更快。'
  }
  if (cacheMeta && !cacheMeta.hit) {
    return '首次打开需要现场计算，后面再打开会更快。'
  }
  return null
}

export const OperationsReportCacheHint: React.FC<Props> = ({
  cacheMeta,
  cacheWarning,
  className = '',
}) => {
  const text = resolveHintText(cacheMeta)
  if (!text && !cacheWarning) return null

  return (
    <div className={`flex flex-wrap items-center gap-2 text-xs text-slate-500 ${className}`.trim()}>
      {text ? <span>{text}</span> : null}
      {cacheWarning ? <span className="text-amber-700">{cacheWarning}</span> : null}
    </div>
  )
}
