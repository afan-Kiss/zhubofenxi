import { prisma } from '../lib/prisma'
import { getBusinessSyncStatus } from './business-sync-scheduler.service'
import {
  BUSINESS_SYNC_HEARTBEAT_STALE_MS,
  BUSINESS_SYNC_STALE_RUNNING_MS,
  isBusinessSyncJobStale,
} from './business-sync-stale-cleanup.service'
import { getSyncStatusPayload, toView } from './xhs-api-sync/xhs-sync-job.service'
import { buildQualityBadCaseSyncDebugPayload } from './quality-badcase-sync-debug.service'

export async function buildBoardSyncDebugForApi() {
  await import('./business-sync-stale-cleanup.service').then((m) =>
    m.clearStaleBusinessSyncJobs(),
  )

  const [businessStatus, syncPayload, runningRow, recentJobs, qualityBadCase] = await Promise.all([
    getBusinessSyncStatus(),
    getSyncStatusPayload(),
    prisma.xhsSyncJob.findFirst({
      where: { status: 'running', preset: 'daily_strategy' },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.xhsSyncJob.findMany({
      where: { preset: 'daily_strategy' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    buildQualityBadCaseSyncDebugPayload(),
  ])

  const job = syncPayload.job
  const now = Date.now()
  const runningSeconds =
    job?.startedAt != null
      ? Math.max(0, Math.floor((now - Date.parse(job.startedAt)) / 1000))
      : runningRow?.startedAt
        ? Math.max(0, Math.floor((now - runningRow.startedAt.getTime()) / 1000))
        : null

  const staleCheck = runningRow ? isBusinessSyncJobStale(runningRow) : { stale: false }

  const heartbeatAgeMs = runningRow
    ? now - (runningRow.updatedAt ?? runningRow.startedAt ?? new Date(0)).getTime()
    : null

  return {
    message: job?.isRunning || runningRow ? undefined : '当前没有经营同步运行中',
    businessSync: {
      status: businessStatus.businessSync.status,
      currentTask: businessStatus.businessSync.currentTask,
      lastSuccessAt: businessStatus.businessSync.lastSuccessAt,
      lastError: businessStatus.businessSync.lastError,
      lastRunAt: businessStatus.businessSync.lastRunAt,
    },
    activeJob: job
      ? {
          syncJobId: job.syncJobId,
          status: job.status,
          currentStep: job.currentStep,
          currentStepLabel: job.currentStepLabel,
          progress: job.progress,
          currentPage: job.currentPage,
          totalPage: job.totalPage,
          orderCount: job.orderCount,
          currentApiLabel: job.currentApiLabel,
          startedAt: job.startedAt,
          updatedAt: job.updatedAt,
          runningSeconds,
          isStaleRunning: staleCheck.stale,
          lastError: job.errorMessage,
        }
      : null,
    thresholds: {
      staleRunningMs: BUSINESS_SYNC_STALE_RUNNING_MS,
      heartbeatStaleMs: BUSINESS_SYNC_HEARTBEAT_STALE_MS,
      heartbeatAgeMs,
    },
    recentJobs: recentJobs.map((r) => {
      const v = toView(r)
      return {
        syncJobId: v.syncJobId,
        status: v.status,
        currentStep: v.currentStep,
        progress: v.progress,
        orderCount: v.orderCount,
        startedAt: v.startedAt,
        finishedAt: v.finishedAt,
        errorMessage: v.errorMessage,
      }
    }),
    qualityBadCase,
  }
}
