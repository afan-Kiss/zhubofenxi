/**
 * 经营看板日期范围同步覆盖判断（按店铺）。
 * 禁止用「库内其他日期有订单」推断当前范围未同步；
 * 禁止用单条成功任务把全部 requiredShopIds 标为已覆盖。
 */
import { prisma } from '../lib/prisma'
import { clearStaleBusinessSyncJobs } from './business-sync-stale-cleanup.service'

const SUCCESS_LIKE_STATUSES = ['success', 'partial_success', 'success_empty'] as const

export type BoardRangeCoverageStatus = 'covered' | 'not_covered' | 'syncing' | 'unknown'

export type ShopRangeCoverageStatus =
  | 'covered'
  | 'not_covered'
  | 'syncing'
  | 'failed'
  | 'unknown'

export interface ShopRangeCoverageEvidence {
  shopId: string
  shopName?: string | null
  status: ShopRangeCoverageStatus
  evidenceJobId: string | null
  evidenceSource: string
  startDate: string | null
  endDate: string | null
  lastSuccessAt: string | null
  reason: string
}

export type BusinessRangeCoverageResult = {
  status: BoardRangeCoverageStatus
  coveredShopIds: string[]
  missingShopIds: string[]
  syncingShopIds: string[]
  failedShopIds: string[]
  unknownShopIds: string[]
  shopEvidence: ShopRangeCoverageEvidence[]
  reason: string
  evidenceJobId: string | null
}

type CoverageJob = {
  id: string
  status: string
  startDate: string | null
  endDate: string | null
  startedAt: Date | null
  finishedAt: Date | null
  errorMessage: string | null
  preset: string | null
  type: string | null
}

type ShopInfo = {
  id: string
  name: string
  createdAt: Date
  lastSyncSuccessAt: Date | null
}

export function jobCoversBusinessRange(
  job: { startDate: string | null; endDate: string | null },
  startDate: string,
  endDate: string,
): boolean {
  if (!job.startDate || !job.endDate) return false
  return job.startDate <= startDate && job.endDate >= endDate
}

function jobOverlapsRange(
  job: { startDate: string | null; endDate: string | null },
  startDate: string,
  endDate: string,
): boolean {
  if (!job.startDate || !job.endDate) return false
  return job.startDate <= endDate && job.endDate >= startDate
}

/** 从任务警告中解析失败店铺展示名，例如「拾玉居」Cookie 已失效 */
export function parseFailedShopNamesFromJobMessage(message: string | null | undefined): string[] {
  if (!message) return []
  const names = new Set<string>()
  const re = /「([^」]+)」/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const name = m[1]?.trim()
    if (name) names.add(name)
  }
  return [...names]
}

function normalizeShopName(name: string): string {
  return name.trim().toLowerCase()
}

function shopExistedAtJob(shop: ShopInfo, job: CoverageJob): boolean {
  const jobAt = job.startedAt ?? job.finishedAt
  if (!jobAt) return true
  return shop.createdAt.getTime() <= jobAt.getTime() + 1000
}

function lastSyncWithinJobWindow(shop: ShopInfo, job: CoverageJob): boolean {
  if (!shop.lastSyncSuccessAt || !job.startedAt) return false
  const end = job.finishedAt ?? new Date(job.startedAt.getTime() + 2 * 60 * 60 * 1000)
  const t = shop.lastSyncSuccessAt.getTime()
  return t >= job.startedAt.getTime() - 1000 && t <= end.getTime() + 60_000
}

/**
 * partial_success 是否具备可解析的店铺级结果。
 * 有失败店名，或有任一店的订单/场次证据，则视为可解析。
 */
export function canParsePartialSuccessShopLevel(params: {
  errorMessage: string | null
  shopsWithRawEvidence: Set<string>
}): boolean {
  const failedNames = parseFailedShopNamesFromJobMessage(params.errorMessage)
  if (failedNames.length > 0) return true
  if (params.shopsWithRawEvidence.size > 0) return true
  return false
}

