/**
 * 经营看板日期范围同步覆盖判断。
 * 禁止用「库内其他日期有订单」推断当前范围未同步。
 */
import { prisma } from '../lib/prisma'
import { clearStaleBusinessSyncJobs } from './business-sync-stale-cleanup.service'

const SUCCESS_STATUSES = ['success', 'partial_success', 'success_empty'] as const

export type BoardRangeCoverageStatus = 'covered' | 'not_covered' | 'syncing' | 'unknown'

export type BusinessRangeCoverageResult = {
  status: BoardRangeCoverageStatus
  coveredShopIds: string[]
  missingShopIds: string[]
  reason: string
  evidenceJobId: string | null
}

export function jobCoversBusinessRange(
  job: { startDate: string | null; endDate: string | null },
  startDate: string,
  endDate: string,
): boolean {
  if (!job.startDate || !job.endDate) return false
  return job.startDate <= startDate && job.endDate >= endDate
}

function jobOverlapsRange(
  job: { startDate: string | null; endDate: string | null },
  startDate: string,
  endDate: string,
): boolean {
  if (!job.startDate || !job.endDate) return false
  return job.startDate <= endDate && job.endDate >= startDate
}

/**
 * 解析指定业务日期范围是否已被经营同步覆盖。
 * 覆盖证据优先：成功任务的 startDate/endDate；进行中任务；启用店铺清单。
 */
export async function resolveBusinessRangeCoverage(params: {
  startDate: string
  endDate: string
  requiredShopIds?: string[]
}): Promise<BusinessRangeCoverageResult> {
  const { startDate, endDate } = params

  let requiredShopIds = params.requiredShopIds ?? []
  if (!requiredShopIds.length) {
    try {
      const { listEnabledLiveAccountsWithCookie } = await import('./live-account.service')
      const accounts = await listEnabledLiveAccountsWithCookie()
      requiredShopIds = accounts.map((a) => a.id)
    } catch {
      requiredShopIds = []
    }
  }

  await clearStaleBusinessSyncJobs().catch(() => undefined)

  const runningJob = await prisma.xhsSyncJob.findFirst({
    where: {
      status: 'running',
      OR: [{ preset: 'daily_strategy' }, { type: 'scheduled' }],
    },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startDate: true, endDate: true, status: true, preset: true },
  })

  if (runningJob && jobOverlapsRange(runningJob, startDate, endDate)) {
    return {
      status: 'syncing',
      coveredShopIds: [],
      missingShopIds: [...requiredShopIds],
      reason: `sync_job_${runningJob.status}_overlaps_range`,
      evidenceJobId: runningJob.id,
    }
  }

  const coveringSuccess = await prisma.xhsSyncJob.findFirst({
    where: {
      status: { in: [...SUCCESS_STATUSES] },
      startDate: { lte: startDate },
      endDate: { gte: endDate },
    },
    orderBy: { finishedAt: 'desc' },
    select: { id: true, startDate: true, endDate: true, finishedAt: true, preset: true },
  })

  if (coveringSuccess && jobCoversBusinessRange(coveringSuccess, startDate, endDate)) {
    return {
      status: 'covered',
      coveredShopIds: [...requiredShopIds],
      missingShopIds: [],
      reason: `success_job_covers_range:${coveringSuccess.id}`,
      evidenceJobId: coveringSuccess.id,
    }
  }

  const anySuccess = await prisma.xhsSyncJob.findFirst({
    where: {
      status: { in: [...SUCCESS_STATUSES] },
      OR: [{ preset: 'daily_strategy' }, { type: 'scheduled' }],
    },
    orderBy: { finishedAt: 'desc' },
    select: { id: true, startDate: true, endDate: true, finishedAt: true },
  })

  if (!anySuccess) {
    return {
      status: 'unknown',
      coveredShopIds: [],
      missingShopIds: [...requiredShopIds],
      reason: 'no_successful_sync_job',
      evidenceJobId: null,
    }
  }

  if (!jobCoversBusinessRange(anySuccess, startDate, endDate)) {
    return {
      status: 'not_covered',
      coveredShopIds: [],
      missingShopIds: [...requiredShopIds],
      reason: `last_success_job_outside_range:${anySuccess.startDate}~${anySuccess.endDate}`,
      evidenceJobId: anySuccess.id,
    }
  }

  return {
    status: 'unknown',
    coveredShopIds: [],
    missingShopIds: [...requiredShopIds],
    reason: 'coverage_inconclusive',
    evidenceJobId: anySuccess.id,
  }
}
