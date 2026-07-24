import {
  BOSS_DASHBOARD_SHOP_KEYS,
  BOSS_DASHBOARD_SHOPS,
  type BossDashboardShopKey,
} from '../../config/boss-dashboard.constants'
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
import { sumWithCoverage, type CoverageSumResult } from './boss-dashboard-coverage.util'

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

function flowSyncFailed(syncError: string | null | undefined): boolean {
  return Boolean(syncError?.includes('流水同步失败'))
}

function serializeFund(row: Awaited<ReturnType<typeof latestFundByShop>>[number]['row']) {
  if (!row) return null
  const flowDerivedStale = flowSyncFailed(row.syncError)
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
    todayIncomeCentStale: flowDerivedStale,
    withdrawnAmountCentStale: flowDerivedStale,
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

function shopMonthAmountCent(
  shops: Array<{ shopKey: string; monthlyIncome: Array<{ month: string; amountCent: number | null }> }>,
  shopKey: BossDashboardShopKey,
  month: string,
): number | null {
  const shop = shops.find((s) => s.shopKey === shopKey)
  if (!shop) return null
  return shop.monthlyIncome.find((m) => m.month === month)?.amountCent ?? null
}

function shopMonthSettlementCent(
  shops: Array<{
    shopKey: string
    monthlySettlementTrend: Array<{ month: string; amountCent: number | null }>
  }>,
  shopKey: BossDashboardShopKey,
  month: string,
): number | null {
  const shop = shops.find((s) => s.shopKey === shopKey)
  if (!shop) return null
  return shop.monthlySettlementTrend.find((m) => m.month === month)?.amountCent ?? null
}

function coverageFromShops<T extends { shopKey: string }>(
  shops: T[],
  pick: (shop: T) => number | null | undefined,
  stale?: (shop: T) => boolean | undefined,
): CoverageSumResult {
  return sumWithCoverage(
    shops.map((shop) => ({
      shopKey: shop.shopKey,
      valueCent: pick(shop),
      stale: stale?.(shop),
    })),
    BOSS_DASHBOARD_SHOP_KEYS,
  )
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

  const combinedMonthlyIncome = monthKeys.map((month) => {
    const shiyuju = shopMonthAmountCent(rankedShops, 'shiyuju', month)
    const hetianyayu = shopMonthAmountCent(rankedShops, 'hetianyayu', month)
    const xiangyu = shopMonthAmountCent(rankedShops, 'xiangyu', month)
    const xyxiangyu = shopMonthAmountCent(rankedShops, 'xyxiangyu', month)
    const amountCent = sumWithCoverage(
      [
        { shopKey: 'shiyuju', valueCent: shiyuju },
        { shopKey: 'hetianyayu', valueCent: hetianyayu },
        { shopKey: 'xiangyu', valueCent: xiangyu },
        { shopKey: 'xyxiangyu', valueCent: xyxiangyu },
      ],
      BOSS_DASHBOARD_SHOP_KEYS,
    ).valueCent
    return { month, amountCent, shiyuju, hetianyayu, xiangyu, xyxiangyu }
  })

  const combinedMonthlySettlement = settlementMonthKeys.map((month) => {
    const shiyuju = shopMonthSettlementCent(rankedShops, 'shiyuju', month)
    const hetianyayu = shopMonthSettlementCent(rankedShops, 'hetianyayu', month)
    const xiangyu = shopMonthSettlementCent(rankedShops, 'xiangyu', month)
    const xyxiangyu = shopMonthSettlementCent(rankedShops, 'xyxiangyu', month)
    const amountCent = sumWithCoverage(
      [
        { shopKey: 'shiyuju', valueCent: shiyuju },
        { shopKey: 'hetianyayu', valueCent: hetianyayu },
        { shopKey: 'xiangyu', valueCent: xiangyu },
        { shopKey: 'xyxiangyu', valueCent: xyxiangyu },
      ],
      BOSS_DASHBOARD_SHOP_KEYS,
    ).valueCent
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
    combinedMonthlyIncome
      .filter((p) => p.amountCent != null)
      .map((p) => ({
        month: p.month,
        amountCent: p.amountCent!,
        shiyuju: p.shiyuju ?? 0,
        hetianyayu: p.hetianyayu ?? 0,
        xiangyu: p.xiangyu ?? 0,
        xyxiangyu: p.xyxiangyu ?? 0,
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

  const availableAmountCoverage = coverageFromShops(
    rankedShops,
    (s) => s.fund?.availableAmountCent,
    (s) => s.fund?.isStale,
  )
  const withdrawingAmountCoverage = coverageFromShops(
    rankedShops,
    (s) => s.fund?.withdrawingAmountCent,
    (s) => s.fund?.isStale,
  )
  const withdrawnAmountCoverage = coverageFromShops(
    rankedShops,
    (s) => s.fund?.withdrawnAmountCent,
    (s) => s.fund?.withdrawnAmountCentStale ?? s.fund?.isStale,
  )
  const afterSaleFrozenAmountCoverage = coverageFromShops(
    rankedShops,
    (s) => s.fund?.afterSaleFrozenAmountCent,
    (s) => s.fund?.isStale,
  )
  const todayIncomeCoverage = coverageFromShops(
    rankedShops,
    (s) => s.fund?.todayIncomeCent,
    (s) => s.fund?.todayIncomeCentStale ?? s.fund?.isStale,
  )
  const yesterdayIncomeCoverage = coverageFromShops(
    rankedShops,
    (s) => s.fund?.yesterdayIncomeCent,
    (s) => s.fund?.isStale,
  )
  const yesterdaySettlementNetCoverage = coverageFromShops(rankedShops, (s) => s.yesterdaySettlement.settlementNetCent)
  const pendingSettlementAmountCoverage = coverageFromShops(rankedShops, (s) => s.pendingSettlement.amountCent)
  const pendingSettlementOrderCountCoverage = coverageFromShops(rankedShops, (s) => s.pendingSettlement.orderCount)
  const currentMonthSettlementNetCoverage = coverageFromShops(rankedShops, (s) => s.currentMonthBill.settlementNetCent)
  const currentMonthCommissionCoverage = coverageFromShops(rankedShops, (s) => s.currentMonthBill.commissionCent)

  const perShopDataThroughDates = rankedShops.map((s) => ({
    shopKey: s.shopKey,
    shopName: s.shopName,
    dataThroughDate: s.currentMonthBill.dataThroughDate,
  }))
  const nonNullThroughDates = perShopDataThroughDates
    .map((s) => s.dataThroughDate)
    .filter((d): d is string => d != null)
  const commonDataThroughDate =
    nonNullThroughDates.length > 0 ? [...nonNullThroughDates].sort()[0]! : null
  const maxDataThroughDate =
    nonNullThroughDates.length > 0 ? [...nonNullThroughDates].sort().reverse()[0]! : null
  const laggingShops =
    maxDataThroughDate != null
      ? perShopDataThroughDates.filter(
          (s) => s.dataThroughDate == null || s.dataThroughDate < maxDataThroughDate,
        )
      : perShopDataThroughDates.filter((s) => s.dataThroughDate == null)

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
      availableAmountCent: availableAmountCoverage.valueCent,
      withdrawingAmountCent: withdrawingAmountCoverage.valueCent,
      withdrawnAmountCent: withdrawnAmountCoverage.valueCent,
      afterSaleFrozenAmountCent: afterSaleFrozenAmountCoverage.valueCent,
      todayIncomeCent: todayIncomeCoverage.valueCent,
      yesterdayIncomeCent: yesterdayIncomeCoverage.valueCent,
      yesterdaySettlementNetCent: yesterdaySettlementNetCoverage.valueCent,
      pendingSettlementAmountCent: pendingSettlementAmountCoverage.valueCent,
      pendingSettlementOrderCount: pendingSettlementOrderCountCoverage.valueCent,
      currentMonthSettlementNetCent: currentMonthSettlementNetCoverage.valueCent,
      currentMonthCommissionCent: currentMonthCommissionCoverage.valueCent,
      coverage: {
        availableAmountCent: availableAmountCoverage,
        withdrawingAmountCent: withdrawingAmountCoverage,
        withdrawnAmountCent: withdrawnAmountCoverage,
        afterSaleFrozenAmountCent: afterSaleFrozenAmountCoverage,
        todayIncomeCent: todayIncomeCoverage,
        yesterdayIncomeCent: yesterdayIncomeCoverage,
        yesterdaySettlementNetCent: yesterdaySettlementNetCoverage,
        pendingSettlementAmountCent: pendingSettlementAmountCoverage,
        pendingSettlementOrderCount: pendingSettlementOrderCountCoverage,
        currentMonthSettlementNetCent: currentMonthSettlementNetCoverage,
        currentMonthCommissionCent: currentMonthCommissionCoverage,
      },
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
    commonDataThroughDate,
    maxDataThroughDate,
    perShopDataThroughDates,
    laggingShops,
    shops: rankedShops,
    announcements,
    unreadAnnouncementCount: unreadCount,
    lastBossSyncAt: latestSync?.finishedAt?.toISOString() ?? latestSync?.startedAt.toISOString() ?? null,
    lastBossSyncStatus: latestSync?.status ?? null,
    lastAttemptAt: latestSync?.startedAt.toISOString() ?? null,
    lastAttemptStatus: latestSync?.status ?? null,
    lastSuccessfulRunAt:
      (
        await prisma.bossSyncRunLog.findFirst({
          where: { status: 'success' },
          orderBy: { finishedAt: 'desc' },
        })
      )?.finishedAt?.toISOString() ?? null,
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
