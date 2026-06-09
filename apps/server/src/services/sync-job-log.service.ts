import { prisma } from '../lib/prisma'
import type { XhsSyncJobView } from './xhs-api-sync/xhs-sync-job.service'
import { toView } from './xhs-api-sync/xhs-sync-job.service'

export type SyncTriggerLabel = '手动' | '定时' | '初始化'

export interface SyncJobLogItem extends XhsSyncJobView {
  triggerLabel: SyncTriggerLabel
  orderPulledCount: number
  orderNewCount: number
  orderUpdatedCount: number
  snapshotGenerated: boolean
}

function triggerLabel(type: string, preset: string): SyncTriggerLabel {
  if (type === 'auto_when_empty') return '初始化'
  if (type === 'scheduled' || preset === 'daily_strategy') return '定时'
  return '手动'
}

function isSuccessStatus(status: string): boolean {
  return status === 'success' || status === 'partial_success' || status === 'success_empty'
}

export async function countOrderStatsForJob(syncJobId: string): Promise<{
  orderNewCount: number
  orderUpdatedCount: number
}> {
  const rows = await prisma.xhsRawOrder.findMany({
    where: { syncJobId },
    select: { createdAt: true, updatedAt: true },
  })
  let orderNewCount = 0
  let orderUpdatedCount = 0
  for (const row of rows) {
    const delta = Math.abs(row.updatedAt.getTime() - row.createdAt.getTime())
    if (delta < 3000) orderNewCount++
    else orderUpdatedCount++
  }
  return { orderNewCount, orderUpdatedCount }
}

export async function enrichSyncJobLog(
  view: XhsSyncJobView,
  row?: { refreshJobId: string | null; startedAt: Date | null },
): Promise<SyncJobLogItem> {
  const stats = await countOrderStatsForJob(view.syncJobId)
  return {
    ...view,
    triggerLabel: triggerLabel(view.type, view.preset),
    orderPulledCount: view.orderCount,
    orderNewCount: stats.orderNewCount,
    orderUpdatedCount: stats.orderUpdatedCount,
    snapshotGenerated: Boolean(row?.refreshJobId),
    startedAt: view.startedAt ?? row?.startedAt?.toISOString() ?? null,
  }
}

export function syncSuccessLabel(status: string): '成功' | '失败' | '进行中' {
  if (status === 'running' || status === 'pending') return '进行中'
  return isSuccessStatus(status) ? '成功' : '失败'
}

export async function listSyncJobLogs(page = 1, pageSize = 20) {
  const safePage = Math.max(1, Math.floor(page))
  const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize)))
  const [total, rows] = await Promise.all([
    prisma.xhsSyncJob.count(),
    prisma.xhsSyncJob.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (safePage - 1) * safeSize,
      take: safeSize,
    }),
  ])

  const items: SyncJobLogItem[] = []
  for (const row of rows) {
    items.push(await enrichSyncJobLog(toView(row), row))
  }

  return {
    items,
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  }
}
