/**
 * 订单唯一归属主播 — 全系统唯一事实来源
 *
 * 规则：
 * 1. 人工指定 / 线下手动
 * 2. 下单时间 + 同源直播号命中真实直播场次（左闭右开）
 * 3. 下单时间 + 同源直播号命中有效排班（已确认 / 默认生成 / 模板虚排，含未人工确认）
 * 4. 未归属 / 冲突
 *
 * 禁止用 paymentTime 决定主播。品退必须继承本结果。
 */
import type { AnalyzedOrderView } from '../types/analysis'
import { findAnchorByName } from './anchor-rules.service'
import { getAnchorConfigSync, isAutoAttributableAnchorName } from './anchor.service'
import { isOfflineDealView } from './offline-deal.service'
import {
  resolveManualAnchorOverrideForView,
} from './order-anchor-manual-override.service'
import {
  parseDailyReportLiveSessionBounds,
  clearLiveSessionOrderAttributionCache,
} from './anchor-live-session-order-attribution.service'
import { resolveDailyReportLiveSessionAssignments } from './daily-report-live-sessions.service'
import {
  getEffectiveScheduleTableForDate,
  type EffectiveScheduleSource,
} from './anchor-daily-schedule.service'
import {
  buildScheduleBounds,
  scheduleDateFromPayMs,
} from '../utils/anchor-schedule-time.util'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'
import { parseDateTime } from '../utils/time'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import { parseViewPayTimeMs } from './anchor-performance-attribution.service'
import { resolveMetricOrderNo } from './calc-refund-rate.service'

/** 归属算法版本，写入缓存指纹；变更后自动重建经营缓存 */
export const CANONICAL_ATTRIBUTION_VERSION = 'canonical-v2-effective-schedule-2026-07-14'

export type CanonicalAttributionType =
  | 'offline_manual'
  | 'manual_override'
  | 'live_session'
  | 'confirmed_schedule'
  | 'generated_default'
  | 'virtual_template'
  | 'unassigned'
  | 'conflict'

export interface CanonicalOrderAttribution {
  canonicalAnchorId: string
  canonicalAnchorName: string
  attributionType: CanonicalAttributionType
  attributionTime: string
  attributionTimeMs: number | null
  liveAccountId: string
  liveAccountName: string
  matchedLiveSessionId: string | null
  matchedScheduleId: string | null
  manualOverrideId: string | null
  attributionExplain: string
  conflictReason: string | null
  /** 调试专用：支付时间命中结果，禁止参与结算 */
  paymentTimeAnchorName?: string | null
  paymentTimeMatchedSessionId?: string | null
}

const RAW_CREATE_TIME_KEYS = [
  'orderedAt',
  'ordered_at',
  'createTime',
  'create_time',
  'orderCreateTime',
  'order_create_time',
  'order_time',
  'orderTime',
  'placed_at',
  'placedAt',
] as const

const assignmentCacheByDate = new Map<
  string,
  Promise<Awaited<ReturnType<typeof resolveDailyReportLiveSessionAssignments>>>
>()

type EffectiveScheduleCacheRow = {
  id: string
  anchorName: string
  shopName: string
  liveRoomName: string
  startAt: Date
  endAt: Date
  confirmed: boolean
  source: EffectiveScheduleSource
}

const effectiveScheduleCache = new Map<string, Promise<EffectiveScheduleCacheRow[]>>()

/** 单元测试夹具：跳过 DB，注入真实场次 / 有效排班（含模板/默认） */
export type CanonicalAttributionTestFixtures = {
  liveSessions?: Array<{
    liveId: string
    anchorName: string
    liveAccountName: string
    sourceShopName?: string
    startMs: number
    endMs: number
  }>
  /** @deprecated 使用 effectiveSchedules；仍兼容旧夹具 */
  confirmedSchedules?: Array<{
    id: string
    anchorName: string
    shopName: string
    liveRoomName: string
    startAt: Date
    endAt: Date
    confirmed?: boolean
    source?: EffectiveScheduleSource
  }>
  effectiveSchedules?: Array<{
    id: string
    anchorName: string
    shopName: string
    liveRoomName: string
    startAt: Date
    endAt: Date
    confirmed?: boolean
    source?: EffectiveScheduleSource
  }>
}

let testFixtures: CanonicalAttributionTestFixtures | null = null

