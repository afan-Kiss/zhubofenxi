import type { BoardLiveQueryData } from './board-live-query'
import type { BoardRangePreset } from './board-range'

export const LIVE_QUERY_CACHE_TTL_MS = 30 * 60 * 1000
/** 今日/昨日更短 TTL，同步后更快刷新 */
export const LIVE_QUERY_REALTIME_CACHE_TTL_MS = 90 * 1000
const STORAGE_KEY = 'board-live-query-cache-v1'
const STORAGE_PREFIX = 'board-live-query:v2:'
const INDEX_KEY = 'board-live-query:v2:__index__'
const MAX_ENTRIES = 24

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
  etag?: string
  dataGeneration?: string
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

function entryStorageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeIndex(keys: string[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(keys.slice(-MAX_ENTRIES)))
  } catch {
    /* quota */
  }
}

/** 迁移旧整包缓存一次 */
function migrateLegacyIfNeeded(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, LiveQueryCacheEntry>
    if (!parsed || typeof parsed !== 'object') {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    const keys: string[] = []
    for (const [k, entry] of Object.entries(parsed)) {
      if (!entry?.data) continue
      // 禁止把订单明细塞进长期缓存
      const slim = {
        ...entry,
        data: {
          ...entry.data,
          orders: [],
          allOrders: [],
          debug: {
            orderNos: [],
            includedOrderNos: [],
            excludedOrderNos: [],
            gmvField: entry.data.debug?.gmvField ?? '',
            formulaVersion: entry.data.debug?.formulaVersion ?? '',
          },
        },
      }
      localStorage.setItem(entryStorageKey(k), JSON.stringify(slim))
      keys.push(k)
    }
    writeIndex(keys)
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
}

function touchLru(key: string): void {
  const keys = readIndex().filter((k) => k !== key)
  keys.push(key)
  while (keys.length > MAX_ENTRIES) {
    const oldest = keys.shift()
    if (!oldest) break
    try {
      localStorage.removeItem(entryStorageKey(oldest))
    } catch {
      /* ignore */
    }
  }
  writeIndex(keys)
}

export function clearBoardLiveQueryCache(): void {
  try {
    const keys = readIndex()
    for (const k of keys) {
      localStorage.removeItem(entryStorageKey(k))
    }
    localStorage.removeItem(INDEX_KEY)
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** 清 localStorage 并通知各页面重新拉取 */
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
  migrateLegacyIfNeeded()
  try {
    const raw = localStorage.getItem(entryStorageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as LiveQueryCacheEntry
    if (!parsed?.data) return null
    return parsed
  } catch {
    return null
  }
}

export function writeLiveQueryCache(
  key: string,
  data: BoardLiveQueryData,
  meta?: { etag?: string; dataGeneration?: string },
): LiveQueryCacheEntry {
  migrateLegacyIfNeeded()
  const slimData: BoardLiveQueryData = {
    ...data,
    orders: [],
    allOrders: [],
    debug: {
      orderNos: [],
      includedOrderNos: [],
      excludedOrderNos: [],
      gmvField: data.debug?.gmvField ?? '',
      formulaVersion: data.debug?.formulaVersion ?? '',
    },
  }
  const entry: LiveQueryCacheEntry = {
    key,
    data: slimData,
    lastUpdatedAt: data.fetchedAt || new Date().toISOString(),
    savedAt: Date.now(),
    etag: meta?.etag,
    dataGeneration: meta?.dataGeneration,
  }
  try {
    localStorage.setItem(entryStorageKey(key), JSON.stringify(entry))
    touchLru(key)
  } catch {
    /* quota：清最旧再试一次 */
    try {
      const keys = readIndex()
      const oldest = keys.shift()
      if (oldest) localStorage.removeItem(entryStorageKey(oldest))
      writeIndex(keys)
      localStorage.setItem(entryStorageKey(key), JSON.stringify(entry))
      touchLru(key)
    } catch {
      /* ignore */
    }
  }
  return entry
}

/** 304：只刷新 savedAt，不替换数据 */
export function touchLiveQueryCacheTimestamp(key: string): void {
  const hit = readLiveQueryCache(key)
  if (!hit) return
  hit.savedAt = Date.now()
  try {
    localStorage.setItem(entryStorageKey(key), JSON.stringify(hit))
    touchLru(key)
  } catch {
    /* ignore */
  }
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
