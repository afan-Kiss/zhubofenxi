import type { BoardLiveQueryData } from './board-live-query'
import type { BoardRangePreset } from './board-range'

export const LIVE_QUERY_CACHE_TTL_MS = 30 * 60 * 1000
/** 今日/昨日更短 TTL，同步后更快刷新 */
export const LIVE_QUERY_REALTIME_CACHE_TTL_MS = 90 * 1000
const STORAGE_KEY = 'board-live-query-cache-v1'

/** 排班变更后广播，经营看板 / 主播业绩应重新拉取 */
export const BOARD_LIVE_QUERY_INVALIDATE_EVENT = 'board-live-query-invalidate'

/** 经营同步完成后广播，买家排行应重新拉取 */
export const BUYER_PROFILE_INVALIDATE_EVENT = 'buyer-profile-invalidate'

export type LiveQueryPageScope = 'overview' | 'anchors'

export interface LiveQueryCacheEntry {
  key: string
  data: BoardLiveQueryData
  lastUpdatedAt: string
  savedAt: number
}

export function buildLiveQueryCacheKey(params: {
  pageScope: LiveQueryPageScope
  preset: BoardRangePreset
  startDate: string
  endDate: string
  anchorId?: string
}): string {
  const anchor = params.anchorId?.trim() || '-'
  return `${params.pageScope}|${params.preset}|${params.startDate}|${params.endDate}|${anchor}`
}

function readAll(): Record<string, LiveQueryCacheEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, LiveQueryCacheEntry>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(map: Record<string, LiveQueryCacheEntry>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* quota */
  }
}

export function clearBoardLiveQueryCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** 清 localStorage 并通知各页面重新请求后端 */
export function invalidateBoardLiveQueryCache(reason?: string): void {
  clearBoardLiveQueryCache()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(BOARD_LIVE_QUERY_INVALIDATE_EVENT, { detail: { reason } }),
    )
  }
}

export function invalidateBuyerProfileCache(reason?: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(BUYER_PROFILE_INVALIDATE_EVENT, { detail: { reason } }),
    )
  }
}

export function readLiveQueryCache(key: string): LiveQueryCacheEntry | null {
  return readAll()[key] ?? null
}

export function writeLiveQueryCache(key: string, data: BoardLiveQueryData): LiveQueryCacheEntry {
  const entry: LiveQueryCacheEntry = {
    key,
    data,
    lastUpdatedAt: data.fetchedAt || new Date().toISOString(),
    savedAt: Date.now(),
  }
  const map = readAll()
  map[key] = entry
  writeAll(map)
  return entry
}

export function resolveLiveQueryCacheTtlMs(preset: string): number {
  if (preset === 'today' || preset === 'yesterday') return LIVE_QUERY_REALTIME_CACHE_TTL_MS
  return LIVE_QUERY_CACHE_TTL_MS
}

export function isLiveQueryCacheFresh(
  entry: LiveQueryCacheEntry,
  now = Date.now(),
  preset?: string,
): boolean {
  const ttl = preset ? resolveLiveQueryCacheTtlMs(preset) : LIVE_QUERY_CACHE_TTL_MS
  return now - entry.savedAt < ttl
}

export function formatDataUpdatedAt(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}
