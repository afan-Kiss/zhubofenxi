import {
  invalidateBusinessBoardCache,
  scheduleBusinessBoardCacheRebuild,
} from './business-cache.service'
import { clearScheduleAttributionCache } from './anchor-schedule-attribution.service'
import { logInfo } from '../utils/server-log'

/** 排班变更：立即失效归属与经营缓存，全量重建在后台进行 */
export function invalidateBusinessBoardCacheForDate(dateKey: string): void {
  clearScheduleAttributionCache()
  invalidateBusinessBoardCache()
  logInfo('主播排班', `排班变更，后台刷新经营缓存（含 ${dateKey}）`)
  scheduleBusinessBoardCacheRebuild(`anchor-schedule:${dateKey}`)
}

export function recalculateAnchorDataForDate(dateKey: string): void {
  invalidateBusinessBoardCacheForDate(dateKey)
}
