import cron from 'node-cron'
import { prisma } from '../lib/prisma'
import {
  BUSINESS_SYNC_INTERVAL_MINUTES,
  BUSINESS_SYNC_INTERVAL_MS,
  BUSINESS_SYNC_LOOKBACK_DAYS,
} from '../config/business-sync.constants'
import {
  ensureDefaultSettings,
  getApiSyncPresets,
  getApiSyncSettings,
  registerApiSyncRescheduleHook,
} from './system-setting.service'
import { logError, logInfo, logWarn } from '../utils/server-log'

const GLOBAL = globalThis as {
  __liveBusinessPeriodicSyncStarted?: boolean
  __liveBusinessPeriodicSyncTimeout?: ReturnType<typeof setTimeout>
}

let buyerRankingCronTask: cron.ScheduledTask | null = null
let workbenchQueueCronTask: cron.ScheduledTask | null = null
let schedulerInitialized = false
let periodicSyncRunning = false

/** 买家全量画像每日更新时间（与经营 API 同步独立，仅本地缓存重建） */
export const BUYER_RANKING_DAILY_TIME = '03:00'
export const BUYER_RANKING_TIMEZONE = 'Asia/Shanghai'

export async function getSchedulerStatus(): Promise<{
  enabled: boolean
  apiSyncTime: string
  apiSyncPreset: string
  apiSyncPresets: string[]
  refreshTimezone: string
  cronRegistered: boolean
  nextRunAt: string | null
  lastScheduledJob: {
    syncJobId: string
    status: string
    startedAt: string | null
    finishedAt: string | null
    preset: string
    startDate: string
    endDate: string
  } | null
  windowsHint: string
  businessSyncIntervalMinutes: number
  businessSyncLookbackDays: number
}> {
  const settings = await getApiSyncSettings()
  const apiSyncPresets = await getApiSyncPresets()
  const last = await prisma.xhsSyncJob.findFirst({
    where: { type: 'scheduled' },
    orderBy: { createdAt: 'desc' },
  })
  const { getBusinessSyncStatus } = await import('./business-sync-scheduler.service')
  const biz = await getBusinessSyncStatus()
  return {
    enabled: settings.apiSyncEnabled,
    apiSyncTime: settings.apiSyncTime,
    apiSyncPreset: settings.apiSyncPreset,
    apiSyncPresets,
    refreshTimezone: settings.refreshTimezone,
    cronRegistered: Boolean(GLOBAL.__liveBusinessPeriodicSyncStarted),
    nextRunAt: biz.businessSync.nextRunAt,
    lastScheduledJob: last
      ? {
          syncJobId: last.id,
          status: last.status,
          startedAt: last.startedAt?.toISOString() ?? null,
          finishedAt: last.finishedAt?.toISOString() ?? null,
          preset: last.preset,
          startDate: last.startDate,
          endDate: last.endDate,
        }
      : null,
    windowsHint:
      'Windows 本机模式：电脑须开机且服务在运行；睡眠或关机时定时同步不会执行。',
    businessSyncIntervalMinutes: BUSINESS_SYNC_INTERVAL_MINUTES,
    businessSyncLookbackDays: BUSINESS_SYNC_LOOKBACK_DAYS,
  }
}

function clearBusinessPeriodicTimer(): void {
  if (GLOBAL.__liveBusinessPeriodicSyncTimeout != null) {
    clearTimeout(GLOBAL.__liveBusinessPeriodicSyncTimeout)
    GLOBAL.__liveBusinessPeriodicSyncTimeout = undefined
  }
}

