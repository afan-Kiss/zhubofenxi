/**
 * 经营同步状态机验收
 */
import { getHealth, getJson } from '../metrics-acceptance/api-client'
import {
  hasFailures,
  logFail,
  logPass,
  logSkip,
  resetResults,
} from '../metrics-acceptance/assertions'
import {
  BUSINESS_SYNC_HEARTBEAT_STALE_MS,
  BUSINESS_SYNC_STALE_RUNNING_MS,
  isBusinessSyncJobStale,
} from '../../src/services/business-sync-stale-cleanup.service'

type SyncMetaResponse = {
  businessSync?: {
    status?: string
    currentTask?: unknown
    lastSuccessAt?: string | null
    lastError?: string | null
  }
  activeSyncJob?: {
    syncJobId?: string
    status?: string
    currentStep?: string
    progress?: number
    currentPage?: number
    totalPage?: number | null
    orderCount?: number
    updatedAt?: string | null
    isStaleRunning?: boolean
    isRunning?: boolean
  } | null
  syncRunning?: boolean
}

async function checkSyncMetaConsistency(): Promise<void> {
  const { url, data } = await getJson<SyncMetaResponse>('/api/board/sync-meta')
  const biz = data.businessSync
  const job = data.activeSyncJob

  if (biz?.status === 'success' && !biz.currentTask) {
    if (job?.isRunning) {
      logFail({
        name: 'sync:success-no-active-job',
        message: 'businessSync success 且 currentTask=null 时不应返回 running activeSyncJob',
        url,
        fields: { businessSync: biz, activeSyncJob: job },
      })
    } else {
      logPass('sync:success-no-active-job', 'OK success/currentTask=null 无 activeSyncJob')
    }
    if (biz.lastError) {
      logFail({
        name: 'sync:success-last-error',
        message: 'success 状态不应携带 lastError',
        actual: biz.lastError,
        url,
      })
    } else {
      logPass('sync:success-last-error', 'OK success 无 lastError')
    }
  } else if (job?.currentStep === 'syncing_order_list') {
    const hasDetail =
      (job.currentPage ?? 0) > 0 ||
      (job.orderCount ?? 0) > 0 ||
      (job.progress ?? 0) > 10 ||
      Boolean(job.updatedAt)
    if (hasDetail) {
      logPass(
        'sync:order-list-progress',
        `OK step=syncing_order_list progress=${job.progress} page=${job.currentPage}/${job.totalPage ?? '?'} orders=${job.orderCount}`,
      )
    } else {
      logSkip('sync:order-list-progress', '订单列表阶段尚无分页/计数进度（可能刚启动）')
    }
  } else {
    logSkip('sync:meta', `status=${biz?.status ?? 'unknown'} 无订单列表 running`)
  }
}

async function checkLocalDataWhenReady(): Promise<void> {
  const { url, data } = await getJson<{ summary?: Record<string, unknown> }>(
    '/api/board/local-data',
    { preset: 'thisMonth' },
  )
  if (data.summary && Object.keys(data.summary).length > 0) {
    logPass('sync:local-data', 'OK local-data 返回 summary')
  } else {
    logSkip('sync:local-data', `local-data 无 summary url=${url}`)
  }
}

async function checkStaleRulesUnit(): Promise<void> {
  const now = new Date()
  const fresh = {
    status: 'running',
    currentStep: 'syncing_order_list',
    startedAt: now,
    updatedAt: now,
  }
  if (!isBusinessSyncJobStale(fresh).stale) {
    logPass('sync:stale-rules:fresh', 'OK 刚启动任务不 stale')
  } else {
    logFail({ name: 'sync:stale-rules:fresh', message: '刚启动不应 stale' })
  }

  const heartbeatStale = {
    status: 'running',
    currentStep: 'syncing_order_list',
    startedAt: new Date(now.getTime() - 60_000),
    updatedAt: new Date(now.getTime() - BUSINESS_SYNC_HEARTBEAT_STALE_MS - 1000),
  }
  if (isBusinessSyncJobStale(heartbeatStale).stale) {
    logPass('sync:stale-rules:heartbeat', `OK ${BUSINESS_SYNC_HEARTBEAT_STALE_MS}ms 无 heartbeat → stale`)
  } else {
    logFail({ name: 'sync:stale-rules:heartbeat', message: 'heartbeat stale 规则未生效' })
  }

  const runningStale = {
    status: 'running',
    currentStep: 'syncing_live_list',
    startedAt: new Date(now.getTime() - BUSINESS_SYNC_STALE_RUNNING_MS - 1000),
    updatedAt: now,
  }
  if (isBusinessSyncJobStale(runningStale).stale) {
    logPass('sync:stale-rules:running', `OK ${BUSINESS_SYNC_STALE_RUNNING_MS}ms running → stale`)
  } else {
    logFail({ name: 'sync:stale-rules:running', message: 'running 10min stale 规则未生效' })
  }
}