function emptyResult(
  status: BoardRangeCoverageStatus,
  requiredShopIds: string[],
  reason: string,
  evidenceJobId: string | null = null,
  shopEvidence: ShopRangeCoverageEvidence[] = [],
): BusinessRangeCoverageResult {
  const unknownShopIds = status === 'unknown' ? [...requiredShopIds] : []
  const missingShopIds =
    status === 'not_covered' || status === 'syncing' ? [...requiredShopIds] : []
  return {
    status,
    coveredShopIds: [],
    missingShopIds,
    syncingShopIds: status === 'syncing' ? [...requiredShopIds] : [],
    failedShopIds: [],
    unknownShopIds,
    shopEvidence,
    reason,
    evidenceJobId,
  }
}

function aggregateShopStatuses(
  shopEvidence: ShopRangeCoverageEvidence[],
  requiredShopIds: string[],
): BusinessRangeCoverageResult {
  const coveredShopIds = shopEvidence.filter((s) => s.status === 'covered').map((s) => s.shopId)
  const syncingShopIds = shopEvidence.filter((s) => s.status === 'syncing').map((s) => s.shopId)
  const failedShopIds = shopEvidence.filter((s) => s.status === 'failed').map((s) => s.shopId)
  const unknownShopIds = shopEvidence.filter((s) => s.status === 'unknown').map((s) => s.shopId)
  const missingShopIds = shopEvidence
    .filter((s) => s.status === 'not_covered' || s.status === 'failed')
    .map((s) => s.shopId)

  const evidenceJobId =
    shopEvidence.find((s) => s.evidenceJobId)?.evidenceJobId ??
    shopEvidence[0]?.evidenceJobId ??
    null

  if (requiredShopIds.length === 0) {
    return {
      status: 'unknown',
      coveredShopIds: [],
      missingShopIds: [],
      syncingShopIds: [],
      failedShopIds: [],
      unknownShopIds: [],
      shopEvidence,
      reason: 'required_shops_empty',
      evidenceJobId,
    }
  }

  if (coveredShopIds.length === requiredShopIds.length) {
    return {
      status: 'covered',
      coveredShopIds,
      missingShopIds: [],
      syncingShopIds: [],
      failedShopIds: [],
      unknownShopIds: [],
      shopEvidence,
      reason: 'all_required_shops_covered',
      evidenceJobId,
    }
  }

  if (syncingShopIds.length > 0) {
    return {
      status: 'syncing',
      coveredShopIds,
      missingShopIds: requiredShopIds.filter((id) => !coveredShopIds.includes(id)),
      syncingShopIds,
      failedShopIds,
      unknownShopIds,
      shopEvidence,
      reason: 'required_shops_syncing',
      evidenceJobId,
    }
  }

  if (unknownShopIds.length > 0) {
    return {
      status: 'unknown',
      coveredShopIds,
      missingShopIds: requiredShopIds.filter((id) => !coveredShopIds.includes(id)),
      syncingShopIds: [],
      failedShopIds,
      unknownShopIds,
      shopEvidence,
      reason: 'shop_level_evidence_unknown',
      evidenceJobId,
    }
  }

  if (missingShopIds.length > 0 || failedShopIds.length > 0) {
    return {
      status: 'not_covered',
      coveredShopIds,
      missingShopIds: requiredShopIds.filter((id) => !coveredShopIds.includes(id)),
      syncingShopIds: [],
      failedShopIds,
      unknownShopIds: [],
      shopEvidence,
      reason: 'required_shops_missing_coverage',
      evidenceJobId,
    }
  }

  return {
    status: 'unknown',
    coveredShopIds,
    missingShopIds: requiredShopIds.filter((id) => !coveredShopIds.includes(id)),
    syncingShopIds: [],
    failedShopIds,
    unknownShopIds: requiredShopIds.filter((id) => !coveredShopIds.includes(id)),
    shopEvidence,
    reason: 'coverage_inconclusive',
    evidenceJobId,
  }
}

/**
 * 解析指定业务日期范围是否已被经营同步按店铺覆盖。
 */
