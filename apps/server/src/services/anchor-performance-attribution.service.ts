import type { AnchorConfig, AnalyzedOrderView } from '../types/analysis'
import { findAnchorByName } from './anchor-rules.service'
import { getAnchorConfigSync, isOfflineOnlyAnchor, YIFAN_SYSTEM_KEY } from './anchor.service'
import { applyManualAnchorOverrideToView } from './order-anchor-manual-override.service'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import { getTimeMinutes } from '../utils/time'
import {
  isInXiaoBaiOrderSlot,
  isXiaoBaiAttributionActive,
  SHOP_SESSION_ANCHOR_CUTOFF_MS,
  XIAOBAI_ANCHOR_CUTOFF_MS,
} from './anchor-session-cutoff.util'
import { resolveXiaoBaiSlotMinutesForDate } from './anchor-xiaobai-slot.util'
import { resolveCanonicalShopName } from '../utils/shop-name-normalize.util'
import {
  aggregateViewsMetrics,
  type BoardAnchorMetrics,
} from './board-metrics.service'

export {
  SHOP_SESSION_ANCHOR_CUTOFF_MS,
  XIAOBAI_ANCHOR_CUTOFF_MS,
  XIAOBAI_SLOT_START_MINUTES,
  XIAOBAI_SLOT_END_MINUTES,
  isInXiaoBaiOrderSlot,
  isXiaoBaiAttributionActive,
} from './anchor-session-cutoff.util'

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

/**
 * 6.18 起：祥钰系午场 → 小白（不含拾玉居/和田雅玉）。
 * 第二参应对应为下单时间 ms（正式归属走 canonical；本函数供兼容/边界验收）。
 */
