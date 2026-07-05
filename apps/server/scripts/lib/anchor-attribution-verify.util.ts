/**
 * 只读：按订单支付日期的生效排班推导期望主播（不写库）
 */
import { prisma } from '../src/lib/prisma'
import {
  getEffectiveScheduleTableForDate,
  type EffectiveScheduleRow,
  type EffectiveScheduleTable,
} from '../src/services/anchor-daily-schedule.service'
import { isPayTimeInSchedule } from '../src/utils/anchor-schedule-time.util'
import { orderLiveRoomMatchesSchedule } from '../src/utils/shop-name-normalize.util'

export interface ExpectedAnchorHit {
  anchorName: string
  row: EffectiveScheduleRow
  reason: string
  usedVirtualFallback: boolean
  hasDailyScheduleRows: boolean
  dateConfirmed: boolean
}

export async function loadDailyScheduleMeta(dateKey: string): Promise<{
  dbRowCount: number
  hasManual: boolean
  hasGenerated: boolean
  confirmed: boolean
}> {
  const rows = await prisma.anchorDailySchedule.findMany({
    where: { scheduleDate: dateKey, enabled: true },
    select: { source: true, confirmed: true },
  })
  return {
    dbRowCount: rows.length,
    hasManual: rows.some((r) => r.source === 'manual'),
    hasGenerated: rows.some((r) => r.source === 'generated_default'),
    confirmed: rows.some((r) => r.confirmed),
  }
}

/** 按当天生效排班表匹配支付时间 → 期望主播（不硬编码主播名） */
export async function computeExpectedAnchorFromEffectiveSchedule(params: {
  dateKey: string
  payMs: number
  liveAccountName: string
}): Promise<{
  hit: ExpectedAnchorHit | null
  table: EffectiveScheduleTable
  meta: Awaited<ReturnType<typeof loadDailyScheduleMeta>>
}> {
  const table = await getEffectiveScheduleTableForDate(params.dateKey)
  const meta = await loadDailyScheduleMeta(params.dateKey)
  const usedVirtualFallback = meta.dbRowCount === 0 && table.sourceSummary.virtualCount > 0

  for (const row of table.rows) {
    if (!row.enabled) continue
    if (!orderLiveRoomMatchesSchedule(params.liveAccountName, row.shopName, row.liveRoomName)) {
      continue
    }
    const startAt = new Date(row.startAt)
    const endAt = new Date(row.endAt)
    if (!isPayTimeInSchedule(params.payMs, startAt, endAt)) continue

    const sourceLabel =
      row.source === 'manual'
        ? 'manual'
        : row.source === 'generated_default'
          ? 'generated_default'
          : 'virtual_template'

    return {
      hit: {
        anchorName: row.anchorName,
        row,
        reason: `命中 ${params.dateKey} 生效排班 ${row.liveRoomName} ${row.startTime}-${row.endTime} (${sourceLabel})`,
        usedVirtualFallback,
        hasDailyScheduleRows: meta.dbRowCount > 0,
        dateConfirmed: table.confirmed,
      },
      table,
      meta,
    }
  }

  return { hit: null, table, meta }
}

export function pickBuyerNick(raw: Record<string, unknown> | undefined): string {
  if (!raw) return '—'
  const userInfo = raw.userInfo as Record<string, unknown> | undefined
  if (userInfo?.nickName) return String(userInfo.nickName)
  if (raw.buyerNickName) return String(raw.buyerNickName)
  return '—'
}

export function pickProductName(raw: Record<string, unknown> | undefined): string {
  if (!raw) return '—'
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    return String(first.displayName ?? first.skuName ?? first.name ?? '—')
  }
  return '—'
}

export function pickSkuId(raw: Record<string, unknown> | undefined): string {
  if (!raw) return '—'
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    return String(first.skuId ?? first.skuName ?? '—')
  }
  return '—'
}
