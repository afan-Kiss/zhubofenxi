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

export async function buildBossDashboardPayload(userId?: string) {
  const monthKeys = buildRecentMonthKeys()
  const [funds, scores] = await Promise.all([latestFundByShop(), latestScoreByShop()])

  const shops = await Promise.all(
    BOSS_DASHBOARD_SHOPS.map(async (shop, index) => {
      const fund = funds[index]?.row ?? null
      const scorePack = scores[index]
      const monthlyIncome = await aggregateMonthlyStatementIncome(shop.shopKey, monthKeys)
      const scoreTrend = await loadBossScoreTrendSeries(shop)
      return {
        shopKey: shop.shopKey,
        shopName: shop.shopName,
        fund: serializeFund(fund),
        score: serializeScore(scorePack?.row ?? null, scorePack?.prev ?? null),
        monthlyIncome,
        scoreTrend,
        advice: buildBossShopAdvice({
          fund,
          score: scorePack?.row ?? null,
          previousScore: scorePack?.prev ?? null,
        }),
      }
    }),
  )

  const sum = (pick: (f: NonNullable<typeof funds[0]['row']>) => number | null | undefined) =>
    funds.reduce((acc, f) => acc + (f.row ? pick(f.row) ?? 0 : 0), 0)

  const combinedMonthly = monthKeys.map((month) => ({
    month,
    amountCent: shops.reduce(
      (acc, s) => acc + (s.monthlyIncome.find((m) => m.month === month)?.amountCent ?? 0),
      0,
    ),
    shiyuju: shops.find((s) => s.shopKey === 'shiyuju')?.monthlyIncome.find((m) => m.month === month)?.amountCent ?? 0,
    hetianyayu: shops.find((s) => s.shopKey === 'hetianyayu')?.monthlyIncome.find((m) => m.month === month)?.amountCent ?? 0,
    xiangyu: shops.find((s) => s.shopKey === 'xiangyu')?.monthlyIncome.find((m) => m.month === month)?.amountCent ?? 0,
    xyxiangyu: shops.find((s) => s.shopKey === 'xyxiangyu')?.monthlyIncome.find((m) => m.month === month)?.amountCent ?? 0,
  }))

  const announcements = await listActiveAnnouncements(userId)
  const unreadCount = userId ? await countUnreadAnnouncements(userId) : announcements.filter((a) => !a.isRead).length

  const latestSync = await prisma.bossSyncRunLog.findFirst({ orderBy: { startedAt: 'desc' } })

  return {
    generatedAt: new Date().toISOString(),
    dataNotes: [
      '可提现金额以平台资金接口当前值为准',
      '累计已提现只统计提现成功流水（PAY_SUCCESS）',
      '每月到账只统计结算入账且收入大于0的流水',
      '店铺分只展示平台真实分项，不自行平均综合分',
    ],
    totals: {
      availableAmountCent: sum((f) => f.availableAmountCent),
      withdrawingAmountCent: sum((f) => f.withdrawingAmountCent),
      withdrawnAmountCent: sum((f) => f.withdrawnAmountCent),
      afterSaleFrozenAmountCent: sum((f) => f.afterSaleFrozenAmountCent),
      todayIncomeCent: sum((f) => f.todayIncomeCent),
      scoreDownShopCount: shops.filter((s) =>
        [s.score?.qualityDelta, s.score?.logisticsDelta, s.score?.serviceDelta].some(
          (d) => d != null && d < 0,
        ),
      ).length,
      cannotWithdrawShopCount: shops.filter((s) => s.fund?.canWithdraw === false).length,
    },
    combinedMonthlyIncome: combinedMonthly,
    shops,
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
