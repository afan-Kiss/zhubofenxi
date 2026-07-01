import type { AnchorConfig, AnalyzedOrderView } from '../types/analysis'
import { findAnchorByName } from './anchor-rules.service'
import { getAnchorConfigSync } from './anchor.service'
import { getTimeMinutes } from '../utils/time'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import {
  aggregateViewsMetrics,
  type BoardAnchorMetrics,
} from './board-metrics.service'

/** 2026-06-13 起：日报 / 主播业绩按「直播号 + 早晚场」固定归属，不再走后台时间段规则 */
export const SHOP_SESSION_ANCHOR_CUTOFF_MS = Date.parse('2026-06-13T00:00:00+08:00')

/** 2026-06-18 起：14:30–18:00 支付订单与对应直播场次归属「小白」 */
export const XIAOBAI_ANCHOR_CUTOFF_MS = Date.parse('2026-06-18T00:00:00+08:00')
export const XIAOBAI_SLOT_START_MINUTES = 14 * 60 + 30
export const XIAOBAI_SLOT_END_MINUTES = 18 * 60

export type LiveSessionPeriod = 'morning' | 'evening'
export type ShopSessionKey = 'xiangyu' | 'hetian' | 'shiyu'

const RAW_LIVE_ACCOUNT_KEYS = [
  'liveAccountName',
  'live_account_name',
  'nickName',
  'nick_name',
  'liveNick',
  'live_nick',
] as const

/** 6.13 起各主播在日报中的固定场次 / 店铺展示 */
export const ANCHOR_SESSION_DISPLAY_FROM_0613: Record<
  string,
  { sessionLabel: string; shopName: string }
> = {
  子杰: { sessionLabel: '早场·XY祥钰珠宝', shopName: 'XY祥钰珠宝' },
  小红: { sessionLabel: '早场·和田雅玉', shopName: '和田雅玉' },
  飞云: { sessionLabel: '晚场·拾玉居和田玉', shopName: '拾玉居和田玉' },
  小艺: { sessionLabel: '晚场·和田雅玉', shopName: '和田雅玉' },
  小白: { sessionLabel: '午场·XY祥钰珠宝 14:30-18:00', shopName: 'XY祥钰珠宝' },
}

const SHOP_SESSION_ANCHOR_MAP: Record<
  LiveSessionPeriod,
  Partial<Record<ShopSessionKey, string>>
> = {
  morning: { xiangyu: '子杰', hetian: '小红' },
  evening: { shiyu: '飞云', hetian: '小艺' },
}

export function isShopSessionAnchorCutoffReached(dateMs: number): boolean {
  return Number.isFinite(dateMs) && dateMs >= SHOP_SESSION_ANCHOR_CUTOFF_MS
}

export function isReportDateOnOrAfterShopSessionCutoff(startDate: string): boolean {
  const ms = Date.parse(`${startDate.trim()}T00:00:00+08:00`)
  return isShopSessionAnchorCutoffReached(ms)
}

export function isReportDateOnOrAfterXiaoBaiCutoff(startDate: string): boolean {
  const ms = Date.parse(`${startDate.trim()}T00:00:00+08:00`)
  return Number.isFinite(ms) && ms >= XIAOBAI_ANCHOR_CUTOFF_MS
}

export function isInXiaoBaiOrderSlot(date: Date): boolean {
  const minutes = getTimeMinutes(date)
  return minutes >= XIAOBAI_SLOT_START_MINUTES && minutes <= XIAOBAI_SLOT_END_MINUTES
}

export function isXiaoBaiAttributionActive(payMs: number): boolean {
  return (
    Number.isFinite(payMs) &&
    payMs >= XIAOBAI_ANCHOR_CUTOFF_MS &&
    isInXiaoBaiOrderSlot(new Date(payMs))
  )
}

