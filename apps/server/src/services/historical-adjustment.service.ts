import { prisma } from '../lib/prisma'
import { loadNormalizedOrdersFromRaw } from './xhs-api-sync/xhs-json-normalizer.service'
import { getMonthKey } from '../utils/time'

export type AdjustmentType = 'refund' | 'settlement' | 'fee' | 'freight'

export async function recordHistoricalAdjustment(input: {
  monthKey: string
  packageId?: string | null
  adjustmentType: AdjustmentType
  amountCent: number
  occurredAt?: Date | null
  description?: string | null
  orderMonth?: string | null
  refundMonth?: string | null
  syncJobId?: string | null
}): Promise<string> {
  const row = await prisma.historicalAdjustment.create({
    data: {
      monthKey: input.monthKey,
      packageId: input.packageId ?? null,
      adjustmentType: input.adjustmentType,
      amountCent: input.amountCent,
      occurredAt: input.occurredAt ?? null,
      description: input.description ?? null,
      orderMonth: input.orderMonth ?? null,
      refundMonth: input.refundMonth ?? null,
      syncJobId: input.syncJobId ?? null,
    },
  })

  const total = await prisma.historicalAdjustment.aggregate({
    where: { monthKey: input.monthKey },
    _sum: { amountCent: true },
  })

  await prisma.monthlyDataStatus.upsert({
    where: { monthKey: input.monthKey },
    create: {
      monthKey: input.monthKey,
      status: 'stable',
      hasHistoricalAdjustment: true,
      adjustmentAmountCent: total._sum.amountCent ?? input.amountCent,
      grossProfitStability: 'adjusted',
      lastSyncedAt: new Date(),
    },
    update: {
      hasHistoricalAdjustment: true,
      adjustmentAmountCent: total._sum.amountCent ?? 0,
      grossProfitStability: 'adjusted',
      lastSyncedAt: new Date(),
    },
  })

  return row.id
}

export async function detectHistoricalAdjustments(syncJobId?: string | null): Promise<number> {
  const now = new Date()
  const currentMonth = getMonthKey(now)
  const orders = await loadNormalizedOrdersFromRaw()
  let created = 0

  for (const order of orders) {
    if (!order.isReturned || !order.orderTime) continue
    const orderMonth = getMonthKey(order.orderTime)
    if (orderMonth === currentMonth) continue

    const refundMonth = currentMonth
    const amountCent = order.receivableAmountCent > 0 ? order.receivableAmountCent : order.gmvCent
    if (amountCent <= 0) continue

    const existing = await prisma.historicalAdjustment.findFirst({
      where: {
        packageId: order.packageId ?? order.matchOrderId,
        monthKey: orderMonth,
        adjustmentType: 'refund',
      },
    })
    if (existing) continue

    await recordHistoricalAdjustment({
      monthKey: orderMonth,
      packageId: order.packageId ?? order.matchOrderId,
      adjustmentType: 'refund',
      amountCent,
      occurredAt: now,
      description: `历史订单 ${orderMonth} 在 ${refundMonth} 发生退款`,
      orderMonth,
      refundMonth,
      syncJobId,
    })
    created++
  }

  return created
}

export async function getAdjustmentsForMonth(monthKey: string): Promise<{
  items: Array<{
    id: string
    adjustmentType: string
    amountCent: number
    description: string | null
    orderMonth: string | null
    refundMonth: string | null
    occurredAt: string | null
  }>
  totalCent: number
}> {
  const rows = await prisma.historicalAdjustment.findMany({
    where: { monthKey },
    orderBy: { createdAt: 'desc' },
  })
  const totalCent = rows.reduce((s, r) => s + r.amountCent, 0)
  return {
    items: rows.map((r) => ({
      id: r.id,
      adjustmentType: r.adjustmentType,
      amountCent: r.amountCent,
      description: r.description,
      orderMonth: r.orderMonth,
      refundMonth: r.refundMonth,
      occurredAt: r.occurredAt?.toISOString() ?? null,
    })),
    totalCent,
  }
}
