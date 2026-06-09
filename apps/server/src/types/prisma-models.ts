/** Prisma row shapes used before client regenerate in some environments */
export interface RefreshJob {
  id: string
  type: string
  status: string
  preset: string
  startDate: string
  endDate: string
  progress: number
  currentStep: string
  currentStepLabel: string
  downloadBatchId: string | null
  trustStatus: string | null
  errorMessage: string | null
  startedBy: string | null
  startedAt: Date | null
  finishedAt: Date | null
  durationMs: number | null
  createdAt: Date
  updatedAt: Date
}
