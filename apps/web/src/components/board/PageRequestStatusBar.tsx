import React from 'react'
import { useLocation } from 'react-router-dom'
import { resolveAppPageScope } from '../../lib/app-page-scope'
import { useDelayedVisible } from '../../hooks/useDelayedVisible'
import { useBoardLiveQuery } from '../../providers/BoardLiveQueryProvider'
import { BoardFloatingStatus } from './BoardFloatingStatus'

export const PageRequestStatusBar: React.FC = () => {
  const location = useLocation()
  const page = resolveAppPageScope(location.pathname)
  const { isLoading, staleMessage, error, status } = useBoardLiveQuery()
  const showHints = page === 'overview' || page === 'anchors'

  const loadingActive = showHints && isLoading
  const loadingVisible = useDelayedVisible(loadingActive, {
    delayMs: 300,
    minVisibleMs: 400,
  })

  if (!showHints) return null

  const staleText =
    staleMessage &&
    !loadingActive &&
    status !== 'failed'
      ? staleMessage.includes('自动同步失败') || staleMessage.includes('暂无')
        ? staleMessage
        : staleMessage
      : null

  return (
    <>
      <BoardFloatingStatus
        visible={loadingVisible}
        text="正在读取本地数据…"
        variant="loading"
      />
      {status === 'failed' && error ? (
        <BoardFloatingStatus visible text={`本地数据加载失败：${error}`} variant="error" />
      ) : null}
      {staleText ? (
        <BoardFloatingStatus visible text={staleText} variant="warning" />
      ) : null}
    </>
  )
}
