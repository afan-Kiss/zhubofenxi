/**
 * 运营报表成品缓存：日报 / 周报 / 月报 / 榜单中心
 * 仅加速读取，不改变报表构建口径。
 * 有登录用户时按 role / username 分缓存；本地免登录模式 fallback 到 local_viewer。
 */
import { BUSINESS_SYNC_INTERVAL_MINUTES } from '../config/business-sync.constants'
import { LOCAL_VIEWER_USER } from '../constants/local-viewer'
import type { SessionUser } from '../types/auth'
import type { UserRole } from '../types/roles'
import {
  addDaysShanghai,
  formatDateKeyShanghai,
  thisWeekStartKeyShanghai,
} from '../utils/business-timezone'
import { resolveBusinessRange } from '../utils/business-range'
import { resolveMonthlyReportRange } from './monthly-operations-report.service'
import { resolveStaffAnchorScope } from './staff-anchor-scope.service'
import { logInfo, logWarn } from '../utils/server-log'

export type OperationsReportCacheKind = 'daily' | 'weekly' | 'monthly' | 'rankings'

export interface OperationsReportCacheKeyInput {
  kind: OperationsReportCacheKind
  startDate: string
  endDate: string
  preset?: string
  scope?: string
  month?: string
  role?: string
  username?: string
  limit?: number
}

export interface OperationsReportCacheEntry<T = unknown> {
  cacheKey: string
  kind: OperationsReportCacheKind
  startDate: string
  endDate: string
  preset?: string
  scope?: string
  month?: string
  builtAt: string
  expiresAt: string
  staleAt: string
  buildDurationMs: number
  source: 'memory'
  payload: T
}

export interface OperationsReportCacheMeta {
  hit: boolean
  stale: boolean
  builtAt: string | null
  expiresAt: string | null
  buildDurationMs: number | null
  /** 与 hit 同义，便于前端展示 */
  fromCache: boolean
  /** 与 builtAt 同义 */
  generatedAt: string | null
  /** 与 buildDurationMs 同义 */
  computeMs: number | null
  refreshing?: boolean
  message?: string
}

const cache = new Map<string, OperationsReportCacheEntry>()
const pendingBuilds = new Map<string, Promise<OperationsReportCacheEntry>>()
let prewarmRunning = false
let prewarmPromise: Promise<{ warmed: number; failed: number; totalMs: number }> | null = null

/** 本地免登录看板固定身份 */
export function getLocalViewerCacheIdentity(): { role: UserRole; username: string } {
  return { role: LOCAL_VIEWER_USER.role, username: LOCAL_VIEWER_USER.username }
}

/** 请求上下文身份：有登录用户用真实身份，否则 fallback 本地看板 */
export function resolveRequestCacheIdentity(
  user?: Pick<SessionUser, 'role' | 'username'> | null,
): { role: UserRole; username: string } {
  const role = user?.role?.trim()
  const username = user?.username?.trim()
  if (role && username) {
    return { role: role as UserRole, username }
  }
  return getLocalViewerCacheIdentity()
}

function normalizeCacheKeyInput(input: OperationsReportCacheKeyInput): OperationsReportCacheKeyInput {
  const role = input.role?.trim()
  const username = input.username?.trim()
  if (role && username) {
    const scope = resolveStaffAnchorScope(role as UserRole, username)
    if (scope.kind === 'all') {
      const identity = getLocalViewerCacheIdentity()
      return { ...input, role: identity.role, username: identity.username }
    }
    return { ...input, role, username }
  }
  const identity = getLocalViewerCacheIdentity()
  return {
    ...input,
    role: identity.role,
    username: identity.username,
  }
}

function getCacheTtlMs(): number {
  const raw = process.env.OPERATIONS_REPORT_CACHE_TTL_MINUTES?.trim()
  const minutes = raw ? Number(raw) : BUSINESS_SYNC_INTERVAL_MINUTES
  const safe =
    Number.isFinite(minutes) && minutes > 0 ? minutes : BUSINESS_SYNC_INTERVAL_MINUTES
  return safe * 60 * 1000
}

