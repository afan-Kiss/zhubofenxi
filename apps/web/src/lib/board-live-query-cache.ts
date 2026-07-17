import type { BoardLiveQueryData } from './board-live-query'
import type { BoardRangePreset } from './board-range'

export const LIVE_QUERY_CACHE_TTL_MS = 30 * 60 * 1000
/** 今日/昨日更短 TTL，同步后更快刷新 */
export const LIVE_QUERY_REALTIME_CACHE_TTL_MS = 90 * 1000
const STORAGE_KEY = 'board-live-query-cache-v1'
const STORAGE_PREFIX = 'board-live-query:v2:'
const INDEX_KEY = 'board-live-query:v2:__index__'
const IDB_NAME = 'zhubo-board-cache'
const IDB_STORE = 'live-query'
const IDB_VERSION = 1
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

const memory = new Map<string, LiveQueryCacheEntry>()
let idbReady: Promise<IDBDatabase | null> | null = null

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

/** 从缓存 key 推导 pageScope（key 形如 overview|preset|start|end|-） */
export function parsePageScopeFromCacheKey(key: string): LiveQueryPageScope | null {
  const scope = key.split('|')[0]
  if (scope === 'overview' || scope === 'anchors') return scope
  return null
}

/**
 * 校验/补齐缓存 payload 的 pageScope + queryKey。
 * 旧缓存无字段时可从 cacheKey 安全推导；无法确认则返回 null。
 */
export function resolveCachedBoardIdentity(params: {
  data: BoardLiveQueryData
  cacheKey: string
  expectedPageScope: LiveQueryPageScope
  expectedQueryKey: string
}): BoardLiveQueryData | null {
  const { data, cacheKey, expectedPageScope, expectedQueryKey } = params
  const keyScope = parsePageScopeFromCacheKey(cacheKey)
  const pageScope = data.pageScope ?? keyScope
  if (!pageScope || pageScope !== expectedPageScope) return null

  const queryKey =
    data.queryKey ??
    `${pageScope}|${data.preset}|${data.startDate}|${data.endDate}`
  if (queryKey !== expectedQueryKey) return null

  return {
    ...data,
    pageScope,
    queryKey,
  }
}

function entryStorageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`
}

function slimBoardData(data: BoardLiveQueryData): BoardLiveQueryData {
  return {
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
}

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!idbReady) {
    idbReady = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'key' })
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return idbReady
}

async function idbGet(key: string): Promise<LiveQueryCacheEntry | null> {
  const db = await openIdb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly')
      const req = tx.objectStore(IDB_STORE).get(key)
      req.onsuccess = () => {
        const v = req.result as LiveQueryCacheEntry | undefined
        resolve(v?.data ? v : null)
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function idbPut(entry: LiveQueryCacheEntry): Promise<void> {
  const db = await openIdb()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(entry)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

async function idbClear(): Promise<void> {
  const db = await openIdb()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
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
      const slim = { ...entry, data: slimBoardData(entry.data) }
      localStorage.setItem(entryStorageKey(k), JSON.stringify(slim))
      memory.set(k, slim)
      void idbPut(slim)
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
    memory.delete(oldest)
    try {
      localStorage.removeItem(entryStorageKey(oldest))
    } catch {
      /* ignore */
    }
    void idbDelete(oldest)
  }
  writeIndex(keys)
}

export function clearBoardLiveQueryCache(): void {
  try {
    const keys = readIndex()
    for (const k of keys) {
      memory.delete(k)
      localStorage.removeItem(entryStorageKey(k))
    }
    localStorage.removeItem(INDEX_KEY)
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  void idbClear()
}

export function removeLiveQueryCacheEntry(key: string): void {
  memory.delete(key)
  try {
    localStorage.removeItem(entryStorageKey(key))
    const raw = localStorage.getItem(INDEX_KEY)
    if (raw) {
      const index = JSON.parse(raw) as string[]
      const next = index.filter((k) => k !== key)
      localStorage.setItem(INDEX_KEY, JSON.stringify(next))
    }
  } catch {
    /* ignore */
  }
  void idbDelete(key).catch(() => undefined)
}

/** 仅清除某一 pageScope+preset+range 的浏览器缓存（不触发全量失效） */
export function invalidateLiveQueryCacheEntry(params: {
  pageScope: LiveQueryPageScope
  preset: BoardRangePreset
  startDate: string
  endDate: string
}): void {
  removeLiveQueryCacheEntry(buildLiveQueryCacheKey(params))
}

/** 清缓存并通知各页面重新拉取 */
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
  const mem = memory.get(key)
  if (mem?.data) return mem
  try {
    const raw = localStorage.getItem(entryStorageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as LiveQueryCacheEntry
    if (!parsed?.data) return null
    memory.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

export async function readLiveQueryCacheAsync(key: string): Promise<LiveQueryCacheEntry | null> {
  const sync = readLiveQueryCache(key)
  if (sync) return sync
  const fromIdb = await idbGet(key)
  if (fromIdb?.data) {
    memory.set(key, fromIdb)
    try {
      localStorage.setItem(entryStorageKey(key), JSON.stringify(fromIdb))
      touchLru(key)
    } catch {
      /* ignore */
    }
    return fromIdb
  }
  return null
}

export function writeLiveQueryCache(
  key: string,
  data: BoardLiveQueryData,
  meta?: { etag?: string; dataGeneration?: string },
): LiveQueryCacheEntry {
  migrateLegacyIfNeeded()
  const entry: LiveQueryCacheEntry = {
    key,
    data: slimBoardData(data),
    lastUpdatedAt: data.fetchedAt || new Date().toISOString(),
    savedAt: Date.now(),
    etag: meta?.etag,
    dataGeneration: meta?.dataGeneration,
  }
  memory.set(key, entry)
  void idbPut(entry)
  try {
    localStorage.setItem(entryStorageKey(key), JSON.stringify(entry))
    touchLru(key)
  } catch {
    try {
      const keys = readIndex()
      const oldest = keys.shift()
      if (oldest) {
        memory.delete(oldest)
        localStorage.removeItem(entryStorageKey(oldest))
        void idbDelete(oldest)
      }
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
  memory.set(key, hit)
  void idbPut(hit)
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

/** 标准预置键：用于启动/切换后后台预取 */
export const BOARD_STANDARD_PREFETCH_TARGETS: Array<{
  pageScope: LiveQueryPageScope
  preset: BoardRangePreset
}> = [
  { pageScope: 'overview', preset: 'today' },
  { pageScope: 'overview', preset: 'yesterday' },
  { pageScope: 'overview', preset: 'thisMonth' },
  { pageScope: 'overview', preset: 'lastMonth' },
  { pageScope: 'anchors', preset: 'today' },
  { pageScope: 'anchors', preset: 'yesterday' },
  { pageScope: 'anchors', preset: 'thisMonth' },
  { pageScope: 'anchors', preset: 'lastMonth' },
]
