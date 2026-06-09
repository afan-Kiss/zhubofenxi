import { prisma } from '../../lib/prisma'
import type { DateRangePreset, DateRangeResolved } from '../../utils/date-range'
import { resolveDateRange } from '../../utils/date-range'
import { getDecryptedCookie } from '../credential.service'
import { getXhsSignStatus } from '../xhs-sign-status.service'
import { writeOperationLog } from '../audit.service'
import type { AuditAction } from '../../types/audit'
import { findUserById } from '../user.service'
import { runAnalysisPipelineFromXhsRaw } from './xhs-analysis-from-raw.service'
import { hasAnyEnabledApi } from './xhs-api-registry'
import { syncOrderList } from './xhs-order-sync.service'
import { syncLiveSessionList } from './xhs-live-sync.service'
import {
  syncPendingSettlementList,
  syncSettledSettlementList,
} from './xhs-settlement-sync.service'
import { getApiSyncSettings } from '../system-setting.service'
import {
  XHS_API_NOT_CONFIGURED_MSG,
  XHS_SYNC_STEP_LABELS,
  type XhsSyncJobStatus,
  type XhsSyncJobType,
  type XhsSyncStep,
} from './xhs-api-types'
import type { XhsRequestAuditContext } from '../xhs-http.service'
import {
  createSyncProgressReporter,
  presetToRangeLabel,
} from './xhs-sync-progress.service'
import {
  buildEmptyRangeSummary,
  buildSyncValidationSummary,
  formatSyncFailureMessage,
  type SyncValidationSummary,
} from './sync-validation-summary.service'

const RUNNING_JOB_TIMEOUT_MS = 30 * 60 * 1000

export interface XhsSyncJobView {
  syncJobId: string
  type: XhsSyncJobType
  status: XhsSyncJobStatus
  preset: string
  startDate: string
  endDate: string
  progress: number
  currentStep: XhsSyncStep
  currentStepLabel: string
  currentPage: number
  totalPage: number | null
  currentApiKey: string | null
  currentApiLabel: string | null
  rangeLabel: string | null
  totalRequestCount: number
  successRequestCount: number
  failedRequestCount: number
  orderCount: number
  liveSessionCount: number
  pendingCount: number
  settledCount: number
  errorMessage: string | null
  startedBy: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  createdAt: string
  updatedAt: string
  isRunning: boolean
  empty?: boolean
  outcome?: SyncValidationSummary['outcome']
  trustStatus?: string | null
  validationSummary?: SyncValidationSummary | null
}

export function toView(row: {
  id: string
  type: string
  status: string
  preset: string
  startDate: string
  endDate: string
  progress: number
  currentStep: string
  currentStepLabel: string
  currentPage: number
  totalPage: number | null
  currentApiKey: string | null
  currentApiLabel: string | null
  rangeLabel: string | null
  totalRequestCount: number
  successRequestCount: number
  failedRequestCount: number
  orderCount: number
  liveSessionCount: number
  pendingCount: number
  settledCount: number
  errorMessage: string | null
  startedBy: string | null
  startedAt: Date | null
  finishedAt: Date | null
  durationMs: number | null
  createdAt: Date
  updatedAt: Date
}): XhsSyncJobView {
  return {
    syncJobId: row.id,
    type: row.type as XhsSyncJobType,
    status: row.status as XhsSyncJobStatus,
    preset: row.preset,
    startDate: row.startDate,
    endDate: row.endDate,
    progress: row.progress,
    currentStep: row.currentStep as XhsSyncStep,
    currentStepLabel: row.currentStepLabel,
    currentPage: row.currentPage,
    totalPage: row.totalPage,
    currentApiKey: row.currentApiKey,
    currentApiLabel: row.currentApiLabel,
    rangeLabel: row.rangeLabel,
    totalRequestCount: row.totalRequestCount,
    successRequestCount: row.successRequestCount,
    failedRequestCount: row.failedRequestCount,
    orderCount: row.orderCount,
    liveSessionCount: row.liveSessionCount,
    pendingCount: row.pendingCount,
    settledCount: row.settledCount,
    errorMessage: row.errorMessage,
    startedBy: row.startedBy,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isRunning: row.status === 'running',
  }
}

async function getSystemUserId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { role: 'super_admin', enabled: true },
    orderBy: { createdAt: 'asc' },
  })
  return admin?.id ?? null
}