export async function resolveBusinessRangeCoverage(params: {
  startDate: string
  endDate: string
  requiredShopIds?: string[]
}): Promise<BusinessRangeCoverageResult> {
  const { startDate, endDate } = params

  let requiredShops: ShopInfo[] = []
  if (params.requiredShopIds?.length) {
    const rows = await prisma.platformCredential.findMany({
      where: { id: { in: params.requiredShopIds } },
      select: {
        id: true,
        displayName: true,
        platformName: true,
        createdAt: true,
        lastSyncSuccessAt: true,
      },
    })
    const byId = new Map(rows.map((r) => [r.id, r]))
    requiredShops = params.requiredShopIds.map((id) => {
      const row = byId.get(id)
      return {
        id,
        name: row?.displayName?.trim() || row?.platformName || id,
        createdAt: row?.createdAt ?? new Date(0),
        lastSyncSuccessAt: row?.lastSyncSuccessAt ?? null,
      }
    })
  } else {
    try {
      const { listEnabledLiveAccountsWithCookie } = await import('./live-account.service')
      const accounts = await listEnabledLiveAccountsWithCookie()
      if (accounts.length === 0) {
        return emptyResult('unknown', [], 'required_shops_unresolved')
      }
      const rows = await prisma.platformCredential.findMany({
        where: { id: { in: accounts.map((a) => a.id) } },
        select: { id: true, createdAt: true, lastSyncSuccessAt: true },
      })
      const meta = new Map(rows.map((r) => [r.id, r]))
      requiredShops = accounts.map((a) => ({
        id: a.id,
        name: a.name,
        createdAt: meta.get(a.id)?.createdAt ?? new Date(0),
        lastSyncSuccessAt: meta.get(a.id)?.lastSyncSuccessAt ?? null,
      }))
    } catch {
      return emptyResult('unknown', [], 'required_shops_unresolved')
    }
  }

  const requiredShopIds = requiredShops.map((s) => s.id)
  if (!requiredShopIds.length) {
    return emptyResult('unknown', [], 'required_shops_empty')
  }

  await clearStaleBusinessSyncJobs().catch(() => undefined)

  const runningJob = await prisma.xhsSyncJob.findFirst({
    where: {
      status: 'running',
      OR: [{ preset: 'daily_strategy' }, { type: 'scheduled' }],
    },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true,
      preset: true,
      type: true,
    },
  })

  const coveringJobs = (await prisma.xhsSyncJob.findMany({
    where: {
      status: { in: [...SUCCESS_LIKE_STATUSES] },
      startDate: { lte: startDate },
      endDate: { gte: endDate },
      OR: [{ preset: 'daily_strategy' }, { type: 'scheduled' }, { type: 'full_read' }, { type: 'manual' }],
    },
    orderBy: { finishedAt: 'desc' },
    take: 40,
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true,
      preset: true,
      type: true,
    },
  })) as CoverageJob[]

  const anySuccessHistory = await prisma.xhsSyncJob.findFirst({
    where: {
      status: { in: [...SUCCESS_LIKE_STATUSES] },
      OR: [{ preset: 'daily_strategy' }, { type: 'scheduled' }],
    },
    orderBy: { finishedAt: 'desc' },
    select: { id: true, startDate: true, endDate: true },
  })

  const coveringJobIds = coveringJobs.map((j) => j.id)
  const shopsWithOrdersByJob = new Map<string, Set<string>>()
  const shopsWithLiveByJob = new Map<string, Set<string>>()

  if (coveringJobIds.length > 0) {
    const orderGroups = await prisma.xhsRawOrder.groupBy({
      by: ['syncJobId', 'liveAccountId'],
      where: {
        syncJobId: { in: coveringJobIds },
        liveAccountId: { in: requiredShopIds },
      },
      _count: { _all: true },
    })
    for (const g of orderGroups) {
      if (!g.syncJobId) continue
      let set = shopsWithOrdersByJob.get(g.syncJobId)
      if (!set) {
        set = new Set()
        shopsWithOrdersByJob.set(g.syncJobId, set)
      }
      set.add(g.liveAccountId)
    }

    const liveGroups = await prisma.xhsRawLiveSession.groupBy({
      by: ['syncJobId', 'liveAccountId'],
      where: {
        syncJobId: { in: coveringJobIds },
        liveAccountId: { in: requiredShopIds },
      },
      _count: { _all: true },
    })
    for (const g of liveGroups) {
      if (!g.syncJobId) continue
      let set = shopsWithLiveByJob.get(g.syncJobId)
      if (!set) {
        set = new Set()
        shopsWithLiveByJob.set(g.syncJobId, set)
      }
      set.add(g.liveAccountId)
    }
  }

  const nameToId = new Map<string, string>()
  for (const shop of requiredShops) {
    nameToId.set(normalizeShopName(shop.name), shop.id)
  }

  const runningOverlaps =
    runningJob != null && jobOverlapsRange(runningJob, startDate, endDate)

  const shopEvidence: ShopRangeCoverageEvidence[] = requiredShops.map((shop) => {
    let best: ShopRangeCoverageEvidence | null = null

    for (const job of coveringJobs) {
      if (!jobCoversBusinessRange(job, startDate, endDate)) continue

      const orderShops = shopsWithOrdersByJob.get(job.id) ?? new Set<string>()
      const liveShops = shopsWithLiveByJob.get(job.id) ?? new Set<string>()
      const rawEvidence = new Set<string>([...orderShops, ...liveShops])
      const failedNames = parseFailedShopNamesFromJobMessage(job.errorMessage)
      const failedIds = new Set(
        failedNames
          .map((n) => nameToId.get(normalizeShopName(n)))
          .filter((id): id is string => Boolean(id)),
      )
      const shopFailedByName = failedNames.some(
        (n) => normalizeShopName(n) === normalizeShopName(shop.name),
      )
      const shopFailed = failedIds.has(shop.id) || shopFailedByName

      if (job.status === 'partial_success') {
        const parseable = canParsePartialSuccessShopLevel({
          errorMessage: job.errorMessage,
          shopsWithRawEvidence: rawEvidence,
        })
        if (!parseable) {
          best = {
            shopId: shop.id,
            shopName: shop.name,
            status: 'unknown',
            evidenceJobId: job.id,
            evidenceSource: 'partial_success_unparsed',
            startDate: job.startDate,
            endDate: job.endDate,
            lastSuccessAt: job.finishedAt?.toISOString() ?? null,
            reason: 'partial_success_without_shop_level_evidence',
          }
          break
        }
        if (shopFailed) {
          best = {
            shopId: shop.id,
            shopName: shop.name,
            status: 'failed',
            evidenceJobId: job.id,
            evidenceSource: 'partial_success_failed_shop',
            startDate: job.startDate,
            endDate: job.endDate,
            lastSuccessAt: job.finishedAt?.toISOString() ?? null,
            reason: 'shop_failed_in_partial_success',
          }
          break
        }
        if (rawEvidence.has(shop.id) || lastSyncWithinJobWindow(shop, job)) {
          best = {
            shopId: shop.id,
            shopName: shop.name,
            status: 'covered',
            evidenceJobId: job.id,
            evidenceSource: rawEvidence.has(shop.id)
              ? 'partial_success_raw_evidence'
              : 'partial_success_last_sync_window',
            startDate: job.startDate,
            endDate: job.endDate,
            lastSuccessAt: job.finishedAt?.toISOString() ?? null,
            reason: 'shop_succeeded_in_partial_success',
          }
          break
        }
        best = {
          shopId: shop.id,
          shopName: shop.name,
          status: 'not_covered',
          evidenceJobId: job.id,
          evidenceSource: 'partial_success_shop_missing',
          startDate: job.startDate,
          endDate: job.endDate,
          lastSuccessAt: job.finishedAt?.toISOString() ?? null,
          reason: 'shop_missing_in_partial_success',
        }
        break
      }

      if (job.status === 'success_empty') {
        if (!shopExistedAtJob(shop, job)) {
          continue
        }
        best = {
          shopId: shop.id,
          shopName: shop.name,
          status: 'covered',
          evidenceJobId: job.id,
          evidenceSource: 'success_empty_job',
          startDate: job.startDate,
          endDate: job.endDate,
          lastSuccessAt: job.finishedAt?.toISOString() ?? null,
          reason: 'success_empty_covers_existing_shop',
        }
        break
      }

      if (job.status === 'success') {
        if (shopFailed) {
          best = {
            shopId: shop.id,
            shopName: shop.name,
            status: 'failed',
            evidenceJobId: job.id,
            evidenceSource: 'success_job_failed_shop_warning',
            startDate: job.startDate,
            endDate: job.endDate,
            lastSuccessAt: job.finishedAt?.toISOString() ?? null,
            reason: 'shop_warned_failed_in_success_job',
          }
          break
        }
        if (rawEvidence.has(shop.id)) {
          best = {
            shopId: shop.id,
            shopName: shop.name,
            status: 'covered',
            evidenceJobId: job.id,
            evidenceSource: 'success_job_raw_evidence',
            startDate: job.startDate,
            endDate: job.endDate,
            lastSuccessAt: job.finishedAt?.toISOString() ?? null,
            reason: 'shop_raw_synced_in_success_job',
          }
          break
        }
        if (lastSyncWithinJobWindow(shop, job)) {
          best = {
            shopId: shop.id,
            shopName: shop.name,
            status: 'covered',
            evidenceJobId: job.id,
            evidenceSource: 'success_job_last_sync_window',
            startDate: job.startDate,
            endDate: job.endDate,
            lastSuccessAt: shop.lastSyncSuccessAt?.toISOString() ?? null,
            reason: 'shop_last_sync_within_success_job_window',
          }
          break
        }
        if (shopExistedAtJob(shop, job)) {
          best = {
            shopId: shop.id,
            shopName: shop.name,
            status: 'not_covered',
            evidenceJobId: job.id,
            evidenceSource: 'success_job_shop_no_evidence',
            startDate: job.startDate,
            endDate: job.endDate,
            lastSuccessAt: job.finishedAt?.toISOString() ?? null,
            reason: 'success_job_lacks_shop_level_evidence',
          }
          break
        }
      }
    }

    if (
      runningOverlaps &&
      runningJob &&
      (!best || best.status === 'not_covered' || best.status === 'unknown')
    ) {
      best = {
        shopId: shop.id,
        shopName: shop.name,
        status: 'syncing',
        evidenceJobId: runningJob.id,
        evidenceSource: 'running_job_overlaps',
        startDate: runningJob.startDate,
        endDate: runningJob.endDate,
        lastSuccessAt: null,
        reason: 'sync_job_running_overlaps_range',
      }
    }

    if (!best) {
      if (!anySuccessHistory) {
        best = {
          shopId: shop.id,
          shopName: shop.name,
          status: 'unknown',
          evidenceJobId: null,
          evidenceSource: 'no_successful_sync_job',
          startDate: null,
          endDate: null,
          lastSuccessAt: null,
          reason: 'no_successful_sync_job',
        }
      } else if (!jobCoversBusinessRange(anySuccessHistory, startDate, endDate)) {
        best = {
          shopId: shop.id,
          shopName: shop.name,
          status: 'not_covered',
          evidenceJobId: anySuccessHistory.id,
          evidenceSource: 'last_success_outside_range',
          startDate: anySuccessHistory.startDate,
          endDate: anySuccessHistory.endDate,
          lastSuccessAt: null,
          reason: `last_success_job_outside_range:${anySuccessHistory.startDate}~${anySuccessHistory.endDate}`,
        }
      } else {
        best = {
          shopId: shop.id,
          shopName: shop.name,
          status: 'unknown',
          evidenceJobId: anySuccessHistory.id,
          evidenceSource: 'coverage_inconclusive',
          startDate: anySuccessHistory.startDate,
          endDate: anySuccessHistory.endDate,
          lastSuccessAt: null,
          reason: 'coverage_inconclusive',
        }
      }
    }

    return best
  })

  // partial_success 无法解析时：任一店因此为 unknown，总状态保持 unknown（聚合已处理）
  return aggregateShopStatuses(shopEvidence, requiredShopIds)
}
