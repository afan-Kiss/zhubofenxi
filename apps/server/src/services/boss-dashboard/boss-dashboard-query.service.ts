import { BOSS_DASHBOARD_SHOPS, type BossDashboardShopKey } from '../../config/boss-dashboard.constants'
import { getGoodReviewShopName } from '../../config/good-review-shops.constants'
import { prisma } from '../../lib/prisma'
import { centToYuan } from '../../utils/money'
import {
  aggregateMonthlyStatementIncome,
  buildRecentMonthKeys,
} from './boss-dashboard-flow.service'
import { loadBossScoreTrendSeries } from './boss-dashboard-score.service'
import { buildBossShopAdvice } from './boss-dashboard-advice.service'
import { listActiveAnnouncements, countUnreadAnnouncements } from './boss-dashboard-announcement.service'
import {
  buildRecentBillMonthKeys,
  loadBillReconciliationStatus,
  loadCurrentMonthBillView,
  loadMonthlySettlementTrend,
  loadPendingSettlementView,
  loadYesterdaySettlementView,
  rankBossShops,
  verifyMonthlyTrendTotals,
} from './boss-dashboard-bill-query.service'

function latestFundByShop() {
  return Promise.all(
    BOSS_DASHBOARD_SHOPS.map(async (shop) => {
      const row = await prisma.bossFundSnapshot.findFirst({
        where: { shopKey: shop.shopKey },
        orderBy: { createdAt: 'desc' },
      })
      return { shop, row }
    }),
  )
}

function latestScoreByShop() {
  return Promise.all(
    BOSS_DASHBOARD_SHOPS.map(async (shop) => {
      const row = await prisma.bossShopScoreSnapshot.findFirst({
        where: { shopKey: shop.shopKey },
        orderBy: { scoreDate: 'desc' },
      })
      const prev = row
        ? await prisma.bossShopScoreSnapshot.findFirst({
            where: { shopKey: shop.shopKey, scoreDate: { lt: row.scoreDate } },
            orderBy: { scoreDate: 'desc' },
          })
        : null
      return { shop, row, prev }
    }),
  )
}

function serializeFund(row: Awaited<ReturnType<typeof latestFundByShop>>[number]['row']) {
  if (!row) return null
  return {
    shopKey: row.shopKey,
    liveAccountId: row.liveAccountId,
    availableAmountCent: row.availableAmountCent,
    withdrawingAmountCent: row.withdrawingAmountCent,
    withdrawnAmountCent: row.withdrawnAmountCent,
    balanceAmountCent: row.balanceAmountCent,
    frozenAmountCent: row.frozenAmountCent,
    afterSaleFrozenAmountCent: row.afterSaleFrozenAmountCent,
    depositBalanceCent: row.depositBalanceCent,
    depositRequiredCent: row.depositRequiredCent,
    depositStandardCent: row.depositStandardCent,
    baseDueDepositCent: row.baseDueDepositCent,
    riskDepositCent: row.riskDepositCent,
    debtAmountCent: row.debtAmountCent,
    todayIncomeCent: row.todayIncomeCent,
    yesterdayIncomeCent: row.yesterdayIncomeCent,
    canWithdraw: row.canWithdraw,
    cannotWithdrawReason: row.cannotWithdrawReason,
    leftWithdrawTimesToday: row.leftWithdrawTimesToday,
    totalWithdrawTimesToday: row.totalWithdrawTimesToday,
    statementPeriodDays: row.statementPeriodDays,
    lastSyncedAt: row.fetchedAt?.toISOString() ?? null,
    isStale: row.isStale,
    syncStatus: row.syncStatus,
    syncError: row.syncError,
  }
}

function serializeScore(
  row: Awaited<ReturnType<typeof latestScoreByShop>>[number]['row'],
  prev: Awaited<ReturnType<typeof latestScoreByShop>>[number]['prev'],
) {
  if (!row) return null
  const delta = (key: 'qualityScore' | 'logisticsScore' | 'serviceScore') => {
    const cur = row[key]
    const old = prev?.[key]
    if (cur == null || old == null) return null
    return Math.round((cur - old) * 100) / 100
  }
  return {
    shopKey: row.shopKey,
    scoreDate: row.scoreDate,
    qualityScore: row.qualityScore,
    logisticsScore: row.logisticsScore,
    serviceScore: row.serviceScore,
    officialOverallScore: row.officialOverallScore,
    qualityDelta: delta('qualityScore'),
    logisticsDelta: delta('logisticsScore'),
    serviceDelta: delta('serviceScore'),
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
    scoreLabel: row.officialOverallScore != null ? '平台体验分' : '平台分项体验分',
  }
}

