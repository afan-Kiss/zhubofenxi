import { prisma } from '../lib/prisma'

import { runDailyStrategySyncJob, DEFAULT_BUSINESS_SYNC_MODE } from './daily-sync-strategy.service'

import { waitForSyncJobComplete } from './scheduled-sync-queue.service'

import { BUYER_RANKING_CACHE_VERSION } from './buyer-ranking-cache.service'

import { getApiSyncSettings } from './system-setting.service'
import { clearStaleBusinessSyncJobs, isIgnorableBusinessSyncFailure } from './business-sync-stale-cleanup.service'
import { logInfo, logWarn } from '../utils/server-log'
import { taskComplete, taskFail, taskStart } from '../utils/task-log'



import {
  BUSINESS_SYNC_INTERVAL_MINUTES,
  BUSINESS_SYNC_LOOKBACK_DAYS,
} from '../config/business-sync.constants'

export { BUSINESS_SYNC_INTERVAL_MINUTES, BUSINESS_SYNC_LOOKBACK_DAYS }



export type BusinessSyncReason = 'startup' | 'catchup' | 'cron' | 'coverage_missing'



export type BusinessSyncStatusValue =

  | 'idle'

  | 'running'

  | 'success'

  | 'failed'

  | 'queued'



const SUCCESS_STATUSES = ['success', 'partial_success', 'success_empty'] as const



const REASON_PRIORITY: Record<BusinessSyncReason, number> = {

  startup: 4,

  catchup: 3,

  cron: 2,

  coverage_missing: 1,

}



let businessSyncRunning = false

let businessSyncQueued = false

let businessSyncQueuedReason: BusinessSyncReason | null = null

let businessSyncQueuedAt: string | null = null

let currentTask: { reason: BusinessSyncReason; startedAt: string } | null = null

let lastBusinessSyncError: string | null = null

let lastCoverageTriggerAt = 0



const COVERAGE_TRIGGER_COOLDOWN_MS = 5 * 60 * 1000

const BIZ_SYNC_LOG_COOLDOWN_MS = 60_000

const bizSyncLogLastAt = new Map<string, number>()

function logBusinessSyncOnce(key: string, line: string): void {
  const now = Date.now()
  if (now - (bizSyncLogLastAt.get(key) ?? 0) < BIZ_SYNC_LOG_COOLDOWN_MS) return
  bizSyncLogLastAt.set(key, now)
  console.log(line)
}

type QueueWhileRunningResult = 'queued' | 'already_queued'

/** running 时合并排队；同 reason 已排队则不再重复入队 */
function tryQueueBusinessSyncWhileRunning(reason: BusinessSyncReason): QueueWhileRunningResult {
  if (businessSyncQueued && businessSyncQueuedReason === reason) {
    return 'already_queued'
  }
  queueBusinessSync(reason)
  return 'queued'
}

function logSkipWhileRunning(reason: BusinessSyncReason, result: QueueWhileRunningResult): void {
  if (result === 'already_queued') {
    if (reason === 'cron') {
      logBusinessSyncOnce(
        'skip_cron_dup',
        '[business-sync] running 中，cron 已在待执行队列，跳过重复触发',
      )
    }
    return
  }
  if (reason === 'cron') {
    logBusinessSyncOnce(
      'skip_cron_queue',
      '[business-sync] running 中，本次 cron 已合并到待执行队列',
    )
    return
  }
  logBusinessSyncOnce(
    `skip_${reason}_queue`,
    `[business-sync] skip reason=${reason}: 内存锁运行中，已排队 reason=${businessSyncQueuedReason}`,
  )
}

/** 经营同步 DB 任务：preset=daily_strategy（含 startup/catchup/cron/coverage_missing） */

export function isBusinessSyncJob(job: {

  preset?: string | null

  startedBy?: string | null

}): boolean {

  if (job.preset === 'daily_strategy') return true

  const by = job.startedBy ?? ''

  return by.startsWith('business-sync:')

}



