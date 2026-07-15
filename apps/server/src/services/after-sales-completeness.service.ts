/**
 * 售后补查完整性状态：供经营总览 / 主播业绩 / 导出提示
 */
import { prisma } from '../lib/prisma'
import { getAfterSalesQueueStatusCounts } from './after-sales-queue.service'

export type AfterSalesCompletenessStatus = 'complete' | 'partial' | 'pending' | 'blocked'

export interface AfterSalesCompleteness {
  status: AfterSalesCompletenessStatus
  pendingCount: number
  retryWaitCount: number
  blockedCount: number
  failedCount: number
  runningCount: number
  doneCount: number
  oldestPendingAt: string | null
  affectedShopCount: number
  lastSuccessfulFetchAt: string | null
  note: string
}

export async function resolveAfterSalesCompleteness(): Promise<AfterSalesCompleteness> {
  const counts = await getAfterSalesQueueStatusCounts()
  const pendingCount = counts.pending ?? 0
  const retryWaitCount = counts.retry_wait ?? 0
  const blockedCount = counts.blocked ?? 0
  const failedCount = counts.failed ?? 0
  const runningCount = counts.running ?? 0
  const doneCount = counts.done ?? 0

  const [oldestPending, shopGroups, lastOk] = await Promise.all([
    prisma.xhsAfterSalesWorkbenchQueue.findFirst({
      where: { status: { in: ['pending', 'retry_wait', 'running'] } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.xhsAfterSalesWorkbenchQueue.groupBy({
      by: ['liveAccountId'],
      where: { status: { in: ['pending', 'retry_wait', 'running', 'blocked'] } },
      _count: { _all: true },
    }),
    prisma.xhsAfterSalesWorkbenchCache.findFirst({
      where: { fetchStatus: { in: ['success', 'empty'] } },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    }),
  ])

  const open = pendingCount + retryWaitCount + runningCount
  let status: AfterSalesCompletenessStatus = 'complete'
  let note = '售后补查已完成，退款与签收可按当前结果查看。'
  if (blockedCount > 0 && open === 0) {
    status = 'blocked'
    note = '部分店铺售后补查受阻（Cookie/签名），退款与签收可能不完整。'
  } else if (open > 0 && (doneCount > 0 || (lastOk?.fetchedAt != null))) {
    status = open > 200 ? 'pending' : 'partial'
    note =
      status === 'pending'
        ? '售后补查进行中，退款单数/退款金额/签收金额可能继续变化。'
        : '售后补查部分完成，退款与签收仍可能继续更新。'
  } else if (open > 0) {
    status = 'pending'
    note = '售后补查尚未完成，退款与签收请暂作过程数据参考。'
  }

  return {
    status,
    pendingCount,
    retryWaitCount,
    blockedCount,
    failedCount,
    runningCount,
    doneCount,
    oldestPendingAt: oldestPending?.createdAt?.toISOString() ?? null,
    affectedShopCount: shopGroups.length,
    lastSuccessfulFetchAt: lastOk?.fetchedAt?.toISOString() ?? null,
    note,
  }
}
