import type { AnalyzedOrderView } from '../types/analysis'
import { findAnchorByName } from './anchor-rules.service'
import { getAnchorConfigSync } from './anchor.service'
import { getEffectiveSchedulesForDate } from './anchor-daily-schedule.service'
import { isPayTimeInSchedule } from '../utils/anchor-schedule-time.util'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'
import { clearLiveSessionOrderAttributionCache } from './anchor-live-session-order-attribution.service'

export type ScheduleAttributionSource =
  | 'live_session'
  | 'manual_schedule'
  | 'default_schedule'
  | 'template_virtual'
  | 'generated_default'
  | 'virtual_template'
  | 'legacy_rule'
  | 'legacy_attribution'
  | 'manual_override'
  | 'offline_manual'
  | 'unassigned'
  | 'unmatched'
  | 'confirmed_schedule'
  | 'conflict'

export interface ScheduleAttributionResult {
  anchorId: string
  anchorName: string
  attributionSource: ScheduleAttributionSource
  attributionExplain: string
  scheduleConfirmed: boolean
  matchedScheduleRowId?: string
}

const scheduleCacheByDate = new Map<string, Awaited<ReturnType<typeof getEffectiveSchedulesForDate>>>()
const confirmCacheByDate = new Map<string, boolean>()

export function clearScheduleAttributionCache(): void {
  scheduleCacheByDate.clear()
  confirmCacheByDate.clear()
  clearLiveSessionOrderAttributionCache()
  void import('./canonical-order-attribution.service').then((m) => m.clearCanonicalAttributionCache())
}

async function loadSchedules(dateKey: string) {
  let cached = scheduleCacheByDate.get(dateKey)
  if (!cached) {
    cached = await getEffectiveSchedulesForDate(dateKey)
    scheduleCacheByDate.set(dateKey, cached)
    confirmCacheByDate.set(dateKey, cached.table.confirmed)
  }
  return cached
}

function resolveAnchorId(anchorName: string): string {
  const config = getAnchorConfigSync()
  const found = findAnchorByName(config, anchorName)
  return found?.id ?? `extra-${anchorName}`
}

/** 导出供静态验收：按直播号+时段匹配排班行（不改优先级链） */
export function matchScheduleRow(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  payMs: number,
  rows: Array<{
    id: string
    anchorName: string
    shopName: string
    liveRoomName: string
    startAt: Date
    endAt: Date
  }>,
): {
  id: string
  anchorName: string
  shopName: string
  liveRoomName: string
  startAt: Date
  endAt: Date
} | null {
  const liveAccountName = (view.liveAccountName ?? '').trim()
  for (const row of rows) {
    if (!orderLiveRoomMatchesSchedule(liveAccountName, row.shopName, row.liveRoomName)) continue
    if (isPayTimeInSchedule(payMs, row.startAt, row.endAt)) return row
  }
  return null
}

/**
 * @deprecated 内部已委托 resolveCanonicalOrderAttribution（下单时间唯一归属）
 * 保留函数名供全站调用点兼容。
 */
export async function resolveAnchorWithScheduleOverlay(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): Promise<ScheduleAttributionResult> {
  const { resolveCanonicalOrderAttribution } = await import('./canonical-order-attribution.service')
  const canonical = await resolveCanonicalOrderAttribution(view)
  const sourceMap: Record<string, ScheduleAttributionSource> = {
    manual_override: 'manual_override',
    live_session: 'live_session',
    confirmed_schedule: 'confirmed_schedule',
    unassigned: 'unmatched',
    conflict: 'conflict',
  }
  return {
    anchorId: canonical.canonicalAnchorId,
    anchorName: canonical.canonicalAnchorName,
    attributionSource: sourceMap[canonical.attributionType] ?? 'unmatched',
    attributionExplain: canonical.attributionExplain,
    scheduleConfirmed: canonical.attributionType === 'confirmed_schedule',
    matchedScheduleRowId: canonical.matchedScheduleId ?? undefined,
  }
}

/** 全站 remap：支付/签收/退款/品退共用同一 canonical 归属 */
export async function remapViewsWithScheduleOverlay(
  views: (AnalyzedOrderView & { raw?: Record<string, unknown> })[],
): Promise<
  (AnalyzedOrderView & {
    scheduleAttributionExplain?: string
    scheduleAttributionSource?: ScheduleAttributionSource
    scheduleConfirmed?: boolean
  })[]
> {
  const { remapViewsWithCanonicalAttribution } = await import(
    './canonical-order-attribution.service'
  )
  const remapped = await remapViewsWithCanonicalAttribution(views)
  return remapped.map((v) => ({
    ...v,
    scheduleAttributionSource: (v.scheduleAttributionSource ??
      'unmatched') as ScheduleAttributionSource,
  }))
}

/** 供调试：加载某日生效排班缓存 */
export async function debugLoadSchedulesForDate(dateKey: string) {
  return loadSchedules(dateKey)
}

void resolveAnchorId
