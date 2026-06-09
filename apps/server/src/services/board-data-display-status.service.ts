import type { BusinessSyncStatusValue } from './business-sync-scheduler.service'

export type BoardDataDisplayStatus =
  | 'ready'
  | 'syncing_with_cache'
  | 'syncing_no_cache'
  | 'failed_with_cache'
  | 'empty'

export function resolveBoardDataDisplayStatus(params: {
  orderCountInRange: number
  totalOrderCount: number
  lastSuccessAt: string | null
  syncStatus: BusinessSyncStatusValue
}): BoardDataDisplayStatus {
  const { orderCountInRange, totalOrderCount, lastSuccessAt, syncStatus } = params
  const isSyncing = syncStatus === 'running' || syncStatus === 'queued'
  const hasCache = Boolean(lastSuccessAt) || totalOrderCount > 0

  if (orderCountInRange > 0) {
    if (isSyncing) return 'syncing_with_cache'
    if (syncStatus === 'failed' && lastSuccessAt) return 'failed_with_cache'
    return 'ready'
  }

  if (totalOrderCount === 0) {
    if (isSyncing && !lastSuccessAt) return 'syncing_no_cache'
    return 'empty'
  }

  if (isSyncing && hasCache) return 'syncing_with_cache'
  if (syncStatus === 'failed' && lastSuccessAt) return 'failed_with_cache'
  return 'empty'
}

export function boardDataDisplayStatusMessage(status: BoardDataDisplayStatus): string {
  switch (status) {
    case 'syncing_with_cache':
      return '经营数据正在更新。'
    case 'syncing_no_cache':
      return '正在同步经营数据。'
    case 'failed_with_cache':
      return '本次更新失败，当前展示上一次成功同步数据。'
    case 'empty':
      return '当前日期范围内暂无订单数据。'
    default:
      return '已从本地同步数据加载'
  }
}

export function boardCachePreparingMessage(): string {
  return '经营数据正在准备中，请稍候…'
}
