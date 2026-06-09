import type { DownloadType } from './download'

export const DOWNLOAD_TASK_STEPS = [
  'pending',
  'export_start',
  'wait_history',
  'poll_record',
  'get_download_url',
  'download_file',
  'validate_file',
  'success',
  'failed',
] as const

export type DownloadTaskStep = (typeof DOWNLOAD_TASK_STEPS)[number]

export const BATCH_STATUSES = [
  'pending',
  'running',
  'success',
  'partial_success',
  'failed',
] as const

export type BatchStatus = (typeof BATCH_STATUSES)[number]

export const BATCH_DOWNLOAD_ORDER: DownloadType[] = [
  'order',
  'live',
  'pendingSettlement',
  'settledSettlement',
]

export const STEP_LABELS: Record<DownloadTaskStep, string> = {
  pending: '等待中',
  export_start: '导出中',
  wait_history: '等待中',
  poll_record: '轮询中',
  get_download_url: '下载中',
  download_file: '下载中',
  validate_file: '下载中',
  success: '成功',
  failed: '失败',
}

export function isDownloadTaskStep(value: string): value is DownloadTaskStep {
  return (DOWNLOAD_TASK_STEPS as readonly string[]).includes(value)
}

export function stepToDisplayStatus(step: string | null | undefined): string {
  if (!step || !isDownloadTaskStep(step)) return '未开始'
  return STEP_LABELS[step]
}

export interface DownloadProgressContext {
  taskId: string
  batchId?: string
  setStep: (step: DownloadTaskStep, meta?: { status?: string }) => Promise<void>
}
