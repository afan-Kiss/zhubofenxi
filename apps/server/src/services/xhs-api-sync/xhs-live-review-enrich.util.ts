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
  rawJson: unknown
}

/**
 * 历史补齐：优先最老的缺详情场次（asc）。
 * 增量：仍可按 desc 优先近期。
 */
export function selectLiveReviewEnrichCandidates<T extends LiveReviewCandidateRow>(
  rows: T[],
  opts: {
    mode: 'history_backfill' | 'historical_refresh' | 'incremental'
    maxSessions: number
    preferSessionIds?: Set<string>
  },
): T[] {
  const needing = rows.filter((r) => {
    const raw = asRecord(r.rawJson) ?? {}
    return liveRawNeedsLiveReview(raw)
  })

  const prefer = opts.preferSessionIds
  needing.sort((a, b) => {
    if (prefer && prefer.size > 0) {
      const pa = prefer.has(a.id) ? 1 : 0
      const pb = prefer.has(b.id) ? 1 : 0
      if (pa !== pb) return pb - pa
    }
    const ta = a.startTime?.getTime() ?? 0
    const tb = b.startTime?.getTime() ?? 0
    if (opts.mode === 'history_backfill') return ta - tb // oldest first
    return tb - ta // recent first
  })

  return needing.slice(0, Math.max(0, opts.maxSessions))
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
