import { prisma } from '../../lib/prisma'
import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'
import {
  fetchBossAggregateAccountAudited,
  fetchBossAfterSaleFrozenAudited,
  fetchBossCanWithdrawAudited,
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

function mergeErrors(parts: Array<string | null | undefined>): string | null {
  const msgs = parts.filter((p): p is string => Boolean(p?.trim()))
  return msgs.length ? msgs.join('；') : null
}

function flowSyncFailed(syncError: string | null | undefined): boolean {
  return Boolean(syncError?.includes('流水同步失败'))
}

export async function syncBossFundForShop(shop: GoodReviewShopDefinition): Promise<{
  success: boolean
  partial?: boolean
  snapshotWritten?: boolean
  error?: string
}> {
  const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
  if (!account?.id) return { success: false, error: '未配置官方账号' }

  const previous = await prisma.bossFundSnapshot.findFirst({
    where: { shopKey: shop.shopKey },
    orderBy: { updatedAt: 'desc' },
  })

  const [aggregateRes, afterSaleRes, canWithdrawRes] = await Promise.all([
    fetchBossAggregateAccountAudited(shop),
    fetchBossAfterSaleFrozenAudited(shop),
    fetchBossCanWithdrawAudited(shop),
  ])

  const aggregateOk = aggregateRes.ok && aggregateRes.data != null
  const afterSaleOk = afterSaleRes.ok && afterSaleRes.data != null
  const canWithdrawOk = canWithdrawRes.ok && canWithdrawRes.data != null

  if (!aggregateOk && !previous) {
    const message = mergeErrors([
      aggregateRes.errorMessage,
      afterSaleRes.errorMessage,
      canWithdrawRes.errorMessage,
    ])
    logWarn('老板同步', `${shop.shopName} 资金主接口失败：${message ?? '未知'}`)
    return { success: false, error: message ?? '资金主接口失败' }
  }

  let aggregate = previous
    ? {
        availableAmountCent: previous.availableAmountCent,
        withdrawingAmountCent: previous.withdrawingAmountCent,
        balanceAmountCent: previous.balanceAmountCent,
        frozenAmountCent: previous.frozenAmountCent,
        yesterdayIncomeCent: previous.yesterdayIncomeCent,
        debtAmountCent: previous.debtAmountCent,
        depositBalanceCent: previous.depositBalanceCent,
        depositRequiredCent: previous.depositRequiredCent,
        depositStandardCent: previous.depositStandardCent,
        baseDueDepositCent: previous.baseDueDepositCent,
        riskDepositCent: previous.riskDepositCent,
        canWithdraw: previous.canWithdraw,
        leftWithdrawTimesToday: previous.leftWithdrawTimesToday,
        totalWithdrawTimesToday: previous.totalWithdrawTimesToday,
        statementPeriodDays: previous.statementPeriodDays,
      }
    : parseBossAggregateAccount({})

  if (aggregateOk) {
    aggregate = parseBossAggregateAccount(aggregateRes.data)
  }

  const afterSaleFrozen = afterSaleOk
    ? parseBossAfterSaleFrozen(afterSaleRes.data)
    : (previous?.afterSaleFrozenAmountCent ?? null)

  const canWithdraw = canWithdrawOk
    ? parseBossCanWithdraw(canWithdrawRes.data)
    : {
        canWithdraw: previous?.canWithdraw ?? null,
        cannotWithdrawReason: previous?.cannotWithdrawReason ?? null,
      }

  const partial = !aggregateOk || !afterSaleOk || !canWithdrawOk
  let flowOk = true
  let flowError: string | null = null

  try {
    await syncBossAccountFlowsForShop({
      shop,
      liveAccountId: account.id,
      firstSync: false,
    })
  } catch (err) {
    flowOk = false
    flowError = err instanceof Error ? err.message : String(err)
    logWarn('老板同步', `${shop.shopName} 流水同步失败：${flowError}`)
  }

  const syncErrors = mergeErrors([
    !aggregateOk ? aggregateRes.errorMessage ?? '账户汇总失败' : null,
    !afterSaleOk ? afterSaleRes.errorMessage ?? '售后冻结失败' : null,
    !canWithdrawOk ? canWithdrawRes.errorMessage ?? '可提现查询失败' : null,
    !flowOk ? `流水同步失败：${flowError ?? '未知'}` : null,
  ])

  const withdrawnAmountCent = flowOk ? await computeWithdrawnAmountCent(shop.shopKey) : null
  const todayIncomeCent = flowOk ? await computeTodayIncomeCent(shop.shopKey) : null

  const syncStatus = partial || !flowOk ? 'partial_success' : 'success'
  const isStale = partial || !flowOk

  await prisma.bossFundSnapshot.create({
    data: {
      shopKey: shop.shopKey,
      liveAccountId: account.id,
      availableAmountCent: aggregate.availableAmountCent ?? previous?.availableAmountCent ?? null,
      withdrawingAmountCent: aggregate.withdrawingAmountCent ?? previous?.withdrawingAmountCent ?? null,
      withdrawnAmountCent,
      balanceAmountCent: aggregate.balanceAmountCent ?? previous?.balanceAmountCent ?? null,
      frozenAmountCent: aggregate.frozenAmountCent ?? previous?.frozenAmountCent ?? null,
      afterSaleFrozenAmountCent: afterSaleFrozen,
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
      syncStatus,
      syncError: syncErrors,
      isStale,
      fetchedAt: aggregateOk ? new Date() : (previous?.fetchedAt ?? new Date()),
    },
  })

  logInfo(
    '老板同步',
    `${shop.shopName} 资金快照已更新（${syncStatus}${syncErrors ? `：${syncErrors}` : ''}）`,
  )
  return {
    success: aggregateOk,
    partial,
    snapshotWritten: true,
    error: syncErrors ?? undefined,
  }
}
