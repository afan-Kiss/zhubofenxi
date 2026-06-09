import { prisma } from '../lib/prisma'
import { writeOperationLog } from './audit.service'
import { resolveRollingDays, resolveDateRange, type DateRangeResolved } from '../utils/date-range'
import { runXhsSyncJob } from './xhs-api-sync/xhs-sync-job.service'
import { hasAnyEnabledApi } from './xhs-api-sync/xhs-api-registry'
import { XHS_API_NOT_CONFIGURED_MSG } from './xhs-api-sync/xhs-api-types'

export type FullReadScope = '30' | '90' | '180' | 'custom' | 'all'

const CLEAR_CONFIRM_PHRASE = '清空全部数据'

export function resolveFullReadRange(scope: FullReadScope, startDate?: string, endDate?: string): DateRangeResolved {
  switch (scope) {
    case '30':
      return resolveRollingDays(30)
    case '90':
      return resolveRollingDays(90)
    case '180':
      return resolveRollingDays(180)
    case 'all':
      return {
        startDate: '1970-01-01',
        endDate: '2099-12-31',
        startTimeMs: 0,
        endTimeMs: Number.MAX_SAFE_INTEGER,
      }
    case 'custom':
    default: {
      if (!startDate?.trim() || !endDate?.trim()) {
        throw new Error('自定义全量读取必须提供 startDate 与 endDate')
      }
      return resolveDateRange('custom', startDate.trim(), endDate.trim())
    }
  }
}

export async function clearAllBusinessData(params: {
  confirmPhrase: string
  userId: string
  username: string
  role: string
  audit?: { requestId?: string; ip?: string; userAgent?: string }
}): Promise<{ cleared: Record<string, number> }> {
  if (params.confirmPhrase.trim() !== CLEAR_CONFIRM_PHRASE) {
    throw new Error(`请输入「${CLEAR_CONFIRM_PHRASE}」以确认操作`)
  }

  const running = await prisma.xhsSyncJob.findFirst({ where: { status: 'running' } })
  if (running) {
    throw new Error('当前有数据读取任务进行中，请等待完成后再清空数据')
  }

  const cleared: Record<string, number> = {}

  await prisma.$transaction(async (tx) => {
    cleared.xhsRawOrderDetail = (await tx.xhsRawOrderDetail.deleteMany()).count
    cleared.xhsRawLiveSessionDetail = (await tx.xhsRawLiveSessionDetail.deleteMany()).count
    cleared.xhsRawOrder = (await tx.xhsRawOrder.deleteMany()).count
    cleared.xhsRawLiveSession = (await tx.xhsRawLiveSession.deleteMany()).count
    cleared.xhsRawPendingSettlement = (await tx.xhsRawPendingSettlement.deleteMany()).count
    cleared.xhsRawSettledSettlement = (await tx.xhsRawSettledSettlement.deleteMany()).count
    cleared.buyerRankingCache = (await tx.buyerRankingCache.deleteMany()).count
    cleared.refreshJob = (await tx.refreshJob.deleteMany()).count
    cleared.xhsSyncJob = (await tx.xhsSyncJob.deleteMany()).count
    cleared.orderTrackingPool = (await tx.orderTrackingPool.deleteMany()).count
    cleared.historicalAdjustment = (await tx.historicalAdjustment.deleteMany()).count
    cleared.monthlyDataStatus = (await tx.monthlyDataStatus.deleteMany()).count
    cleared.validationPackage = (await tx.validationPackage.deleteMany()).count
    cleared.reportExport = (await tx.reportExport.deleteMany()).count
    cleared.downloadTask = (await tx.downloadTask.deleteMany()).count
    cleared.downloadBatch = (await tx.downloadBatch.deleteMany()).count
  })

  await writeOperationLog({
    userId: params.userId,
    username: params.username,
    role: params.role,
    action: 'data_clear_all',
    module: 'system',
    description: `${params.username} 清空全部业务数据`,
    requestId: params.audit?.requestId ?? null,
    ip: params.audit?.ip ?? null,
    userAgent: params.audit?.userAgent ?? null,
    meta: { cleared },
  })

  return { cleared }
}

export async function startFullDataRead(params: {
  scope: FullReadScope
  startDate?: string
  endDate?: string
  triggeredBy: string
  audit?: { requestId?: string; ip?: string; userAgent?: string }
}): Promise<{ syncJobId: string; alreadyRunning: boolean; range: DateRangeResolved; message: string }> {
  if (!hasAnyEnabledApi()) {
    throw new Error(XHS_API_NOT_CONFIGURED_MSG)
  }

  const range = resolveFullReadRange(params.scope, params.startDate, params.endDate)
  const preset = params.scope === 'custom' ? 'custom' : params.scope === 'all' ? 'custom' : 'custom'

  const { job, alreadyRunning } = await runXhsSyncJob({
    type: 'full_read',
    preset,
    startDate: range.startDate,
    endDate: range.endDate,
    triggeredBy: params.triggeredBy,
    audit: params.audit,
  })

  return {
    syncJobId: job.syncJobId,
    alreadyRunning,
    range,
    message: alreadyRunning
      ? '已有数据读取任务进行中，请稍候…'
      : '全量读取任务已启动，完成后经营看板和买家排行将自动更新',
  }
}

export { CLEAR_CONFIRM_PHRASE }