async function updateStep(
  jobId: string,
  step: XhsSyncStep,
  progress: number,
  extra?: Partial<{
    errorMessage: string
    totalRequestCount: number
    successRequestCount: number
    failedRequestCount: number
    orderCount: number
    liveSessionCount: number
    pendingCount: number
    settledCount: number
  }>,
): Promise<void> {
  await prisma.xhsSyncJob.update({
    where: { id: jobId },
    data: {
      currentStep: step,
      currentStepLabel: XHS_SYNC_STEP_LABELS[step],
      progress,
      ...extra,
    },
  })
}

async function logSync(
  action: AuditAction,
  description: string,
  jobId: string,
  meta: Record<string, unknown>,
  userId?: string | null,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<void> {
  let username: string | null = null
  let role: string | null = null
  if (userId) {
    const u = await findUserById(userId)
    username = u?.username ?? null
    role = u?.role ?? null
  }
  await writeOperationLog({
    userId: userId ?? null,
    username,
    role,
    action,
    module: 'dashboard',
    description,
    requestId: audit?.requestId ?? null,
    ip: audit?.ip ?? null,
    userAgent: audit?.userAgent ?? null,
    meta: { syncJobId: jobId, ...meta },
  })
}

export async function failStaleRunningSyncJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - RUNNING_JOB_TIMEOUT_MS)
  const stale = await prisma.xhsSyncJob.findMany({
    where: { status: 'running', startedAt: { lt: cutoff } },
  })
  for (const job of stale) {
    await prisma.xhsSyncJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        currentStep: 'failed',
        currentStepLabel: XHS_SYNC_STEP_LABELS.failed,
        errorMessage: '同步任务超时（超过 30 分钟）',
        finishedAt: new Date(),
        durationMs: job.startedAt ? Date.now() - job.startedAt.getTime() : null,
      },
    })
  }
  return stale.length
}

export async function getRunningXhsSyncJob(): Promise<XhsSyncJobView | null> {
  await failStaleRunningSyncJobs()
  const row = await prisma.xhsSyncJob.findFirst({
    where: { status: 'running' },
    orderBy: { startedAt: 'desc' },
  })
  return row ? toView(row) : null
}

export async function getLatestXhsSyncJob(): Promise<XhsSyncJobView | null> {
  const row = await prisma.xhsSyncJob.findFirst({ orderBy: { createdAt: 'desc' } })
  return row ? toView(row) : null
}

export async function getXhsSyncJobById(id: string): Promise<XhsSyncJobView | null> {
  const row = await prisma.xhsSyncJob.findUnique({ where: { id } })
  return row ? toView(row) : null
}

export async function listXhsSyncHistory(page = 1, pageSize = 20) {
  const safePage = Math.max(1, Math.floor(page))
  const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
  const [total, rows] = await Promise.all([
    prisma.xhsSyncJob.count(),
    prisma.xhsSyncJob.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * safeSize,
      take: safeSize,
    }),
  ])
  const items = rows.map(toView)
  const totalPages = Math.max(1, Math.ceil(total / safeSize))
  return {
    items,
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages,
    summary: {},
  }
}

function auditContext(
  userId: string,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): XhsRequestAuditContext {
  return {
    userId,
    requestId: audit?.requestId ?? null,
    ip: audit?.ip ?? null,
    userAgent: audit?.userAgent ?? null,
    module: 'xhs_export',
  }
}