function mergeQueuedReason(

  existing: BusinessSyncReason | null,

  incoming: BusinessSyncReason,

): BusinessSyncReason {

  if (!existing) return incoming

  return REASON_PRIORITY[incoming] > REASON_PRIORITY[existing] ? incoming : existing

}



function queueBusinessSync(reason: BusinessSyncReason): void {

  businessSyncQueuedReason = mergeQueuedReason(businessSyncQueuedReason, reason)

  businessSyncQueued = true

  if (!businessSyncQueuedAt) {

    businessSyncQueuedAt = new Date().toISOString()

  }

}



function reasonFromStartedBy(startedBy: string | null | undefined): BusinessSyncReason {

  if (!startedBy?.startsWith('business-sync:')) return 'cron'

  const r = startedBy.replace('business-sync:', '')

  if (r === 'startup' || r === 'catchup' || r === 'coverage_missing' || r === 'cron') {

    return r

  }

  return 'cron'

}



function normalizeReason(trigger: string): BusinessSyncReason {

  if (trigger === 'startup' || trigger === 'catchup' || trigger === 'coverage_missing') {

    return trigger

  }

  if (
    trigger === 'interval' ||
    trigger === 'scheduler:180m' ||
    trigger === 'scheduler:90m' ||
    trigger === 'scheduler:30m' ||
    trigger.startsWith('scheduler')
  ) {
    return 'cron'
  }

  return 'cron'

}



function alignNextBusinessSync(from = new Date()): Date {
  const next = new Date(from)
  next.setSeconds(0, 0)
  const totalMinutes = next.getHours() * 60 + next.getMinutes()
  const interval = BUSINESS_SYNC_INTERVAL_MINUTES
  const nextSlotMinutes = Math.floor(totalMinutes / interval) * interval + interval
  if (nextSlotMinutes >= 24 * 60) {
    const tomorrow = new Date(next)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    return tomorrow
  }
  next.setHours(Math.floor(nextSlotMinutes / 60), nextSlotMinutes % 60, 0, 0)
  return next
}



async function findLastSuccessJob() {

  return prisma.xhsSyncJob.findFirst({

    where: {

      preset: 'daily_strategy',

      status: { in: [...SUCCESS_STATUSES] },

    },

    orderBy: { finishedAt: 'desc' },

  })

}



async function findLastFailedJob() {

  return prisma.xhsSyncJob.findFirst({

    where: { preset: 'daily_strategy', status: 'failed' },

    orderBy: { finishedAt: 'desc' },

  })

}



/** 仅查询经营同步 running 任务，不含 buyer_ranking_fill 等 */

async function findRunningBusinessSyncJob() {

  await clearStaleBusinessSyncJobs()

  return prisma.xhsSyncJob.findFirst({

    where: { status: 'running', preset: 'daily_strategy' },

    orderBy: { startedAt: 'desc' },

  })

}



function resolveCurrentTaskFromDb(job: {

  startedBy: string | null

  startedAt: Date | null

}): { reason: BusinessSyncReason; startedAt: string } {

  return {

    reason: reasonFromStartedBy(job.startedBy),

    startedAt: job.startedAt?.toISOString() ?? new Date().toISOString(),

  }

}



function processQueuedAfterComplete(): void {

  console.log('[business-sync] 当前经营同步完成，检查 queued 任务')

  try {

    if (businessSyncQueued && businessSyncQueuedReason) {

      const queuedReason = businessSyncQueuedReason

      businessSyncQueued = false

      businessSyncQueuedReason = null

      businessSyncQueuedAt = null

      console.log(`[business-sync] 发现 queued 经营同步任务，准备启动：reason=${queuedReason}`)

      void runNormalBusinessSyncJob(queuedReason).catch((err) => {

        console.warn(

          `[business-sync] queued 经营同步启动失败 reason=${queuedReason}: ${err instanceof Error ? err.message : err}`,

        )

      })

    } else {

      console.log('[business-sync] 无 queued 经营同步任务')

    }

  } catch (err) {

    console.warn(

      `[business-sync] queued 消费检查失败: ${err instanceof Error ? err.message : err}`,

    )

  }

}