export function buildOperationsReportCacheKey(input: OperationsReportCacheKeyInput): string {
  const normalized = normalizeCacheKeyInput(input)
  return [
    normalized.kind,
    normalized.startDate,
    normalized.endDate,
    normalized.month ?? '',
    normalized.preset ?? 'custom',
    normalized.scope ?? '',
    normalized.role ?? '',
    normalized.username ?? '',
    normalized.limit != null ? String(normalized.limit) : '',
  ].join('|')
}

export function getOperationsReportCache<T>(
  input: OperationsReportCacheKeyInput,
): OperationsReportCacheEntry<T> | null {
  const key = buildOperationsReportCacheKey(normalizeCacheKeyInput(input))
  return (cache.get(key) as OperationsReportCacheEntry<T> | undefined) ?? null
}

function isEntryFresh(entry: OperationsReportCacheEntry, nowMs = Date.now()): boolean {
  return nowMs < Date.parse(entry.expiresAt)
}

function buildCacheMeta(
  entry: OperationsReportCacheEntry | null,
  opts: {
    hit: boolean
    stale: boolean
    refreshing?: boolean
  },
): OperationsReportCacheMeta {
  const meta: OperationsReportCacheMeta = {
    hit: opts.hit,
    stale: opts.stale,
    builtAt: entry?.builtAt ?? null,
    expiresAt: entry?.expiresAt ?? null,
    buildDurationMs: entry?.buildDurationMs ?? null,
    fromCache: opts.hit,
    generatedAt: entry?.builtAt ?? null,
    computeMs: entry?.buildDurationMs ?? null,
  }
  if (opts.refreshing) meta.refreshing = true
  if (opts.hit && !opts.stale) {
    meta.message = '数据已提前算好，打开更快。'
  } else if (opts.hit && opts.stale) {
    meta.message = '正在后台更新，当前先显示上次算好的数据。'
  } else if (!opts.hit) {
    meta.message = '首次打开需要现场计算，后面再打开会更快。'
  }
  return meta
}

async function executeBuild<T>(
  input: OperationsReportCacheKeyInput,
  builder: () => Promise<T>,
): Promise<OperationsReportCacheEntry<T>> {
  const key = buildOperationsReportCacheKey(input)
  const started = Date.now()
  const payload = await builder()
  const builtAt = new Date().toISOString()
  const ttlMs = getCacheTtlMs()
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  const entry: OperationsReportCacheEntry<T> = {
    cacheKey: key,
    kind: input.kind,
    startDate: input.startDate,
    endDate: input.endDate,
    preset: input.preset,
    scope: input.scope,
    month: input.month,
    builtAt,
    expiresAt,
    staleAt: expiresAt,
    buildDurationMs: Date.now() - started,
    source: 'memory',
    payload,
  }
  cache.set(key, entry as OperationsReportCacheEntry)
  logInfo(
    '运营报表缓存',
    `${input.kind} 构建完成 ${input.startDate}~${input.endDate}，用时 ${entry.buildDurationMs}ms`,
  )
  return entry
}

function scheduleBackgroundRebuild<T>(
  input: OperationsReportCacheKeyInput,
  builder: () => Promise<T>,
): void {
  const key = buildOperationsReportCacheKey(input)
  if (pendingBuilds.has(key)) return
  const buildPromise = executeBuild(input, builder).finally(() => {
    pendingBuilds.delete(key)
  })
  pendingBuilds.set(key, buildPromise as Promise<OperationsReportCacheEntry>)
  void buildPromise.catch((err) => {
    logWarn(
      '运营报表缓存',
      `${input.kind} 后台刷新失败：${err instanceof Error ? err.message : String(err)}`,
    )
  })
}

