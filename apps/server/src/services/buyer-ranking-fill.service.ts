import { prisma } from '../lib/prisma'
import type { DateRangePreset } from '../utils/date-range'
import {
  resolveBuyerRankingDateRange,
  buyerRankingRangeToAnalysisRange,
  type BuyerRankingDateRange,
} from '../utils/buyer-ranking-date-range'
import {
  runXhsSyncJob,
  getXhsSyncJobById,
  toView,
  type XhsSyncJobView,
} from './xhs-api-sync/xhs-sync-job.service'
import { hasAnyEnabledApi } from './xhs-api-sync/xhs-api-registry'
import { XHS_API_NOT_CONFIGURED_MSG } from './xhs-api-sync/xhs-api-types'
import { buildBuyerRanking, type BuyerRankingSortBy, type BuyerRankingType } from './buyer-ranking.service'

export type BuyerRankingLoadStatus =
  | 'ready'
  | 'syncing'
  | 'need_full_read'
  | 'empty_after_sync'
  | 'sync_failed'
  | 'api_not_configured'

export interface BuyerRankingLoadResult {
  status: BuyerRankingLoadStatus
  message?: string
  syncJob?: XhsSyncJobView | null
  ranking?: Awaited<ReturnType<typeof buildBuyerRanking>>
}

function mapBuyerRangeToSyncParams(range: BuyerRankingDateRange): {
  preset: DateRangePreset
  startDate: string
  endDate: string
} {
  if (range.isAll) {
    throw new Error('全部范围不支持自动补数')
  }
  return {
    preset: 'custom',
    startDate: range.startDate,
    endDate: range.endDate,
  }
}

function syncRangeKey(startDate: string, endDate: string): string {
  return `${startDate}|${endDate}`
}

async function findSyncJobForRange(
  syncParams: { startDate: string; endDate: string },
  statuses: string[],
): Promise<XhsSyncJobView | null> {
  const key = syncRangeKey(syncParams.startDate, syncParams.endDate)
  const rows = await prisma.xhsSyncJob.findMany({
    where: {
      status: { in: statuses },
      type: { in: ['buyer_ranking_fill', 'manual', 'full_read', 'live_query'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  for (const row of rows) {
    if (syncRangeKey(row.startDate, row.endDate) === key) return toView(row)
  }
  return null
}

export async function loadBuyerRankingWithAutoFill(params: {
  preset?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
  sortBy?: BuyerRankingSortBy
  sortOrder?: 'asc' | 'desc'
  type?: BuyerRankingType
  anchorName?: string
  anchorId?: string
  syncJobId?: string
  triggeredBy?: string | null
  audit?: { requestId?: string; ip?: string; userAgent?: string }
}): Promise<BuyerRankingLoadResult> {
  const range = resolveBuyerRankingDateRange(
    params.preset ?? 'today',
    params.startDate,
    params.endDate,
  )

  if (range.isAll) {
    const total = await prisma.xhsRawOrder.count()
    if (total === 0) {
      return {
        status: 'need_full_read',
        message: '本地暂无历史订单数据。请前往系统设置 → 数据管理，点击「全量读取数据」初始化本地数据库。',
      }
    }
    const ranking = await buildBuyerRanking(params)
    return { status: 'ready', ranking }
  }

  if (!hasAnyEnabledApi()) {
    return {
      status: 'api_not_configured',
      message: XHS_API_NOT_CONFIGURED_MSG,
    }
  }

  const syncParams = mapBuyerRangeToSyncParams(range)

  if (params.syncJobId) {
    const tracked = await getXhsSyncJobById(params.syncJobId)
    if (tracked && (tracked.status === 'running' || tracked.status === 'pending')) {
      return {
        status: 'syncing',
        syncJob: tracked,
        message: '正在从接口读取当前范围订单…',
      }
    }
    if (tracked && tracked.status === 'failed') {
      return {
        status: 'sync_failed',
        message: tracked.errorMessage ?? '读取失败，请稍后重试',
        syncJob: tracked,
      }
    }
    if (tracked && tracked.status === 'success_empty') {
      return {
        status: 'empty_after_sync',
        message: '当前范围读取完成，但接口返回暂无订单数据',
        syncJob: tracked,
      }
    }
    if (tracked && ['success', 'partial_success'].includes(tracked.status)) {
      const ranking = await buildBuyerRanking(params)
      return { status: 'ready', ranking, syncJob: tracked }
    }
  }

  const running = await findSyncJobForRange(syncParams, ['pending', 'running'])
  if (running) {
    return {
      status: 'syncing',
      syncJob: running,
      message: '正在从接口读取当前范围订单…',
    }
  }

  const { job, alreadyRunning } = await runXhsSyncJob({
    type: 'buyer_ranking_fill',
    preset: syncParams.preset,
    startDate: syncParams.startDate,
    endDate: syncParams.endDate,
    triggeredBy: params.triggeredBy ?? null,
    audit: params.audit,
  })

  return {
    status: 'syncing',
    syncJob: job,
    message: alreadyRunning
      ? '已有数据读取任务进行中，请稍候…'
      : '正在从接口读取当前范围订单…',
  }
}
