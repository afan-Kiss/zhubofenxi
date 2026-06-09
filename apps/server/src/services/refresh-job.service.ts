import { prisma } from '../lib/prisma'
import {
  REFRESH_STEP_LABELS,
  REFRESH_STEP_PROGRESS,
  RUNNING_JOB_TIMEOUT_MS,
  type RefreshJobStatus,
  type RefreshJobType,
  type RefreshStep,
} from '../types/refresh-job'
import type { DateRangePreset } from '../utils/date-range'
import { resolveDateRange } from '../utils/date-range'
import { runXhsSyncJob } from './xhs-api-sync/xhs-sync-job.service'
import { hasAnyEnabledApi } from './xhs-api-sync/xhs-api-registry'
import { writeOperationLog } from './audit.service'
import type { AuditAction } from '../types/audit'
import { findUserById } from './user.service'
import { getAutoRefreshSettings } from './system-setting.service'

export interface RefreshJobView {
  refreshJobId: string
  type: RefreshJobType
  status: RefreshJobStatus
  preset: string
  startDate: string
  endDate: string
  progress: number
  currentStep: RefreshStep
  currentStepLabel: string
  trustStatus: string | null
  errorMessage: string | null
  startedBy: string | null
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  createdAt: string
  isRunning: boolean
}

function toJobView(row: {
  id: string
  type: string
  status: string
  preset: string
  startDate: string
  endDate: string
  progress: number
  currentStep: string
  currentStepLabel: string
  trustStatus: string | null
  errorMessage: string | null
  startedBy: string | null
  startedAt: Date | null
  finishedAt: Date | null
  durationMs: number | null
  createdAt: Date
}): RefreshJobView {
  return {
    refreshJobId: row.id,
    type: row.type as RefreshJobType,
    status: row.status as RefreshJobStatus,
    preset: row.preset,
    startDate: row.startDate,
    endDate: row.endDate,
    progress: row.progress,
    currentStep: row.currentStep as RefreshStep,
    currentStepLabel: row.currentStepLabel,
    trustStatus: row.trustStatus,
    errorMessage: row.errorMessage,
    startedBy: row.startedBy,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
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

export async function failStaleRunningJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - RUNNING_JOB_TIMEOUT_MS)
  const stale = await prisma.refreshJob.findMany({
    where: { status: 'running', startedAt: { lt: cutoff } },
  })
  for (const job of stale) {
    await prisma.refreshJob.update({
      where: { id: job.id },
      data: {
        status: 'failed_timeout',
        currentStep: 'failed',
        currentStepLabel: REFRESH_STEP_LABELS.failed,
        errorMessage: '刷新任务超时（超过 30 分钟），已自动终止',
        finishedAt: new Date(),
        durationMs: job.startedAt
          ? Date.now() - job.startedAt.getTime()
          : null,
      },
    })
  }
  return stale.length
}

export async function getRunningRefreshJob(): Promise<RefreshJobView | null> {
  await failStaleRunningJobs()
  const row = await prisma.refreshJob.findFirst({
    where: { status: 'running' },
    orderBy: { startedAt: 'desc' },
  })
  return row ? toJobView(row) : null
}

export async function getLatestRefreshJob(): Promise<RefreshJobView | null> {
  const row = await prisma.refreshJob.findFirst({
    orderBy: { createdAt: 'desc' },
  })
  return row ? toJobView(row) : null
}

const PROGRESS_MILESTONES = [5, 20, 35, 50, 65, 75, 85, 95, 100]

async function updateJobProgress(
  jobId: string,
  step: RefreshStep,
  progress?: number,
  extra?: { errorMessage?: string; audit?: { userId?: string; requestId?: string } },
): Promise<void> {
  const p = progress ?? REFRESH_STEP_PROGRESS[step] ?? 0
  const prev = await prisma.refreshJob.findUnique({
    where: { id: jobId },
    select: { progress: true },
  })
  await prisma.refreshJob.update({
    where: { id: jobId },
    data: {
      currentStep: step,
      currentStepLabel: REFRESH_STEP_LABELS[step],
      progress: p,
      ...extra,
    },
  })
  const crossedMilestone =
    prev != null &&
    PROGRESS_MILESTONES.some((m) => prev.progress < m && p >= m)
  if (crossedMilestone && extra?.audit?.userId) {
    await logRefreshAction(
      'refresh_progress_update',
      `刷新进度 ${p}%：${REFRESH_STEP_LABELS[step]}`,
      jobId,
      { progress: p, currentStep: step },
      extra.audit.userId,
      { requestId: extra.audit.requestId },
    )
  }
}

