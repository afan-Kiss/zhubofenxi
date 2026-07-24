import {
  BOSS_DASHBOARD_SHOPS,
  BOSS_INCOME_MONTHS,
  BOSS_SHOP_RANK_ORDER,
  type BossDashboardShopKey,
} from '../../config/boss-dashboard.constants'
import { prisma } from '../../lib/prisma'
import { addDaysShanghai, formatDateKeyShanghai, shanghaiMonthKey } from '../../utils/business-timezone'
import {
  readStoredBossFeeDetailJson,
  sumFeeDetailExceptStatement,
  type BossFeeDetailMap,
} from './boss-dashboard-bill-normalize.service'

export type BossPendingSettlementView = {
  amountCent: number | null
  orderCount: number | null
  settlePeriodDays: number | null
  fetchedAt: string | null
  syncStatus: string
  syncError: string | null
  reconciliationDiffCent: number | null
}

export type BossCurrentMonthBillView = {
  settlementNetCent: number | null
  statementInCent: number | null
  statementRefundCent: number | null
  otherFeeCent: number | null
  commissionCent: number | null
  settleOrderCount: number | null
  dataThroughDate: string | null
  isPartialMonth: boolean
}

export type BossYesterdaySettlementView = {
  settlementNetCent: number | null
  billDate: string | null
  settleOrderCount: number | null
  commissionCent: number | null
}

export type BossMonthlySettlementTrendPoint = {
  month: string
  amountCent: number | null
  source: 'official_month' | 'day_aggregate'
  isPartialMonth: boolean
}

function latestPendingSnapshot(shopKey: string) {
  return prisma.bossPendingSettlementSnapshot.findFirst({
    where: { shopKey },
    orderBy: { createdAt: 'desc' },
  })
}

export async function loadPendingSettlementView(shopKey: string): Promise<BossPendingSettlementView> {
  const row = await latestPendingSnapshot(shopKey)
  if (!row) {
    return {
      amountCent: null,
      orderCount: null,
      settlePeriodDays: null,
      fetchedAt: null,
      syncStatus: 'missing',
      syncError: null,
      reconciliationDiffCent: null,
    }
  }
  return {
    amountCent: row.pendingAmountCent,
    orderCount: row.pendingOrderCount,
    settlePeriodDays: row.settlePeriodDays,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
    syncStatus: row.syncStatus,
    syncError: row.syncError,
    reconciliationDiffCent: row.reconciliationDiffCent,
  }
}

function mergeFeeDetails(details: BossFeeDetailMap[]): BossFeeDetailMap {
  const merged: BossFeeDetailMap = {}
  for (const detail of details) {
    for (const [code, cent] of Object.entries(detail)) {
      if (cent == null) continue
      merged[code] = (merged[code] ?? 0) + cent
    }
  }
  return merged
}

export async function loadCurrentMonthBillView(shopKey: string): Promise<BossCurrentMonthBillView> {
  const currentMonth = shanghaiMonthKey()
  const monthBills = await prisma.bossSettlementPeriodBill.findMany({
    where: {
      shopKey,
      periodType: 'DAY',
      billDate: { startsWith: currentMonth },
    },
    orderBy: { billDate: 'desc' },
  })

  if (monthBills.length === 0) {
    return {
      settlementNetCent: null,
      statementInCent: null,
      statementRefundCent: null,
      otherFeeCent: null,
      commissionCent: null,
      settleOrderCount: null,
      dataThroughDate: null,
      isPartialMonth: true,
    }
  }

  const feeDetails = monthBills.map((b) => readStoredBossFeeDetailJson(b.feeDetailJson))
  const merged = mergeFeeDetails(feeDetails)
  const settlementNetCent = monthBills.reduce((acc, b) => acc + (b.totalChangeCent ?? 0), 0)
  const commissionCent = monthBills.reduce((acc, b) => acc + (b.totalCommissionCent ?? 0), 0)
  const settleOrderCount = monthBills.reduce((acc, b) => acc + (b.settleOrderCount ?? 0), 0)
  const refundRaw = merged.STATEMENT_REFUND
  const otherFeeCent = sumFeeDetailExceptStatement(merged)

  return {
    settlementNetCent,
    statementInCent: merged.STATEMENT_IN ?? null,
    statementRefundCent: refundRaw != null ? Math.abs(refundRaw) : null,
    otherFeeCent,
    commissionCent,
    settleOrderCount,
    dataThroughDate: monthBills[0]?.billDate ?? null,
    isPartialMonth: true,
  }
}

/** 昨日日账单结算净额（按 billDate 归属上海时区昨日） */
export async function loadYesterdaySettlementView(shopKey: string): Promise<BossYesterdaySettlementView> {
  const yesterday = addDaysShanghai(formatDateKeyShanghai(), -1)
  const dayBills = await prisma.bossSettlementPeriodBill.findMany({
    where: {
      shopKey,
      periodType: 'DAY',
      billDate: { startsWith: yesterday },
    },
    orderBy: { fetchedAt: 'desc' },
  })

  if (dayBills.length === 0) {
    return {
      settlementNetCent: null,
      billDate: yesterday,
      settleOrderCount: null,
      commissionCent: null,
    }
  }

  return {
    settlementNetCent: dayBills.reduce((acc, b) => acc + (b.totalChangeCent ?? 0), 0),
    billDate: yesterday,
    settleOrderCount: dayBills.reduce((acc, b) => acc + (b.settleOrderCount ?? 0), 0),
    commissionCent: dayBills.reduce((acc, b) => acc + (b.totalCommissionCent ?? 0), 0),
  }
}