/** 6.18 起：14:30–18:00 且来源直播号为祥钰系 → 归小白（不含拾玉居/和田雅玉等） */
export function isXiaoBaiOrderAttribution(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  payMs: number,
): boolean {
  if (!isXiaoBaiAttributionActive(payMs)) return false
  const liveAccountName =
    (view.liveAccountName ?? '').trim() || pickLiveAccountFromRaw(view.raw)
  return normalizeShopSessionKey(liveAccountName) === 'xiangyu'
}

export function isXiaoBaiSessionStart(sessionStartMs: number): boolean {
  return (
    Number.isFinite(sessionStartMs) &&
    sessionStartMs >= XIAOBAI_ANCHOR_CUTOFF_MS &&
    isInXiaoBaiOrderSlot(new Date(sessionStartMs))
  )
}

/** 直播场次与当日 14:30–18:00 时段有交集（6.18 起用于场次归属小白） */
export function sessionOverlapsXiaoBaiSlot(startMs: number, endMs: number): boolean {
  if (!Number.isFinite(startMs) || startMs < XIAOBAI_ANCHOR_CUTOFF_MS) return false
  const dateKey = formatDateKeyShanghai(new Date(startMs))
  const slotStartMs = Date.parse(`${dateKey}T14:30:00+08:00`)
  const slotEndMs = Date.parse(`${dateKey}T18:00:00+08:00`)
  let effectiveEnd = endMs
  if (!Number.isFinite(effectiveEnd)) effectiveEnd = startMs
  if (effectiveEnd < startMs) effectiveEnd += 86_400_000
  return startMs <= slotEndMs && effectiveEnd >= slotStartMs
}

export function resolveXiaoBaiSlotBoundsMs(sessionStartMs: number): {
  slotStartMs: number
  slotEndMs: number
} {
  const dateKey = formatDateKeyShanghai(new Date(sessionStartMs))
  return {
    slotStartMs: Date.parse(`${dateKey}T14:30:00+08:00`),
    slotEndMs: Date.parse(`${dateKey}T18:00:00+08:00`),
  }
}

function normalizeSessionEndMs(startMs: number, endMs: number): number {
  let effectiveEnd = endMs
  if (!Number.isFinite(effectiveEnd)) effectiveEnd = startMs
  if (effectiveEnd < startMs) effectiveEnd += 86_400_000
  return effectiveEnd
}

/** 直播场次与小白固定时段（14:30–18:00）的交集分钟数，用于日报时长 */
export function computeXiaoBaiSlotOverlapMinutes(startMs: number, endMs: number): number {
  if (!sessionOverlapsXiaoBaiSlot(startMs, endMs)) return 0
  const effectiveEnd = normalizeSessionEndMs(startMs, endMs)
  const { slotStartMs, slotEndMs } = resolveXiaoBaiSlotBoundsMs(startMs)
  const overlapStart = Math.max(startMs, slotStartMs)
  const overlapEnd = Math.min(effectiveEnd, slotEndMs)
  if (overlapEnd <= overlapStart) return 0
  return Math.round((overlapEnd - overlapStart) / 60_000)
}

/** 早场跨场：场次在 14:30 之前开始的分钟数（归属早场主播如子杰） */
export function computeMorningPortionBeforeXiaoBaiSlotMinutes(
  startMs: number,
  endMs: number,
): number {
  if (!sessionOverlapsXiaoBaiSlot(startMs, endMs)) return 0
  const effectiveEnd = normalizeSessionEndMs(startMs, endMs)
  const { slotStartMs } = resolveXiaoBaiSlotBoundsMs(startMs)
  if (startMs >= slotStartMs) return 0
  const morningEnd = Math.min(effectiveEnd, slotStartMs)
  if (morningEnd <= startMs) return 0
  return Math.round((morningEnd - startMs) / 60_000)
}

function resolveXiaoBaiAnchor(config: AnchorConfig): { anchorId: string; anchorName: string } {
  const found = findAnchorByName(config, '小白')
  return { anchorId: found?.id ?? 'extra-小白', anchorName: '小白' }
}

