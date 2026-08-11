/**
 * live_review 补齐纯函数（可单测，无 DB / HTTP）
 */
export type LiveReviewPartKey = 'overview' | 'traffic' | 'transform' | 'note'
export type LiveReviewPartStatus = 'missing' | 'ok' | 'failed' | 'empty_ok'

export type LiveReviewPartsStatus = Record<LiveReviewPartKey, LiveReviewPartStatus>

export const LIVE_REVIEW_PART_KEYS: LiveReviewPartKey[] = [
  'overview',
  'traffic',
  'transform',
  'note',
]

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function isPartStatus(v: unknown): v is LiveReviewPartStatus {
  return v === 'missing' || v === 'ok' || v === 'failed' || v === 'empty_ok'
}

/** 字段存在且非空数组/对象视为已有成功载荷 */
export function hasLiveReviewPartPayload(
  raw: Record<string, unknown>,
  part: LiveReviewPartKey,
): boolean {
  if (part === 'overview') return asRecord(raw._liveReviewOverview) != null
  if (part === 'traffic') return asRecord(raw._liveReviewTrafficCore) != null
  if (part === 'transform') return asRecord(raw._liveReviewTransform) != null
  if (part === 'note') {
    if (raw._liveReviewNoteDetailAvailable === true) return true
    if (Array.isArray(raw._liveReviewNotes) && raw._liveReviewNotes.length > 0) return true
    // 明确成功但空列表：total=0 且 status empty_ok / note fetched
    const st = asRecord(raw._liveReviewPartsStatus)
    if (st && (st.note === 'empty_ok' || st.note === 'ok')) return true
    return false
  }
  return false
}

/** 从 rawJson 推断/读取四分部状态 */
export function readLiveReviewPartsStatus(raw: Record<string, unknown>): LiveReviewPartsStatus {
  const stored = asRecord(raw._liveReviewPartsStatus)
  const out: LiveReviewPartsStatus = {
    overview: 'missing',
    traffic: 'missing',
    transform: 'missing',
    note: 'missing',
  }
  for (const key of LIVE_REVIEW_PART_KEYS) {
    const s = stored?.[key]
    if (isPartStatus(s)) {
      out[key] = s
      continue
    }
    if (hasLiveReviewPartPayload(raw, key)) {
      out[key] = key === 'note' && Array.isArray(raw._liveReviewNotes) && raw._liveReviewNotes.length === 0
        ? 'empty_ok'
        : 'ok'
    } else {
      out[key] = 'missing'
    }
  }
  return out
}

export function isLiveReviewPartSuccess(status: LiveReviewPartStatus): boolean {
  return status === 'ok' || status === 'empty_ok'
}

export function liveReviewPartsFullyComplete(status: LiveReviewPartsStatus): boolean {
  return LIVE_REVIEW_PART_KEYS.every((k) => isLiveReviewPartSuccess(status[k]))
}

/** 仍需请求的分部（缺失或失败） */
export function liveReviewPartsNeedingFetch(status: LiveReviewPartsStatus): LiveReviewPartKey[] {
  return LIVE_REVIEW_PART_KEYS.filter((k) => status[k] === 'missing' || status[k] === 'failed')
}

/** 历史补齐 / remaining：任一分部未成功即算 missing */
export function liveRawNeedsLiveReview(raw: Record<string, unknown>): boolean {
  return !liveReviewPartsFullyComplete(readLiveReviewPartsStatus(raw))
}

export function mergeLiveReviewPartsStatus(
  prev: LiveReviewPartsStatus,
  patch: Partial<LiveReviewPartsStatus>,
): LiveReviewPartsStatus {
  return {
    overview: patch.overview ?? prev.overview,
    traffic: patch.traffic ?? prev.traffic,
    transform: patch.transform ?? prev.transform,
    note: patch.note ?? prev.note,
  }
}