export async function loadMonthlySettlementTrend(
  shopKey: string,
  monthKeys: string[],
): Promise<BossMonthlySettlementTrendPoint[]> {
  const currentMonth = shanghaiMonthKey()
  const result: BossMonthlySettlementTrendPoint[] = []

  for (const month of monthKeys) {
    if (month === currentMonth) {
      const dayBills = await prisma.bossSettlementPeriodBill.findMany({
        where: { shopKey, periodType: 'DAY', billDate: { startsWith: month } },
      })
      const amountCent = dayBills.length
        ? dayBills.reduce((acc, b) => acc + (b.totalChangeCent ?? 0), 0)
        : null
      result.push({
        month,
        amountCent,
        source: 'day_aggregate',
        isPartialMonth: true,
      })
      continue
    }

    const monthBill = await prisma.bossSettlementPeriodBill.findFirst({
      where: {
        shopKey,
        periodType: 'MONTH',
        billDate: { startsWith: month },
        sourceType: 'official_month',
      },
      orderBy: { fetchedAt: 'desc' },
    })

    if (monthBill) {
      result.push({
        month,
        amountCent: monthBill.totalChangeCent,
        source: 'official_month',
        isPartialMonth: false,
      })
      continue
    }

    const dayBills = await prisma.bossSettlementPeriodBill.findMany({
      where: { shopKey, periodType: 'DAY', billDate: { startsWith: month } },
    })
    const amountCent = dayBills.length
      ? dayBills.reduce((acc, b) => acc + (b.totalChangeCent ?? 0), 0)
      : null
    result.push({
      month,
      amountCent,
      source: 'day_aggregate',
      isPartialMonth: false,
    })
  }

  return result
}

/** 固定店铺展示顺序（非经营名次；可提现余额不得作为经营排名） */
export function rankBossShops<T extends { shopKey: BossDashboardShopKey }>(
  shops: T[],
): Array<T & { rank: number }> {
  const orderIndex = (key: BossDashboardShopKey) => {
    const i = BOSS_SHOP_RANK_ORDER.indexOf(key)
    return i >= 0 ? i : 999
  }
  const sorted = [...shops].sort((a, b) => orderIndex(a.shopKey) - orderIndex(b.shopKey))
  return sorted.map((shop, index) => ({ ...shop, rank: index + 1 }))
}

export async function loadBillReconciliationStatus(shopKey: string): Promise<string> {
  const row = await latestPendingSnapshot(shopKey)
  if (!row) return 'unknown'
  if (row.syncStatus === 'reconciliation_warning') return 'reconciliation_warning'
  if (row.fundReconcileStatus === 'reconciliation_warning') return 'reconciliation_warning'
  if (row.fundReconcileStatus === 'ok' && row.syncStatus === 'success') return 'ok'
  if (row.fundReconcileStatus === 'ok') return 'ok'
  return row.fundReconcileStatus ?? 'unknown'
}

export function buildRecentBillMonthKeys(count = BOSS_INCOME_MONTHS): string[] {
  const keys: string[] = []
  const today = formatDateKeyShanghai()
  const [y, m] = today.split('-').map(Number)
  let year = y!
  let month = m!
  for (let i = 0; i < count; i++) {
    keys.unshift(`${year}-${String(month).padStart(2, '0')}`)
    month -= 1
    if (month <= 0) {
      month = 12
      year -= 1
    }
  }
  return keys
}

export async function listBossBillOrders(params: {
  shopKey?: string
  status: 'pending' | 'settled'
  page: number
  pageSize: number
}) {
  const where =
    params.status === 'pending'
      ? {
          ...(params.shopKey ? { shopKey: params.shopKey } : {}),
          isCurrent: true,
        }
      : {
          ...(params.shopKey ? { shopKey: params.shopKey } : {}),
          isCurrent: false,
          settleStatus: { not: 'INIT' },
        }

  const [items, total] = await Promise.all([
    prisma.bossPendingSettlementOrder.findMany({
      where,
      orderBy: { orderCreateTime: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: {
        shopKey: true,
        packageId: true,
        orderCreateTime: true,
        orderStatus: true,
        expectedSettleTime: true,
        orderFinishTime: true,
        sellerIncomeCent: true,
        platformCommissionCent: true,
        settleStatus: true,
      },
    }),
    prisma.bossPendingSettlementOrder.count({ where }),
  ])

  const shopNames = Object.fromEntries(BOSS_DASHBOARD_SHOPS.map((s) => [s.shopKey, s.shopName]))

  return {
    items: items.map((row) => ({
      shopKey: row.shopKey,
      shopName: shopNames[row.shopKey as BossDashboardShopKey] ?? row.shopKey,
      packageId: row.packageId,
      orderCreateTime: row.orderCreateTime?.toISOString() ?? null,
      orderStatus: row.orderStatus,
      expectedSettleAmountCent: row.sellerIncomeCent,
      expectedSettleTime: row.expectedSettleTime?.toISOString() ?? null,
      actualSettleTime: row.orderFinishTime?.toISOString() ?? null,
      platformCommissionCent: row.platformCommissionCent,
      settleStatus: row.settleStatus,
    })),
    total,
    page: params.page,
    pageSize: params.pageSize,
  }
}

export function verifyMonthlyTrendTotals(
  points: Array<{
    month: string
    amountCent: number
    shiyuju: number
    hetianyayu: number
    xiangyu: number
    xyxiangyu: number
  }>,
): boolean {
  for (const p of points) {
    const sum = p.shiyuju + p.hetianyayu + p.xiangyu + p.xyxiangyu
    if (sum !== p.amountCent) return false
  }
  return true
}
