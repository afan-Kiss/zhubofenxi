import type { AnalyzedOrderView } from '../types/analysis'
import { findAnchorByName } from './anchor-rules.service'
import { getAnchorConfigSync } from './anchor.service'
import {
  parseViewPayTimeMs,
  resolveAnchorForPerformanceAttribution,
} from './anchor-performance-attribution.service'
import { getEffectiveSchedulesForDate } from './anchor-daily-schedule.service'
import { isPayTimeInSchedule, scheduleDateFromPayMs } from '../utils/anchor-schedule-time.util'
import { orderLiveRoomMatchesSchedule } from '../utils/shop-name-normalize.util'

export type ScheduleAttributionSource =
  | 'manual_schedule'
  | 'default_schedule'
  | 'legacy_rule'
  | 'unmatched'

export interface ScheduleAttributionResult {
  anchorId: string
  anchorName: string
  attributionSource: ScheduleAttributionSource
  attributionExplain: string
}

const scheduleCacheByDate = new Map<string, Awaited<ReturnType<typeof getEffectiveSchedulesForDate>>>()

export function clearScheduleAttributionCache(): void {
  scheduleCacheByDate.clear()
}

async function loadSchedules(dateKey: string) {
  let cached = scheduleCacheByDate.get(dateKey)
  if (!cached) {
    cached = await getEffectiveSchedulesForDate(dateKey)
    scheduleCacheByDate.set(dateKey, cached)
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
    }
  }

  const dateKey = scheduleDateFromPayMs(payMs)
  const buckets = await loadSchedules(dateKey)

  const manualHit = matchScheduleRow(view, payMs, buckets.manual)
  if (manualHit) {
    const anchorName = manualHit.anchorName
    return {
      anchorId: resolveAnchorId(anchorName),
      anchorName,
      attributionSource: 'manual_schedule',
      attributionExplain: `命中 ${dateKey} 手动排班：${manualHit.liveRoomName} ${formatHmRange(manualHit.startAt, manualHit.endAt)} ${anchorName}`,
    }
  }

  const generatedHit = matchScheduleRow(view, payMs, buckets.generated)
  if (generatedHit) {
    const anchorName = generatedHit.anchorName
    return {
      anchorId: resolveAnchorId(anchorName),
      anchorName,
      attributionSource: 'default_schedule',
      attributionExplain: `命中 ${dateKey} 默认排班：${generatedHit.liveRoomName} ${formatHmRange(generatedHit.startAt, generatedHit.endAt)} ${anchorName}`,
    }
  }

  const virtualHit = matchScheduleRow(view, payMs, buckets.virtual)
  if (virtualHit) {
    const anchorName = virtualHit.anchorName
    return {
      anchorId: resolveAnchorId(anchorName),
      anchorName,
      attributionSource: 'default_schedule',
      attributionExplain: `命中默认排班模板：${virtualHit.liveRoomName} ${formatHmRange(virtualHit.startAt, virtualHit.endAt)} ${anchorName}`,
    }
  }

  const config = getAnchorConfigSync()
  const legacy = resolveAnchorForPerformanceAttribution(view, config)
  return {
    anchorId: legacy.anchorId,
    anchorName: legacy.anchorName,
    attributionSource: legacy.anchorName === '未归属' ? 'unmatched' : 'legacy_rule',
    attributionExplain:
      legacy.anchorName === '未归属'
        ? '没有命中当天排班、默认排班和旧规则'
        : `沿用系统默认归属规则：${legacy.anchorName}`,
  }
}

export async function remapViewsWithScheduleOverlay(
  views: (AnalyzedOrderView & { raw?: Record<string, unknown> })[],
): Promise<(AnalyzedOrderView & { scheduleAttributionExplain?: string })[]> {
  const out: (AnalyzedOrderView & { scheduleAttributionExplain?: string })[] = []
  for (const view of views) {
    const resolved = await resolveAnchorWithScheduleOverlay(view)
    out.push({
      ...view,
      anchorId: resolved.anchorId,
      anchorName: resolved.anchorName,
      scheduleAttributionExplain: resolved.attributionExplain,
    })
  }
  return out
}