/** Detail / rawJson 部分刷新：成功字段不被 null/[] 覆盖 */
export function mergeLiveReviewDetailFields(
  previous: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const prev = previous ?? {}
  const out: Record<string, unknown> = { ...prev, ...incoming }

  const keepIfEmpty = (key: string, isEmpty: (v: unknown) => boolean) => {
    if (!(key in incoming)) return
    const next = incoming[key]
    if (isEmpty(next) && prev[key] != null && !isEmpty(prev[key])) {
      out[key] = prev[key]
    }
  }

  keepIfEmpty('overview', (v) => v == null)
  keepIfEmpty('trafficCore', (v) => v == null)
  keepIfEmpty('transform', (v) => v == null)
  keepIfEmpty('coverList', (v) => v == null || (Array.isArray(v) && v.length === 0))
  keepIfEmpty('notes', (v) => v == null || (Array.isArray(v) && v.length === 0))
  keepIfEmpty('noteTotal', (v) => v == null || v === 0)
  keepIfEmpty('noteDetailAvailable', (v) => v == null || v === false)
  keepIfEmpty('partsStatus', (v) => v == null)
  keepIfEmpty('syncedAt', (v) => v == null || v === '')

  // rawJson 侧同名字段
  keepIfEmpty('_liveReviewOverview', (v) => v == null)
  keepIfEmpty('_liveReviewTrafficCore', (v) => v == null)
  keepIfEmpty('_liveReviewTransform', (v) => v == null)
  keepIfEmpty('_liveReviewCoverList', (v) => v == null || (Array.isArray(v) && v.length === 0))
  keepIfEmpty('_liveReviewNotes', (v) => v == null || (Array.isArray(v) && v.length === 0))
  keepIfEmpty('_liveReviewNoteTotal', (v) => v == null || v === 0)
  keepIfEmpty('_liveReviewPartsStatus', (v) => v == null)

  return out
}

export interface LiveReviewCandidateRow {
  id: string
  startTime: Date | null
  endTime?: Date | null
  rawJson: unknown
}

export type LiveReviewSelectReason = 'missing_or_failed' | 'cooldown_refresh' | 'historical_refresh'

export const DEFAULT_DETAIL_COOLDOWN_MS = 6 * 60 * 60 * 1000
export const DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
/** 刚结束：下播后仍视为近期场次（与增量刷新窗口一致） */
export const RECENTLY_ENDED_MS = 2 * 60 * 60 * 1000

/** 按直播账号独立记录历史刷新完成时间 */
export function liveReviewHistoricalRefreshSettingKey(liveAccountId: string): string {
  const id = liveAccountId.trim()
  if (!id) throw new Error('liveAccountId required for historical refresh setting key')
  return `liveReviewLastHistoricalRefreshAt:${id}`
}

/** 是否应写入该账号的 lastHistoricalRefreshAt（必须 remainingDue === 0） */
export function shouldMarkAccountHistoricalRefreshDone(remainingRefreshDueCount: number): boolean {
  return remainingRefreshDueCount === 0
}

/**
 * 统计 historical_refresh 模式下仍需处理的场次（missing/failed 或 full 到期刷新）
 */
export function countHistoricalRefreshDue(
  rows: LiveReviewCandidateRow[],
  opts: { now?: number; refreshIntervalMs?: number },
): number {
  let n = 0
  for (const row of rows) {
    const reason = resolveLiveReviewSelectReason(row, {
      mode: 'historical_refresh',
      now: opts.now,
      refreshIntervalMs: opts.refreshIntervalMs ?? DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
    })
    if (reason) n++
  }
  return n
}

/**
 * 模拟「账号 A 完成后账号 B 仍可进 historical_refresh」的纯函数判定
 */
export function resolveHistoricalRefreshModeForAccount(params: {
  liveAccountId: string
  settings: Record<string, string | null | undefined>
  nowMs: number
  refreshIntervalMs?: number
}): 'historical_refresh' | 'incremental' {
  const key = liveReviewHistoricalRefreshSettingKey(params.liveAccountId)
  const raw = params.settings[key]
  const lastMs =
    typeof raw === 'string' && raw.trim() ? Date.parse(raw) : Number.NaN
  const interval = params.refreshIntervalMs ?? DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS
  if (!Number.isFinite(lastMs) || params.nowMs - lastMs >= interval) {
    return 'historical_refresh'
  }
  return 'incremental'
}

export function parseLiveReviewSyncedAtMs(raw: Record<string, unknown>): number | null {
  const full = raw._liveReviewFullySyncedAt
  const synced = raw._liveReviewSyncedAt
  for (const v of [full, synced]) {
    if (typeof v === 'string' && v.trim()) {
      const ms = Date.parse(v)
      if (Number.isFinite(ms)) return ms
    }
  }
  return null
}