/** 日报使用的主播列表：6.13 前走后台配置，6.13 起固定四人场次 */
export function resolveDailyReportAnchors(
  config: AnchorConfig,
  useShopSessionRules: boolean,
): Array<{ anchorId: string; anchorName: string }> {
  if (!useShopSessionRules) {
    return config.anchors
      .filter((a) => a.enabled)
      .map((a) => ({ anchorId: a.id, anchorName: a.name }))
  }
  const names = Object.keys(ANCHOR_SESSION_DISPLAY_FROM_0613).filter(
    (name) => name !== '小白',
  )
  return names.map((anchorName) => {
    const found = findAnchorByName(config, anchorName)
    return {
      anchorId: found?.id ?? `extra-${anchorName}`,
      anchorName,
    }
  })
}

export function resolveDailyReportAnchorsForDate(
  config: AnchorConfig,
  startDate: string,
): Array<{ anchorId: string; anchorName: string }> {
  const useShopSessionRules = isReportDateOnOrAfterShopSessionCutoff(startDate)
  const anchors = resolveDailyReportAnchors(config, useShopSessionRules)
  if (useShopSessionRules && isReportDateOnOrAfterXiaoBaiCutoff(startDate)) {
    anchors.push(resolveXiaoBaiAnchor(config))
  }
  return anchors
}

/** 早场 00:00–17:59，晚场 18:00–23:59（与历史默认时间段一致） */
export function resolveLiveSessionPeriod(date: Date): LiveSessionPeriod | null {
  const minutes = getTimeMinutes(date)
  if (minutes >= 0 && minutes < 18 * 60) return 'morning'
  if (minutes >= 18 * 60 && minutes <= 23 * 60 + 59) return 'evening'
  return null
}

export function normalizeShopSessionKey(liveAccountName: string): ShopSessionKey | null {
  const n = (liveAccountName ?? '').trim()
  if (!n) return null
  if (n.includes('祥钰')) return 'xiangyu'
  if (n.includes('拾玉居')) return 'shiyu'
  if (n.includes('和田雅玉')) return 'hetian'
  return null
}

export function resolveShopSessionAnchorName(
  shopKey: ShopSessionKey | null,
  period: LiveSessionPeriod | null,
): string | null {
  if (!shopKey || !period) return null
  return SHOP_SESSION_ANCHOR_MAP[period][shopKey] ?? null
}

function pickLiveAccountFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  for (const k of RAW_LIVE_ACCOUNT_KEYS) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export function parseViewPayTimeMs(view: AnalyzedOrderView & { raw?: Record<string, unknown> }): number | null {
  const raw = view.raw
  if (raw) {
    for (const k of ['payTime', 'pay_time', 'paymentTime', 'payment_time', 'paidTime', 'paid_time']) {
      const v = raw[k]
      if (v == null || v === '') continue
      const text = String(v).trim()
      const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text)
      if (m) {
        const ms = Date.parse(
          `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+08:00`,
        )
        if (Number.isFinite(ms)) return ms
      }
      const t = Date.parse(text)
      if (Number.isFinite(t)) return t
    }
  }
  const text = view.orderTimeText?.trim()
  if (!text) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text)
  if (m) {
    const ms = Date.parse(
      `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+08:00`,
    )
    return Number.isFinite(ms) ? ms : null
  }
  const t = Date.parse(text)
  return Number.isFinite(t) ? t : null
}

export function resolveShopSessionAnchorFromLiveAccount(
  liveAccountName: string,
  at: Date,
  config: AnchorConfig = getAnchorConfigSync(),
): { anchorId: string; anchorName: string } | null {
  const shopKey = normalizeShopSessionKey(liveAccountName)
  const period = resolveLiveSessionPeriod(at)
  const anchorName = resolveShopSessionAnchorName(shopKey, period)
  if (!anchorName) return null
  const found = findAnchorByName(config, anchorName)
  if (found?.enabled) {
    return { anchorId: found.id, anchorName: found.name }
  }
  return { anchorId: `extra-${anchorName}`, anchorName }
}

