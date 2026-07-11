import { prisma } from '../../lib/prisma'
import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'
import {
  fetchBossAggregateAccount,
  fetchBossAfterSaleFrozen,
  fetchBossCanWithdraw,
} from './boss-dashboard-api.service'
import {
  parseBossAfterSaleFrozen,
  parseBossAggregateAccount,
  parseBossCanWithdraw,
} from './boss-dashboard-normalize.service'
import {
  computeTodayIncomeCent,
  computeWithdrawnAmountCent,
  syncBossAccountFlowsForShop,
} from './boss-dashboard-flow.service'
import { logInfo, logWarn } from '../../utils/server-log'

export async function syncBossFundForShop(shop: GoodReviewShopDefinition): Promise<{
  success: boolean
  error?: string
}> {
  const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
  if (!account?.id) return { success: false, error: '未配置官方账号' }

  const previous = await prisma.bossFundSnapshot.findFirst({
    where: { shopKey: shop.shopKey },
    orderBy: { updatedAt: 'desc' },
  })

  try {
    const [aggregateRaw, afterSaleRaw, canWithdrawRaw] = await Promise.all([
      fetchBossAggregateAccount(shop),
      fetchBossAfterSaleFrozen(shop),
      fetchBossCanWithdraw(shop),
    ])
    const aggregate = parseBossAggregateAccount(aggregateRaw)
    const afterSaleFrozen = parseBossAfterSaleFrozen(afterSaleRaw)
    const canWithdraw = parseBossCanWithdraw(canWithdrawRaw)

    await syncBossAccountFlowsForShop({
      shop,
      liveAccountId: account.id,
      firstSync: false,
    })

    const withdrawnAmountCent = await computeWithdrawnAmountCent(shop.shopKey)
    const todayIncomeCent = await computeTodayIncomeCent(shop.shopKey)

    await prisma.bossFundSnapshot.create({
      data: {
        shopKey: shop.shopKey,
        liveAccountId: account.id,
        availableAmountCent: aggregate.availableAmountCent ?? previous?.availableAmountCent ?? null,
        withdrawingAmountCent: aggregate.withdrawingAmountCent ?? previous?.withdrawingAmountCent ?? null,
        withdrawnAmountCent,
        balanceAmountCent: aggregate.balanceAmountCent ?? previous?.balanceAmountCent ?? null,
        frozenAmountCent: aggregate.frozenAmountCent ?? previous?.frozenAmountCent ?? null,
        afterSaleFrozenAmountCent: afterSaleFrozen ?? previous?.afterSaleFrozenAmountCent ?? null,
        depositBalanceCent: aggregate.depositBalanceCent ?? previous?.depositBalanceCent ?? null,
        depositRequiredCent: aggregate.depositRequiredCent ?? previous?.depositRequiredCent ?? null,
        depositStandardCent: aggregate.depositStandardCent ?? previous?.depositStandardCent ?? null,
        baseDueDepositCent: aggregate.baseDueDepositCent ?? previous?.baseDueDepositCent ?? null,
        riskDepositCent: aggregate.riskDepositCent ?? previous?.riskDepositCent ?? null,
        debtAmountCent: aggregate.debtAmountCent ?? previous?.debtAmountCent ?? null,
        todayIncomeCent,
        yesterdayIncomeCent: aggregate.yesterdayIncomeCent ?? previous?.yesterdayIncomeCent ?? null,
        canWithdraw: canWithdraw.canWithdraw ?? aggregate.canWithdraw ?? previous?.canWithdraw ?? null,
        cannotWithdrawReason:
          canWithdraw.cannotWithdrawReason ?? previous?.cannotWithdrawReason ?? null,
        leftWithdrawTimesToday:
          aggregate.leftWithdrawTimesToday ?? previous?.leftWithdrawTimesToday ?? null,
        totalWithdrawTimesToday:
          aggregate.totalWithdrawTimesToday ?? previous?.totalWithdrawTimesToday ?? null,
        statementPeriodDays: aggregate.statementPeriodDays ?? previous?.statementPeriodDays ?? null,
        syncStatus: 'success',
        syncError: null,
        isStale: false,
        fetchedAt: new Date(),
      },
    })

    logInfo('老板同步', `${shop.shopName} 资金快照已更新`)
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logWarn('老板同步', `${shop.shopName} 资金同步失败：${message}`)
    if (previous) {
      await prisma.bossFundSnapshot.create({
        data: {
          shopKey: shop.shopKey,
          liveAccountId: previous.liveAccountId,
          availableAmountCent: previous.availableAmountCent,
          withdrawingAmountCent: previous.withdrawingAmountCent,
          withdrawnAmountCent: previous.withdrawnAmountCent,
          balanceAmountCent: previous.balanceAmountCent,
          frozenAmountCent: previous.frozenAmountCent,
          afterSaleFrozenAmountCent: previous.afterSaleFrozenAmountCent,
          depositBalanceCent: previous.depositBalanceCent,
          depositRequiredCent: previous.depositRequiredCent,
          depositStandardCent: previous.depositStandardCent,
          baseDueDepositCent: previous.baseDueDepositCent,
          riskDepositCent: previous.riskDepositCent,
          debtAmountCent: previous.debtAmountCent,
          todayIncomeCent: previous.todayIncomeCent,
          yesterdayIncomeCent: previous.yesterdayIncomeCent,
          canWithdraw: previous.canWithdraw,
          cannotWithdrawReason: previous.cannotWithdrawReason,
          leftWithdrawTimesToday: previous.leftWithdrawTimesToday,
          totalWithdrawTimesToday: previous.totalWithdrawTimesToday,
          statementPeriodDays: previous.statementPeriodDays,
          syncStatus: 'failed',
          syncError: message,
          isStale: true,
          fetchedAt: previous.fetchedAt,
        },
      })
    }
    return { success: false, error: message }
  }
}