function dateKeyFromMs(ms: number): string {
  // Asia/Shanghai YYYY-MM-DD via UTC+8 offset
  const d = new Date(ms + 8 * 3600_000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 增量：今天 / 昨天 / 仍在播 / 刚结束 */
export function isIncrementalRecentSession(
  row: { startTime: Date | null; endTime?: Date | null },
  opts: { now?: number; todayKey: string; yesterdayKey: string; recentlyEndedMs?: number },
): boolean {
  const now = opts.now ?? Date.now()
  const recentlyEndedMs = opts.recentlyEndedMs ?? RECENTLY_ENDED_MS
  if (row.endTime == null) return true
  if (row.endTime.getTime() > now - recentlyEndedMs) return true
  if (!row.startTime) return false
  const key = dateKeyFromMs(row.startTime.getTime())
  return key === opts.todayKey || key === opts.yesterdayKey
}

export function isCooldownRefreshDue(
  raw: Record<string, unknown>,
  opts: { now?: number; cooldownMs: number },
): boolean {
  if (liveRawNeedsLiveReview(raw)) return false
  const syncedAt = parseLiveReviewSyncedAtMs(raw)
  if (syncedAt == null) return true
  const now = opts.now ?? Date.now()
  return now - syncedAt >= opts.cooldownMs
}

export function isHistoricalRefreshDue(
  raw: Record<string, unknown>,
  opts: { now?: number; refreshIntervalMs: number },
): boolean {
  if (liveRawNeedsLiveReview(raw)) return false
  const syncedAt = parseLiveReviewSyncedAtMs(raw)
  if (syncedAt == null) return true
  const now = opts.now ?? Date.now()
  return now - syncedAt >= opts.refreshIntervalMs
}

export function resolveLiveReviewSelectReason(
  row: LiveReviewCandidateRow,
  opts: {
    mode: 'history_backfill' | 'historical_refresh' | 'incremental'
    now?: number
    todayKey?: string
    yesterdayKey?: string
    cooldownMs?: number
    refreshIntervalMs?: number
    recentlyEndedMs?: number
  },
): LiveReviewSelectReason | null {
  const raw = asRecord(row.rawJson) ?? {}
  if (liveRawNeedsLiveReview(raw)) return 'missing_or_failed'

  if (opts.mode === 'history_backfill') return null

  if (opts.mode === 'incremental') {
    const todayKey = opts.todayKey
    const yesterdayKey = opts.yesterdayKey
    if (!todayKey || !yesterdayKey) return null
    if (
      !isIncrementalRecentSession(row, {
        now: opts.now,
        todayKey,
        yesterdayKey,
        recentlyEndedMs: opts.recentlyEndedMs,
      })
    ) {
      return null
    }
    if (
      isCooldownRefreshDue(raw, {
        now: opts.now,
        cooldownMs: opts.cooldownMs ?? DEFAULT_DETAIL_COOLDOWN_MS,
      })
    ) {
      return 'cooldown_refresh'
    }
    return null
  }

  // historical_refresh
  if (
    isHistoricalRefreshDue(raw, {
      now: opts.now,
      refreshIntervalMs: opts.refreshIntervalMs ?? DEFAULT_HISTORICAL_REFRESH_INTERVAL_MS,
    })
  ) {
    return 'historical_refresh'
  }
  return null
}

/**
 * 候选选择：
 * - history_backfill：仅 missing/failed，最老优先
 * - incremental：missing/failed 优先；今天/昨天/刚结束的 full 可按 cooldown 刷新
 * - historical_refresh：missing/failed 优先；30 天窗内 full 可按 refreshInterval 刷新
 * 不得无条件用 liveRawNeedsLiveReview 滤掉全部 full 场次。
 */
export function selectLiveReviewEnrichCandidates<T extends LiveReviewCandidateRow>(
  rows: T[],
  opts: {
    mode: 'history_backfill' | 'historical_refresh' | 'incremental'
    maxSessions: number
    preferSessionIds?: Set<string>
    now?: number
    todayKey?: string
    yesterdayKey?: string
    cooldownMs?: number
    refreshIntervalMs?: number
    recentlyEndedMs?: number
  },
): Array<T & { selectReason: LiveReviewSelectReason }> {
  const scored: Array<T & { selectReason: LiveReviewSelectReason; priority: number }> = []
  for (const row of rows) {
    const reason = resolveLiveReviewSelectReason(row, opts)
    if (!reason) continue
    scored.push({
      ...row,
      selectReason: reason,
      priority: reason === 'missing_or_failed' ? 2 : 1,
    })
  }

  const prefer = opts.preferSessionIds
  scored.sort((a, b) => {
    if (prefer && prefer.size > 0) {
      const pa = prefer.has(a.id) ? 1 : 0
      const pb = prefer.has(b.id) ? 1 : 0
      if (pa !== pb) return pb - pa
    }
    if (a.priority !== b.priority) return b.priority - a.priority
    const ta = a.startTime?.getTime() ?? 0
    const tb = b.startTime?.getTime() ?? 0
    if (opts.mode === 'history_backfill') return ta - tb // oldest first
    // incremental / historical_refresh：同优先级下近期优先（缺详情也先啃近窗）
    if (a.selectReason === 'missing_or_failed' && b.selectReason === 'missing_or_failed') {
      // 缺详情：历史刷新窗内仍偏老优先，避免永远补不到旧的；增量窗短，用近期优先
      if (opts.mode === 'historical_refresh') return ta - tb
      return tb - ta
    }
    return tb - ta
  })

  return scored.slice(0, Math.max(0, opts.maxSessions)).map((row) => {
    const { priority: _priority, ...rest } = row
    return rest as T & { selectReason: LiveReviewSelectReason }
  })
}

/** 刷新类候选需重拉全部分部 */
export function liveReviewPartsForSelectReason(
  reason: LiveReviewSelectReason,
  status: LiveReviewPartsStatus,
): LiveReviewPartKey[] {
  if (reason === 'cooldown_refresh' || reason === 'historical_refresh') {
    return [...LIVE_REVIEW_PART_KEYS]
  }
  return liveReviewPartsNeedingFetch(status)
}

/** 全量扫描 remaining（禁止 take:N 截断后判完成） */
export function countLiveReviewRemainingMissing(rows: Array<{ rawJson: unknown }>): number {
  let n = 0
  for (const r of rows) {
    const raw = asRecord(r.rawJson) ?? {}
    if (liveRawNeedsLiveReview(raw)) n++
  }
  return n
}

/**
 * 同日偏移月份：按目标月实际最大日期 clamp（3/31 → 2/28|29）
 */
export function shiftMonthSameDay(dateKey: string, monthDelta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return dateKey
  const targetMonthIndex = m - 1 + monthDelta
  const probe = new Date(Date.UTC(y, targetMonthIndex, 1))
  const ty = probe.getUTCFullYear()
  const tm = probe.getUTCMonth()
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 本月 ∪ 上月同期 键并集（保留上月有、本月 0） */
export function unionMapKeys(...maps: Array<Map<string, unknown>>): string[] {
  const keys = new Set<string>()
  for (const m of maps) {
    for (const k of m.keys()) keys.add(k)
  }
  return [...keys].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function pickPrimaryCanonicalAnchorName(
  segments: Array<{ anchorName: string; overlapMinutes: number }>,
): string | null {
  if (!segments.length) return null
  const best = segments.reduce((a, b) =>
    b.overlapMinutes > a.overlapMinutes ? b : a,
  )
  const name = best.anchorName.trim()
  return name || null
}

export interface CanonicalSegmentMetric {
  anchorName: string
  clippedStartTime: string
  clippedEndTime: string
  clippedDurationMinutes: number
  overlapMinutes: number
}

/** 主播直播时长：按 clippedDurationMinutes 加总，不可把整场全算给 primary */
export function sumClippedLiveHoursForAnchor(
  sessions: Array<{ canonicalSegments?: CanonicalSegmentMetric[] | null }>,
  anchorName: string,
): number {
  let minutes = 0
  for (const s of sessions) {
    for (const seg of s.canonicalSegments ?? []) {
      if (seg.anchorName.trim() === anchorName.trim()) {
        minutes += Math.max(0, seg.clippedDurationMinutes || 0)
      }
    }
  }
  return minutes / 60
}

export function countSessionsTouchingAnchor(
  sessions: Array<{ canonicalSegments?: CanonicalSegmentMetric[] | null }>,
  anchorName: string,
): number {
  let n = 0
  for (const s of sessions) {
    if ((s.canonicalSegments ?? []).some((seg) => seg.anchorName.trim() === anchorName.trim())) {
      n++
    }
  }
  return n
}