export async function getBusinessSyncStatus(): Promise<{

  businessSync: {

    lastRunAt: string | null

    lastSuccessAt: string | null

    failedAt: string | null

    nextRunAt: string | null

    status: BusinessSyncStatusValue

    intervalMinutes: number

    /** 系统设置 apiSyncEnabled；关闭时不触发 interval/补跑同步 */
    enabled: boolean

    message: string

    lastError: string | null

    settlementSkippedForBusinessBI: boolean

    currentTask: { reason: BusinessSyncReason; startedAt: string } | null

  }

  buyerRankingSync: {

    lastRunAt: string | null

    nextRunAt: string | null

    status: 'success' | 'failed' | 'running' | 'idle'

    message: string

    lastError: string | null

    cacheVersion: string | null

  }

  qianfanCookie: {
    at: string
    controlOk: number
    envFallback: number
    sqliteFallback: number
    missing: number
    staleShops: string[]
    shops: Array<{
      shopName: string
      source: string
      updatedAt: string | null
      cookieHash: string | null
      staleWarning: string | null
      failureReason: string | null
    }>
  } | null

}> {

  const [lastSuccessJob, lastFailedJob, lastAnyJob, runningBizJob, buyerCache] = await Promise.all([

    findLastSuccessJob(),

    findLastFailedJob(),

    prisma.xhsSyncJob.findFirst({

      where: { preset: 'daily_strategy' },

      orderBy: { finishedAt: 'desc' },

    }),

    findRunningBusinessSyncJob(),

    prisma.buyerRankingCache.findUnique({ where: { id: 'default' } }),

  ])



  const isRunning = businessSyncRunning || Boolean(runningBizJob)

  const lastSuccessAt = lastSuccessJob?.finishedAt?.toISOString() ?? null

  const failedAt = lastFailedJob?.finishedAt?.toISOString() ?? null

  const lastRunAt =

    lastAnyJob?.finishedAt?.toISOString() ?? lastAnyJob?.startedAt?.toISOString() ?? null



  let businessStatus: BusinessSyncStatusValue = 'idle'

  if (isRunning) {

    businessStatus = 'running'

  } else if (businessSyncQueued) {

    businessStatus = 'queued'

  } else if (
    lastFailedJob &&
    !isIgnorableBusinessSyncFailure(lastFailedJob.errorMessage) &&
    (!lastSuccessJob ||
      (lastFailedJob.finishedAt &&
        lastSuccessJob.finishedAt &&
        lastFailedJob.finishedAt > lastSuccessJob.finishedAt))
  ) {

    businessStatus = 'failed'

  } else if (lastSuccessJob) {

    businessStatus = 'success'

  }



  let buyerCacheVersion: string | null = null

  if (buyerCache?.summaryJson) {

    try {

      const parsed = JSON.parse(buyerCache.summaryJson) as { cacheVersion?: string }

      buyerCacheVersion = parsed.cacheVersion ?? null

    } catch {

      buyerCacheVersion = null

    }

  }



  const buyerLastTrigger = buyerCache?.lastTrigger ?? ''

  const buyerFailed = buyerLastTrigger.includes(':failed')



  const nextBusiness = alignNextBusinessSync()



  const nextBuyer = new Date()

  nextBuyer.setHours(3, 0, 0, 0)

  if (nextBuyer.getTime() <= Date.now()) {

    nextBuyer.setDate(nextBuyer.getDate() + 1)

  }



  const lastError =
    businessStatus === 'failed'
      ? lastFailedJob?.errorMessage ?? lastBusinessSyncError
      : null



  let resolvedCurrentTask: { reason: BusinessSyncReason; startedAt: string } | null = null

  if (isRunning) {

    resolvedCurrentTask =

      currentTask ?? (runningBizJob ? resolveCurrentTaskFromDb(runningBizJob) : null)

  } else if (businessSyncQueued && businessSyncQueuedReason) {

    resolvedCurrentTask = {

      reason: businessSyncQueuedReason,

      startedAt: businessSyncQueuedAt ?? new Date().toISOString(),

    }

  }



  const { getLastCookieBootstrapSummary } = await import('./qianfan-cookie-resolver.service')
  const cookieSummary = getLastCookieBootstrapSummary()
  const settings = await getApiSyncSettings()
  const apiSyncEnabled = settings.apiSyncEnabled

  return {

    businessSync: {

      lastRunAt,

      lastSuccessAt,

      failedAt,

      nextRunAt: apiSyncEnabled ? nextBusiness.toISOString() : null,

      status: businessStatus,

      intervalMinutes: BUSINESS_SYNC_INTERVAL_MINUTES,

      enabled: apiSyncEnabled,

      message: apiSyncEnabled
        ? `经营数据每 ${BUSINESS_SYNC_INTERVAL_MINUTES} 分钟自动同步`
        : '经营数据自动同步已关闭',

      lastError: lastError ?? null,

      settlementSkippedForBusinessBI: true,

      currentTask: resolvedCurrentTask,

    },

    buyerRankingSync: {

      lastRunAt: buyerCache?.updatedAt?.toISOString() ?? null,

      nextRunAt: nextBuyer.toISOString(),

      status: buyerFailed ? 'failed' : buyerCache ? 'success' : 'idle',

      message: '买家排行每天凌晨 3 点自动更新',

      lastError: buyerFailed ? '买家排行最近一次自动更新失败' : null,

      cacheVersion: buyerCacheVersion ?? BUYER_RANKING_CACHE_VERSION,

    },

    qianfanCookie: cookieSummary
      ? {
          at: cookieSummary.at,
          controlOk: cookieSummary.controlOk,
          envFallback: cookieSummary.envFallback,
          sqliteFallback: cookieSummary.sqliteFallback,
          missing: cookieSummary.missing,
          staleShops: cookieSummary.staleShops,
          shops: cookieSummary.shops.map((x) => ({
            shopName: x.shopName,
            source: x.source,
            updatedAt: x.updatedAt ?? null,
            cookieHash: x.cookieHash ? String(x.cookieHash).slice(0, 8) : null,
            staleWarning: x.staleWarning ?? null,
            failureReason: x.failureReason ?? null,
          })),
        }
      : null,

  }

}