export function resolveAnchorForPerformanceAttribution(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  config: AnchorConfig = getAnchorConfigSync(),
): { anchorId: string; anchorName: string } {
  const payMs = parseViewPayTimeMs(view)
  if (payMs == null || payMs < SHOP_SESSION_ANCHOR_CUTOFF_MS) {
    return { anchorId: view.anchorId, anchorName: view.anchorName }
  }

  if (isXiaoBaiOrderAttribution(view, payMs)) {
    return resolveXiaoBaiAnchor(config)
  }

  const liveAccountName =
    (view.liveAccountName ?? '').trim() || pickLiveAccountFromRaw(view.raw)
  const resolved = resolveShopSessionAnchorFromLiveAccount(
    liveAccountName,
    new Date(payMs),
    config,
  )
  if (resolved) return resolved
  return { anchorId: '', anchorName: '未归属' }
}

export function remapViewsForAnchorPerformance(
  views: (AnalyzedOrderView & { raw?: Record<string, unknown> })[],
): AnalyzedOrderView[] {
  const config = getAnchorConfigSync()
  return views.map((view) => {
    const resolved = resolveAnchorForPerformanceAttribution(view, config)
    if (resolved.anchorId === view.anchorId && resolved.anchorName === view.anchorName) {
      return view
    }
    return {
      ...view,
      anchorId: resolved.anchorId,
      anchorName: resolved.anchorName,
    }
  })
}

function createEmptyAnchorLeaderboardRow(
  anchorId: string,
  anchorName: string,
  color: string,
): BoardAnchorMetrics {
  const m = aggregateViewsMetrics([])
  return {
    anchorName,
    anchorId,
    color,
    ...m,
    gmv: m.totalGmv,
    actualSignedCount: m.signedOrderCount,
  }
}

/** 6.13 起主播业绩固定展示四人，无订单时也保留空行（如小红早场暂无单） */
export function ensureAnchorPerformanceLeaderboardSlots(
  rows: BoardAnchorMetrics[],
  endDate: string,
): BoardAnchorMetrics[] {
  if (!isReportDateOnOrAfterShopSessionCutoff(endDate)) return rows

  const config = getAnchorConfigSync()
  const fixedNames = Object.keys(ANCHOR_SESSION_DISPLAY_FROM_0613).filter(
    (name) => name !== '小白',
  )
  if (isReportDateOnOrAfterXiaoBaiCutoff(endDate)) {
    fixedNames.push('小白')
  }
  const byName = new Map(rows.map((r) => [r.anchorName, r]))
  const merged: BoardAnchorMetrics[] = [...rows]

  for (const anchorName of fixedNames) {
    if (byName.has(anchorName)) continue
    const found = findAnchorByName(config, anchorName)
    merged.push(
      createEmptyAnchorLeaderboardRow(
        found?.id ?? `extra-${anchorName}`,
        anchorName,
        found?.color ?? '#94a3b8',
      ),
    )
  }

  return merged.sort((a, b) => {
    const orderA = config.anchors.findIndex((x) => x.name === a.anchorName)
    const orderB = config.anchors.findIndex((x) => x.name === b.anchorName)
    const ia = orderA >= 0 ? orderA : fixedNames.indexOf(a.anchorName)
    const ib = orderB >= 0 ? orderB : fixedNames.indexOf(b.anchorName)
    const safeIa = ia >= 0 ? ia : 999
    const safeIb = ib >= 0 ? ib : 999
    if (safeIa !== safeIb) return safeIa - safeIb
    return a.anchorName.localeCompare(b.anchorName, 'zh-CN')
  })
}
