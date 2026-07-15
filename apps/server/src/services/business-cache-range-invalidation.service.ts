/**
 * 售后变化 → 按支付日期范围合并失效经营缓存（防重建风暴）
 */
import { logInfo } from '../utils/server-log'
import type { BusinessRangePreset } from '../utils/business-range'
import { resolveBusinessRange } from '../utils/business-range'

const DEBOUNCE_MS = 3_000

type PendingChange = {
  payDate: string // YYYY-MM-DD Asia/Shanghai calendar day
  orderNo?: string
}

const pending = new Map<string, PendingChange>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false

function shanghaiDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  return `${y}-${m}-${day}`
}

export function scheduleBusinessBoardCacheInvalidationForPayTime(
  payTime: Date | string | null | undefined,
  orderNo?: string,
): void {
  if (payTime == null || payTime === '') return
  const d = typeof payTime === 'string' ? new Date(payTime.replace(' ', 'T')) : payTime
  if (Number.isNaN(d.getTime())) return
  const payDate = shanghaiDateKey(d)
  pending.set(`${payDate}::${orderNo ?? ''}`, { payDate, orderNo })
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void flushBusinessBoardCacheRangeInvalidations()
  }, DEBOUNCE_MS)
}

export async function flushBusinessBoardCacheRangeInvalidations(): Promise<{
  changeCount: number
  dates: string[]
  presets: string[]
  customKeysRemoved: number
}> {
  if (flushing) {
    return { changeCount: 0, dates: [], presets: [], customKeysRemoved: 0 }
  }
  flushing = true
  const batch = [...pending.values()]
  pending.clear()
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  try {
    if (batch.length === 0) {
      return { changeCount: 0, dates: [], presets: [], customKeysRemoved: 0 }
    }
    const dates = [...new Set(batch.map((b) => b.payDate))].sort()
    const presetsToDrop = new Set<BusinessRangePreset>()
    const standard: BusinessRangePreset[] = [
      'today',
      'yesterday',
      'thisWeek',
      'thisMonth',
      'lastMonth',
    ]
    for (const preset of standard) {
      try {
        const range = resolveBusinessRange(preset)
        for (const day of dates) {
          // 经营预设用日历日闭区间 [startDate, endDate]（时刻再用 start/endOfDay）
          if (day >= range.startDate && day <= range.endDate) {
            presetsToDrop.add(preset)
            break
          }
        }
      } catch {
        // ignore
      }
    }

    const { invalidateBusinessBoardCacheForPresets, removeCustomBusinessCachesIntersectingDates } =
      await import('./business-cache.service')

    const presets = [...presetsToDrop]
    const t0 = Date.now()
    if (presets.length) invalidateBusinessBoardCacheForPresets(presets)
    const customKeysRemoved = removeCustomBusinessCachesIntersectingDates(dates)
    const ms = Date.now() - t0
    logInfo(
      '经营缓存',
      `售后变更合并失效：变更=${batch.length} 日期=${dates.join(',')} 预设=${presets.join(',') || '—'} custom=${customKeysRemoved} 耗时=${ms}ms`,
    )
    return {
      changeCount: batch.length,
      dates,
      presets,
      customKeysRemoved,
    }
  } finally {
    flushing = false
  }
}

/** 测试用：清空待合并队列 */
export function resetBusinessBoardCacheInvalidationQueueForTests(): void {
  pending.clear()
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

export function getPendingBusinessBoardCacheInvalidationCount(): number {
  return pending.size
}
