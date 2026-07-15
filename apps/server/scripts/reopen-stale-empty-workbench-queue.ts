/**
 * 生产一次性：把「主表已售后完成但工作台仍 empty/过期」的队列重开为 pending
 * npx tsx apps/server/scripts/reopen-stale-empty-workbench-queue.ts
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { enqueueWorkbenchSync } from '../src/services/xhs-after-sales-workbench.service'
import {
  extractOrderAfterSaleContextFromRaw,
  isWorkbenchCacheCurrentlyValid,
  shouldReopenWorkbenchQueueTask,
} from '../src/services/workbench-cache-validity.service'

config({ path: path.resolve(__dirname, '../.env') })

async function main(): Promise<void> {
  const queues = await prisma.xhsAfterSalesWorkbenchQueue.findMany({
    where: { status: { in: ['done', 'failed', 'blocked', 'retry_wait'] } },
    select: { liveAccountId: true, orderNo: true, status: true },
    take: 5000,
  })
  let reopen = 0
  for (const q of queues) {
    const [cache, order] = await Promise.all([
      prisma.xhsAfterSalesWorkbenchCache.findUnique({
        where: {
          liveAccountId_orderNo: { liveAccountId: q.liveAccountId, orderNo: q.orderNo },
        },
        select: {
          fetchStatus: true,
          fetchedAt: true,
          updatedAt: true,
          officialRefundAmountCent: true,
          successReturnCount: true,
          hasReturnRefund: true,
          hasRefundOnly: true,
          appliedShipFeeAmountCent: true,
        },
      }),
      prisma.xhsRawOrder.findFirst({
        where: {
          liveAccountId: q.liveAccountId,
          OR: [{ packageId: q.orderNo }, { orderId: q.orderNo }],
        },
        select: { rawJson: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ])
    const orderCtx = extractOrderAfterSaleContextFromRaw(
      order?.rawJson && typeof order.rawJson === 'object'
        ? (order.rawJson as Record<string, unknown>)
        : {},
    )
    const snap = cache
      ? {
          fetchStatus: cache.fetchStatus,
          fetchedAt: cache.fetchedAt,
          updatedAt: cache.updatedAt,
          officialRefundAmountCent: cache.officialRefundAmountCent,
          successReturnCount: cache.successReturnCount,
          hasReturnRefund: cache.hasReturnRefund,
          hasRefundOnly: cache.hasRefundOnly,
          freightRefundAmountCent: cache.appliedShipFeeAmountCent,
        }
      : null
    if (
      shouldReopenWorkbenchQueueTask({
        queueStatus: q.status,
        cache: snap,
        order: orderCtx,
      }) ||
      (snap && !isWorkbenchCacheCurrentlyValid(snap, orderCtx))
    ) {
      await enqueueWorkbenchSync(q.orderNo, q.liveAccountId, { force: true })
      reopen++
    }
  }
  console.log(`扫描队列 ${queues.length}，重开 ${reopen}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
