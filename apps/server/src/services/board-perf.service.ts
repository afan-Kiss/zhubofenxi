/**
 * Wave4: 经营看板性能观测 — Server-Timing + 结构化累计指标
 */
import { logInfo } from '../utils/server-log'

export type BoardCacheSource = 'memory' | 'snapshot' | 'rebuilt' | 'stale-fallback'

export type BoardPerfPhase =
  | 'auth'
  | 'rangeResolve'
  | 'browserVersionCheck'
  | 'memoryCacheLookup'
  | 'cacheGenerationCheck'
  | 'snapshotRead'
  | 'rawOrderLoad'
  | 'rawOrderNormalize'
  | 'liveSessionLoad'
  | 'settlementLoad'
  | 'afterSalesLoad'
  | 'attribution'
  | 'metricAggregate'
  | 'leaderboard'
  | 'livePeriod'
  | 'trend'
  | 'completeness'
  | 'overviewMeta'
  | 'serialize'
  | 'total'
  | 'backgroundRebuildEnqueue'

export interface BoardPerfTrace {
  route: 'overview' | 'anchors' | 'full' | 'build' | string
  cacheKey?: string
  cacheSource?: BoardCacheSource
  dataGeneration?: string
  etag?: string
  buildDurationMs?: number
  payloadBytes?: number
  phases: Partial<Record<BoardPerfPhase, number>>
  startedAt: number
  mark(phase: BoardPerfPhase): void
  endPhase(phase: BoardPerfPhase): number
  finish(totalOverrideMs?: number): BoardPerfResult
}

export interface BoardPerfResult {
  route: string
  cacheKey?: string
  cacheSource?: BoardCacheSource
  totalMs: number
  phases: Partial<Record<BoardPerfPhase, number>>
  payloadBytes?: number
  etag?: string
  dataGeneration?: string
  buildDurationMs?: number
}

interface RouteAgg {
  samples: number[]
  payloadBytes: number[]
  hits: number
  misses: number
  builds: number
  deduped: number
}

const aggregates = new Map<string, RouteAgg>()
let concurrentBuildDedupedCount = 0
let buildCount = 0

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]!
}

function getAgg(route: string): RouteAgg {
  let a = aggregates.get(route)
  if (!a) {
    a = { samples: [], payloadBytes: [], hits: 0, misses: 0, builds: 0, deduped: 0 }
    aggregates.set(route, a)
  }
  return a
}

export function recordBoardCacheHit(route: string, source: BoardCacheSource): void {
  const a = getAgg(route)
  if (source === 'memory' || source === 'snapshot' || source === 'stale-fallback') a.hits += 1
  else a.misses += 1
}

export function recordBoardBuild(deduped: boolean): void {
  if (deduped) {
    concurrentBuildDedupedCount += 1
    getAgg('build').deduped += 1
  } else {
    buildCount += 1
    getAgg('build').builds += 1
  }
}

export function createBoardPerfTrace(
  route: string,
  meta?: { cacheKey?: string },
): BoardPerfTrace {
  const startedAt = Date.now()
  const phases: Partial<Record<BoardPerfPhase, number>> = {}
  const open = new Map<BoardPerfPhase, number>()

  const mark = (phase: BoardPerfPhase) => {
    open.set(phase, Date.now())
  }
  const endPhase = (phase: BoardPerfPhase): number => {
    const t0 = open.get(phase) ?? startedAt
    const ms = Math.max(0, Date.now() - t0)
    phases[phase] = (phases[phase] ?? 0) + ms
    open.delete(phase)
    return ms
  }

  return {
    route,
    cacheKey: meta?.cacheKey,
    phases,
    startedAt,
    mark,
    endPhase,
    finish(totalOverrideMs?: number): BoardPerfResult {
      const totalMs = totalOverrideMs ?? Math.max(0, Date.now() - startedAt)
      phases.total = totalMs
      const result: BoardPerfResult = {
        route,
        cacheKey: this.cacheKey,
        cacheSource: this.cacheSource,
        totalMs,
        phases: { ...phases },
        payloadBytes: this.payloadBytes,
        etag: this.etag,
        dataGeneration: this.dataGeneration,
        buildDurationMs: this.buildDurationMs,
      }
      const a = getAgg(route)
      a.samples.push(totalMs)
      if (a.samples.length > 500) a.samples.splice(0, a.samples.length - 500)
      if (typeof this.payloadBytes === 'number') {
        a.payloadBytes.push(this.payloadBytes)
        if (a.payloadBytes.length > 500) a.payloadBytes.splice(0, a.payloadBytes.length - 500)
      }
      if (this.cacheSource) recordBoardCacheHit(route, this.cacheSource)
      logInfo(
        '看板性能',
        JSON.stringify({
          route,
          cacheKey: this.cacheKey,
          cacheSource: this.cacheSource,
          totalMs,
          payloadBytes: this.payloadBytes,
          phases,
        }),
      )
      return result
    },
  }
}

export function buildServerTimingHeader(phases: Partial<Record<BoardPerfPhase, number>>): string {
  const parts: string[] = []
  for (const [name, dur] of Object.entries(phases)) {
    if (typeof dur !== 'number') continue
    parts.push(`${name};dur=${dur.toFixed(1)}`)
  }
  return parts.join(', ')
}

export function getBoardPerfSnapshot(): Record<
  string,
  {
    p50: number
    p95: number
    p99: number
    count: number
    payloadBytesP50: number
    cacheHitRate: number
    buildCount: number
    concurrentBuildDedupedCount: number
  }
> {
  const out: Record<string, ReturnType<typeof getBoardPerfSnapshot>[string]> = {}
  for (const [route, a] of aggregates) {
    const sorted = [...a.samples].sort((x, y) => x - y)
    const payloads = [...a.payloadBytes].sort((x, y) => x - y)
    const total = a.hits + a.misses
    out[route] = {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      count: sorted.length,
      payloadBytesP50: percentile(payloads, 50),
      cacheHitRate: total === 0 ? 0 : a.hits / total,
      buildCount: a.builds,
      concurrentBuildDedupedCount: a.deduped,
    }
  }
  out.__global__ = {
    p50: 0,
    p95: 0,
    p99: 0,
    count: 0,
    payloadBytesP50: 0,
    cacheHitRate: 0,
    buildCount,
    concurrentBuildDedupedCount,
  }
  return out
}

export function resetBoardPerfAggregatesForTests(): void {
  aggregates.clear()
  concurrentBuildDedupedCount = 0
  buildCount = 0
}

export function buildBoardEtag(parts: {
  cacheKey: string
  fingerprint: string
  generationToken: string
  lastBuiltAt: string
}): string {
  const raw = `${parts.cacheKey}|${parts.fingerprint}|${parts.generationToken}|${parts.lastBuiltAt}`
  // 轻量稳定 hash（不引入 crypto 依赖链成本）
  let h = 2166136261
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `"w4-${(h >>> 0).toString(16)}-${parts.lastBuiltAt.slice(0, 19)}"`
}

export function generationToken(gen: {
  ordersGeneration: number
  workbenchGeneration: number
  timeSearchGeneration: number
  scheduleGeneration: number
  manualOverrideGeneration: number
  offlineDealGeneration: number
}): string {
  return [
    gen.ordersGeneration,
    gen.workbenchGeneration,
    gen.timeSearchGeneration,
    gen.scheduleGeneration,
    gen.manualOverrideGeneration,
    gen.offlineDealGeneration,
  ].join('.')
}
