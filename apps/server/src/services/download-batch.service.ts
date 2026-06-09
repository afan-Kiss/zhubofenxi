import { prisma } from '../lib/prisma'
import { BATCH_DOWNLOAD_ORDER, type BatchStatus, stepToDisplayStatus } from '../types/download-batch'
import { DOWNLOAD_TYPE_LABELS, type DownloadType } from '../types/download'
import type { DateRangeResolved } from '../utils/date-range'
import { normalizeDownloadError } from '../utils/download-errors'
import { writeOperationLog } from './audit.service'
import { downloadByType, type DownloadTaskView } from './download.service'
import {
  getDownloadConfig,
  getEffectiveDownloadMode,
  migrateLegacyDownloadModes,
} from './downloadConfig.service'
import {
  createProgressContext,
  getFailedStepHint,
  updateDownloadTaskStep,
} from './download-task-progress.service'
import { findUserById } from './user.service'
import { toPipelineView, type DownloadPipelineView } from './download-pipeline-meta.service'

export interface BatchTaskView {
  id: string
  type: DownloadType
  typeLabel: string
  mode: string | null
  step: string | null
  stepLabel: string
  status: string
  taskId: string | null
  fileName: string | null
  fileSize: number | null
  filePath: string | null
  errorMessage: string | null
  failedStepHint: string | null
  durationMs: number | null
  startedAt: string | null
  finishedAt: string | null
  pipeline: DownloadPipelineView | null
}

export interface BatchDetailView {
  id: string
  status: BatchStatus
  startDate: string
  endDate: string
  durationMs: number | null
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  tasks: BatchTaskView[]
  summary: {
    total: number
    success: number
    failed: number
  }
}

function toBatchTaskView(row: {
  id: string
  type: string
  mode: string | null
  step: string | null
  xhsTaskId: string | null
  status: string
  fileName: string | null
  filePath: string | null
  fileSize: number | null
  errorMessage: string | null
  durationMs: number | null
  startedAt: Date | null
  finishedAt: Date | null
  pipelineMetaJson?: string | null
}): BatchTaskView {
  const type = row.type as DownloadType
  const failed = row.status === 'failed' || row.step === 'failed'
  return {
    id: row.id,
    type,
    typeLabel: DOWNLOAD_TYPE_LABELS[type] ?? row.type,
    mode: row.mode,
    step: row.step,
    stepLabel: stepToDisplayStatus(row.step),
    status: row.status,
    taskId: row.xhsTaskId,
    fileName: row.fileName,
    fileSize: row.fileSize,
    filePath: row.filePath,
    errorMessage: row.errorMessage,
    failedStepHint: failed ? getFailedStepHint(row.step) : null,
    durationMs: row.durationMs,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    pipeline: toPipelineView(row.pipelineMetaJson, row.mode),
  }
}

