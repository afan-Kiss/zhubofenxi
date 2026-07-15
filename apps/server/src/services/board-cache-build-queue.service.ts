/**
 * Wave4: 按 cacheKey 单飞 + 全局并发上限 + 优先级，取消全局串行 fullRebuildQueue 阻塞无关请求
 */
import { recordBoardBuild } from './board-perf.service'

export type BoardBuildPriority =
  | 'interactive' // 当前用户请求 today/thisMonth
  | 'warmup-high' // today / thisMonth 预热
  | 'warmup-mid' // yesterday
  | 'custom'
  | 'warmup-low' // lastMonth / 售后后台

const PRIORITY_SCORE: Record<BoardBuildPriority, number> = {
  interactive: 100,
  'warmup-high': 80,
  'warmup-mid': 50,
  custom: 40,
  'warmup-low': 10,
}

const GLOBAL_CONCURRENCY = Math.max(1, Number(process.env.BOARD_BUILD_CONCURRENCY || 2))

type BuildTask<T> = {
  cacheKey: string
  priority: BoardBuildPriority
  run: () => Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
  enqueuedAt: number
}

const inFlight = new Map<string, Promise<unknown>>()
const waiting: BuildTask<unknown>[] = []
let active = 0

function sortWaiting(): void {
  waiting.sort((a, b) => {
    const pd = PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority]
    if (pd !== 0) return pd
    return a.enqueuedAt - b.enqueuedAt
  })
}

function pump(): void {
  while (active < GLOBAL_CONCURRENCY && waiting.length > 0) {
    sortWaiting()
    const next = waiting.shift()
    if (!next) break
    active += 1
    void (async () => {
      try {
        const value = await next.run()
        next.resolve(value)
      } catch (e) {
        next.reject(e)
      } finally {
        active -= 1
        inFlight.delete(next.cacheKey)
        pump()
      }
    })()
  }
}

export function inferBoardBuildPriority(params: {
  preset: string
  interactive?: boolean
}): BoardBuildPriority {
  if (params.interactive) return 'interactive'
  if (params.preset === 'today' || params.preset === 'thisMonth') return 'warmup-high'
  if (params.preset === 'yesterday' || params.preset === 'thisWeek') return 'warmup-mid'
  if (params.preset === 'custom') return 'custom'
  return 'warmup-low'
}

/**
 * 同一 cacheKey 只跑一个构建；其它调用者 await 同一 Promise（计为 deduped）。
 * 不同 cacheKey 可并行，受 GLOBAL_CONCURRENCY 限制。
 */
export function enqueueBoardCacheBuild<T>(params: {
  cacheKey: string
  priority: BoardBuildPriority
  run: () => Promise<T>
}): Promise<T> {
  const existing = inFlight.get(params.cacheKey) as Promise<T> | undefined
  if (existing) {
    recordBoardBuild(true)
    return existing
  }

  recordBoardBuild(false)
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  inFlight.set(params.cacheKey, promise)

  waiting.push({
    cacheKey: params.cacheKey,
    priority: params.priority,
    run: params.run,
    resolve: resolve as (v: unknown) => void,
    reject,
    enqueuedAt: Date.now(),
  })
  pump()
  return promise
}

export function isBoardCacheBuildInFlight(cacheKey: string): boolean {
  return inFlight.has(cacheKey)
}

export function getBoardBuildQueueDebug(): {
  active: number
  waiting: number
  inFlightKeys: string[]
} {
  return {
    active,
    waiting: waiting.length,
    inFlightKeys: [...inFlight.keys()],
  }
}
