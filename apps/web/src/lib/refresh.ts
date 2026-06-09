export interface RefreshJobView {
  refreshJobId: string
  type: 'manual' | 'scheduled'
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
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  createdAt: string
  isRunning: boolean
}

export interface RefreshStatusResponse {
  running: RefreshJobView | null
  latest: RefreshJobView | null
  job: RefreshJobView | null
  message: string | null
  missedRefresh: {
    missed: boolean
    message: string | null
    skippedJobId: string | null
  }
}

export interface RefreshMeta {
  lastRefreshAt: string | null
  refreshType: string
  refreshStatus: string
  snapshotCreatedAt?: string
  startedByUsername?: string | null
}
