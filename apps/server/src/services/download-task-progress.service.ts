import { prisma } from '../lib/prisma'
import { writeOperationLog } from './audit.service'
import {
  type DownloadProgressContext,
  type DownloadTaskStep,
  isDownloadTaskStep,
  stepToDisplayStatus,
} from '../types/download-batch'
import type { DownloadType } from '../types/download'
import { isDownloadType } from '../types/download'

function stepToTaskStatus(step: DownloadTaskStep): string {
  switch (step) {
    case 'pending':
    case 'wait_history':
      return 'waiting'
    case 'export_start':
      return 'exporting'
    case 'poll_record':
      return 'polling'
    case 'get_download_url':
    case 'download_file':
    case 'validate_file':
      return 'downloading'
    case 'success':
      return 'success'
    case 'failed':
      return 'failed'
    default:
      return 'downloading'
  }
}

export async function updateDownloadTaskStep(
  taskId: string,
  step: DownloadTaskStep,
  extra?: {
    status?: string
    errorMessage?: string | null
    fileName?: string
    filePath?: string
    fileSize?: number
    xhsTaskId?: string
    mode?: string
    durationMs?: number
    finishedAt?: Date | null
    startedAt?: Date
  },
): Promise<void> {
  await prisma.downloadTask.update({
    where: { id: taskId },
    data: {
      step,
      status: extra?.status ?? stepToTaskStatus(step),
      errorMessage: extra?.errorMessage,
      fileName: extra?.fileName,
      filePath: extra?.filePath,
      fileSize: extra?.fileSize,
      xhsTaskId: extra?.xhsTaskId,
      mode: extra?.mode,
      durationMs: extra?.durationMs,
      finishedAt: extra?.finishedAt,
      startedAt: extra?.startedAt,
    },
  })
}

export function createProgressContext(
  taskId: string,
  batchId?: string,
  audit?: {
    userId?: string
    username?: string
    role?: string
    requestId?: string
    type?: DownloadType
  },
): DownloadProgressContext {
  return {
    taskId,
    batchId,
    setStep: async (step, meta) => {
      await updateDownloadTaskStep(taskId, step, { status: meta?.status })
      if (audit?.userId) {
        await writeOperationLog({
          userId: audit.userId,
          username: audit.username ?? null,
          role: audit.role ?? null,
          action: 'download_task_step_update',
          module: 'download',
          description: `${audit.type ?? 'download'} 步骤：${stepToDisplayStatus(step)}`,
          requestId: audit.requestId ?? null,
          meta: {
            batchId,
            type: audit.type,
            step,
            taskId,
          },
        })
      }
    },
  }
}

export function getFailedStepHint(step: string | null | undefined): string {
  if (!step || !isDownloadTaskStep(step)) return '未知步骤'
  return `失败步骤：${stepToDisplayStatus(step)}（${step}）`
}