export async function getBatchDetail(batchId: string): Promise<BatchDetailView | null> {
  const batch = await prisma.downloadBatch.findUnique({
    where: { id: batchId },
    include: {
      tasks: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!batch) return null

  const tasks = await Promise.all(
    BATCH_DOWNLOAD_ORDER.map(async (type) => {
    const row = batch.tasks.find((t) => t.type === type)
    if (!row) {
      return {
        id: '',
        type,
        typeLabel: DOWNLOAD_TYPE_LABELS[type],
        mode: null,
        step: null,
        stepLabel: '未开始',
        status: 'idle',
        taskId: null,
        fileName: null,
        fileSize: null,
        filePath: null,
        errorMessage: null,
        failedStepHint: null,
        durationMs: null,
        startedAt: null,
        finishedAt: null,
        pipeline: null,
      } satisfies BatchTaskView
    }
    const view = toBatchTaskView(row)
    const config = await getDownloadConfig(type)
    const displayMode = config?.mode ?? view.mode ?? 'auto_export'
    return {
      ...view,
      mode: displayMode,
      pipeline: toPipelineView(row.pipelineMetaJson, displayMode),
    }
  }),
  )

  const success = tasks.filter((t) => t.status === 'success').length
  const failed = tasks.filter((t) => t.status === 'failed').length

  return {
    id: batch.id,
    status: batch.status as BatchStatus,
    startDate: batch.startDate,
    endDate: batch.endDate,
    durationMs: batch.durationMs,
    errorMessage: batch.errorMessage,
    startedAt: batch.startedAt?.toISOString() ?? null,
    finishedAt: batch.finishedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    tasks,
    summary: { total: tasks.length, success, failed },
  }
}

export async function listRecentBatches(limit = 20): Promise<BatchDetailView[]> {
  const rows = await prisma.downloadBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  const results: BatchDetailView[] = []
  for (const row of rows) {
    const detail = await getBatchDetail(row.id)
    if (detail) results.push(detail)
  }
  return results
}

async function runBatchDownload(
  batchId: string,
  range: DateRangeResolved,
  userId: string,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<void> {
  await migrateLegacyDownloadModes()
  const user = await findUserById(userId)
  const auditUser = {
    userId,
    username: user?.username ?? userId,
    role: user?.role ?? 'unknown',
  }

  const batchStarted = Date.now()
  await prisma.downloadBatch.update({
    where: { id: batchId },
    data: { status: 'running', startedAt: new Date() },
  })

  let successCount = 0
  let failCount = 0

  for (const type of BATCH_DOWNLOAD_ORDER) {
    const taskRow = await prisma.downloadTask.findFirst({
      where: { batchId, type },
    })
    if (!taskRow) continue

    const config = await getDownloadConfig(type)
    const effectiveMode = config ? getEffectiveDownloadMode(type, config) : 'auto_export'
    await prisma.downloadTask.update({
      where: { id: taskRow.id },
      data: { mode: effectiveMode },
    })

    const taskStarted = Date.now()
    await updateDownloadTaskStep(taskRow.id, 'pending', {
      status: 'waiting',
      startedAt: new Date(),
      errorMessage: null,
    })

    const progress = createProgressContext(taskRow.id, batchId, {
      ...auditUser,
      requestId: audit?.requestId,
      type,
    })

    try {
      await progress.setStep('export_start')
      const result: DownloadTaskView = await downloadByType(type, userId, range, audit, {
        batchId,
        taskId: taskRow.id,
        progress,
      })

      const durationMs = Date.now() - taskStarted
      if (result.status === 'success') {
        successCount++
        await updateDownloadTaskStep(taskRow.id, 'success', {
          status: 'success',
          durationMs,
          finishedAt: new Date(),
          errorMessage: null,
        })
        await writeOperationLog({
          ...auditUser,
          action: 'download_task_success',
          module: 'download',
          description: `${DOWNLOAD_TYPE_LABELS[type]} 下载成功`,
          requestId: audit?.requestId ?? null,
          ip: audit?.ip ?? null,
          userAgent: audit?.userAgent ?? null,
          meta: {
            batchId,
            type,
            step: 'success',
            fileName: result.fileName,
            fileSize: result.fileSize,
            durationMs,
          },
        })
      } else {
        failCount++
        const msg = result.errorMessage ?? `${DOWNLOAD_TYPE_LABELS[type]} 下载失败`
        await updateDownloadTaskStep(taskRow.id, 'failed', {
          status: 'failed',
          errorMessage: msg,
          durationMs,
          finishedAt: new Date(),
        })
        await writeOperationLog({
          ...auditUser,
          action: 'download_task_failed',
          module: 'download',
          description: `${DOWNLOAD_TYPE_LABELS[type]} 下载失败：${msg}`,
          requestId: audit?.requestId ?? null,
          meta: { batchId, type, step: 'failed', errorMessage: msg, durationMs },
        })
      }
    } catch (err) {
      failCount++
      const message = normalizeDownloadError(err, type)
      const durationMs = Date.now() - taskStarted
      const current = await prisma.downloadTask.findUnique({ where: { id: taskRow.id } })
      await updateDownloadTaskStep(taskRow.id, 'failed', {
        status: 'failed',
        errorMessage: `${message}（${getFailedStepHint(current?.step)}）`,
        durationMs,
        finishedAt: new Date(),
      })
      await writeOperationLog({
        ...auditUser,
        action: 'download_task_failed',
        module: 'download',
        description: `${DOWNLOAD_TYPE_LABELS[type]} 下载失败：${message}`,
        requestId: audit?.requestId ?? null,
        meta: {
          batchId,
          type,
          step: current?.step ?? 'failed',
          errorMessage: message,
          durationMs,
        },
      })
    }
  }

  const durationMs = Date.now() - batchStarted
  let batchStatus: BatchStatus = 'failed'
  if (successCount === BATCH_DOWNLOAD_ORDER.length) {
    batchStatus = 'success'
  } else if (successCount > 0) {
    batchStatus = 'partial_success'
  }

  const errorMessage =
    failCount > 0 ? `${failCount} 张表下载失败，${successCount} 张成功` : null

  await prisma.downloadBatch.update({
    where: { id: batchId },
    data: {
      status: batchStatus,
      finishedAt: new Date(),
      durationMs,
      errorMessage,
    },
  })

  const action =
    batchStatus === 'success'
      ? 'download_batch_success'
      : batchStatus === 'partial_success'
        ? 'download_batch_partial_success'
        : 'download_batch_failed'

  await writeOperationLog({
    ...auditUser,
    action,
    module: 'download',
    description: `批量下载完成：${batchStatus}（成功 ${successCount}，失败 ${failCount}）`,
    requestId: audit?.requestId ?? null,
    ip: audit?.ip ?? null,
    userAgent: audit?.userAgent ?? null,
    meta: {
      batchId,
      startDate: range.startDate,
      endDate: range.endDate,
      durationMs,
      successCount,
      failCount,
      errorMessage,
    },
  })
}

export async function startDownloadBatch(
  userId: string,
  range: DateRangeResolved,
  audit?: { requestId?: string; ip?: string; userAgent?: string },
): Promise<BatchDetailView> {
  await migrateLegacyDownloadModes()
  const user = await findUserById(userId)

  const batch = await prisma.downloadBatch.create({
    data: {
      status: 'pending',
      startDate: range.startDate,
      endDate: range.endDate,
      createdBy: userId,
    },
  })

  for (const type of BATCH_DOWNLOAD_ORDER) {
    const config = await getDownloadConfig(type)
    const mode = config?.mode ?? 'auto_export'
    await prisma.downloadTask.create({
      data: {
        type,
        batchId: batch.id,
        mode,
        step: 'pending',
        status: 'waiting',
        createdBy: userId,
        requestId: audit?.requestId ?? null,
      },
    })
  }

  await writeOperationLog({
    userId,
    username: user?.username ?? userId,
    role: user?.role ?? 'unknown',
    action: 'download_batch_start',
    module: 'download',
    description: `开始批量下载四张表 ${range.startDate} ~ ${range.endDate}`,
    requestId: audit?.requestId ?? null,
    ip: audit?.ip ?? null,
    userAgent: audit?.userAgent ?? null,
    meta: {
      batchId: batch.id,
      startDate: range.startDate,
      endDate: range.endDate,
    },
  })

  void runBatchDownload(batch.id, range, userId, audit).catch(async (err) => {
    console.error('[download-batch] 批量下载异常', err)
    await prisma.downloadBatch.update({
      where: { id: batch.id },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : '批量下载异常',
      },
    })
  })

  const detail = await getBatchDetail(batch.id)
  return detail!
}
