/**
 * 安全重开售后工作台队列（dry-run / 分店分批，不绕过限流退避）
 *
 * npx tsx apps/server/scripts/reopen-stale-empty-workbench-queue.ts --dry-run
 * npx tsx apps/server/scripts/reopen-stale-empty-workbench-queue.ts --limit=50 --status=done
 * npx tsx apps/server/scripts/reopen-stale-empty-workbench-queue.ts --force --reason=admin --shop=<id>
 */
import path from 'node:path'
import { config } from 'dotenv'
import { prisma } from '../src/lib/prisma'
import { enqueueWorkbenchSync } from '../src/services/xhs-after-sales-workbench.service'
import {
  extractOrderAfterSaleContextFromRaw,
  resolveWorkbenchCacheValidity,
  shouldReopenWorkbenchQueueTask,
  type WorkbenchCacheSnapshot,
} from '../src/services/workbench-cache-validity.service'

config({ path: path.resolve(__dirname, '../.env') })

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main(): Promise<void> {
  const dryRun = hasFlag('dry-run') || !hasFlag('apply')
  const force = hasFlag('force')
  const shop = arg('shop')
  const limit = Math.max(1, Number(arg('limit') ?? '200') || 200)
  const statusFilter = (arg('status') ?? 'done,failed').split(',').map((s) => s.trim()).filter(Boolean)
  const reason = arg('reason') ?? 'reopen-script'
  const olderThanHours = Number(arg('older-than') ?? '0') || 0

  const whereStatus = statusFilter.length ? statusFilter : ['done', 'failed']
  const queues = await prisma.xhsAfterSalesWorkbenchQueue.findMany({
    where: {
      status: { in: whereStatus },
      ...(shop ? { liveAccountId: shop } : {}),
    },
    select: {
      liveAccountId: true,
      orderNo: true,
      status: true,
      nextAttemptAt: true,
      errorType: true,
      lastError: true,
      updatedAt: true,
    },
    take: Math.min(5000, limit * 5),
    orderBy: { updatedAt: 'asc' },
  })

  const stats = {
    scanned: 0,
    staleEmpty: 0,
    staleSuccess: 0,
    retryWaitNotDue: 0,
    blocked: 0,
    permanentFail: 0,
    safeReopen: 0,
    skipped: 0,
    byShop: new Map<string, number>(),
    applied: 0,
  }

  const cutoff =
    olderThanHours > 0 ? Date.now() - olderThanHours * 3600_000 : null

  for (const q of queues) {
    if (stats.safeReopen + stats.skipped >= limit * 2 && stats.applied >= limit) break
    stats.scanned++
    if (cutoff != null && q.updatedAt.getTime() > cutoff) {
      stats.skipped++
      continue
    }

    const [cache, order] = await Promise.all([
      prisma.xhsAfterSalesWorkbenchCache.findUnique({
        where: {
          liveAccountId_orderNo: { liveAccountId: q.liveAccountId, orderNo: q.orderNo },
        },
      }),
      prisma.xhsRawOrder.findFirst({
        where: {
          liveAccountId: q.liveAccountId,
          OR: [{ packageId: q.orderNo }, { orderId: q.orderNo }],
        },
        select: { rawJson: true, updatedAt: true, orderTime: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ])

    const orderCtx = extractOrderAfterSaleContextFromRaw(
      order?.rawJson && typeof order.rawJson === 'object'
        ? (order.rawJson as Record<string, unknown>)
        : {},
      { orderUpdatedAt: order?.updatedAt, orderTime: order?.orderTime },
    )

    const snap: WorkbenchCacheSnapshot | null = cache
      ? {
          fetchStatus: cache.fetchStatus,
          fetchedAt: cache.fetchedAt,
          updatedAt: cache.updatedAt,
          officialRefundAmountCent: cache.officialRefundAmountCent,
          expectedRefundAmountCent: cache.expectedRefundAmountCent,
          appliedAmountCent: cache.appliedAmountCent,
          appliedShipFeeAmountCent: cache.appliedShipFeeAmountCent,
          freightRefundAmountCent: cache.appliedShipFeeAmountCent,
          successReturnCount: cache.successReturnCount,
          returnRefundCount: cache.returnRefundCount,
          refundOnlyCount: cache.refundOnlyCount,
          hasReturnRefund: cache.hasReturnRefund,
          hasRefundOnly: cache.hasRefundOnly,
          afterSaleStatus: cache.afterSaleStatus,
          afterSaleReason: cache.afterSaleReason,
          afterSaleType: cache.afterSaleType,
          returnTypeCodes: cache.returnTypeCodes,
          classificationSource: cache.classificationSource,
          returnsIds: cache.returnsIds,
          refundIncludesFreight: cache.refundIncludesFreight,
        }
      : null

    const validity = resolveWorkbenchCacheValidity(snap, orderCtx)
    if (validity.staleEmpty) stats.staleEmpty++
    if (validity.staleSuccess) stats.staleSuccess++
    if (q.status === 'blocked') stats.blocked++

    const decision = shouldReopenWorkbenchQueueTask({
      queueStatus: q.status,
      nextAttemptAt: q.nextAttemptAt,
      errorType: q.errorType,
      lastError: q.lastError,
      cache: snap,
      order: orderCtx,
      force,
      source: reason,
      // 非 force：blocked 不自动恢复
      externalHealth: force ? { cookieHealthy: true, signEnvHealthy: true } : undefined,
    })

    if (!decision.reopen) {
      if (decision.reason.startsWith('retry_wait_until')) stats.retryWaitNotDue++
      if (decision.reason.startsWith('permanent_fail')) stats.permanentFail++
      stats.skipped++
      continue
    }

    stats.safeReopen++
    stats.byShop.set(q.liveAccountId, (stats.byShop.get(q.liveAccountId) ?? 0) + 1)

    if (dryRun) continue
    if (stats.applied >= limit) break

    // 分批：每店至多 limit/店铺 在本脚本内写入 pending；真正平台请求仍走队列限流
    await enqueueWorkbenchSync(q.orderNo, q.liveAccountId, {
      force,
      source: reason,
    })
    stats.applied++
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        force,
        limit,
        statusFilter: whereStatus,
        reason,
        scanned: stats.scanned,
        staleEmpty: stats.staleEmpty,
        staleSuccess: stats.staleSuccess,
        retryWaitNotDue: stats.retryWaitNotDue,
        blocked: stats.blocked,
        permanentFail: stats.permanentFail,
        safeReopen: stats.safeReopen,
        skipped: stats.skipped,
        applied: stats.applied,
        estimatedPlatformRequests: dryRun ? stats.safeReopen : stats.applied,
        byShop: Object.fromEntries(stats.byShop),
        note: dryRun
          ? 'dry-run：未改库。加 --apply 正式执行；不要用无限制 --force 冲垮限流。'
          : '已写入 pending；平台请求由售后队列按店限流执行。',
      },
      null,
      2,
    ),
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