export function setCanonicalAttributionTestFixtures(
  fixtures: CanonicalAttributionTestFixtures | null,
): void {
  testFixtures = fixtures
  clearCanonicalAttributionCache()
}

export function clearCanonicalAttributionCache(): void {
  assignmentCacheByDate.clear()
  effectiveScheduleCache.clear()
  clearLiveSessionOrderAttributionCache()
}

function scheduleSourceToAttributionType(
  source: EffectiveScheduleSource,
): Extract<
  CanonicalAttributionType,
  'confirmed_schedule' | 'generated_default' | 'virtual_template'
> {
  if (source === 'virtual_template') return 'virtual_template'
  if (source === 'generated_default') return 'generated_default'
  return 'confirmed_schedule'
}

function scheduleSourceLabel(source: EffectiveScheduleSource): string {
  if (source === 'virtual_template') return '模板虚排'
  if (source === 'generated_default') return '默认生成排班'
  return '排班'
}

function resolveAnchorId(anchorName: string): string {
  if (!anchorName || anchorName === '未归属') return ''
  const config = getAnchorConfigSync()
  const found = findAnchorByName(config, anchorName)
  return found?.id ?? `extra-${anchorName}`
}

function pickLiveAccount(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): { id: string; name: string } {
  const name =
    (view.liveAccountName ?? '').trim() ||
    (() => {
      const raw = view.raw
      if (!raw) return ''
      for (const k of ['liveAccountName', 'live_account_name', 'nickName', 'liveNick']) {
        const v = raw[k]
        if (v != null && String(v).trim()) return String(v).trim()
      }
      return ''
    })()
  return { id: (view.liveAccountId ?? '').trim(), name }
}

function parseShanghaiTextMs(text: string): number | null {
  const t = text.trim()
  if (!t || t === '—') return null
  const parsed = parseDateTime(t)
  if (parsed.ok) return parsed.date.getTime()
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t)
  if (m) {
    const ms = Date.parse(
      `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+08:00`,
    )
    return Number.isFinite(ms) ? ms : null
  }
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

/** 下单时间（禁止用支付时间） */
export function parseViewOrderCreateTimeMs(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): { ms: number | null; text: string } {
  const raw = view.raw
  if (raw && typeof raw === 'object') {
    for (const k of RAW_CREATE_TIME_KEYS) {
      const v = raw[k]
      if (v == null || v === '') continue
      if (v instanceof Date && Number.isFinite(v.getTime())) {
        return {
          ms: v.getTime(),
          text: v.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }),
        }
      }
      const text = String(v).trim()
      const ms = parseShanghaiTextMs(text)
      if (ms != null) return { ms, text }
    }
  }
  // 兼容：部分链路未挂 raw 时，orderTimeText 可能是下单或支付；仅作最后兜底
  const fallback = view.orderTimeText?.trim() ?? ''
  if (fallback && fallback !== '—') {
    const ms = parseShanghaiTextMs(fallback)
    if (ms != null) return { ms, text: fallback }
  }
  return { ms: null, text: fallback || '—' }
}

