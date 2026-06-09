import type { BoardLiveQueryResult } from './board-live-query.service'

export interface LiveQueryProgressState {
  totalPages: number
  fetchedPages: number
  totalOrders: number
  message: string
}

export interface LiveQueryJobRecord {
  requestId: string
  status: 'running' | 'success' | 'failed'
  progress: LiveQueryProgressState
  result?: BoardLiveQueryResult
  error?: string
  createdAt: number
}

const jobs = new Map<string, LiveQueryJobRecord>()
const TTL_MS = 30 * 60 * 1000

function prune(): void {
  const cutoff = Date.now() - TTL_MS
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id)
  }
}

export function createLiveQueryJob(requestId: string): LiveQueryJobRecord {
  prune()
  const job: LiveQueryJobRecord = {
    requestId,
    status: 'running',
    progress: {
      totalPages: 0,
      fetchedPages: 0,
      totalOrders: 0,
      message: '正在请求订单接口...',
    },
    createdAt: Date.now(),
  }
  jobs.set(requestId, job)
  return job
}

export function getLiveQueryJob(requestId: string): LiveQueryJobRecord | undefined {
  return jobs.get(requestId)
}

export function updateLiveQueryProgress(
  requestId: string,
  patch: Partial<LiveQueryProgressState>,
): void {
  const job = jobs.get(requestId)
  if (!job) return
  job.progress = { ...job.progress, ...patch }
}

export function completeLiveQueryJob(
  requestId: string,
  result: BoardLiveQueryResult,
): void {
  const job = jobs.get(requestId)
  if (!job) return
  job.status = 'success'
  job.result = result
  job.progress.message = '数据刷新完成'
}

export function failLiveQueryJob(requestId: string, error: string): void {
  const job = jobs.get(requestId)
  if (!job) return
  job.status = 'failed'
  job.error = error
  job.progress.message = error
}