export type TriggerBusinessSyncResult =

  | 'started'

  | 'queued'

  | 'skipped_running'

  | 'skipped_disabled'

  | 'skipped_cooldown'



export async function triggerBusinessSyncIfStale(

  reason: BusinessSyncReason,

): Promise<TriggerBusinessSyncResult> {

  const settings = await getApiSyncSettings()

  if (!settings.apiSyncEnabled) {

    console.log(`[business-sync] trigger ${reason} skipped: API 同步已禁用`)

    return 'skipped_disabled'

  }



  if (businessSyncRunning) {
    const q = tryQueueBusinessSyncWhileRunning(reason)
    logSkipWhileRunning(reason, q)
    return 'queued'
  }

  const runningBiz = await findRunningBusinessSyncJob()

  if (runningBiz) {
    const q = tryQueueBusinessSyncWhileRunning(reason)
    if (q === 'queued') {
      logBusinessSyncOnce(
        `trigger_db_${reason}`,
        `[business-sync] trigger ${reason} queued: 经营同步 DB 任务 ${runningBiz.id} 运行中`,
      )
    } else {
      logSkipWhileRunning(reason, q)
    }
    return 'queued'
  }

  if (businessSyncQueued) {
    const before = businessSyncQueuedReason
    queueBusinessSync(reason)
    if (businessSyncQueuedReason !== before) {
      logBusinessSyncOnce(
        `trigger_merge_${reason}`,
        `[business-sync] trigger ${reason} merged into queued，当前 reason=${businessSyncQueuedReason}`,
      )
    }
    return 'queued'
  }



  void runNormalBusinessSyncJob(reason)

  return 'started'

}



