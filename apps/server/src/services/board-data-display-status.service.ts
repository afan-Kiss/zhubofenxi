import type { BusinessSyncStatusValue } from './business-sync-scheduler.service'
import type { BoardRangeCoverageStatus } from './board-range-coverage.service'

export type BoardDataDisplayStatus =
  | 'ready'
  | 'syncing_with_cache'
  | 'syncing_no_cache'
  | 'failed_with_cache'
  | 'empty'
  | 'coverage_missing'

export function resolveBoardDataDisplayStatus(params: {
  orderCountInRange: number
  /** @deprecated 不得再用于推断 coverage_missing；保留参数兼容旧调用 */
  totalOrderCount?: number
  lastSuccessAt: string | null
  syncStatus: BusinessSyncStatusValue
  coverageStatus: BoardRangeCoverageStatus
  cachePreparing?: boolean
}): BoardDataDisplayStatus {
  const {
    orderCountInRange,
    lastSuccessAt,
    syncStatus,
    coverageStatus,
    cachePreparing = false,
  } = params

  const isSyncing =
    syncStatus === 'running' ||
    syncStatus === 'queued' ||
    coverageStatus === 'syncing'

  if (orderCountInRange > 0) {
    if (isSyncing) return 'syncing_with_cache'
    if (syncStatus === 'failed' && lastSuccessAt) return 'failed_with_cache'
    return 'ready'
  }

  if (cachePreparing) {
    return isSyncing ? 'syncing_no_cache' : 'empty'
  }

  if (isSyncing) {
    return lastSuccessAt ? 'syncing_with_cache' : 'syncing_no_cache'
  }

  if (coverageStatus === 'not_covered') {
    return 'coverage_missing'
  }

  if (coverageStatus === 'covered') {
    return 'empty'
  }

  // unknown：不得冒充 coverage_missing
  if (syncStatus === 'failed' && lastSuccessAt) return 'failed_with_cache'
  return 'empty'
}

export function boardDataDisplayStatusMessage(
  status: BoardDataDisplayStatus,
  opts?: {
    coverageStatus?: BoardRangeCoverageStatus
    preset?: string
  },
): string {
  const coverage = opts?.coverageStatus
  const preset = opts?.preset

  switch (status) {
    case 'syncing_with_cache':
    case 'syncing_no_cache':
      if (preset === 'today') return '正在更新今日数据'
      if (preset === 'yesterday') return '正在更新昨日数据'
      return '经营数据正在更新。'
    case 'failed_with_cache':
      return '本次更新失败，当前展示上一次成功同步数据。'
    case 'empty':
      if (coverage === 'unknown') {
        return '暂未查询到数据，请重新加载；系统正在确认同步状态'
      }
      return '当前日期范围内暂无订单数据。'
    case 'coverage_missing':
      return '该日期范围尚未完成同步'
    default:
      return '已从本地同步数据加载'
  }
}

export function boardCachePreparingMessage(): string {
  return '数据正在准备中'
}
