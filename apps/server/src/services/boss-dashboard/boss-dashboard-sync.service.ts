import { BOSS_DASHBOARD_SHOPS } from '../../config/boss-dashboard.constants'
import { prisma } from '../../lib/prisma'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'
import { syncBossBillForShop } from './boss-dashboard-bill.service'
import { syncBossFundForShop } from './boss-dashboard-fund.service'
import { syncBossShopScoreForShop } from './boss-dashboard-score.service'
import { logInfo, logWarn } from '../../utils/server-log'
import { summarizeBossRun, type ShopSyncResult } from './boss-dashboard-sync-status.util'

let bossSyncRunning: Promise<void> | null = null

type ShopSyncResultLocal = ShopSyncResult

export async function runBossDashboardSync(trigger: string): Promise<void> {
  if (bossSyncRunning) {
    await bossSyncRunning
    return
  }
  bossSyncRunning = (async () => {
    const startedAt = new Date()
    const run = await prisma.bossSyncRunLog.create({
      data: { trigger, status: 'running' },
    })
    const shopResults: ShopSyncResultLocal[] = []
    try {
      for (const shop of BOSS_DASHBOARD_SHOPS) {
        const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
        if (!account?.id) {
          shopResults.push({
            shopKey: shop.shopKey,
            fundSuccess: false,
            fundError: '未配置官方账号',
            scoreSkipped: true,
            scoreSaved: false,
            scoreDate: null,
          })
          continue
        }
        const fund = await syncBossFundForShop(shop)
        let bill: {
          success: boolean
          partial?: boolean
          pendingSnapshotWritten?: boolean
          pendingOrderCount?: number
          periodBillWrittenCount?: number
          error?: string
        } = { success: false, error: 'skipped' }
        try {
          bill = await syncBossBillForShop(shop)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logWarn('老板同步', `${shop.shopName} 账单失败：${msg}`)
          bill = { success: false, error: msg }
        }
        let score: {
          skipped: boolean
          saved: boolean
          partial?: boolean
          scoreDate: string | null
          reason?: string
        } = { skipped: true, saved: false, scoreDate: null, reason: 'skipped' }
        try {
          score = await syncBossShopScoreForShop({ shop, liveAccountId: account.id })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logWarn('老板同步', `${shop.shopName} 店铺分失败：${msg}`)
          score = { skipped: false, saved: false, scoreDate: null, reason: msg }
        }
        shopResults.push({
          shopKey: shop.shopKey,
          fundSuccess: fund.success,
          fundPartial: fund.partial,
          fundSnapshotWritten: fund.snapshotWritten,
          fundError: fund.error ?? null,
          billSuccess: bill.success,
          billPartial: bill.partial,
          pendingSnapshotWritten: bill.pendingSnapshotWritten,
          pendingOrderCount: bill.pendingOrderCount,
          periodBillWrittenCount: bill.periodBillWrittenCount,
          billError: bill.error ?? null,
          scoreSkipped: score.skipped,
          scoreSaved: score.saved,
          scorePartial: score.partial,
          scoreDate: score.scoreDate,
          scoreReason: score.reason ?? null,
          skippedFresh:
            !fund.snapshotWritten &&
            !fund.success &&
            !bill.pendingSnapshotWritten &&
            !bill.success &&
            score.skipped &&
            !score.saved &&
            !fund.error &&
            !bill.error,
        })
      }
      const summary = summarizeBossRun(shopResults)
      await prisma.bossSyncRunLog.update({
        where: { id: run.id },
        data: {
          status: summary.status,
          finishedAt: new Date(),
          errorMessage: summary.errorSummary,
          shopResults: JSON.stringify({ shops: shopResults, summary }),
        },
      })
      logInfo(
        '老板同步',
        `完成 status=${summary.status} 资金快照=${summary.snapshotWrittenCount} 账单快照=${summary.billSnapshotWrittenCount} 店铺分=${summary.scoreSnapshotWrittenCount} 用时 ${Date.now() - startedAt.getTime()}ms`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await prisma.bossSyncRunLog.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          errorMessage: message,
          shopResults: JSON.stringify(shopResults),
        },
      })
      logWarn('老板同步', `运行失败：${message}`)
    }
  })().finally(() => {
    bossSyncRunning = null
  })
  await bossSyncRunning
}

export function isBossDashboardSyncRunning(): boolean {
  return bossSyncRunning != null
}
