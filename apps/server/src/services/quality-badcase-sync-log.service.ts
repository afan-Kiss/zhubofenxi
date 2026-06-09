export type QualityBadCaseSyncLogEntry = {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
  accountName?: string
  liveAccountId?: string
  legacyAccount?: string
}

const MAX_LOGS = 10
const recentLogs: QualityBadCaseSyncLogEntry[] = []

export function appendQualityBadCaseSyncLog(entry: Omit<QualityBadCaseSyncLogEntry, 'at'>): void {
  recentLogs.unshift({ ...entry, at: new Date().toISOString() })
  if (recentLogs.length > MAX_LOGS) recentLogs.length = MAX_LOGS
}

export function getRecentQualityBadCaseSyncLogs(): QualityBadCaseSyncLogEntry[] {
  return [...recentLogs]
}

export function clearQualityBadCaseSyncLogs(): void {
  recentLogs.length = 0
}
