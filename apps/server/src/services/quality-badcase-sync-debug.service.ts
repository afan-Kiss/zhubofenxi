import { prisma } from '../lib/prisma'
import { getCookieHealthPayload, listLiveAccountsPublic } from './live-account.service'
import {
  cleanupOrphanQualityBadCaseSyncJobs,
  listOfficialQualitySyncCandidateAccounts,
} from './quality-badcase-orphan-cleanup.service'
import {
  getOfficialQualityBadCaseAutoSyncDebugInfo,
  type QualityBadCaseAutoSyncStatus,
} from './quality-badcase-auto-sync.service'
import { getRecentQualityBadCaseSyncLogs } from './quality-badcase-sync-log.service'

export async function buildQualityBadCaseSyncDebugPayload() {
  const [cleanup, candidateAccounts, autoSync, recentLogs] = await Promise.all([
    cleanupOrphanQualityBadCaseSyncJobs(),
    listOfficialQualitySyncCandidateAccounts(),
    Promise.resolve(getOfficialQualityBadCaseAutoSyncDebugInfo()),
    Promise.resolve(getRecentQualityBadCaseSyncLogs()),
  ])

  const candidateIds = candidateAccounts.map((a) => a.id)
  const orphanHistoryCaseGroups =
    candidateIds.length > 0
      ? await prisma.qualityBadCase.groupBy({
          by: ['liveAccountId'],
          where: { liveAccountId: { notIn: candidateIds } },
          _count: { _all: true },
        })
      : await prisma.qualityBadCase.groupBy({
          by: ['liveAccountId'],
          _count: { _all: true },
        })

  const enabledAccounts = await listLiveAccountsPublic()
  const enabledLiveAccounts = enabledAccounts
    .filter((a) => a.enabled)
    .map((a) => ({
      id: a.id,
      name: a.name,
      enabled: a.enabled,
      hasCookie: a.hasCookie,
      cookieStatus: a.cookieStatus,
    }))

  const oldXiaohongshuTasks = cleanup.staleXiaohongshuLabels.map((row) => ({
    liveAccountId: row.liveAccountId,
    currentDisplayName: row.currentDisplayName,
    legacyPlatformName: row.legacyPlatformName,
    source: 'platform_credential' as const,
    skipped: false,
    note: '内部 platformName 仍为 xiaohongshu，同步与日志使用当前 displayName',
  }))

  const orphanFromHistory = cleanup.orphanTasks.map((t) => ({
    liveAccountId: t.liveAccountId,
    accountName: t.accountName,
    legacyPlatformName: t.legacyPlatformName,
    source: t.source,
    skipped: t.skipped,
    qualityBadCaseCount: t.qualityBadCaseCount,
  }))

  const candidateNames = new Set(candidateAccounts.map((a) => a.name))
  const attemptsXiaohongshuSync =
    candidateAccounts.some((a) => a.platformName === 'xiaohongshu') &&
    !candidateNames.has('xiaohongshu')

  return {
    enabledLiveAccounts,
    candidateAccounts: candidateAccounts.map((a) => ({
      id: a.id,
      name: a.name,
      platformName: a.platformName,
    })),
    autoSync: {
      status: autoSync.autoSyncStatus as QualityBadCaseAutoSyncStatus,
      lastError: autoSync.lastError,
      lastTrigger: autoSync.lastTrigger,
      lastAttemptAt: autoSync.lastAttemptAt,
      isRunning: autoSync.autoSyncStatus === 'running',
    },
    oldXiaohongshuTasks,
    orphanTasks: orphanFromHistory,
    orphanHistoryCaseGroups: orphanHistoryCaseGroups.map((g) => ({
      liveAccountId: g.liveAccountId,
      count: g._count._all,
      source: 'old_quality_bad_case' as const,
      skipped: true,
    })),
    attemptsXiaohongshuAsDisplayName: false,
    attemptsXiaohongshuByPlatformSlug: attemptsXiaohongshuSync,
    recentLogs,
  }
}

export async function buildCookieHealthWithQualitySync() {
  const [health, qualityDebug] = await Promise.all([
    getCookieHealthPayload(),
    buildQualityBadCaseSyncDebugPayload(),
  ])
  return {
    ...health,
    qualityBadCaseSync: {
      autoSyncStatus: qualityDebug.autoSync.status,
      lastError: qualityDebug.autoSync.lastError,
      candidateAccountNames: qualityDebug.candidateAccounts.map((a) => a.name),
      perAccountHints: qualityDebug.candidateAccounts.map((a) => {
        const failedLog = qualityDebug.recentLogs.find(
          (l) => l.liveAccountId === a.id && l.level === 'warn',
        )
        return {
          liveAccountId: a.id,
          accountName: a.name,
          orderApiStatus: health.accounts.find((x) => x.id === a.id)?.cookieStatus ?? 'unknown',
          qualityApiHint: failedLog?.message ?? '使用历史缓存或尚未同步',
        }
      }),
    },
  }
}