export async function getOrBuildOperationsReportCache<T>(
  input: OperationsReportCacheKeyInput,
  builder: () => Promise<T>,
  options?: {
    forceRebuild?: boolean
    staleWhileRevalidate?: boolean
  },
): Promise<{
  payload: T
  cache: OperationsReportCacheMeta
  warning?: string
}> {
  const normalizedInput = normalizeCacheKeyInput(input)
  const forceRebuild = options?.forceRebuild ?? false
  const staleWhileRevalidate = options?.staleWhileRevalidate ?? true
  const key = buildOperationsReportCacheKey(normalizedInput)
  const existing = cache.get(key) as OperationsReportCacheEntry<T> | undefined

  if (!forceRebuild && existing && isEntryFresh(existing)) {
    logInfo('运营报表缓存', `cache hit ${input.kind} ${key}`)
    return {
      payload: existing.payload,
      cache: buildCacheMeta(existing, { hit: true, stale: false }),
    }
  }

  if (!forceRebuild && existing && !isEntryFresh(existing) && staleWhileRevalidate) {
    logInfo('运营报表缓存', `cache stale hit ${normalizedInput.kind} ${key}，后台刷新`)
    scheduleBackgroundRebuild(normalizedInput, builder)
    return {
      payload: existing.payload,
      cache: buildCacheMeta(existing, { hit: true, stale: true, refreshing: true }),
    }
  }

  const pending = pendingBuilds.get(key) as Promise<OperationsReportCacheEntry<T>> | undefined
  if (pending && !forceRebuild) {
    try {
      const entry = await pending
      const stale = !isEntryFresh(entry)
      return {
        payload: entry.payload,
        cache: buildCacheMeta(entry, { hit: true, stale }),
      }
    } catch {
      if (existing) {
        return {
          payload: existing.payload,
          cache: buildCacheMeta(existing, { hit: true, stale: true }),
          warning: '报表刷新失败，当前显示上次算好的数据',
        }
      }
      throw new Error('报表构建失败')
    }
  }

  const buildPromise = executeBuild(normalizedInput, builder).finally(() => {
    pendingBuilds.delete(key)
  })
  pendingBuilds.set(key, buildPromise as Promise<OperationsReportCacheEntry>)

  try {
    const entry = await buildPromise
    return {
      payload: entry.payload,
      cache: buildCacheMeta(entry, { hit: false, stale: false }),
    }
  } catch (err) {
    if (existing) {
      return {
        payload: existing.payload,
        cache: buildCacheMeta(existing, { hit: true, stale: true }),
        warning: '报表刷新失败，当前显示上次算好的数据',
      }
    }
    throw err
  }
}

export function invalidateOperationsReportCache(reason: string): void {
  const count = cache.size
  cache.clear()
  pendingBuilds.clear()
  prewarmPromise = null
  prewarmRunning = false
  logInfo('运营报表缓存', `已清空 ${count} 条缓存：${reason}`)
}

export function resolveMonthlyCacheKeyInput(params: {
  month?: string
  startDate?: string
  endDate?: string
  preset?: string
  role?: string
  username?: string
}): OperationsReportCacheKeyInput {
  const resolved = resolveMonthlyReportRange(params)
  const todayKey = formatDateKeyShanghai(new Date())
  const endDate = resolved.endDate > todayKey ? todayKey : resolved.endDate
  return normalizeCacheKeyInput({
    kind: 'monthly',
    startDate: resolved.startDate,
    endDate,
    month: resolved.month,
    preset: params.preset ?? 'custom',
    scope: params.month?.trim() ? 'monthly' : 'custom',
    role: params.role,
    username: params.username,
  })
}

/** 验收脚本：列出当前内存中的缓存 key */
export function listOperationsReportCacheKeys(): string[] {
  return [...cache.keys()]
}