async function checkQualityBadCaseSyncDebug(): Promise<void> {
  try {
    const { url, data } = await getJson<{
    qualityBadCase?: {
      enabledLiveAccounts?: Array<{ id: string; name: string; enabled: boolean; hasCookie?: boolean }>
      candidateAccounts?: Array<{ id: string; name: string; platformName: string }>
      attemptsXiaohongshuAsDisplayName?: boolean
      autoSync?: { isRunning?: boolean }
      orphanTasks?: Array<{ skipped: boolean }>
    }
  }>('/api/board/sync-debug')

  const qb = data.qualityBadCase
  if (!qb) {
    logSkip('sync:quality-badcase-debug', 'sync-debug 未返回 qualityBadCase 段')
    return
  }

  const enabledWithCookie =
    qb.enabledLiveAccounts?.filter((a) => a.enabled && a.hasCookie !== false) ?? []
  const candidates = qb.candidateAccounts ?? []

  if (candidates.length === enabledWithCookie.length) {
    logPass(
      'sync:quality-candidates',
      `OK 品退候选账号数=${candidates.length} 与 enabled+Cookie 直播号一致`,
    )
  } else {
    logFail({
      name: 'sync:quality-candidates',
      message: '品退候选账号应等于 enabled 且有 Cookie 的直播号',
      expected: enabledWithCookie.length,
      actual: candidates.length,
      url,
    })
  }

  const hasXhsDisplayName = candidates.some((a) => a.name === 'xiaohongshu')
  if (hasXhsDisplayName || qb.attemptsXiaohongshuAsDisplayName) {
    logFail({
      name: 'sync:quality-no-xhs-display',
      message: '当前无 xiaohongshu 直播号时不应以 account=xiaohongshu 同步',
      url,
      fields: { candidates },
    })
  } else {
    logPass('sync:quality-no-xhs-display', 'OK 品退同步不使用 xiaohongshu 作为显示账号名')
  }

  const orphanRunning = (qb.orphanTasks ?? []).some((t) => !t.skipped)
  if (orphanRunning) {
    logFail({
      name: 'sync:quality-orphan-skipped',
      message: 'orphan 品退任务应全部 skipped',
      url,
    })
  } else {
    logPass('sync:quality-orphan-skipped', 'OK orphan 品退任务已跳过')
  }

  if (qb.autoSync?.isRunning) {
    logSkip('sync:quality-running', '品退 autoSync 正在 running')
  } else {
    logPass('sync:quality-not-running', 'OK 无 orphan quality running')
  }
  } catch (err) {
    logSkip(
      'sync:quality-badcase-debug',
      err instanceof Error ? err.message : 'sync-debug 不可用',
    )
  }
}

async function main(): Promise<void> {
  resetResults()
  console.log('[test:sync] 开始经营同步状态验收\n')

  const health = await getHealth()
  if (!health.ok) {
    logFail({
      name: 'health',
      message: '服务未启动',
      hint: 'npm run dev',
    })
    process.exit(1)
  }

  await checkStaleRulesUnit()
  await checkSyncMetaConsistency()
  await checkLocalDataWhenReady()
  await checkQualityBadCaseSyncDebug()

  console.log('')
  if (hasFailures()) {
    console.error('[test:sync] FAIL')
    process.exit(1)
  }
  console.log('[test:sync] PASS')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
