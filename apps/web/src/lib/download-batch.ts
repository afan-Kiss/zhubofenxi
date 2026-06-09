import type { DownloadType } from './settings'

export type BatchStatus = 'pending' | 'running' | 'success' | 'partial_success' | 'failed'

export interface DownloadPipelineView {
  signEnabled: boolean
  signSuccess: boolean | null
  apiSuccess: boolean | null
  fileUrlObtained: boolean | null
  xlsxDownloaded: boolean | null
  failedPhase: 'sign' | 'api' | 'poll' | 'download' | 'parse' | null
  signEnabledLabel: string
  signSuccessLabel: string
  apiSuccessLabel: string
  fileUrlLabel: string
  xlsxLabel: string
  failedPhaseLabel: string | null
}

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
