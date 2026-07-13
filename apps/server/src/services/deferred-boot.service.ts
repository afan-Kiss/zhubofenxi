import { cleanupExpiredSessions } from './session.service'
import { initScheduler } from './scheduler.service'
import { ensureBuyerRankingCacheOnBoot } from './buyer-ranking-cache.service'
import { bootstrapQualityBadCaseCache } from './quality-badcase-store.service'
import { scheduleOfficialQualityBadCaseSyncOnBoot } from './quality-badcase-auto-sync.service'
import { warmupBusinessCacheOnBoot } from './business-cache.service'
import { ensureSqlitePragmas } from '../lib/prisma'
import { logInfo, logWarn } from '../utils/server-log'

let deferredBootStarted = false

/** HTTP 已监听后执行：不阻塞 /api/health，单项失败仅 warning */
export function startDeferredBootTasks(): void {
  if (deferredBootStarted) return
  deferredBootStarted = true

  void (async () => {
    try {
      await ensureSqlitePragmas()
    } catch (err) {
      logWarn('数据库', `PRAGMA 初始化失败：${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      await initScheduler()
    } catch (err) {
      logWarn(
        '启动',
        `定时任务注册失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }

    try {
      await bootstrapQualityBadCaseCache()
    } catch (err) {
      logWarn(
        '品退缓存',
        `加载失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }

    await warmupBusinessCacheOnBoot()

    try {
      const snapMod = await import('./board-preset-snapshot.service')
      await snapMod.cleanupNonStandardBoardPresetSnapshots()
    } catch (err) {
      logWarn(
        '经营快照',
        `启动清理失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }

    try {
      const opsMod = await import('./operations-report-cache.service')
      await opsMod.prewarmCommonOperationsReportsOnBoot()
    } catch (err) {
      logWarn(
        '运营报表缓存',
        `提前计算失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }

    try {
      await ensureBuyerRankingCacheOnBoot()
    } catch (err) {
      logWarn(
        '买家排行',
        `启动时构建失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }

    void import('./quality-badcase-orphan-cleanup.service').then((m) =>
      m.cleanupOrphanQualityBadCaseSyncJobs({ logOrphans: true }).catch((err) => {
        logWarn(
          '品退缓存',
          `孤立任务清理失败：${err instanceof Error ? err.message : String(err)}`,
        )
      }),
    )

    scheduleOfficialQualityBadCaseSyncOnBoot()

    try {
      const removed = await cleanupExpiredSessions()
      if (removed > 0) {
        logInfo('会话', `已清理 ${removed} 条过期会话`)
      }
    } catch (err) {
      logWarn(
        '会话',
        `清理过期会话失败：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  })()
}
