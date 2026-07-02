import { prisma } from '../lib/prisma'
import { LEGACY_LIVE_ACCOUNT_ID } from '../utils/live-account-cache-key.util'
import {
  isLegacyDuplicateShopAccountRow,
  listActiveLiveAccountsWithCookie,
} from './official-shop-account.service'
import { appendQualityBadCaseSyncLog } from './quality-badcase-sync-log.service'

export type OrphanQualityBadCaseTaskSource =
  | 'old_quality_bad_case'
  | 'legacy_live_account_id'
  | 'disabled_live_account'
  | 'missing_live_account'
  | 'unknown'

export type OrphanQualityBadCaseTask = {
  liveAccountId: string
  accountName: string | null
  legacyPlatformName: string | null
  source: OrphanQualityBadCaseTaskSource
  skipped: boolean
  qualityBadCaseCount: number
}

export type CleanupOrphanQualityBadCaseSyncJobsResult = {
  orphanTasks: OrphanQualityBadCaseTask[]
  staleXiaohongshuLabels: Array<{
    liveAccountId: string
    currentDisplayName: string
    legacyPlatformName: string
    source: 'platform_credential'
  }>
  enabledCandidateAccounts: Array<{
    id: string
    name: string
    platformName: string
    enabled: boolean
  }>
}

const DEFAULT_LEGACY_PLATFORM = 'xiaohongshu'

/** 品退同步前/启动时：识别 orphan 历史任务，不删除业务数据、不发起请求 */
export async function cleanupOrphanQualityBadCaseSyncJobs(options?: {
  logOrphans?: boolean
}): Promise<CleanupOrphanQualityBadCaseSyncJobsResult> {
  const allAccounts = await prisma.platformCredential.findMany({
    select: {
      id: true,
      displayName: true,
      platformName: true,
      enabled: true,
      cookieEncrypted: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const enabledWithCookie = allAccounts.filter(
    (a) =>
      a.enabled &&
      Boolean(a.cookieEncrypted?.trim()) &&
      !isLegacyDuplicateShopAccountRow(a),
  )
  const accountById = new Map(allAccounts.map((a) => [a.id, a]))

  const staleXiaohongshuLabels = allAccounts
    .filter(
      (a) =>
        a.platformName === DEFAULT_LEGACY_PLATFORM &&
        (a.displayName?.trim() || '') !== DEFAULT_LEGACY_PLATFORM,
    )
    .map((a) => ({
      liveAccountId: a.id,
      currentDisplayName: a.displayName?.trim() || a.platformName,
      legacyPlatformName: a.platformName,
      source: 'platform_credential' as const,
    }))

  const caseGroups = await prisma.qualityBadCase.groupBy({
    by: ['liveAccountId'],
    _count: { _all: true },
  })

  const orphanTasks: OrphanQualityBadCaseTask[] = []

  for (const group of caseGroups) {
    const liveAccountId = group.liveAccountId
    const count = group._count._all

    if (liveAccountId === LEGACY_LIVE_ACCOUNT_ID) {
      orphanTasks.push({
        liveAccountId,
        accountName: null,
        legacyPlatformName: 'legacy',
        source: 'legacy_live_account_id',
        skipped: true,
        qualityBadCaseCount: count,
      })
      continue
    }

    const account = accountById.get(liveAccountId)
    if (!account) {
      orphanTasks.push({
        liveAccountId,
        accountName: null,
        legacyPlatformName: null,
        source: 'missing_live_account',
        skipped: true,
        qualityBadCaseCount: count,
      })
      continue
    }

    if (!account.enabled) {
      orphanTasks.push({
        liveAccountId,
        accountName: account.displayName?.trim() || account.platformName,
        legacyPlatformName:
          account.platformName === DEFAULT_LEGACY_PLATFORM ? account.platformName : null,
        source: 'disabled_live_account',
        skipped: true,
        qualityBadCaseCount: count,
      })
    }
  }

  for (const task of orphanTasks) {
    if (options?.logOrphans) {
      appendQualityBadCaseSyncLog({
        level: 'warn',
        message: '跳过旧品退同步任务：直播号不存在或已停用',
        liveAccountId: task.liveAccountId,
        accountName: task.accountName ?? undefined,
        legacyAccount: task.legacyPlatformName ?? undefined,
      })
    }
  }

  return {
    orphanTasks,
    staleXiaohongshuLabels,
    enabledCandidateAccounts: enabledWithCookie.map((a) => ({
      id: a.id,
      name: a.displayName?.trim() || a.platformName,
      platformName: a.platformName,
      enabled: a.enabled,
    })),
  }
}

/** 仅返回当前应参与官方品退同步的 enabled + 有 Cookie 的直播号（不含硬编码 fallback） */
export async function listOfficialQualitySyncCandidateAccounts(): Promise<
  Array<{ id: string; name: string; platformName: string }>
> {
  return listActiveLiveAccountsWithCookie()
}

export function isOrphanLiveAccountId(
  liveAccountId: string,
  enabledIds: Set<string>,
): boolean {
  if (liveAccountId === LEGACY_LIVE_ACCOUNT_ID) return true
  return !enabledIds.has(liveAccountId)
}
