import type { AnalyzedOrderView } from '../types/analysis'
import { findAnchorByName, matchTimeRule } from './anchor-rules.service'
import { getAnchorConfigSync } from './anchor.service'
import {
  parseViewPayTimeMs,
  resolveAnchorForPerformanceAttribution,
  SHOP_SESSION_ANCHOR_CUTOFF_MS,
} from './anchor-performance-attribution.service'
import { getEffectiveSchedulesForDate } from './anchor-daily-schedule.service'
import { isDateScheduleConfirmed } from './anchor-schedule-confirm.service'
import { isPayTimeInSchedule, scheduleDateFromPayMs } from '../utils/anchor-schedule-time.util'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'
import { ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE } from '../config/anchor-schedule.constants'

export type ScheduleAttributionSource =
  | 'manual_schedule'
  | 'default_schedule'
  | 'saved_time_rule'
  | 'template_virtual'
  | 'legacy_rule'
  | 'unmatched'

export interface ScheduleAttributionResult {
  anchorId: string
  anchorName: string
  attributionSource: ScheduleAttributionSource
  attributionExplain: string
  scheduleConfirmed: boolean
}

const scheduleCacheByDate = new Map<string, Awaited<ReturnType<typeof getEffectiveSchedulesForDate>>>()
const confirmCacheByDate = new Map<string, boolean>()

export function clearScheduleAttributionCache(): void {
  scheduleCacheByDate.clear()
  confirmCacheByDate.clear()
}

async function loadSchedules(dateKey: string) {
  let cached = scheduleCacheByDate.get(dateKey)
  if (!cached) {
    cached = await getEffectiveSchedulesForDate(dateKey)
    scheduleCacheByDate.set(dateKey, cached)
  }
  return cached
}

async function loadDateConfirmed(dateKey: string): Promise<boolean> {
  let cached = confirmCacheByDate.get(dateKey)
  if (cached === undefined) {
    cached = await isDateScheduleConfirmed(dateKey)
    confirmCacheByDate.set(dateKey, cached)
  }
  return cached
}

function resolveAnchorId(anchorName: string): string {
  const config = getAnchorConfigSync()
  const found = findAnchorByName(config, anchorName)
  return found?.id ?? `extra-${anchorName}`
}

function matchScheduleRow(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
  payMs: number,
  rows: Array<{
    anchorName: string
    shopName: string
    liveRoomName: string
    startAt: Date
    endAt: Date
  }>,
): { anchorName: string; shopName: string; liveRoomName: string; startAt: Date; endAt: Date } | null {
  const liveAccountName = (view.liveAccountName ?? '').trim()
  for (const row of rows) {
    if (!orderLiveRoomMatchesSchedule(liveAccountName, row.shopName, row.liveRoomName)) {
      continue
    }
    if (isPayTimeInSchedule(payMs, row.startAt, row.endAt)) {
      return row
    }
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

export async function resolveAnchorWithScheduleOverlay(
  view: AnalyzedOrderView & { raw?: Record<string, unknown> },
): Promise<ScheduleAttributionResult> {
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
  const dateConfirmed = await loadDateConfirmed(dateKey)
  const config = getAnchorConfigSync()
  const onOrAfter613 = payMs >= SHOP_SESSION_ANCHOR_CUTOFF_MS

  const manualHit = matchScheduleRow(view, payMs, buckets.manual)
  if (manualHit) {
    const anchorName = manualHit.anchorName
    return {
      anchorId: resolveAnchorId(anchorName),
      anchorName,
      attributionSource: 'manual_schedule',
      attributionExplain: `命中 ${dateKey} 手动排班：${manualHit.liveRoomName} ${formatHmRange(manualHit.startAt, manualHit.endAt)} ${anchorName}`,
      scheduleConfirmed: dateConfirmed,
    }
  }

  if (dateConfirmed) {
    const generatedHit = matchScheduleRow(view, payMs, buckets.generated)
    if (generatedHit) {
      const anchorName = generatedHit.anchorName
      return {
        anchorId: resolveAnchorId(anchorName),
        anchorName,
        attributionSource: 'default_schedule',
        attributionExplain: `命中 ${dateKey} 已确认默认排班：${generatedHit.liveRoomName} ${formatHmRange(generatedHit.startAt, generatedHit.endAt)} ${anchorName}`,
        scheduleConfirmed: true,
      }
    }
  }

  if (onOrAfter613) {
    const timeRule = matchTimeRule(new Date(payMs), config)
    if (timeRule) {
      return {
        anchorId: timeRule.anchor.id,
        anchorName: timeRule.anchor.name,
        attributionSource: 'saved_time_rule',
        attributionExplain: `命中已保存时段规则「${timeRule.rule.name}」→ ${timeRule.anchor.name}`,
        scheduleConfirmed: dateConfirmed,
      }
    }
  }

  if (dateConfirmed && onOrAfter613) {
    const virtualHit = matchScheduleRow(view, payMs, buckets.virtual)
    if (virtualHit) {
      const anchorName = virtualHit.anchorName
      return {
        anchorId: resolveAnchorId(anchorName),
        anchorName,
        attributionSource: 'template_virtual',
        attributionExplain: `命中 ${ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE} 起默认排班模板：${virtualHit.liveRoomName} ${formatHmRange(virtualHit.startAt, virtualHit.endAt)} ${anchorName}`,
        scheduleConfirmed: true,
      }
    }
  }

  if (!onOrAfter613) {
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
  } else {
    const legacy = resolveAnchorForPerformanceAttribution(view, config)
    if (legacy.anchorName !== '未归属') {
      return {
        anchorId: legacy.anchorId,
        anchorName: legacy.anchorName,
        attributionSource: 'legacy_rule',
        attributionExplain: `沿用 ${ANCHOR_SCHEDULE_ATTRIBUTION_START_DATE} 起直播号+场次规则：${legacy.anchorName}`,
        scheduleConfirmed: dateConfirmed,
      }
    }
  }

  if (!dateConfirmed && onOrAfter613) {
    return {
      anchorId: '',
      anchorName: '未归属',
      attributionSource: 'unmatched',
      attributionExplain: `${dateKey} 排班尚未确认，未将订单归属给主播（请确认排班后重算）`,
      scheduleConfirmed: false,
    }
  }

  return {
    anchorId: '',
    anchorName: '未归属',
    attributionSource: 'unmatched',
    attributionExplain: '没有命中手动排班、已确认排班、时段规则或旧规则',
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