export function getOperationsReportCacheStatus(): {
  entryCount: number
  byKind: Record<OperationsReportCacheKind, number>
  latestBuiltAt: string | null
  prewarmRunning: boolean
  pendingBuildCount: number
} {
  const byKind: Record<OperationsReportCacheKind, number> = {
    daily: 0,
    weekly: 0,
    monthly: 0,
    rankings: 0,
  }
  let latestBuiltAt: string | null = null
  for (const entry of cache.values()) {
    byKind[entry.kind] += 1
    if (!latestBuiltAt || entry.builtAt > latestBuiltAt) {
      latestBuiltAt = entry.builtAt
    }
  }
  return {
    entryCount: cache.size,
    byKind,
    latestBuiltAt,
    prewarmRunning,
    pendingBuildCount: pendingBuilds.size,
  }
}

type PrewarmTask = {
  label: string
  run: () => Promise<void>
}

function prewarmIdentity(): { role: UserRole; username: string } {
  return getLocalViewerCacheIdentity()
}

async function buildPrewarmTasks(
  forceRebuild: boolean,
  options?: { bootMode?: boolean },
): Promise<PrewarmTask[]> {
  const { buildDailyOperationsReport } = await import('./daily-operations-report.service')
  const { buildWeeklyOperationsReport } = await import('./weekly-operations-report.service')
  const { getMonthlyOperationsReport } = await import('./monthly-operations-report.service')
  const { getOperationsRankings } = await import('./operations-rankings.service')

  const identity = prewarmIdentity()
  const today = formatDateKeyShanghai(new Date())
  const yesterday = addDaysShanghai(today, -1)
  const thisWeekStart = thisWeekStartKeyShanghai()
  const lastWeekEnd = addDaysShanghai(thisWeekStart, -1)
  const lastWeekStart = addDaysShanghai(thisWeekStart, -7)
  const thisMonth = resolveBusinessRange('thisMonth')
  const lastMonth = resolveBusinessRange('lastMonth')

  const wrapDaily = (dateKey: string, label: string): PrewarmTask => ({
    label,
    run: async () => {
      await getOrBuildOperationsReportCache(
        {
          kind: 'daily',
          startDate: dateKey,
          endDate: dateKey,
          preset: 'custom',
          scope: 'daily',
          ...identity,
        },
        () =>
          buildDailyOperationsReport({
            preset: 'custom',
            startDate: dateKey,
            endDate: dateKey,
            role: identity.role,
            username: identity.username,
          }),
        { forceRebuild },
      )
    },
  })

  const wrapWeekly = (weekStart: string, weekEnd: string, label: string): PrewarmTask => ({
    label,
    run: async () => {
      await getOrBuildOperationsReportCache(
        {
          kind: 'weekly',
          startDate: weekStart,
          endDate: weekEnd,
          preset: 'custom',
          scope: 'weekly',
          ...identity,
        },
        () =>
          buildWeeklyOperationsReport({
            weekStart,
            weekEnd,
            preset: 'custom',
            role: identity.role,
            username: identity.username,
          }),
        { forceRebuild },
      )
    },
  })

  const wrapMonthly = (month: string, label: string): PrewarmTask => ({
    label,
    run: async () => {
      const keyInput = resolveMonthlyCacheKeyInput({
        month,
        preset: 'custom',
        ...identity,
      })
      await getOrBuildOperationsReportCache(
        keyInput,
        () =>
          getMonthlyOperationsReport({
            month,
            preset: 'custom',
            role: identity.role,
            username: identity.username,
          }),
        { forceRebuild },
      )
    },
  })

  const wrapRankings = (
    startDate: string,
    endDate: string,
    preset: string,
    scope: string,
    label: string,
  ): PrewarmTask => ({
    label,
    run: async () => {
      await getOrBuildOperationsReportCache(
        {
          kind: 'rankings',
          startDate,
          endDate,
          preset,
          scope,
          limit: 10,
          ...identity,
        },
        () =>
          getOperationsRankings({
            startDate,
            endDate,
            preset,
            scope: scope as 'daily' | 'weekly' | 'custom',
            limit: 10,
            role: identity.role,
            username: identity.username,
          }),
        { forceRebuild },
      )
    },
  })

  return [
    wrapDaily(today, '今日日报'),
    wrapDaily(yesterday, '昨日日报'),
    wrapWeekly(thisWeekStart, today, '本周周报'),
    ...(options?.bootMode
      ? []
      : [
          wrapWeekly(lastWeekStart, lastWeekEnd, '上周周报'),
          wrapMonthly(thisMonth.startDate.slice(0, 7), '本月月报'),
          wrapMonthly(lastMonth.startDate.slice(0, 7), '上月月报'),
        ]),
    wrapRankings(today, today, 'today', 'daily', '榜单中心（今日）'),
    wrapRankings(yesterday, yesterday, 'yesterday', 'daily', '榜单中心（昨日）'),
    wrapRankings(thisWeekStart, today, 'thisWeek', 'weekly', '榜单中心（本周）'),
    ...(options?.bootMode
      ? []
      : [
          wrapRankings(lastWeekStart, lastWeekEnd, 'lastWeek', 'custom', '榜单中心（上周）'),
          wrapRankings(thisMonth.startDate, thisMonth.endDate, 'thisMonth', 'custom', '榜单中心（本月）'),
          wrapRankings(lastMonth.startDate, lastMonth.endDate, 'lastMonth', 'custom', '榜单中心（上月）'),
        ]),
  ]
}

