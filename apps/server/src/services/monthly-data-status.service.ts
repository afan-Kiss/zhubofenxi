import { prisma } from '../lib/prisma'
import { getSyncStrategySettings } from './system-setting.service'
import { getMonthKey } from '../utils/time'

export type MonthlyDataPhase = 'live' | 'recalculating' | 'stable'
export type GrossProfitStability = 'realtime' | 'recalculating' | 'stable' | 'adjusted'

export async function resolveMonthlyPhaseAsync(
  monthKey: string,
  now = new Date(),
): Promise<MonthlyDataPhase> {
  const settings = await getSyncStrategySettings()
  const currentMonth = getMonthKey(now)
  if (monthKey === currentMonth) return 'live'

  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`

  if (monthKey !== prevMonth) return 'stable'

  const day = now.getDate()
  if (day >= settings.monthClosingStartDay && day <= settings.monthClosingEndDay) {
    return 'recalculating'
  }
  return 'stable'
}

export function grossProfitStabilityFromPhase(
  phase: MonthlyDataPhase,
  hasAdjustment: boolean,
): GrossProfitStability {
  if (hasAdjustment) return 'adjusted'
  if (phase === 'live') return 'realtime'
  if (phase === 'recalculating') return 'recalculating'
  return 'stable'
}

const PHASE_LABELS: Record<MonthlyDataPhase, string> = {
  live: '实时变动中',
  recalculating: '月结修正中',
  stable: '基本稳定',
}

const STABILITY_LABELS: Record<GrossProfitStability, string> = {
  realtime: '实时估算',
  recalculating: '月结修正中',
  stable: '基本稳定',
  adjusted: '有历史调整',
}

export function monthlyPhaseLabel(phase: MonthlyDataPhase): string {
  return PHASE_LABELS[phase]
}

export function grossProfitStabilityLabel(stability: GrossProfitStability): string {
  return STABILITY_LABELS[stability]
}

export async function refreshMonthlyDataStatuses(monthKeys?: string[]): Promise<void> {
  const now = new Date()
  const keys =
    monthKeys ??
    [
      getMonthKey(now),
      getMonthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    ]

  for (const monthKey of keys) {
    const phase = await resolveMonthlyPhaseAsync(monthKey, now)
    const adj = await prisma.historicalAdjustment.aggregate({
      where: { monthKey },
      _sum: { amountCent: true },
      _count: true,
    })
    const hasAdj = (adj._count ?? 0) > 0
    const stability = grossProfitStabilityFromPhase(phase, hasAdj)

    await prisma.monthlyDataStatus.upsert({
      where: { monthKey },
      create: {
        monthKey,
        status: phase,
        lastSyncedAt: now,
        hasHistoricalAdjustment: hasAdj,
        adjustmentAmountCent: adj._sum.amountCent ?? 0,
        grossProfitStability: stability,
      },
      update: {
        status: phase,
        lastSyncedAt: now,
        hasHistoricalAdjustment: hasAdj,
        adjustmentAmountCent: adj._sum.amountCent ?? 0,
        grossProfitStability: stability,
      },
    })
  }
}

export async function getMonthlyDataStatus(monthKey: string) {
  const row = await prisma.monthlyDataStatus.findUnique({ where: { monthKey } })
  if (!row) {
    const phase = await resolveMonthlyPhaseAsync(monthKey)
    return {
      monthKey,
      status: phase,
      statusLabel: monthlyPhaseLabel(phase),
      lastSyncedAt: null,
      hasHistoricalAdjustment: false,
      adjustmentAmountCent: 0,
      grossProfitStability: grossProfitStabilityFromPhase(phase, false),
      grossProfitStabilityLabel: grossProfitStabilityLabel(
        grossProfitStabilityFromPhase(phase, false),
      ),
    }
  }
  return {
    monthKey: row.monthKey,
    status: row.status as MonthlyDataPhase,
    statusLabel: monthlyPhaseLabel(row.status as MonthlyDataPhase),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    hasHistoricalAdjustment: row.hasHistoricalAdjustment,
    adjustmentAmountCent: row.adjustmentAmountCent,
    grossProfitStability: row.grossProfitStability as GrossProfitStability,
    grossProfitStabilityLabel: grossProfitStabilityLabel(
      (row.grossProfitStability ?? 'stable') as GrossProfitStability,
    ),
  }
}

export function primaryMonthKeyFromRange(startDate: string, endDate: string): string {
  const startMonth = startDate.slice(0, 7)
  const endMonth = endDate.slice(0, 7)
  if (startMonth === endMonth) return startMonth
  return endMonth
}
