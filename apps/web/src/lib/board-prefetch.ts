/**
 * Wave4 P2：看板标准预置后台预取（不阻塞当前页）
 */
import { resolveBoardRangeDates } from './board-range'
import {
  BOARD_STANDARD_PREFETCH_TARGETS,
  buildLiveQueryCacheKey,
  isLiveQueryCacheFresh,
  readLiveQueryCache,
  writeLiveQueryCache,
  type LiveQueryPageScope,
} from './board-live-query-cache'
import {
  fetchBoardAnchorsDataResult,
  fetchBoardOverviewResult,
} from './board-live-query'
import type { BoardRangePreset } from './board-range'

let prefetchRunning = false
const prefetchQueued = new Set<string>()

export function scheduleBoardStandardPrefetch(options?: {
  preferScope?: LiveQueryPageScope
}): void {
  if (typeof window === 'undefined') return
  const targets = [...BOARD_STANDARD_PREFETCH_TARGETS].sort((a, b) => {
    if (!options?.preferScope) return 0
    if (a.pageScope === options.preferScope && b.pageScope !== options.preferScope) return -1
    if (b.pageScope === options.preferScope && a.pageScope !== options.preferScope) return 1
    return 0
  })
  for (const t of targets) {
    prefetchQueued.add(`${t.pageScope}|${t.preset}`)
  }
  void drainPrefetchQueue()
}

async function drainPrefetchQueue(): Promise<void> {
  if (prefetchRunning) return
  prefetchRunning = true
  try {
    while (prefetchQueued.size > 0) {
      const next = prefetchQueued.values().next().value as string
      prefetchQueued.delete(next)
      const [pageScope, preset] = next.split('|') as [LiveQueryPageScope, BoardRangePreset]
      const dates = resolveBoardRangeDates(preset, '', '')
      const key = buildLiveQueryCacheKey({
        pageScope,
        preset,
        startDate: dates.startDate,
        endDate: dates.endDate,
      })
      const hit = readLiveQueryCache(key)
      if (hit && isLiveQueryCacheFresh(hit, Date.now(), preset)) continue
      try {
        const fetchFn =
          pageScope === 'anchors' ? fetchBoardAnchorsDataResult : fetchBoardOverviewResult
        const result = await fetchFn({
          preset,
          startDate: dates.startDate,
          endDate: dates.endDate,
          etag: hit?.etag,
        })
        if (result.notModified) {
          continue
        }
        writeLiveQueryCache(key, result.data, {
          etag: result.etag,
          dataGeneration: result.dataGeneration,
        })
      } catch {
        /* ignore prefetch errors */
      }
      await new Promise((r) => setTimeout(r, 80))
    }
  } finally {
    prefetchRunning = false
  }
}