/** local-data 缺覆盖时调用：不覆盖 startup/catchup，已有经营同步任务时不重复创建 */

export async function handleLocalDataCoverageMissing(): Promise<TriggerBusinessSyncResult> {

  await clearStaleBusinessSyncJobs()

  const settings = await getApiSyncSettings()

  if (!settings.apiSyncEnabled) {

    return 'skipped_disabled'

  }



  if (businessSyncRunning) {

    console.log(

      `[business-sync] coverage_missing skipped: 经营同步 running reason=${currentTask?.reason ?? '—'}`,

    )

    return 'skipped_running'

  }



  if (businessSyncQueued) {

    console.log(

      `[business-sync] coverage_missing skipped: 经营同步 queued reason=${businessSyncQueuedReason ?? '—'}`,

    )

    return 'skipped_running'

  }



  const runningBiz = await findRunningBusinessSyncJob()

  if (runningBiz) {

    const task = resolveCurrentTaskFromDb(runningBiz)

    console.log(

      `[business-sync] coverage_missing skipped: 经营同步 DB running reason=${task.reason} jobId=${runningBiz.id}`,

    )

    return 'skipped_running'

  }



  const lastSuccessJob = await findLastSuccessJob()

  if (!lastSuccessJob) {

    console.log('[business-sync] coverage_missing 转 startup: 无 lastSuccessAt')

    return triggerBusinessSyncIfStale('startup')

  }



  if (Date.now() - lastCoverageTriggerAt < COVERAGE_TRIGGER_COOLDOWN_MS) {

    console.log('[business-sync] trigger coverage_missing skipped: cooldown')

    return 'skipped_cooldown'

  }

  lastCoverageTriggerAt = Date.now()



  return triggerBusinessSyncIfStale('coverage_missing')

}



export async function ensureInitialBusinessSync(): Promise<void> {

  await clearStaleBusinessSyncJobs(true)

  const settings = await getApiSyncSettings()

  if (!settings.apiSyncEnabled) {

    console.log('[business-sync] ensureInitialBusinessSync skipped: API 同步已禁用')

    return

  }



  if (businessSyncRunning) {

    console.log(

      `[business-sync] ensureInitialBusinessSync skipped: 经营同步内存运行中 reason=${currentTask?.reason ?? '—'}`,

    )

    return

  }



  if (businessSyncQueued) {

    console.log(

      `[business-sync] ensureInitialBusinessSync skipped: 经营同步已排队 reason=${businessSyncQueuedReason ?? '—'}`,

    )

    return

  }



  const runningBiz = await findRunningBusinessSyncJob()

  if (runningBiz) {

    const task = resolveCurrentTaskFromDb(runningBiz)

    console.log(

      `[business-sync] ensureInitialBusinessSync skipped: 经营同步 DB 运行中 reason=${task.reason} jobId=${runningBiz.id}`,

    )

    return

  }



  const lastSuccessJob = await findLastSuccessJob()

  const lastSuccessAt = lastSuccessJob?.finishedAt?.toISOString() ?? null

  if (!lastSuccessAt) {

    console.log('[business-sync] ensureInitialBusinessSync: 无成功记录，触发 startup')

    await triggerBusinessSyncIfStale('startup')

    return

  }



  const elapsedMs = Date.now() - new Date(lastSuccessAt).getTime()

  const thresholdMs = BUSINESS_SYNC_INTERVAL_MINUTES * 60 * 1000

  if (elapsedMs > thresholdMs) {

    console.log(

      `[business-sync] ensureInitialBusinessSync: 距上次成功 ${Math.round(elapsedMs / 60000)} 分钟，触发 catchup`,

    )

    await triggerBusinessSyncIfStale('catchup')

    return

  }



  /* 距上次成功未超时，无需补跑 — 默认不打印，避免启动噪音 */

}



let ensureInitialSyncScheduled = false