async function logRefreshAction(
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
    meta: { refreshJobId: jobId, ...meta },
  })
}

/**
 * @deprecated Excel 下载主流程已废弃，委托 API 同步任务
 */
export async function executeRefreshJob(
  jobId: string,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<void> {
  const job = await prisma.refreshJob.findUnique({ where: { id: jobId } })
  if (!job || job.status !== 'pending') return

  await prisma.refreshJob.update({
    where: { id: jobId },
    data: {
      status: 'skipped',
      currentStep: 'completed',
      currentStepLabel: '已切换为 API 同步',
      errorMessage: '请使用「刷新所有总数据」触发 API 同步',
      finishedAt: new Date(),
    },
  })

  if (!hasAnyEnabledApi()) {
    return
  }

  await runXhsSyncJob({
    type: job.type === 'scheduled' ? 'scheduled' : 'manual',
    preset: job.preset as DateRangePreset,
    startDate: job.startDate,
    endDate: job.endDate,
    triggeredBy: job.startedBy,
    audit,
  })
}

export async function startRefreshJob(params: {
  type: RefreshJobType
  preset: DateRangePreset
  startDate?: string
  endDate?: string
  startedBy?: string | null
  audit?: { requestId?: string; ip?: string; userAgent?: string }
}): Promise<{ job: RefreshJobView; alreadyRunning: boolean }> {
  await failStaleRunningJobs()

  const running = await prisma.refreshJob.findFirst({
    where: { status: 'running' },
  })
  if (running) {
    return { job: toJobView(running), alreadyRunning: true }
  }

  const range = resolveDateRange(
    params.preset,
    params.startDate,
    params.endDate,
  )

  const job = await prisma.refreshJob.create({
    data: {
      type: params.type,
      status: 'pending',
      preset: params.preset,
      startDate: range.startDate,
      endDate: range.endDate,
      progress: 0,
      currentStep: 'idle',
      currentStepLabel: REFRESH_STEP_LABELS.idle,
      startedBy: params.startedBy ?? null,
    },
  })

  const view = toJobView(job)

  setImmediate(() => {
    void executeRefreshJob(job.id, params.audit)
  })

  return { job: view, alreadyRunning: false }
}

/** @deprecated 请使用 startScheduledApiSync */
export async function startScheduledRefresh(): Promise<RefreshJobView | null> {
  const { startScheduledApiSync, getLatestXhsSyncJob } = await import(
    './xhs-api-sync/xhs-sync-job.service'
  )
  await startScheduledApiSync()
  const sync = await getLatestXhsSyncJob()
  if (!sync) return null
  return {
    refreshJobId: sync.syncJobId,
    type: sync.type === 'scheduled' ? 'scheduled' : 'manual',
    status: sync.status as RefreshJobStatus,
    preset: sync.preset,
    startDate: sync.startDate,
    endDate: sync.endDate,
    progress: sync.progress,
    currentStep: sync.currentStep as RefreshStep,
    currentStepLabel: sync.currentStepLabel,
    trustStatus: null,
    errorMessage: sync.errorMessage,
    startedBy: sync.startedBy,
    startedAt: sync.startedAt,
    finishedAt: sync.finishedAt,
    durationMs: sync.durationMs,
    createdAt: sync.createdAt,
    isRunning: sync.isRunning,
  }
}

export async function listRefreshHistory(limit = 30): Promise<RefreshJobView[]> {
  const rows = await prisma.refreshJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return rows.map(toJobView)
}

export async function getRefreshJobById(id: string): Promise<RefreshJobView | null> {
  const row = await prisma.refreshJob.findUnique({ where: { id } })
  return row ? toJobView(row) : null
}

export function buildRefreshNotice(params: {
  snapshotCreatedAt: string | null
  latestJob: RefreshJobView | null
  missedRefresh: MissedRefreshInfo
}): string | null {
  if (params.missedRefresh.missed && params.missedRefresh.message) {
    return params.missedRefresh.message
  }
  const job = params.latestJob
  if (!job) return null
  if (job.status === 'failed' || job.status === 'failed_timeout') {
    return job.type === 'scheduled'
      ? '今日自动刷新失败，请管理员检查下载记录和 Cookie'
      : '最近一次刷新失败，当前展示的是上一次成功数据'
  }
  if (job.status === 'skipped') {
    return '今日凌晨自动刷新未执行，当前展示最近一次数据'
  }
  if (job.status === 'success' || job.status === 'partial_success') {
    return null
  }
  if (job.isRunning) {
    return '数据正在刷新中，当前展示的是刷新前的快照'
  }
  return null
}

export interface MissedRefreshInfo {
  missed: boolean
  message: string | null
  skippedJobId: string | null
}

function getShanghaiDateParts(): { y: number; m: number; d: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date())
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day'), hour: get('hour'), minute: get('minute') }
}