export async function executeXhsSyncJob(
  jobId: string,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<void> {
  const job = await prisma.xhsSyncJob.findUnique({ where: { id: jobId } })
  if (!job || job.status !== 'pending') return

  const startedAt = new Date()
  const userId = job.startedBy ?? (await getSystemUserId())
  if (!userId) {
    await prisma.xhsSyncJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        currentStep: 'failed',
        currentStepLabel: XHS_SYNC_STEP_LABELS.failed,
        errorMessage: '无可用超级管理员执行同步',
        finishedAt: new Date(),
      },
    })
    return
  }

  const range = resolveDateRange(
    job.preset as DateRangePreset,
    job.startDate,
    job.endDate,
  )
  const rangeLabel = presetToRangeLabel(job.preset)
  const progress = createSyncProgressReporter(jobId, rangeLabel)

  await prisma.xhsSyncJob.update({
    where: { id: jobId },
    data: { rangeLabel },
  })

  const startAction =
    job.type === 'scheduled' ? 'api_sync_start' : 'api_sync_start'

  await prisma.xhsSyncJob.update({
    where: { id: jobId },
    data: { status: 'running', startedAt },
  })

  await logSync(startAction, '开始 API 数据同步', jobId, {
    preset: job.preset,
    startDate: range.startDate,
    endDate: range.endDate,
  }, userId, audit)

  const warnings: string[] = []
  let totalRequests = 0
  let successRequests = 0
  let failedRequests = 0

  const bumpRequests = (count: number, failed = 0) => {
    totalRequests += count
    successRequests += count - failed
    failedRequests += failed
  }

  try {
    await progress.setStep('idle', 2, '正在检查 Cookie 和签名')
    try {
      await getDecryptedCookie()
    } catch {
      throw new Error('尚未配置平台 Cookie，请先在系统设置保存')
    }

    const signStatus = await getXhsSignStatus()
    if (!signStatus.signerModuleOk) {
      warnings.push('签名模块未就绪，部分接口可能失败')
    }

    if (!hasAnyEnabledApi()) {
      const finishedAt = new Date()
      await prisma.xhsSyncJob.update({
        where: { id: jobId },
        data: {
          status: 'skipped',
          currentStep: 'completed',
          currentStepLabel: XHS_SYNC_STEP_LABELS.completed,
          errorMessage: XHS_API_NOT_CONFIGURED_MSG,
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          progress: 100,
        },
      })
      await logSync('api_sync_skipped', XHS_API_NOT_CONFIGURED_MSG, jobId, {}, userId, audit)
      return
    }

    const settings = await getApiSyncSettings()
    const ctx = auditContext(userId, audit)

    await progress.setStep('syncing_order_list', 10)
    const orderList = await syncOrderList({
      syncJobId: jobId,
      startDate: range.startDate,
      endDate: range.endDate,
      context: ctx,
      progress,
    })
    bumpRequests(orderList.requestCount)
    warnings.push(...orderList.warnings)
    await updateStep(jobId, 'syncing_order_list', 25, {
      orderCount: orderList.itemCount,
    })
    if (orderList.itemCount > 0) {
      await logSync('api_sync_order_list_success', '订单列表同步完成', jobId, {
        itemCount: orderList.itemCount,
      }, userId, audit)
    }

    // 详情接口已注册，主流程不拉取详情（syncOrderDetailMode 仅预留）
    void settings.syncOrderDetailEnabled

    await progress.setStep('syncing_live_list', 30)
    const liveList = await syncLiveSessionList({
      syncJobId: jobId,
      startDate: range.startDate,
      endDate: range.endDate,
      context: ctx,
      progress,
    })
    bumpRequests(liveList.requestCount)
    warnings.push(...liveList.warnings)
    await updateStep(jobId, 'syncing_live_list', 45, {
      liveSessionCount: liveList.itemCount,
    })
    if (liveList.itemCount > 0) {
      await logSync('api_sync_live_list_success', '直播场次同步完成', jobId, {
        itemCount: liveList.itemCount,
      }, userId, audit)
    }

    await progress.setStep('syncing_pending_settlement', 50)
    const pending = await syncPendingSettlementList({
      syncJobId: jobId,
      startDate: range.startDate,
      endDate: range.endDate,
      context: ctx,
      progress,
    })
    bumpRequests(pending.requestCount)
    warnings.push(...pending.warnings)
    await updateStep(jobId, 'syncing_pending_settlement', 60, {
      pendingCount: pending.itemCount,
    })
    if (pending.itemCount > 0) {
      await logSync('api_sync_pending_success', '待结算同步完成', jobId, {
        itemCount: pending.itemCount,
      }, userId, audit)
    }

    await progress.setStep('syncing_settled_settlement', 65)
    const settled = await syncSettledSettlementList({
      syncJobId: jobId,
      startDate: range.startDate,
      endDate: range.endDate,
      context: ctx,
      progress,
    })
    bumpRequests(settled.requestCount)
    warnings.push(...settled.warnings)
    await updateStep(jobId, 'syncing_settled_settlement', 75, {
      settledCount: settled.itemCount,
    })
    if (settled.itemCount > 0) {
      await logSync('api_sync_settled_success', '已结算同步完成', jobId, {
        itemCount: settled.itemCount,
      }, userId, audit)
    }

    await progress.setStep('syncing_quality_badcase', 78, '正在同步官方品质反馈')
    const qualityResult = await (
      await import('../quality-badcase-auto-sync.service')
    ).runOfficialQualityBadCaseSyncStep({ trigger: job.type === 'full_read' ? 'full_read' : job.type === 'scheduled' ? 'scheduled' : 'manual', failSoft: true })
    if (!qualityResult.ok && qualityResult.error) {
      warnings.push(`官方品质反馈：${qualityResult.error}`)
    }

    await prisma.xhsSyncJob.update({
      where: { id: jobId },
      data: {
        totalRequestCount: totalRequests,
        successRequestCount: successRequests,
        failedRequestCount: failedRequests,
        orderCount: orderList.itemCount,
        liveSessionCount: liveList.itemCount,
        pendingCount: pending.itemCount,
        settledCount: settled.itemCount,
      },
    })

    await progress.setStep('normalizing_data', 85, '正在标准化订单数据')
    await progress.setStep('analyzing_business', 90, '正在生成经营看板')

    const apiCounts = {
      order: orderList.itemCount,
      live: liveList.itemCount,
      pending: pending.itemCount,
      settled: settled.itemCount,
    }

    if (orderList.itemCount === 0 && failedRequests === 0) {
      const emptySummary = buildEmptyRangeSummary(rangeLabel, apiCounts)
      await logSync('api_sync_validation', '数据校验摘要', jobId, {
        validationSummary: emptySummary,
        trustStatus: 'empty',
      }, userId, audit)

      const finishedAt = new Date()
      await prisma.xhsSyncJob.update({
        where: { id: jobId },
        data: {
          status: 'success_empty',
          currentStep: 'completed',
          currentStepLabel: '当前范围暂无订单数据',
          errorMessage: '当前范围暂无订单数据',
          finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          progress: 100,
          totalRequestCount: totalRequests,
          successRequestCount: successRequests,
          failedRequestCount: failedRequests,
          orderCount: 0,
          liveSessionCount: liveList.itemCount,
          pendingCount: pending.itemCount,
          settledCount: settled.itemCount,
        },
      })
      await logSync('api_sync_success_empty', `同步完成，${rangeLabel}暂无订单数据`, jobId, {
        apiCounts,
        validationSummary: emptySummary,
      }, userId, audit)
      try {
        const { invalidateAndRebuildBusinessBoardCache } = await import(
          '../business-cache.service'
        )
        await invalidateAndRebuildBusinessBoardCache('API 同步无订单')
      } catch {
        /* ignore */
      }
      return
    }

    const pipeline = await runAnalysisPipelineFromXhsRaw(range, {
      userId,
      requestId: audit?.requestId,
      ip: audit?.ip,
      userAgent: audit?.userAgent,
    })

    const validationSummary = pipeline
      ? buildSyncValidationSummary({
          trustStatus: pipeline.trustStatus,
          validation: pipeline.validation,
          apiCounts,
          result: pipeline.result,
        })
      : buildEmptyRangeSummary(rangeLabel, apiCounts)

    await logSync('api_sync_validation', '数据校验摘要', jobId, {
      validationSummary,
      trustStatus: pipeline?.trustStatus ?? 'blocked',
    }, userId, audit)

    if (!pipeline || !pipeline.result) {
      const msg = formatSyncFailureMessage(validationSummary)
      throw new Error(msg)
    }

    if (
      pipeline.trustStatus !== 'official_ready' &&
      pipeline.trustStatus !== 'preview_only'
    ) {
      const msg = formatSyncFailureMessage(validationSummary)
      throw new Error(msg)
    }

    await progress.setStep('completed', 95, '数据已写入本地，看板请使用实时查询')

    if (job.type === 'full_read') {
      try {
        const { rebuildBuyerRankingCache } = await import('../buyer-ranking-cache.service')
        await progress.setStep('analyzing_business', 96, '正在重建买家排行缓存')
        await rebuildBuyerRankingCache('full_read')
      } catch (err) {
        warnings.push(
          `买家排行重建失败：${err instanceof Error ? err.message : '未知错误'}`,
        )
      }
    }

    const finishedAt = new Date()
    const finalStatus: XhsSyncJobStatus =
      pipeline.trustStatus === 'preview_only'
        ? 'partial_success'
        : warnings.length > 0
          ? 'partial_success'
          : 'success'

    await prisma.xhsSyncJob.update({
      where: { id: jobId },
      data: {
        status: finalStatus,
        currentStep: 'completed',
        currentStepLabel: XHS_SYNC_STEP_LABELS.completed,
        errorMessage:
          pipeline.trustStatus === 'preview_only'
            ? validationSummary.previewReasons.slice(0, 3).join('；') || '数据仅供预览'
            : warnings.length > 0
              ? warnings.join('；')
              : null,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        progress: 100,
        totalRequestCount: totalRequests,
        successRequestCount: successRequests,
        failedRequestCount: failedRequests,
        orderCount: orderList.itemCount,
        liveSessionCount: liveList.itemCount,
        pendingCount: pending.itemCount,
        settledCount: settled.itemCount,
      },
    })

    const successAction =
      finalStatus === 'partial_success' ? 'api_sync_partial_success' : 'api_sync_success'
    await logSync(successAction, 'API 同步完成', jobId, {
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      warnings,
    }, userId, audit)

    if (
      finalStatus === 'success' ||
      finalStatus === 'partial_success' ||
      orderList.itemCount > 0
    ) {
      try {
        const { invalidateAndRebuildBusinessBoardCache } = await import(
          '../business-cache.service'
        )
        await invalidateAndRebuildBusinessBoardCache('API 同步完成')
      } catch {
        /* 不阻断同步结果 */
      }
    }
  } catch (err) {
    const finishedAt = new Date()
    const message = err instanceof Error ? err.message : '同步失败'
    await prisma.xhsSyncJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        currentStep: 'failed',
        currentStepLabel: XHS_SYNC_STEP_LABELS.failed,
        errorMessage: message,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        totalRequestCount: totalRequests,
        successRequestCount: successRequests,
        failedRequestCount: failedRequests,
      },
    })
    await logSync('api_sync_failed', `同步失败：${message}`, jobId, {
      errorMessage: message,
    }, userId, audit)
    if (job.type === 'auto_when_empty') {
      const { markAutoSyncFailed } = await import('../auto-sync-guard.service')
      markAutoSyncFailed(job.preset, job.startDate, job.endDate)
    }
  } finally {
    if (job.type === 'scheduled') {
      const { onScheduledSyncJobFinished } = await import('../scheduled-sync-queue.service')
      void onScheduledSyncJobFinished()
    }
  }
}