function formatAttributionTime(ms: number | null, text: string): string {
  if (ms == null) return text || '—'
  return new Date(ms).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** 左闭右开 [start, end) */
export function isTimeInHalfOpenRange(ms: number, startMs: number, endMs: number): boolean {
  return ms >= startMs && ms < endMs
}

async function loadAssignment(dateKey: string) {
  let pending = assignmentCacheByDate.get(dateKey)
  if (!pending) {
    pending = resolveDailyReportLiveSessionAssignments(dateKey)
    assignmentCacheByDate.set(dateKey, pending)
  }
  return pending
}

async function loadEffectiveSchedules(dateKey: string): Promise<EffectiveScheduleCacheRow[]> {
  let pending = effectiveScheduleCache.get(dateKey)
  if (!pending) {
    pending = getEffectiveScheduleTableForDate(dateKey).then((table) =>
      table.rows
        .filter((r) => r.enabled)
        .map((r) => ({
          id: r.rowId,
          anchorName: r.anchorName,
          shopName: r.shopName,
          liveRoomName: r.liveRoomName,
          startAt: new Date(r.startAt),
          endAt: new Date(r.endAt),
          confirmed: r.confirmed,
          source: r.source,
        })),
    )
    effectiveScheduleCache.set(dateKey, pending)
  }
  return pending
}

async function resolveByLiveSession(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  createMs: number,
  liveAccountName: string,
): Promise<{
  hit: {
    anchorName: string
    liveId: string
    startMs: number
    endMs: number
    explain: string
  } | null
  conflict: string | null
  hasShopSessions: boolean
}> {
  const dateKey = scheduleDateFromPayMs(createMs)

  type Cand = {
    anchorName: string
    liveId: string
    startMs: number
    endMs: number
    spanMs: number
  }
  const hits: Cand[] = []

  if (testFixtures?.liveSessions) {
    const shopSessions = testFixtures.liveSessions.filter((session) =>
      orderLiveRoomMatchesSchedule(
        liveAccountName,
        session.sourceShopName ?? session.liveAccountName,
        session.liveAccountName,
      ),
    )
    if (!shopSessions.length) {
      return { hit: null, conflict: null, hasShopSessions: false }
    }
    for (const session of shopSessions) {
      if (!isTimeInHalfOpenRange(createMs, session.startMs, session.endMs)) continue
      hits.push({
        anchorName: session.anchorName,
        liveId: session.liveId,
        startMs: session.startMs,
        endMs: session.endMs,
        spanMs: session.endMs - session.startMs,
      })
    }
  } else {
    const assignment = await loadAssignment(dateKey)
    const shopSessions = assignment.assignedSessions.filter((session) =>
      orderLiveRoomMatchesSchedule(liveAccountName, session.sourceShopName, session.liveAccountName),
    )
    if (!shopSessions.length) {
      return { hit: null, conflict: null, hasShopSessions: false }
    }
    for (const [anchorName, sessions] of assignment.byAnchor.entries()) {
      for (const session of sessions) {
        if (
          !orderLiveRoomMatchesSchedule(
            liveAccountName,
            session.sourceShopName,
            session.liveAccountName,
          )
        ) {
          continue
        }
        const bounds = parseDailyReportLiveSessionBounds(session)
        if (!bounds) continue
        if (!isTimeInHalfOpenRange(createMs, bounds.startMs, bounds.endMs)) continue
        hits.push({
          anchorName,
          liveId: session.liveId,
          startMs: bounds.startMs,
          endMs: bounds.endMs,
          spanMs: bounds.endMs - bounds.startMs,
        })
      }
    }
  }

  if (!hits.length) return { hit: null, conflict: null, hasShopSessions: true }

  const autoHits = hits.filter((h) => isAutoAttributableAnchorName(h.anchorName))
  if (!autoHits.length) return { hit: null, conflict: null, hasShopSessions: true }

  const anchors = new Set(autoHits.map((h) => h.anchorName))
  if (anchors.size > 1) {
    return {
      hit: null,
      conflict: `同一直播号同一时间存在多个主播（${[...anchors].join('、')}），订单暂不能归属`,
      hasShopSessions: true,
    }
  }

  autoHits.sort((a, b) => a.spanMs - b.spanMs || b.startMs - a.startMs)
  const best = autoHits[0]!
  const startHm = new Date(best.startMs).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const endHm = new Date(best.endMs).toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return {
    hit: {
      anchorName: best.anchorName,
      liveId: best.liveId,
      startMs: best.startMs,
      endMs: best.endMs,
      explain: `命中 ${dateKey} 真实直播场次：${liveAccountName} ${startHm}–${endHm} → ${best.anchorName}`,
    },
    conflict: null,
    hasShopSessions: true,
  }
}

async function resolveByEffectiveSchedule(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  createMs: number,
  liveAccountName: string,
): Promise<{
  hit: {
    id: string
    anchorName: string
    explain: string
    attributionType: Extract<
      CanonicalAttributionType,
      'confirmed_schedule' | 'generated_default' | 'virtual_template'
    >
  } | null
  conflict: string | null
}> {
  const dateKey = scheduleDateFromPayMs(createMs)
  const fixtureRows = testFixtures?.effectiveSchedules ?? testFixtures?.confirmedSchedules
  const rows: EffectiveScheduleCacheRow[] = fixtureRows
    ? fixtureRows.map((r) => ({
        id: r.id,
        anchorName: r.anchorName,
        shopName: r.shopName,
        liveRoomName: r.liveRoomName,
        startAt: r.startAt,
        endAt: r.endAt,
        confirmed: r.confirmed !== false,
        source: r.source ?? 'manual',
      }))
    : await loadEffectiveSchedules(dateKey)
  const matched = rows.filter((row) => {
    if (!orderLiveRoomMatchesSchedule(liveAccountName, row.shopName, row.liveRoomName)) return false
    // 排班区间左闭右开：endAt 瞬间不归属本场
    return createMs >= row.startAt.getTime() && createMs < row.endAt.getTime()
  })
  if (!matched.length) return { hit: null, conflict: null }
  const autoMatched = matched.filter((m) => isAutoAttributableAnchorName(m.anchorName))
  if (!autoMatched.length) return { hit: null, conflict: null }
  const anchors = new Set(autoMatched.map((m) => m.anchorName))
  if (anchors.size > 1) {
    return {
      hit: null,
      conflict: `同一直播号同一时间有效排班存在多个主播（${[...anchors].join('、')}），订单暂不能归属`,
    }
  }
  const best = autoMatched[0]!
  const attributionType = scheduleSourceToAttributionType(best.source)
  return {
    hit: {
      id: best.id,
      anchorName: best.anchorName,
      attributionType,
      explain: `命中 ${dateKey} ${scheduleSourceLabel(best.source)}：${best.liveRoomName} → ${best.anchorName}`,
    },
    conflict: null,
  }
}

function unassignedResult(
  live: { id: string; name: string },
  timeText: string,
  timeMs: number | null,
  reason: string,
  conflictReason: string | null = null,
): CanonicalOrderAttribution {
  return {
    canonicalAnchorId: '',
    canonicalAnchorName: '未归属',
    attributionType: conflictReason ? 'conflict' : 'unassigned',
    attributionTime: formatAttributionTime(timeMs, timeText),
    attributionTimeMs: timeMs,
    liveAccountId: live.id,
    liveAccountName: live.name,
    matchedLiveSessionId: null,
    matchedScheduleId: null,
    manualOverrideId: null,
    attributionExplain: reason,
    conflictReason,
  }
}

/**
 * 全系统唯一订单归属入口。
 */
export async function resolveCanonicalOrderAttribution(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): Promise<CanonicalOrderAttribution> {
  const live = pickLiveAccount(view)
  const create = parseViewOrderCreateTimeMs(view)
  const payMs = parseViewPayTimeMs(view)

  // 线下成交台账：人工归属最高优先级，缓存刷新不得用场次/排班覆盖
  if (isOfflineDealView(view)) {
    const name = (view.anchorName ?? '').trim() || '未归属'
    const hasAnchor = name !== '未归属' && Boolean(view.anchorId || name)
    return {
      canonicalAnchorId: hasAnchor ? view.anchorId || resolveAnchorId(name) : '',
      canonicalAnchorName: hasAnchor ? name : '未归属',
      attributionType: hasAnchor ? 'offline_manual' : 'unassigned',
      attributionTime: formatAttributionTime(create.ms, create.text),
      attributionTimeMs: create.ms,
      liveAccountId: live.id,
      liveAccountName: live.name,
      matchedLiveSessionId: null,
      matchedScheduleId: null,
      manualOverrideId: view.offlineDealKey || resolveMetricOrderNo(view) || null,
      attributionExplain: hasAnchor
        ? `线下成交手动归属：${name}`
        : '线下成交待归属主播',
      conflictReason: null,
      paymentTimeAnchorName: null,
      paymentTimeMatchedSessionId: null,
    }
  }

  const manual = resolveManualAnchorOverrideForView(view)
  if (manual) {
    return {
      canonicalAnchorId: manual.anchorId,
      canonicalAnchorName: manual.anchorName,
      attributionType: 'manual_override',
      attributionTime: formatAttributionTime(create.ms, create.text),
      attributionTimeMs: create.ms,
      liveAccountId: live.id,
      liveAccountName: live.name,
      matchedLiveSessionId: null,
      matchedScheduleId: null,
      manualOverrideId: resolveMetricOrderNo(view) || null,
      attributionExplain: `手动指定归属：${manual.anchorName}`,
      conflictReason: null,
      paymentTimeAnchorName: null,
      paymentTimeMatchedSessionId: null,
    }
  }

  if (!live.name) {
    return unassignedResult(live, create.text, create.ms, '缺少来源直播号，无法归属')
  }
  if (create.ms == null) {
    return unassignedResult(live, create.text, null, '缺少下单时间，无法归属')
  }

  const liveHit = await resolveByLiveSession(view, create.ms, live.name)
  if (liveHit.conflict) {
    return unassignedResult(live, create.text, create.ms, liveHit.conflict, liveHit.conflict)
  }
  if (liveHit.hit) {
    return {
      canonicalAnchorId: resolveAnchorId(liveHit.hit.anchorName),
      canonicalAnchorName: liveHit.hit.anchorName,
      attributionType: 'live_session',
      attributionTime: formatAttributionTime(create.ms, create.text),
      attributionTimeMs: create.ms,
      liveAccountId: live.id,
      liveAccountName: live.name,
      matchedLiveSessionId: liveHit.hit.liveId,
      matchedScheduleId: null,
      manualOverrideId: null,
      attributionExplain: liveHit.hit.explain,
      conflictReason: null,
    }
  }

  // 场次未命中或完全缺失时，用有效排班兜底（含默认生成 / 模板虚排，不要求人工确认）
  const scheduleHit = await resolveByEffectiveSchedule(view, create.ms, live.name)
  if (scheduleHit.conflict) {
    return unassignedResult(
      live,
      create.text,
      create.ms,
      scheduleHit.conflict,
      scheduleHit.conflict,
    )
  }
  if (scheduleHit.hit) {
    return {
      canonicalAnchorId: resolveAnchorId(scheduleHit.hit.anchorName),
      canonicalAnchorName: scheduleHit.hit.anchorName,
      attributionType: scheduleHit.hit.attributionType,
      attributionTime: formatAttributionTime(create.ms, create.text),
      attributionTimeMs: create.ms,
      liveAccountId: live.id,
      liveAccountName: live.name,
      matchedLiveSessionId: null,
      matchedScheduleId: scheduleHit.hit.id,
      manualOverrideId: null,
      attributionExplain: scheduleHit.hit.explain,
      conflictReason: null,
    }
  }

  return unassignedResult(
    live,
    create.text,
    create.ms,
    liveHit.hasShopSessions
      ? '下单时间未命中该直播号真实场次，且无有效排班可兜底'
      : '无真实场次且无有效排班可归属',
  )
}

export function canonicalAttributionLabel(type: CanonicalAttributionType): string {
  switch (type) {
    case 'offline_manual':
      return '线下手动归属'
    case 'manual_override':
      return '手动指定'
    case 'live_session':
      return '真实场次归属'
    case 'confirmed_schedule':
      return '已确认排班归属'
    case 'generated_default':
      return '默认生成排班归属'
    case 'virtual_template':
      return '模板虚排归属'
    case 'conflict':
      return '归属冲突'
    default:
      return '未归属'
  }
}

/** 批量 remap：所有榜单/明细/品退共用 */
export async function remapViewsWithCanonicalAttribution(
  views: (AnalyzedOrderView & { raw?: Record<string, unknown> })[],
): Promise<
  (AnalyzedOrderView & {
    scheduleAttributionExplain?: string
    scheduleAttributionSource?: string
    scheduleConfirmed?: boolean
    canonicalAttributionType?: CanonicalAttributionType
    matchedLiveSessionId?: string | null
    matchedScheduleId?: string | null
  })[]
> {
  const { ensureManualAnchorOverrideCache } = await import('./order-anchor-manual-override.service')
  await ensureManualAnchorOverrideCache()
  const out = []
  for (const view of views) {
    const resolved = await resolveCanonicalOrderAttribution(view)
    out.push({
      ...view,
      anchorId: resolved.canonicalAnchorId,
      anchorName: resolved.canonicalAnchorName,
      scheduleAttributionExplain: resolved.attributionExplain,
      scheduleAttributionSource: resolved.attributionType,
      scheduleConfirmed: resolved.attributionType === 'confirmed_schedule',
      canonicalAttributionType: resolved.attributionType,
      matchedLiveSessionId: resolved.matchedLiveSessionId,
      matchedScheduleId: resolved.matchedScheduleId,
      // 品退主播 = 订单唯一归属主播（禁止另算）
      qualityAttributionAnchorName: resolved.canonicalAnchorName,
    })
  }
  return out
}

/** 兼容旧 isPayTimeInSchedule 调用点的半开区间探测 */
export function probeHalfOpenSchedule(
  dateKey: string,
  startTime: string,
  endTime: string,
  ms: number,
): boolean {
  const { startAt, endAt } = buildScheduleBounds(dateKey, startTime, endTime)
  return isTimeInHalfOpenRange(ms, startAt.getTime(), endAt.getTime())
}

export function todayShanghai(): string {
  return formatDateKeyShanghai(new Date())
}