export async function prewarmOperationsReportCache(
  reason: string,
  options?: { forceRebuild?: boolean; bootMode?: boolean },
): Promise<{ warmed: number; failed: number; totalMs: number }> {
  if (prewarmPromise && !options?.forceRebuild) return prewarmPromise

  const started = Date.now()
  prewarmRunning = true
  const forceRebuild = options?.forceRebuild ?? false

  prewarmPromise = (async () => {
    logInfo('运营报表缓存', `开始提前计算常用报表（${reason}）`)
    const tasks = await buildPrewarmTasks(forceRebuild, options)
    let warmed = 0
    let failed = 0

    for (const task of tasks) {
      const taskStarted = Date.now()
      try {
        logInfo('运营报表缓存', `开始提前计算${task.label}`)
        await task.run()
        const sec = ((Date.now() - taskStarted) / 1000).toFixed(1)
        logInfo('运营报表缓存', `${task.label}提前计算完成，用时 ${sec} 秒`)
        warmed += 1
      } catch (err) {
        logWarn(
          '运营报表缓存',
          `${task.label}提前计算失败，稍后访问时再算：${err instanceof Error ? err.message : String(err)}`,
        )
        failed += 1
      }
    }

    const totalMs = Date.now() - started
    logInfo(
      '运营报表缓存',
      `常用报表提前计算结束：成功 ${warmed}，失败 ${failed}，总用时 ${(totalMs / 1000).toFixed(1)} 秒`,
    )
    return { warmed, failed, totalMs }
  })().finally(() => {
    prewarmRunning = false
  })

  return prewarmPromise
}

export async function prewarmCommonOperationsReportsOnBoot(): Promise<void> {
  await prewarmOperationsReportCache('服务启动', { bootMode: true })
}

export async function prewarmCommonOperationsReportsAfterBusinessSync(): Promise<void> {
  await prewarmOperationsReportCache('经营数据同步完成')
}

/** 验收脚本：将指定 key 标记为已过期 */
export function __testOnlyMarkCacheStale(input: OperationsReportCacheKeyInput): void {
  const key = buildOperationsReportCacheKey(input)
  const entry = cache.get(key)
  if (!entry) return
  const past = new Date(Date.now() - 1000).toISOString()
  entry.expiresAt = past
  entry.staleAt = past
}