export function isXiaoBaiOrderAttribution(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  orderCreateMs: number,
): boolean {
  if (!isXiaoBaiAttributionActive(orderCreateMs)) return false
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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 直播场次与当日小白午场有交集（6月 14:30–18:00 / 7月起 14:00–18:30） */
export function sessionOverlapsXiaoBaiSlot(startMs: number, endMs: number): boolean {
  if (!Number.isFinite(startMs) || startMs < XIAOBAI_ANCHOR_CUTOFF_MS) return false
  const { slotStartMs, slotEndMs } = resolveXiaoBaiSlotBoundsMs(startMs)
  let effectiveEnd = endMs
  if (!Number.isFinite(effectiveEnd)) effectiveEnd = startMs
  if (effectiveEnd < startMs) effectiveEnd += 86_400_000
  return startMs < slotEndMs && effectiveEnd > slotStartMs
}

export function resolveXiaoBaiSlotBoundsMs(sessionStartMs: number): {
  slotStartMs: number
  slotEndMs: number
} {
  const dateKey = formatDateKeyShanghai(new Date(sessionStartMs))
  const { startMinutes, endMinutes } = resolveXiaoBaiSlotMinutesForDate(dateKey)
  const startH = Math.floor(startMinutes / 60)
  const startM = startMinutes % 60
  const endH = Math.floor(endMinutes / 60)
  const endM = endMinutes % 60
  return {
    slotStartMs: Date.parse(`${dateKey}T${pad2(startH)}:${pad2(startM)}:00+08:00`),
    slotEndMs: Date.parse(`${dateKey}T${pad2(endH)}:${pad2(endM)}:00+08:00`),
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
): Array<{ anchorId: string; anchorName: string; systemKey?: string | null; attributionMode?: string }> {
  const useShopSessionRules = isReportDateOnOrAfterShopSessionCutoff(startDate)
  const anchors = resolveDailyReportAnchors(config, useShopSessionRules)
  if (useShopSessionRules && isReportDateOnOrAfterXiaoBaiCutoff(startDate)) {
    anchors.push(resolveXiaoBaiAnchor(config))
  }
  // 日报直播主播候选：排除线下专属主播（YIFAN_MANUAL）；有线下出单时由 buildDailyReport 单独追加
  return anchors
    .map((a) => {
      const cfg = config.anchors.find((x) => x.id === a.anchorId || x.name === a.anchorName)
      return {
        ...a,
        systemKey: cfg?.systemKey ?? null,
        attributionMode: cfg?.attributionMode,
        effectiveFrom: cfg?.effectiveFrom ?? null,
        effectiveTo: cfg?.effectiveTo ?? null,
      }
    })
    .filter((a) => !isOfflineOnlyAnchor({ systemKey: a.systemKey }))
    .filter((a) => {
      if (a.effectiveFrom && startDate < a.effectiveFrom) return false
      if (a.effectiveTo && startDate > a.effectiveTo) return false
      return true
    })
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
  const canonical = resolveCanonicalShopName(n)
  if (canonical === 'XY祥钰珠宝' || canonical === '祥钰珠宝') return 'xiangyu'
  if (canonical === '拾玉居和田玉') return 'shiyu'
  if (canonical === '和田雅玉') return 'hetian'
  // 兜底：未进 canonical 表但标签含关键店铺关键字
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

/**
 * @deprecated 正式业绩/品退/明细请用 resolveCanonicalOrderAttribution（下单时间 + 有效排班）。
 * 本函数仅作同步兼容路径：优先下单时间判定小白午场，其余仍按支付时间回落旧规则。
 */
export function resolveAnchorForPerformanceAttribution(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  config: AnchorConfig = getAnchorConfigSync(),
): { anchorId: string; anchorName: string } {
  const createMs = parseLegacyOrderCreateTimeMs(view)
  const payMs = parseViewPayTimeMs(view)
  const anchorMs = createMs ?? payMs
  if (anchorMs == null || anchorMs < SHOP_SESSION_ANCHOR_CUTOFF_MS) {
    return { anchorId: view.anchorId, anchorName: view.anchorName }
  }

  if (isXiaoBaiOrderAttribution(view, createMs ?? payMs!)) {
    return resolveXiaoBaiAnchor(config)
  }

  const liveAccountName =
    (view.liveAccountName ?? '').trim() || pickLiveAccountFromRaw(view.raw)
  const resolved = resolveShopSessionAnchorFromLiveAccount(
    liveAccountName,
    new Date(anchorMs),
    config,
  )
  if (resolved) return resolved
  return { anchorId: '', anchorName: '未归属' }
}

/** 避免与 canonical 循环依赖：仅读取常见下单时间字段 */
function parseLegacyOrderCreateTimeMs(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): number | null {
  const raw = view.raw
  if (!raw || typeof raw !== 'object') return null
  for (const k of [
    'orderedAt',
    'ordered_at',
    'createTime',
    'create_time',
    'orderCreateTime',
    'order_create_time',
  ] as const) {
    const v = raw[k]
    if (v == null || v === '') continue
    if (v instanceof Date && Number.isFinite(v.getTime())) return v.getTime()
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
  return null
}

export function remapViewsForAnchorPerformance(
  views: (AnalyzedOrderView & { raw?: Record<string, unknown> })[],
): AnalyzedOrderView[] {
  const config = getAnchorConfigSync()
  return views.map((view) => {
    const withManual = applyManualAnchorOverrideToView(view)
    const resolved = resolveAnchorForPerformanceAttribution(withManual, config)
    if (resolved.anchorId === withManual.anchorId && resolved.anchorName === withManual.anchorName) {
      return withManual
    }
    return {
      ...withManual,
      anchorId: resolved.anchorId,
      anchorName: resolved.anchorName,
    }
  })
}

function createEmptyAnchorLeaderboardRow(
  anchorId: string,
  anchorName: string,
  color: string,
  opts?: { systemKey?: string | null; attributionMode?: string | null },
): BoardAnchorMetrics {
  const m = aggregateViewsMetrics([])
  return {
    anchorName,
    anchorId,
    color,
    systemKey: opts?.systemKey ?? null,
    attributionMode: opts?.attributionMode ?? null,
    ...m,
    gmv: m.totalGmv,
    onlineGmv: 0,
    offlineGmv: 0,
    offlineDealCount: 0,
    actualSignedCount: m.signedOrderCount,
  }
}

/** 6.13 起主播业绩固定展示场次主播；另补「无时间段」手动归属主播空卡（不含线下专属 YIFAN_MANUAL） */
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

  const manualOnlyNames = config.anchors
    .filter(
      (a) =>
        a.enabled &&
        a.name.trim() &&
        !isOfflineOnlyAnchor(a) &&
        (a.attributionMode === 'manual' ||
          // 兼容未写 attributionMode 的缓存：无任何启用时段 → 手动槽位
          (!a.attributionMode &&
            !config.timeRules.some((r) => r.enabled && r.anchorId === a.id))),
    )
    .map((a) => a.name.trim())

  const slotNames = [...fixedNames]
  for (const name of manualOnlyNames) {
    if (!slotNames.includes(name)) slotNames.push(name)
  }

  const byName = new Map(rows.map((r) => [r.anchorName, r]))
  const merged: BoardAnchorMetrics[] = [...rows]

  for (const anchorName of slotNames) {
    if (byName.has(anchorName)) continue
    const found = findAnchorByName(config, anchorName)
    if (found && isOfflineOnlyAnchor(found)) continue
    merged.push(
      createEmptyAnchorLeaderboardRow(
        found?.id ?? `extra-${anchorName}`,
        anchorName,
        found?.color ?? '#94a3b8',
        { systemKey: found?.systemKey ?? null, attributionMode: found?.attributionMode ?? null },
      ),
    )
  }

  return merged.sort((a, b) => {
    const gmvDiff = Number(b.gmv ?? b.totalGmv ?? 0) - Number(a.gmv ?? a.totalGmv ?? 0)
    if (gmvDiff !== 0) return gmvDiff
    const signedDiff =
      Number(b.actualSignedAmount ?? 0) - Number(a.actualSignedAmount ?? 0)
    if (signedDiff !== 0) return signedDiff
    if (a.anchorName === '未归属' && b.anchorName !== '未归属') return 1
    if (b.anchorName === '未归属' && a.anchorName !== '未归属') return -1
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
