/**
 * 支付时间预筛漏单诊断（只读，绕过 loadNormalizedOrdersFromRaw 的业务 range 预筛）
 */
import { prisma } from '../lib/prisma'
import type { NormalizedOrder } from '../types/analysis'
import type { DateRangeResolved } from '../utils/date-range'
import { formatDateKeyShanghai } from '../utils/business-timezone'
import { orderPayTimeInRange } from '../utils/order-stat-time.util'
import {
  normalizeXhsOrderPackage,
  RAW_ORDER_RANGE_DB_BUFFER_MS,
} from './xhs-api-sync/xhs-json-normalizer.service'
import type { Prisma } from '@prisma/client'

export type PayTimePrefilterDiagnoseMode = 'full_raw_scan' | 'wide_raw_scan'

export interface PayTimePrefilterGapRow {
  packageId: string
  orderId: string
  orderedAt: string | null
  orderTime: string | null
  paymentTime: string | null
  gapDays: number
  gmvYuan: number
  paymentMonth: string
  wouldMissWithCurrentPrefilter: boolean
  reason: string
}

export interface PayTimePrefilterDiagnosticResult {
  diagnoseMode: PayTimePrefilterDiagnoseMode
  rawRowsScanned: number
  normalizedCount: number
  paymentRange: { startDate: string; endDate: string }
  latePayOver30DaysCount: number
  wouldMissWithCurrentPrefilterCount: number
  rows: PayTimePrefilterGapRow[]
  note: string
}

function asRecord(raw: Prisma.JsonValue): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

const RAW_SELECT = {
  id: true,
  packageId: true,
  orderId: true,
  orderTime: true,
  rawJson: true,
  updatedAt: true,
  liveAccountId: true,
  liveAccountName: true,
} as const

/** 只读：从 raw 表加载并 normalize，不做 orderTime range 预筛 */
export async function loadNormalizedOrdersForDiagnosticsWithoutRangePrefilter(options?: {
  updatedSince?: Date
  scanAll?: boolean
}): Promise<{
  normalized: NormalizedOrder[]
  rawRowsScanned: number
  diagnoseMode: PayTimePrefilterDiagnoseMode
}> {
  const PAGE = 500
  const normalized: NormalizedOrder[] = []
  let rawRowsScanned = 0
  let skip = 0
  const diagnoseMode: PayTimePrefilterDiagnoseMode = options?.scanAll
    ? 'full_raw_scan'
    : 'wide_raw_scan'

  while (true) {
    const batch = await prisma.xhsRawOrder.findMany({
      where:
        options?.scanAll || !options?.updatedSince
          ? undefined
          : { updatedAt: { gte: options.updatedSince } },
      select: RAW_SELECT,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: PAGE,
    })
    if (batch.length === 0) break

    rawRowsScanned += batch.length
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i]!
      normalized.push(
        normalizeXhsOrderPackage(asRecord(row.rawJson), skip + i + 1, {
          dbPackageId: row.packageId,
          dbOrderId: row.orderId,
          liveAccountId: row.liveAccountId,
          liveAccountName: row.liveAccountName,
        }),
      )
    }

    skip += batch.length
    if (batch.length < PAGE) break
  }

  return { normalized, rawRowsScanned, diagnoseMode }
}

export function wouldOrderPassCurrentDbPrefilter(
  orderTime: Date | null,
  range: DateRangeResolved,
): boolean {
  const gte = new Date(range.startTimeMs - RAW_ORDER_RANGE_DB_BUFFER_MS)
  const lte = new Date(range.endTimeMs + RAW_ORDER_RANGE_DB_BUFFER_MS)
  if (orderTime == null) return true
  return orderTime >= gte && orderTime <= lte
}

export function analyzePayTimePrefilterGaps(
  orders: NormalizedOrder[],
  paymentRange: DateRangeResolved,
): PayTimePrefilterGapRow[] {
  const results: PayTimePrefilterGapRow[] = []

  for (const o of orders) {
    if (o.errors.length > 0 || !o.paymentTime || !o.orderedAt) continue

    const gapMs = o.paymentTime.getTime() - o.orderedAt.getTime()
    const gapDays = Math.floor(gapMs / 86_400_000)
    if (gapDays <= 30) continue
    if (!orderPayTimeInRange(o, paymentRange)) continue

    const orderTimeDate = o.orderTime ?? o.orderedAt
    const wouldMiss = !wouldOrderPassCurrentDbPrefilter(orderTimeDate, paymentRange)
    const paymentMonth = formatDateKeyShanghai(o.paymentTime).slice(0, 7)

    let reason = `下单与支付相差 ${gapDays} 天`
    if (wouldMiss) {
      reason += `；下单时间 ${formatDateKeyShanghai(orderTimeDate)} 不在支付月 ${paymentRange.startDate}~${paymentRange.endDate} 的 orderTime±30天 预筛范围内，可能被漏算`
    } else {
      reason += `；当前 orderTime±30天 预筛仍可覆盖`
    }

    results.push({
      packageId: o.packageId,
      orderId: o.orderId,
      orderedAt: o.orderedAt.toISOString(),
      orderTime: orderTimeDate.toISOString(),
      paymentTime: o.paymentTime.toISOString(),
      gapDays,
      gmvYuan: Math.round(o.gmvCent / 100),
      paymentMonth,
      wouldMissWithCurrentPrefilter: wouldMiss,
      reason,
    })
  }

  return results.sort((a, b) => b.gapDays - a.gapDays)
}

export async function runPayTimePrefilterDiagnostic(params: {
  paymentRange: DateRangeResolved
  scanAll?: boolean
  scanDays?: number
}): Promise<PayTimePrefilterDiagnosticResult> {
  const scanDays = params.scanDays ?? 180
  const updatedSince =
    params.scanAll === true
      ? undefined
      : new Date(Date.now() - scanDays * 86_400_000)

  const { normalized, rawRowsScanned, diagnoseMode } =
    await loadNormalizedOrdersForDiagnosticsWithoutRangePrefilter({
      scanAll: params.scanAll === true,
      updatedSince,
    })

  const rows = analyzePayTimePrefilterGaps(normalized, params.paymentRange)
  const wouldMiss = rows.filter((r) => r.wouldMissWithCurrentPrefilter)

  let note: string
  if (wouldMiss.length > 0) {
    note = `全库 raw 扫描发现 ${wouldMiss.length} 单可能被 orderTime 预筛漏掉（扫描 ${rawRowsScanned} 条 raw）`
  } else if (rows.length > 0) {
    note = `发现 ${rows.length} 单晚支付超过30天，但当前预筛仍可覆盖（扫描 ${rawRowsScanned} 条 raw）`
  } else {
    note = `在 ${diagnoseMode}（${rawRowsScanned} 条 raw）内未发现支付月 ${params.paymentRange.startDate}~${params.paymentRange.endDate} 的晚支付漏单样本`
  }

  return {
    diagnoseMode,
    rawRowsScanned,
    normalizedCount: normalized.length,
    paymentRange: {
      startDate: params.paymentRange.startDate,
      endDate: params.paymentRange.endDate,
    },
    latePayOver30DaysCount: rows.length,
    wouldMissWithCurrentPrefilterCount: wouldMiss.length,
    rows,
    note,
  }
}