export function getTodayShanghaiKey(): string {
  const { y, m, d } = getShanghaiDateParts()
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export async function recordMissedScheduledRefreshIfNeeded(): Promise<MissedRefreshInfo> {
  const settings = await getAutoRefreshSettings()
  if (!settings.autoRefreshEnabled) {
    return { missed: false, message: null, skippedJobId: null }
  }

  const { hour, minute } = getShanghaiDateParts()
  const [sh, sm] = settings.autoRefreshTime.split(':').map(Number)
  const pastScheduled = hour > sh || (hour === sh && minute >= sm)
  if (!pastScheduled) {
    return { missed: false, message: null, skippedJobId: null }
  }

  const todayKey = getTodayShanghaiKey()
  const todayStart = new Date(`${todayKey}T00:00:00+08:00`)

  const existing = await prisma.refreshJob.findFirst({
    where: {
      type: 'scheduled',
      createdAt: { gte: todayStart },
    },
  })
  if (existing) {
    if (existing.status === 'skipped') {
      return {
        missed: true,
        message: '今日凌晨自动刷新未执行，当前展示最近一次数据',
        skippedJobId: existing.id,
      }
    }
    return { missed: false, message: null, skippedJobId: null }
  }

  const range = resolveDateRange(settings.autoRefreshPreset)
  const skipped = await prisma.refreshJob.create({
    data: {
      type: 'scheduled',
      status: 'skipped',
      preset: settings.autoRefreshPreset,
      startDate: range.startDate,
      endDate: range.endDate,
      progress: 0,
      currentStep: 'idle',
      currentStepLabel: '已错过自动刷新',
      errorMessage: '服务在计划时间未运行，已错过今日自动刷新',
      finishedAt: new Date(),
    },
  })

  await writeOperationLog({
    action: 'scheduled_refresh_skipped',
    module: 'dashboard',
    description: '错过今日凌晨自动刷新',
    meta: {
      refreshJobId: skipped.id,
      date: todayKey,
      autoRefreshTime: settings.autoRefreshTime,
    },
  })

  return {
    missed: true,
    message: '今日凌晨自动刷新未执行，当前展示最近一次数据',
    skippedJobId: skipped.id,
  }
}

export async function getMissedRefreshInfo(): Promise<MissedRefreshInfo> {
  const settings = await getAutoRefreshSettings()
  if (!settings.autoRefreshEnabled) {
    return { missed: false, message: null, skippedJobId: null }
  }

  const todayKey = getTodayShanghaiKey()
  const todayStart = new Date(`${todayKey}T00:00:00+08:00`)
  const skipped = await prisma.refreshJob.findFirst({
    where: {
      type: 'scheduled',
      status: 'skipped',
      createdAt: { gte: todayStart },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!skipped) return { missed: false, message: null, skippedJobId: null }
  return {
    missed: true,
    message: '今日凌晨自动刷新未执行，当前展示最近一次数据',
    skippedJobId: skipped.id,
  }
}

export async function getRefreshStatusPayload(): Promise<{
  running: RefreshJobView | null
  latest: RefreshJobView | null
  missedRefresh: MissedRefreshInfo
}> {
  const running = await getRunningRefreshJob()
  const latest = await getLatestRefreshJob()
  const missedRefresh = await getMissedRefreshInfo()
  return { running, latest, missedRefresh }
}
