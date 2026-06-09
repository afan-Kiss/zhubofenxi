import { prisma } from '../lib/prisma'
import { logInfo } from '../utils/server-log'
import { XHS_SYNC_STEP_LABELS } from './xhs-api-sync/xhs-api-types'

/** running 超过 10 分钟视为 stale */
export const BUSINESS_SYNC_STALE_RUNNING_MS = 10 * 60 * 1000

/** updatedAt 超过 3 分钟无变化视为 stale（含订单列表阶段） */
export const BUSINESS_SYNC_HEARTBEAT_STALE_MS = 3 * 60 * 1000

/** 经营 BI 同步不应再停留在结算步骤；超过此时长仍卡在结算步骤则释放 */
export const SETTLEMENT_STUCK_STEP_MS = 5 * 60 * 1000

export const BUSINESS_SYNC_STALE_ERROR_MSG = '经营同步任务超时未完成，已自动释放'

export const BUSINESS_SYNC_HEARTBEAT_STALE_MSG =
  '经营同步任务长时间无进展，已自动释放（可稍后重试）'

export const BUSINESS_SYNC_SETTLEMENT_SKIPPED_MSG =
  '经营BI同步不再等待待结算/已结算账单，任务已自动释放（settlementSkippedForBusinessBI）'

const SETTLEMENT_STUCK_STEPS = new Set([
  'syncing_pending_settlement',
  'syncing_settled_settlement',
  'syncing_settlement_detail',
])

const CLEANUP_COOLDOWN_MS = 30 * 1000

let lastCleanupAt = 0

function reasonLabel(startedBy: string | null | undefined): string {
  if (!startedBy?.startsWith('business-sync:')) return startedBy ?? '—'
  return startedBy.replace('business-sync:', '')
}

function jobStepReferenceTime(job: { startedAt: Date | null; updatedAt: Date }): Date {
  return job.updatedAt ?? job.startedAt ?? new Date(0)
}

function jobRunningReferenceTime(job: { startedAt: Date | null; updatedAt: Date }): Date {
  return job.startedAt ?? job.updatedAt
}

export function isBusinessSyncJobStale(job: {
  currentStep: string
  startedAt: Date | null
  updatedAt: Date
  status: string
}): { stale: boolean; reason?: string } {
  if (job.status !== 'running') return { stale: false }
  const now = Date.now()
  const startedRef = jobRunningReferenceTime(job)
  if (now - startedRef.getTime() >= BUSINESS_SYNC_STALE_RUNNING_MS) {
    return { stale: true, reason: 'running 超过 10 分钟' }
  }
  const heartbeatRef = jobStepReferenceTime(job)
  if (now - heartbeatRef.getTime() >= BUSINESS_SYNC_HEARTBEAT_STALE_MS) {
    return {
      stale: true,
      reason:
        job.currentStep === 'syncing_order_list'
          ? '订单列表阶段 3 分钟无 updatedAt 变化'
          : 'updatedAt 超过 3 分钟无变化',
    }
  }
  return { stale: false }
}

async function releaseBusinessSyncJob(
  job: { id: string; startedAt: Date | null; updatedAt: Date },
  status: 'failed' | 'skipped',
  errorMessage: string,
  ref: Date,
): Promise<void> {
  const finishedAt = new Date()
  await prisma.xhsSyncJob.update({
    where: { id: job.id },
    data: {
      status,
      currentStep: status === 'skipped' ? 'completed' : 'failed',
      currentStepLabel:
        status === 'skipped' ? XHS_SYNC_STEP_LABELS.completed : XHS_SYNC_STEP_LABELS.failed,
      errorMessage,
      finishedAt,
      durationMs: finishedAt.getTime() - ref.getTime(),
    },
  })
  console.log(`[business-sync] 任务已标记 ${status}：jobId=${job.id}`)
  try {
    const { resetBusinessSyncMemoryLock } = await import('./business-sync-scheduler.service')
    resetBusinessSyncMemoryLock()
  } catch {
    /* ignore circular import edge */
  }
}

/**
 * 释放超时的 daily_strategy running 任务。
 * 不触碰 buyer_ranking_fill 等非经营同步任务。
 */
export async function clearStaleBusinessSyncJobs(force = false): Promise<number> {
  const now = Date.now()
  if (!force && now - lastCleanupAt < CLEANUP_COOLDOWN_MS) {
    return 0
  }
  lastCleanupAt = now

  logInfo('经营同步', '检查是否有超时未完成的同步任务')

  const candidates = await prisma.xhsSyncJob.findMany({
    where: {
      status: 'running',
      preset: 'daily_strategy',
    },
    orderBy: { startedAt: 'asc' },
  })

  if (candidates.length === 0) {
    return 0
  }

  let released = 0

  for (const job of candidates) {
    if (SETTLEMENT_STUCK_STEPS.has(job.currentStep)) {
      const ref = jobStepReferenceTime(job)
      if (now - ref.getTime() < SETTLEMENT_STUCK_STEP_MS) continue
      console.log(
        `[business-sync] 发现卡在结算步骤的经营同步任务，自动释放：jobId=${job.id} step=${job.currentStep} updatedAt=${ref.toISOString()}`,
      )
      await releaseBusinessSyncJob(job, 'skipped', BUSINESS_SYNC_SETTLEMENT_SKIPPED_MSG, ref)
      released++
      continue
    }

    const staleCheck = isBusinessSyncJobStale(job)
    if (!staleCheck.stale) continue

    const ref = jobStepReferenceTime(job)
    const msg =
      staleCheck.reason?.includes('订单列表') || staleCheck.reason?.includes('无变化')
        ? BUSINESS_SYNC_HEARTBEAT_STALE_MSG
        : BUSINESS_SYNC_STALE_ERROR_MSG

    console.log(
      `[business-sync] 发现 stale running 经营同步任务，自动释放：jobId=${job.id} reason=${reasonLabel(job.startedBy)} ${staleCheck.reason} updatedAt=${ref.toISOString()}`,
    )
    await releaseBusinessSyncJob(job, 'failed', msg, ref)
    released++
  }

  if (released === 0) {
    console.log('[business-sync] 未发现需释放的超时 running 经营同步任务')
  }

  return released
}