async function syncJadeAccountingUsersOnSchedule(): Promise<void> {
  try {
    const { syncJadeAccountingUsers } = await import('./jade-accounting-user-sync.service')
    await syncJadeAccountingUsers()
  } catch (err) {
    logWarn(
      '记账用户同步',
      `执行异常：${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function runBusinessPeriodicSyncTick(): Promise<void> {
  if (periodicSyncRunning) return
  periodicSyncRunning = true
  try {
    const s = await getApiSyncSettings()
    if (s.apiSyncEnabled) {
      logInfo('定时任务', `触发经营数据自动同步（每 ${BUSINESS_SYNC_INTERVAL_MINUTES} 分钟）`)
      const { runNormalBusinessSyncJob } = await import('./business-sync-scheduler.service')
      await runNormalBusinessSyncJob('interval')
    }
    await syncJadeAccountingUsersOnSchedule()
  } catch (err) {
    logWarn(
      '定时任务',
      `经营数据自动同步执行异常：${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    periodicSyncRunning = false
  }
}

/** 单次 setTimeout 链：上一轮结束后再预约下一轮，避免 setInterval 叠加/NaN 间隔刷屏 */
function scheduleNextBusinessPeriodicSync(): void {
  clearBusinessPeriodicTimer()
  const delayMs =
    Number.isFinite(BUSINESS_SYNC_INTERVAL_MS) && BUSINESS_SYNC_INTERVAL_MS > 0
      ? BUSINESS_SYNC_INTERVAL_MS
      : 180 * 60 * 1000

  GLOBAL.__liveBusinessPeriodicSyncTimeout = setTimeout(() => {
    GLOBAL.__liveBusinessPeriodicSyncTimeout = undefined
    void runBusinessPeriodicSyncTick().finally(() => {
      if (GLOBAL.__liveBusinessPeriodicSyncStarted) {
        scheduleNextBusinessPeriodicSync()
      }
    })
  }, delayMs)
}

function scheduleBusinessPeriodicSync(): void {
  if (GLOBAL.__liveBusinessPeriodicSyncStarted) {
    logInfo('定时任务', '经营数据自动同步已启动，跳过重复注册')
    return
  }

  clearBusinessPeriodicTimer()
  GLOBAL.__liveBusinessPeriodicSyncStarted = true

  logInfo(
    '定时任务',
    `经营数据自动同步已开启：每 ${BUSINESS_SYNC_INTERVAL_MINUTES} 分钟一次，间隔 ${Math.round(BUSINESS_SYNC_INTERVAL_MS / 60000)} 分钟（${BUSINESS_SYNC_INTERVAL_MS}ms），范围最近 ${BUSINESS_SYNC_LOOKBACK_DAYS} 天`,
  )

  scheduleNextBusinessPeriodicSync()
}

/** 保留供设置页兼容；不再注册每日 02:00 API cron */
export function scheduleApiSync(_time: string, _timezone: string): void {
  logInfo('定时任务', '每日 02:00 API 定时任务已停用，经营数据由 interval 自动同步')
}

export async function rescheduleFromSettings(): Promise<void> {
  const settings = await getApiSyncSettings()
  if (!settings.apiSyncEnabled) {
    logInfo('定时任务', '经营数据自动同步已关闭（apiSyncEnabled=false）')
    return
  }
  logInfo(
    '定时任务',
    `经营数据自动同步：每 ${BUSINESS_SYNC_INTERVAL_MINUTES} 分钟，最近 ${BUSINESS_SYNC_LOOKBACK_DAYS} 天（不再注册每日 02:00 API cron）`,
  )
}

function scheduleBuyerRankingCache(): void {
  if (buyerRankingCronTask) {
    buyerRankingCronTask.stop()
    buyerRankingCronTask = null
  }
  const [h, m] = BUYER_RANKING_DAILY_TIME.split(':').map(Number)
  const expr = `${m} ${h} * * *`
  buyerRankingCronTask = cron.schedule(
    expr,
    () => {
      void (async () => {
        logInfo('买家排行', '开始定时全量画像重建')
        try {
          const { rebuildBuyerRankingCache } = await import('./buyer-ranking-cache.service')
          const r = await rebuildBuyerRankingCache('scheduler')
          logInfo(
            '买家排行',
            `定时重建完成：${r.buyerCount} 位买家，${r.orderCount} 单`,
          )
        } catch (err) {
          logError(
            '买家排行',
            `定时重建失败：${err instanceof Error ? err.message : String(err)}`,
            err,
          )
        }
      })()
    },
    { timezone: BUYER_RANKING_TIMEZONE },
  )
  logInfo(
    '定时任务',
    `买家排行自动重建已开启：每日 ${BUYER_RANKING_DAILY_TIME}（${BUYER_RANKING_TIMEZONE}）`,
  )
}

function scheduleWorkbenchQueueProcessor(): void {
  if (workbenchQueueCronTask) {
    workbenchQueueCronTask.stop()
    workbenchQueueCronTask = null
  }
  workbenchQueueCronTask = cron.schedule('* * * * *', () => {
    void (async () => {
      try {
        const { runAfterSalesBackfillBatch } = await import('./after-sales-backfill.service')
        await runAfterSalesBackfillBatch(60)
      } catch (err) {
        logError(
          '售后补查',
          `补查任务异常：${err instanceof Error ? err.message : String(err)}`,
          err,
        )
      }
    })()
  })
}

export async function initScheduler(): Promise<void> {
  if (schedulerInitialized) {
    logInfo('定时任务', '调度器已初始化，跳过重复注册')
    return
  }
  schedulerInitialized = true

  await ensureDefaultSettings()
  registerApiSyncRescheduleHook(rescheduleFromSettings)
  scheduleBusinessPeriodicSync()
  scheduleBuyerRankingCache()
  scheduleWorkbenchQueueProcessor()
  try {
    const { initMonthlyCloseScheduler } = await import('./monthly-close-scheduler.service')
    initMonthlyCloseScheduler()
  } catch (err) {
    logWarn('定时任务', `月度结账调度注册失败：${err instanceof Error ? err.message : String(err)}`)
  }
  try {
    const { refreshWorkbenchMemoryCache } = await import('./xhs-after-sales-workbench.service')
    const n = await refreshWorkbenchMemoryCache()
    logInfo('定时任务', `售后工作台内存缓存已加载：${n} 条`)
  } catch (e) {
    logWarn(
      '定时任务',
      `售后工作台缓存加载跳过（表可能未迁移）：${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const settings = await getApiSyncSettings()
  if (!settings.apiSyncEnabled) {
    logInfo('定时任务', '经营数据自动同步已关闭（apiSyncEnabled=false）')
  }

  const { scheduleEnsureInitialBusinessSync } = await import('./business-sync-scheduler.service')
  scheduleEnsureInitialBusinessSync()
}