export function scheduleEnsureInitialBusinessSync(): void {
  if (ensureInitialSyncScheduled) return
  ensureInitialSyncScheduled = true

  const delayMs = 3000 + Math.floor(Math.random() * 7000)

  logInfo('经营同步', `将在 ${(delayMs / 1000).toFixed(1)} 秒后检查是否需要启动补跑`)

  setTimeout(() => {

    void ensureInitialBusinessSync()

  }, delayMs)

}



export async function runNormalBusinessSyncJob(trigger = 'interval'): Promise<void> {

  const reason = normalizeReason(trigger)

  await clearStaleBusinessSyncJobs()



  if (businessSyncRunning) {
    logSkipWhileRunning(reason, tryQueueBusinessSyncWhileRunning(reason))
    return
  }

  const runningBiz = await findRunningBusinessSyncJob()

  if (runningBiz) {
    const q = tryQueueBusinessSyncWhileRunning(reason)
    if (q === 'queued') {
      logBusinessSyncOnce(
        `skip_db_${reason}`,
        `[business-sync] skip reason=${reason}: 经营同步 ${runningBiz.id} 运行中，已排队`,
      )
    } else {
      logSkipWhileRunning(reason, q)
    }
    return
  }

  const settings = await getApiSyncSettings()

  if (!settings.apiSyncEnabled) {
    logBusinessSyncOnce(`skip_disabled_${reason}`, `[business-sync] skip reason=${reason}: API 同步已禁用`)
    return
  }

  businessSyncRunning = true

  businessSyncQueued = false

  businessSyncQueuedReason = null

  businessSyncQueuedAt = null

  lastBusinessSyncError = null

  currentTask = { reason, startedAt: new Date().toISOString() }

  const started = Date.now()

  const reasonLabel =
    reason === 'cron'
      ? `定时（每 ${BUSINESS_SYNC_INTERVAL_MINUTES} 分钟）`
      : reason === 'startup'
        ? '启动补跑'
        : reason
  taskStart('经营同步', `${reasonLabel} 开始执行`)



  let startedJobId: string | null = null



  try {

    const { jobId, alreadyRunning } = await runDailyStrategySyncJob({

      triggeredBy: `business-sync:${reason}`,

      mode: DEFAULT_BUSINESS_SYNC_MODE,

    })

    if (alreadyRunning) {

      console.log(

        `[business-sync] skip reason=${reason}: runDailyStrategySyncJob alreadyRunning jobId=${jobId}`,

      )

      queueBusinessSync(reason)

      return

    }



    startedJobId = jobId

    console.log(`[business-sync] queued 经营同步任务已启动：jobId=${jobId} reason=${reason}`)



    await waitForSyncJobComplete(jobId, 3_600_000)

    const job = await prisma.xhsSyncJob.findUnique({ where: { id: jobId } })

    const finishedAt = job?.finishedAt?.toISOString() ?? new Date().toISOString()



    if (job?.status === 'failed') {

      lastBusinessSyncError = job.errorMessage ?? '同步失败'

      taskFail('经营同步', `${reasonLabel} 失败：${lastBusinessSyncError}`)

    } else {

      const durationSec = Math.round((Date.now() - started) / 1000)

      taskComplete(
        '经营同步',
        `${reasonLabel} 完成：订单 ${job?.orderCount ?? 0} 单，直播 ${job?.liveSessionCount ?? 0} 场，用时 ${durationSec} 秒`,
      )
      // 经营缓存重建由 daily-sync-strategy 在同步任务内统一触发，避免重复全量重建

    }

  } catch (err) {

    lastBusinessSyncError = err instanceof Error ? err.message : '同步失败'

    taskFail('经营同步', `${reasonLabel} 异常：${lastBusinessSyncError}`, err)

  } finally {

    businessSyncRunning = false

    currentTask = null



    if (!startedJobId) {

      processQueuedAfterComplete()

      return

    }



    processQueuedAfterComplete()

  }

}



/** stale 任务释放后重置内存锁，避免前端长期认为仍在 running */
export function resetBusinessSyncMemoryLock(): void {
  businessSyncRunning = false
  currentTask = null
}