export async function runXhsSyncJob(params: {
  type: XhsSyncJobType
  preset: DateRangePreset
  startDate?: string
  endDate?: string
  triggeredBy?: string | null
  audit?: { requestId?: string; ip?: string; userAgent?: string }
}): Promise<{ job: XhsSyncJobView; alreadyRunning: boolean }> {
  await failStaleRunningSyncJobs()

  const running = await prisma.xhsSyncJob.findFirst({ where: { status: 'running' } })
  if (running) {
    return { job: toView(running), alreadyRunning: true }
  }

  const range = resolveDateRange(params.preset, params.startDate, params.endDate)

  const job = await prisma.xhsSyncJob.create({
    data: {
      type: params.type,
      status: 'pending',
      preset: params.preset,
      startDate: range.startDate,
      endDate: range.endDate,
      progress: 0,
      currentStep: 'idle',
      currentStepLabel: XHS_SYNC_STEP_LABELS.idle,
      startedBy: params.triggeredBy ?? null,
    },
  })

  setImmediate(() => {
    void executeXhsSyncJob(job.id, params.audit)
  })

  return { job: toView(job), alreadyRunning: false }
}

export async function startScheduledApiSync(): Promise<XhsSyncJobView | null> {
  const { startScheduledApiSyncSequence } = await import('../scheduled-sync-queue.service')
  const settings = await getApiSyncSettings()
  if (!settings.apiSyncEnabled) return null

  const seq = await startScheduledApiSyncSequence()
  if (!seq.started) {
    const running = await prisma.xhsSyncJob.findFirst({ where: { status: 'running' } })
    if (running) {
      console.log(`[scheduler] 定时同步跳过：已有任务进行中 ${running.id}`)
      await writeOperationLog({
        action: 'scheduled_refresh_skipped',
        module: 'system',
        description: '定时同步跳过：已有同步任务进行中',
        meta: { syncJobId: running.id, reason: 'refresh_lock' },
      })
      return toView(running)
    }
    return null
  }

  const job = await getLatestXhsSyncJob()
  return job
}

