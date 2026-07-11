import { BOSS_DASHBOARD_SHOPS } from '../../config/boss-dashboard.constants'
import { prisma } from '../../lib/prisma'
import { resolveOfficialShopAccountForStatus } from '../official-shop-account.service'
import { syncBossFundForShop } from './boss-dashboard-fund.service'
import { syncBossShopScoreForShop } from './boss-dashboard-score.service'
import { logInfo, logWarn } from '../../utils/server-log'

let bossSyncRunning: Promise<void> | null = null

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
    const shopResults: Array<Record<string, unknown>> = []
    try {
      for (const shop of BOSS_DASHBOARD_SHOPS) {
        const account = await resolveOfficialShopAccountForStatus(shop.shopKey)
        if (!account?.id) {
          shopResults.push({ shopKey: shop.shopKey, success: false, error: '未配置官方账号' })
          continue
        }
        const fund = await syncBossFundForShop(shop)
        let score: {
          skipped: boolean
          saved: boolean
          scoreDate: string | null
          reason?: string
        } = { skipped: true, saved: false, scoreDate: null, reason: 'skipped' }
        try {
          score = await syncBossShopScoreForShop({ shop, liveAccountId: account.id })
        } catch (err) {
          logWarn(
            '老板同步',
            `${shop.shopName} 店铺分失败：${err instanceof Error ? err.message : String(err)}`,
          )
        }
        shopResults.push({
          shopKey: shop.shopKey,
          fundSuccess: fund.success,
          fundError: fund.error ?? null,
          scoreSkipped: score.skipped,
          scoreSaved: score.saved,
          scoreDate: score.scoreDate,
          scoreReason: score.reason ?? null,
        })
      }
      await prisma.bossSyncRunLog.update({
        where: { id: run.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          shopResults: JSON.stringify(shopResults),
        },
      })
      logInfo('老板同步', `完成，用时 ${Date.now() - startedAt.getTime()}ms`)
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
