import type { DateRangePreset } from '../utils/date-range'
import { prisma } from '../lib/prisma'
import { getApiSyncSettings } from './system-setting.service'
import { getXhsSyncJobById } from './xhs-api-sync/xhs-sync-job.service'

async function getSystemUserId(): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { role: 'super_admin', enabled: true },
    orderBy: { createdAt: 'asc' },
  })
  return user?.id ?? null
}

let pendingPresets: DateRangePreset[] = []

export function enqueueScheduledPresets(presets: DateRangePreset[]): void {
  pendingPresets.push(...presets)
}

/** 每日策略同步为单次任务，不再串行 preset 队列 */
export async function onScheduledSyncJobFinished(): Promise<void> {
  pendingPresets = []
}

export async function startScheduledApiSyncSequence(): Promise<{
  started: boolean
  firstPreset: string | null
  queuedCount: number
}> {
  const settings = await getApiSyncSettings()
  if (!settings.apiSyncEnabled) {
    return { started: false, firstPreset: null, queuedCount: 0 }
  }

  const running = await prisma.xhsSyncJob.findFirst({ where: { status: 'running' } })
  if (running) {
    return { started: false, firstPreset: null, queuedCount: 0 }
  }

  pendingPresets = []
  const userId = await getSystemUserId()
  const { runDailyStrategySyncJob } = await import('./daily-sync-strategy.service')
  const result = await runDailyStrategySyncJob({ triggeredBy: userId })

  return {
    started: !result.alreadyRunning,
    firstPreset: 'daily_strategy',
    queuedCount: 0,
  }
}

export async function waitForSyncJobComplete(
  jobId: string,
  timeoutMs = 3_600_000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const job = await getXhsSyncJobById(jobId)
    if (!job) return
    if (job.status !== 'running' && job.status !== 'pending') return
    await new Promise((r) => setTimeout(r, 2000))
  }
}