async function loadValidationSummary(jobId: string): Promise<SyncValidationSummary | null> {
  const row = await prisma.operationLog.findFirst({
    where: {
      action: 'api_sync_validation',
      OR: [
        { metaJson: { contains: `"syncJobId":"${jobId}"` } },
        { metaJson: { contains: `"syncJobId": "${jobId}"` } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!row?.metaJson) return null
  try {
    const meta = JSON.parse(row.metaJson) as { validationSummary?: SyncValidationSummary }
    return meta.validationSummary ?? null
  } catch {
    return null
  }
}

function enrichJobView(
  view: XhsSyncJobView,
  summary: SyncValidationSummary | null,
): XhsSyncJobView {
  const empty = view.status === 'success_empty'
  return {
    ...view,
    empty,
    outcome: summary?.outcome ?? (empty ? 'success_empty' : view.status === 'partial_success' ? 'preview_only' : view.status === 'failed' ? 'failed' : 'success'),
    trustStatus: summary?.trustStatus ?? null,
    validationSummary: summary,
  }
}

export async function getSyncStatusPayload(): Promise<{
  running: boolean
  job: XhsSyncJobView | null
  settlementSkippedForBusinessBI: boolean
}> {
  const { clearStaleBusinessSyncJobs } = await import('../business-sync-stale-cleanup.service')
  await clearStaleBusinessSyncJobs()

  const runningJob = await getRunningXhsSyncJob()
  if (runningJob) {
    const summary = await loadValidationSummary(runningJob.syncJobId)
    return {
      running: true,
      job: enrichJobView(runningJob, summary),
      settlementSkippedForBusinessBI: true,
    }
  }
  const latest = await getLatestXhsSyncJob()
  if (!latest) {
    return { running: false, job: null, settlementSkippedForBusinessBI: true }
  }
  const summary = await loadValidationSummary(latest.syncJobId)
  return {
    running: false,
    job: enrichJobView(latest, summary),
    settlementSkippedForBusinessBI: true,
  }
}

export interface XhsSyncJobStepLog {
  action: string
  description: string
  success: boolean
  createdAt: string
  durationMs: number | null
  meta: Record<string, unknown> | null
}

export async function getXhsSyncJobDetail(id: string): Promise<{
  job: XhsSyncJobView
  steps: XhsSyncJobStepLog[]
} | null> {
  const job = await getXhsSyncJobById(id)
  if (!job) return null

  const summary = await loadValidationSummary(id)

  const rows = await prisma.operationLog.findMany({
    where: {
      OR: [
        { metaJson: { contains: `"syncJobId":"${id}"` } },
        { metaJson: { contains: `"syncJobId": "${id}"` } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  const steps: XhsSyncJobStepLog[] = rows
    .filter((r) => r.action.startsWith('api_sync') || r.action.startsWith('api_request'))
    .map((r) => ({
      action: r.action,
      description: r.description,
      success: !r.action.includes('failed'),
      createdAt: r.createdAt.toISOString(),
      durationMs: r.durationMs,
      meta: r.metaJson ? (JSON.parse(r.metaJson) as Record<string, unknown>) : null,
    }))

  return { job: enrichJobView(job, summary), steps }
}

export function mapSyncErrorForUser(errorMessage: string | null | undefined): string {
  if (!errorMessage) return '同步失败，请查看同步历史或重新刷新'
  const msg = errorMessage
  if (msg.includes('Cookie') || msg.includes('登录')) {
    return '小红书登录状态可能已失效，请重新复制 Cookie'
  }
  if (msg.includes('签名') || msg.includes('xhshow') || msg.includes('a1')) {
    return '小红书签名失败，请检查 Cookie、a1、access-token 和 xhshow'
  }
  if (msg.includes('尚未配置') || msg.includes('接口未配置')) {
    return '小红书接口尚未配置，请联系管理员'
  }
  if (msg.includes('频率') || msg.includes('rate') || msg.includes('429')) {
    return '请求频率受限，系统已暂停，请稍后重试'
  }
  if (msg.includes('没有数据') || msg.includes('无订单') || msg.includes('暂无订单')) {
    return '接口同步已完成，当前范围暂无订单数据'
  }
  return msg
}
