import {
  endOfMonthKeyShanghai,
  startOfMonthKeyShanghai,
} from './business-timezone'

export type DataSyncStaleness = 'ok' | 'stale' | 'expired' | 'never'

const TWO_HOURS_MS = 2 * 60 * 60 * 1000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export interface DataFreshnessInfo {
  startDate: string
  endDate: string
  latestOrderTime: string | null
  lastQianfanSyncAt: string | null
}

export function resolveDataSyncStaleness(
  lastQianfanSyncAt: string | null | undefined,
  nowMs: number = Date.now(),
): DataSyncStaleness {
  if (!lastQianfanSyncAt) return 'never'
  const syncedMs = new Date(lastQianfanSyncAt).getTime()
  if (!Number.isFinite(syncedMs)) return 'never'
  const ageMs = nowMs - syncedMs
  if (ageMs > TWENTY_FOUR_HOURS_MS) return 'expired'
  if (ageMs > TWO_HOURS_MS) return 'stale'
  return 'ok'
}

export function formatDataFreshnessTime(iso: string | null | undefined): string {
  if (!iso) return '暂无'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

export function resolveOperationsReportDateRange(input: {
  tab: 'daily' | 'weekly' | 'monthly' | 'rankings'
  dailyDate: string
  weekStart: string
  weekEnd: string
  monthKey: string
  rankStart: string
  rankEnd: string
}): { startDate: string; endDate: string } {
  if (input.tab === 'daily') {
    return { startDate: input.dailyDate, endDate: input.dailyDate }
  }
  if (input.tab === 'weekly') {
    return { startDate: input.weekStart, endDate: input.weekEnd }
  }
  if (input.tab === 'monthly') {
    const parts = input.monthKey.trim().split('-')
    const year = Number(parts[0])
    const month = Number(parts[1])
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return { startDate: input.monthKey, endDate: input.monthKey }
    }
    return {
      startDate: startOfMonthKeyShanghai(year, month),
      endDate: endOfMonthKeyShanghai(year, month),
    }
  }
  return { startDate: input.rankStart, endDate: input.rankEnd }
}