function sumNullable(values: Array<number | null | undefined>): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0)
}

export async function buildBossDashboardPayload(userId?: string) {
  const monthKeys = buildRecentMonthKeys()
  const settlementMonthKeys = buildRecentBillMonthKeys()
  const [funds, scores] = await Promise.all([latestFundByShop(), latestScoreByShop()])

  const shopsRaw = await Promise.all(
    BOSS_DASHBOARD_SHOPS.map(async (shop, index) => {
      const fund = funds[index]?.row ?? null
      const scorePack = scores[index]
      const monthlyIncome = await aggregateMonthlyStatementIncome(shop.shopKey, monthKeys)
      const monthlySettlementTrend = await loadMonthlySettlementTrend(shop.shopKey, settlementMonthKeys)
      const scoreTrend = await loadBossScoreTrendSeries(shop)
      const pendingSettlement = await loadPendingSettlementView(shop.shopKey)
      const currentMonthBill = await loadCurrentMonthBillView(shop.shopKey)
      const yesterdaySettlement = await loadYesterdaySettlementView(shop.shopKey)
      const billReconciliationStatus = await loadBillReconciliationStatus(shop.shopKey)
      return {
        shopKey: shop.shopKey,
        shopName: shop.shopName,
        fund: serializeFund(fund),
        score: serializeScore(scorePack?.row ?? null, scorePack?.prev ?? null),
        monthlyIncome,
        monthlySettlementTrend,
        pendingSettlement,
        currentMonthBill,
        yesterdaySettlement,
        billReconciliationStatus,
        scoreTrend,
        advice: buildBossShopAdvice({
          fund,
          score: scorePack?.row ?? null,
          previousScore: scorePack?.prev ?? null,
        }),
      }
    }),
  )

  const rankedShops = rankBossShops(shopsRaw)

  const combinedMonthlyIncome = monthKeys.map((month) => ({
    month,
    amountCent: rankedShops.reduce(
      (acc, s) => acc + (s.monthlyIncome.find((m) => m.month === month)?.amountCent ?? 0),
      0,
    ),
    shiyuju: rankedShops.find((s) => s.shopKey === 'shiyuju')?.monthlyIncome.find((m) => m.month === month)?.amountCent ?? 0,
    hetianyayu: rankedShops.find((s) => s.shopKey === 'hetianyayu')?.monthlyIncome.find((m) => m.month === month)?.amountCent ?? 0,
    xiangyu: rankedShops.find((s) => s.shopKey === 'xiangyu')?.monthlyIncome.find((m) => m.month === month)?.amountCent ?? 0,
    xyxiangyu: rankedShops.find((s) => s.shopKey === 'xyxiangyu')?.monthlyIncome.find((m) => m.month === month)?.amountCent ?? 0,
  }))

  const combinedMonthlySettlement = settlementMonthKeys.map((month) => {
    const shiyuju = rankedShops.find((s) => s.shopKey === 'shiyuju')?.monthlySettlementTrend.find((m) => m.month === month)?.amountCent ?? null
    const hetianyayu = rankedShops.find((s) => s.shopKey === 'hetianyayu')?.monthlySettlementTrend.find((m) => m.month === month)?.amountCent ?? null
    const xiangyu = rankedShops.find((s) => s.shopKey === 'xiangyu')?.monthlySettlementTrend.find((m) => m.month === month)?.amountCent ?? null
    const xyxiangyu = rankedShops.find((s) => s.shopKey === 'xyxiangyu')?.monthlySettlementTrend.find((m) => m.month === month)?.amountCent ?? null
    const parts = [shiyuju, hetianyayu, xiangyu, xyxiangyu]
    const hasAny = parts.some((p) => p != null)
    const amountCent = hasAny ? sumNullable(parts) : null
    return {
      month,
      amountCent,
      shiyuju,
      hetianyayu,
      xiangyu,
      xyxiangyu,
    }
  })

  if (!verifyMonthlyTrendTotals(
    combinedMonthlyIncome.map((p) => ({
      month: p.month,
      amountCent: p.amountCent,
      shiyuju: p.shiyuju,
      hetianyayu: p.hetianyayu,
      xiangyu: p.xiangyu,
      xyxiangyu: p.xyxiangyu,
    })),
  )) {
    throw new Error('到账趋势四店合计校验失败')
  }

  const settlementForVerify = combinedMonthlySettlement
    .filter((p) => p.amountCent != null)
    .map((p) => ({
      month: p.month,
      amountCent: p.amountCent!,
      shiyuju: p.shiyuju ?? 0,
      hetianyayu: p.hetianyayu ?? 0,
      xiangyu: p.xiangyu ?? 0,
      xyxiangyu: p.xyxiangyu ?? 0,
    }))
  if (settlementForVerify.length > 0 && !verifyMonthlyTrendTotals(settlementForVerify)) {
    throw new Error('结算净额趋势四店合计校验失败')
  }

  const announcements = await listActiveAnnouncements(userId)
  const unreadCount = userId ? await countUnreadAnnouncements(userId) : announcements.filter((a) => !a.isRead).length

  const latestSync = await prisma.bossSyncRunLog.findFirst({ orderBy: { startedAt: 'desc' } })

  const pendingSettlementAmountCent = sumNullable(rankedShops.map((s) => s.pendingSettlement.amountCent))
  const pendingSettlementOrderCount = sumNullable(rankedShops.map((s) => s.pendingSettlement.orderCount))
  const currentMonthSettlementNetCent = sumNullable(rankedShops.map((s) => s.currentMonthBill.settlementNetCent))
  const currentMonthCommissionCent = sumNullable(rankedShops.map((s) => s.currentMonthBill.commissionCent))
  const yesterdayIncomeCent = sumNullable(rankedShops.map((s) => s.fund?.yesterdayIncomeCent))
  const yesterdaySettlementNetCent = sumNullable(
    rankedShops.map((s) => s.yesterdaySettlement.settlementNetCent),
  )

  return {
    generatedAt: new Date().toISOString(),
    dataNotes: [
      '可提现：平台当前可提现余额',
      '待结算：平台预计待结算订单金额，可能因退款、取消或延迟结算变化',
      '实际到账：真正进入店铺余额的结算入账',
      '昨日入账：平台资金账户「昨日入账」字段合计',
      '昨日结算净额：昨日日账单 totalChangeAmount 合计',
      '结算净额：结算账单周期净变动',
      '累计已提现：只统计提现成功',
      '平台佣金：账单参考值，不会再次从结算净额重复扣除',
    ],
    totals: {
      availableAmountCent: sumNullable(rankedShops.map((s) => s.fund?.availableAmountCent)),
      withdrawingAmountCent: sumNullable(rankedShops.map((s) => s.fund?.withdrawingAmountCent)),
      withdrawnAmountCent: sumNullable(rankedShops.map((s) => s.fund?.withdrawnAmountCent)),
      afterSaleFrozenAmountCent: sumNullable(rankedShops.map((s) => s.fund?.afterSaleFrozenAmountCent)),
      todayIncomeCent: sumNullable(rankedShops.map((s) => s.fund?.todayIncomeCent)),
      yesterdayIncomeCent,
      yesterdaySettlementNetCent,
      pendingSettlementAmountCent,
      pendingSettlementOrderCount,
      currentMonthSettlementNetCent,
      currentMonthCommissionCent,
      billReconciliationWarningShopCount: rankedShops.filter(
        (s) => s.billReconciliationStatus === 'reconciliation_warning',
      ).length,
      scoreDownShopCount: rankedShops.filter((s) =>
        [s.score?.qualityDelta, s.score?.logisticsDelta, s.score?.serviceDelta].some(
          (d) => d != null && d < 0,
        ),
      ).length,
      cannotWithdrawShopCount: rankedShops.filter((s) => s.fund?.canWithdraw === false).length,
    },
    combinedMonthlyIncome,
    combinedMonthlySettlement,
    shops: rankedShops,
    announcements,
    unreadAnnouncementCount: unreadCount,
    lastBossSyncAt: latestSync?.finishedAt?.toISOString() ?? latestSync?.startedAt.toISOString() ?? null,
    lastBossSyncStatus: latestSync?.status ?? null,
    displayAmountsYuan: false,
    centToYuanSample: centToYuan(100),
  }
}

export async function buildBossShopPayload(shopKey: BossDashboardShopKey, userId?: string) {
  const payload = await buildBossDashboardPayload(userId)
  const shop = payload.shops.find((s) => s.shopKey === shopKey)
  if (!shop) throw new Error(`未知店铺：${shopKey}`)
  return {
    ...shop,
    shopName: getGoodReviewShopName(shopKey),
  }
}
