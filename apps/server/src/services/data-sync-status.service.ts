import { prisma } from '../lib/prisma'
import { listSyncJobLogs } from './sync-job-log.service'
import { buildQualityFeedbackPublicStatus } from './quality-badcase-auto-sync.service'

function mapOverallSyncStatus(
  runningJob: { status: string } | null,
  qualityStatus: string,
): 'normal' | 'updating' | 'failed' {
  if (runningJob?.status === 'running') return 'updating'
  if (qualityStatus === 'running') return 'updating'
  if (qualityStatus === 'failed') return 'failed'
  return 'normal'
}

export async function getDataSyncStatus() {
  const [
    orderAgg,
    liveCount,
    pendingSettlement,
    settledSettlement,
    lastFullRead,
    lastManual,
    lastScheduled,
    recentJobs,
    buyerRankingCache,
    qualityFeedback,
  ] = await Promise.all([
    prisma.xhsRawOrder.aggregate({
      _count: true,
      _min: { orderTime: true },
      _max: { orderTime: true },
    }),
    prisma.xhsRawLiveSession.count(),
    prisma.xhsRawPendingSettlement.count(),
    prisma.xhsRawSettledSettlement.count(),
    prisma.xhsSyncJob.findFirst({
      where: { type: 'full_read' },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.xhsSyncJob.findFirst({
      where: { type: { in: ['manual', 'buyer_ranking_fill'] } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.xhsSyncJob.findFirst({
      where: { type: 'scheduled' },
      orderBy: { createdAt: 'desc' },
    }),
    listSyncJobLogs(1, 10),
    prisma.buyerRankingCache.findUnique({ where: { id: 'default' } }),
    buildQualityFeedbackPublicStatus(),
  ])

  const runningJob = await prisma.xhsSyncJob.findFirst({ where: { status: 'running' } })
  const fullReadDone = Boolean(
    lastFullRead && ['success', 'partial_success'].includes(lastFullRead.status),
  )

  return {
    lastSync: {
      fullReadAt:
        lastFullRead?.finishedAt?.toISOString() ?? lastFullRead?.createdAt?.toISOString() ?? null,
      autoSyncAt:
        lastScheduled?.finishedAt?.toISOString() ??
        lastScheduled?.createdAt?.toISOString() ??
        null,
      manualRefreshAt:
        lastManual?.finishedAt?.toISOString() ?? lastManual?.createdAt?.toISOString() ?? null,
      orderDataAt: orderAgg._max.orderTime?.toISOString() ?? null,
      qualityFeedbackAt: qualityFeedback.lastSyncedAt,
      buyerRankingAt: buyerRankingCache?.updatedAt?.toISOString() ?? null,
    },
    dataSyncHealth: {
      status: mapOverallSyncStatus(runningJob, qualityFeedback.autoSyncStatus),
      qualityFeedback,
    },
    coverage: {
      earliestOrderTime: orderAgg._min.orderTime?.toISOString() ?? null,
      latestOrderTime: orderAgg._max.orderTime?.toISOString() ?? null,
      orderCount: orderAgg._count,
      liveSessionCount: liveCount,
      pendingSettlementCount: pendingSettlement,
      settledSettlementCount: settledSettlement,
    },
    fullRead: {
      hasFullRead: fullReadDone,
      scope: lastFullRead?.preset ?? null,
      rangeLabel: lastFullRead?.rangeLabel ?? null,
      lastStatus: lastFullRead?.status ?? null,
      lastError: lastFullRead?.errorMessage ?? null,
      ordersRead: lastFullRead?.orderCount ?? 0,
      liveSessionsRead: lastFullRead?.liveSessionCount ?? 0,
      settlementsRead:
        (lastFullRead?.pendingCount ?? 0) + (lastFullRead?.settledCount ?? 0),
      finishedAt: lastFullRead?.finishedAt?.toISOString() ?? null,
    },
    recentTasks: recentJobs.items.map((j) => ({
      syncJobId: j.syncJobId,
      type: j.type,
      typeLabel:
        j.type === 'full_read'
          ? '全量读取'
          : j.type === 'scheduled'
            ? '自动同步'
            : j.type === 'buyer_ranking_fill'
              ? '买家排行补数'
              : '手动刷新',
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      status: j.status,
      orderCount: j.orderCount,
      errorMessage: j.errorMessage,
    })),
  }
}
