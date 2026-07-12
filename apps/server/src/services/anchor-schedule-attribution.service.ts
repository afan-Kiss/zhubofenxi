import type { AnalyzedOrderView } from '../types/analysis'
import { findAnchorByName } from './anchor-rules.service'
import { getAnchorConfigSync } from './anchor.service'
import {
  parseViewPayTimeMs,
  resolveAnchorForPerformanceAttribution,
  SHOP_SESSION_ANCHOR_CUTOFF_MS,
} from './anchor-performance-attribution.service'
import { getEffectiveSchedulesForDate } from './anchor-daily-schedule.service'
import { isPayTimeInSchedule, scheduleDateFromPayMs } from '../utils/anchor-schedule-time.util'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'
import { ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE } from '../config/anchor-schedule.constants'
import { matchTimeRule } from './anchor-rules.service'
import {
  resolveManualAnchorOverrideForView,
} from './order-anchor-manual-override.service'
import { clearLiveSessionOrderAttributionCache } from './anchor-live-session-order-attribution.service'

export type ScheduleAttributionSource =
  | 'live_session'
  | 'manual_schedule'
  | 'default_schedule'
  | 'template_virtual'
  | 'legacy_rule'
  | 'manual_override'
  | 'unmatched'

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

function formatHmRange(startAt: Date, endAt: Date): string {
  const start = startAt.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const end =
    endAt.getHours() === 0 && endAt.getMinutes() === 0
      ? '24:00'
      : endAt.toLocaleTimeString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
  return `${start}-${end}`
}

function buildEffectiveExplain(
  dateKey: string,
  hit: { liveRoomName: string; startAt: Date; endAt: Date; anchorName: string },
  fromLiveSessionGap = false,
): string {
  const base = `命中 ${dateKey} 生效排班表：${hit.liveRoomName} ${formatHmRange(hit.startAt, hit.endAt)} → ${hit.anchorName}`
  if (fromLiveSessionGap) {
    return `支付时间未命中真实直播时段，按当天生效排班兜底：${hit.liveRoomName} ${formatHmRange(hit.startAt, hit.endAt)} → ${hit.anchorName}`
  }
  return base
}

function resolveScheduleAttribution(
  dateKey: string,
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  payMs: number,
  buckets: Awaited<ReturnType<typeof loadSchedules>>,
  dateConfirmed: boolean,
  fromLiveSessionGap: boolean,
): ScheduleAttributionResult | null {
  const manualHit = matchScheduleRow(view, payMs, buckets.manual)
  if (manualHit) {
    return {
      anchorId: resolveAnchorId(manualHit.anchorName),
      anchorName: manualHit.anchorName,
      attributionSource: 'manual_schedule',
      attributionExplain: buildEffectiveExplain(dateKey, manualHit, fromLiveSessionGap),
      scheduleConfirmed: dateConfirmed,
      matchedScheduleRowId: manualHit.id,
    }
  }

  const generatedHit = matchScheduleRow(view, payMs, buckets.generated)
  if (generatedHit) {
    return {
      anchorId: resolveAnchorId(generatedHit.anchorName),
      anchorName: generatedHit.anchorName,
      attributionSource: 'default_schedule',
      attributionExplain: buildEffectiveExplain(dateKey, generatedHit, fromLiveSessionGap),
      scheduleConfirmed: dateConfirmed,
      matchedScheduleRowId: generatedHit.id,
    }
  }

  const virtualHit = matchScheduleRow(view, payMs, buckets.virtual)
  if (virtualHit) {
    return {
      anchorId: resolveAnchorId(virtualHit.anchorName),
      anchorName: virtualHit.anchorName,
      attributionSource: 'template_virtual',
      attributionExplain: buildEffectiveExplain(dateKey, virtualHit, fromLiveSessionGap),
      scheduleConfirmed: dateConfirmed,
      matchedScheduleRowId: virtualHit.id,
    }
  }

  return null
}

