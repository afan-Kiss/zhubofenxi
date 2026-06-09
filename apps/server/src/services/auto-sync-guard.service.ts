import { prisma } from '../lib/prisma'

const COOLDOWN_MS = 5 * 60 * 1000
const autoSyncLastAt = new Map<string, number>()
const autoSyncFailedAt = new Map<string, number>()

function rangeKey(preset: string, startDate: string, endDate: string): string {
  return `${preset}|${startDate}|${endDate}`
}

export function checkAutoSyncAllowed(
  preset: string,
  startDate: string,
  endDate: string,
): { allowed: boolean; reason?: string } {
  const key = rangeKey(preset, startDate, endDate)
  const now = Date.now()
  const last = autoSyncLastAt.get(key)
  if (last != null && now - last < COOLDOWN_MS) {
    return { allowed: false, reason: 'cooldown' }
  }
  const failedAt = autoSyncFailedAt.get(key)
  if (failedAt != null && now - failedAt < COOLDOWN_MS) {
    return { allowed: false, reason: 'recent_failed' }
  }
  return { allowed: true }
}

export function markAutoSyncTriggered(preset: string, startDate: string, endDate: string): void {
  autoSyncLastAt.set(rangeKey(preset, startDate, endDate), Date.now())
}

export function markAutoSyncFailed(preset: string, startDate: string, endDate: string): void {
  const key = rangeKey(preset, startDate, endDate)
  autoSyncFailedAt.set(key, Date.now())
}

export function clearAutoSyncFailed(preset: string, startDate: string, endDate: string): void {
  autoSyncFailedAt.delete(rangeKey(preset, startDate, endDate))
}

export async function getLastFailedJobForRange(
  preset: string,
  startDate: string,
  endDate: string,
): Promise<{ id: string; status: string } | null> {
  const row = await prisma.xhsSyncJob.findFirst({
    where: {
      preset,
      startDate,
      endDate,
      status: { in: ['failed', 'failed_timeout'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  })
  return row
}
