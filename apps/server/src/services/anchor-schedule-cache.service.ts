import { invalidateAndRebuildBusinessBoardCache } from './business-cache.service'
import { clearScheduleAttributionCache } from './anchor-schedule-attribution.service'
import { logInfo } from '../utils/server-log'

export async function invalidateBusinessBoardCacheForDate(dateKey: string): Promise<void> {
  clearScheduleAttributionCache()
  logInfo('主播排班', `排班变更，刷新经营缓存（含 ${dateKey}）`)
  await invalidateAndRebuildBusinessBoardCache(`anchor-schedule:${dateKey}`)
}

export async function recalculateAnchorDataForDate(dateKey: string): Promise<void> {
  await invalidateBusinessBoardCacheForDate(dateKey)
}