export async function resolveAnchorWithScheduleOverlay(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): Promise<ScheduleAttributionResult> {
  const manual = resolveManualAnchorOverrideForView(view)
  if (manual) {
    return {
      anchorId: manual.anchorId,
      anchorName: manual.anchorName,
      attributionSource: 'manual_override',
      attributionExplain: `手动指定归属：${manual.anchorName}`,
      scheduleConfirmed: false,
    }
  }

  const payMs = parseViewPayTimeMs(view)
  if (payMs == null) {
    return {
      anchorId: '',
      anchorName: '未归属',
      attributionSource: 'unmatched',
      attributionExplain: '订单无支付时间，无法按排班归属',
      scheduleConfirmed: false,
    }
  }

  const dateKey = scheduleDateFromPayMs(payMs)
  const buckets = await loadSchedules(dateKey)
  const dateConfirmed = buckets.table.confirmed
  const onOrAfter613 = payMs >= SHOP_SESSION_ANCHOR_CUTOFF_MS

  if (onOrAfter613) {
    const { resolveAnchorByLiveSessionPayTime, shopHasLiveSessionDataForPayTime } = await import(
      './anchor-live-session-order-attribution.service'
    )
    const liveHit = await resolveAnchorByLiveSessionPayTime(view, payMs)
    if (liveHit) {
      return {
        anchorId: liveHit.anchorId,
        anchorName: liveHit.anchorName,
        attributionSource: 'live_session',
        attributionExplain: liveHit.explain,
        scheduleConfirmed: dateConfirmed,
      }
    }

    const hasLiveForShop = await shopHasLiveSessionDataForPayTime(view, payMs)
    const scheduleHit = resolveScheduleAttribution(
      dateKey,
      view,
      payMs,
      buckets,
      dateConfirmed,
      hasLiveForShop,
    )
    if (scheduleHit) {
      return scheduleHit
    }

    if (hasLiveForShop) {
      return {
        anchorId: '',
        anchorName: '未归属',
        attributionSource: 'unmatched',
        attributionExplain: `${dateKey} 支付时间未落在该直播号当日真实直播时段内，且未命中生效排班表`,
        scheduleConfirmed: dateConfirmed,
      }
    }

    return {
      anchorId: '',
      anchorName: '未归属',
      attributionSource: 'unmatched',
      attributionExplain: `${dateKey} 未命中生效排班表（直播号/时段无匹配）`,
      scheduleConfirmed: dateConfirmed,
    }
  }

  const config = getAnchorConfigSync()
  const timeRule = matchTimeRule(new Date(payMs), config)
  if (timeRule) {
    return {
      anchorId: timeRule.anchor.id,
      anchorName: timeRule.anchor.name,
      attributionSource: 'legacy_rule',
      attributionExplain: `${ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE} 前沿用时段规则「${timeRule.rule.name}」→ ${timeRule.anchor.name}`,
      scheduleConfirmed: dateConfirmed,
    }
  }
  if (view.anchorName && view.anchorName !== '未归属') {
    return {
      anchorId: view.anchorId,
      anchorName: view.anchorName,
      attributionSource: 'legacy_rule',
      attributionExplain: `${ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE} 前沿用系统初始归属：${view.anchorName}`,
      scheduleConfirmed: dateConfirmed,
    }
  }
  const legacy = resolveAnchorForPerformanceAttribution(view, config)
  if (legacy.anchorName !== '未归属') {
    return {
      anchorId: legacy.anchorId,
      anchorName: legacy.anchorName,
      attributionSource: 'legacy_rule',
      attributionExplain: `${ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE} 前沿用直播号+场次规则：${legacy.anchorName}`,
      scheduleConfirmed: dateConfirmed,
    }
  }

  return {
    anchorId: '',
    anchorName: '未归属',
    attributionSource: 'unmatched',
    attributionExplain: `${dateKey} 未命中旧规则或排班`,
    scheduleConfirmed: dateConfirmed,
  }
}

export async function remapViewsWithScheduleOverlay(
  views: (AnalyzedOrderView & { raw?: Record<string, unknown> })[],
): Promise<
  (AnalyzedOrderView & {
    scheduleAttributionExplain?: string
    scheduleAttributionSource?: ScheduleAttributionSource
    scheduleConfirmed?: boolean
  })[]
> {
  const { ensureManualAnchorOverrideCache } = await import(
    './order-anchor-manual-override.service'
  )
  await ensureManualAnchorOverrideCache()
  const out: (AnalyzedOrderView & {
    scheduleAttributionExplain?: string
    scheduleAttributionSource?: ScheduleAttributionSource
    scheduleConfirmed?: boolean
  })[] = []
  for (const view of views) {
    const resolved = await resolveAnchorWithScheduleOverlay(view)
    out.push({
      ...view,
      anchorId: resolved.anchorId,
      anchorName: resolved.anchorName,
      scheduleAttributionExplain: resolved.attributionExplain,
      scheduleAttributionSource: resolved.attributionSource,
      scheduleConfirmed: resolved.scheduleConfirmed,
    })
  }
  return out
}
