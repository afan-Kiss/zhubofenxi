/**
 * 清理无售后信号的售后队列积压（默认 dry-run）
 *
 * npx tsx apps/server/scripts/prune-after-sales-queue-no-signal.ts
 * npx tsx apps/server/scripts/prune-after-sales-queue-no-signal.ts --apply
 */
import { prisma } from '../src/lib/prisma'
import {
  resolveAfterSalesQueueEligibility,
  type ShouldFetchWorkbenchInput,
} from '../src/services/after-sales-fetch-decision.service'
import { writeAfterSalesQueueAudit } from '../src/services/after-sales-queue-audit.service'

const APPLY = process.argv.includes('--apply')

type AmountBucket = 'lt_2990' | 'eq_2990' | 'gt_2990' | 'unknown'

function amountBucket(cent: number | null | undefined): AmountBucket {
  if (cent == null || !Number.isFinite(cent)) return 'unknown'
  if (cent < 2990) return 'lt_2990'
  if (cent === 2990) return 'eq_2990'
  return 'gt_2990'
}

async function main(): Promise<void> {
  console.log(`prune-after-sales-queue-no-signal mode=${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)

  const rows = await prisma.xhsAfterSalesWorkbenchQueue.findMany({
    where: { status: { in: ['pending', 'retry_wait'] } },
    select: {
      id: true,
      liveAccountId: true,
      orderNo: true,
      status: true,
      priority: true,
      createdAt: true,
      signalDetectedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  let scanned = 0
  let pruned = 0
  let kept = 0
  let blockedFailedReported = 0
  const byShop = new Map<string, { scanned: number; pruned: number; kept: number }>()
  const byAmount = { lt_2990: 0, eq_2990: 0, gt_2990: 0, unknown: 0 }
  const byAmountPruned = { lt_2990: 0, eq_2990: 0, gt_2990: 0, unknown: 0 }
  const priorityKept = new Map<number, number>()
  let oldestKeptPendingMs: number | null = null

  const now = Date.now()

  for (const q of rows) {
    scanned++
    const shop = byShop.get(q.liveAccountId) ?? { scanned: 0, pruned: 0, kept: 0 }
    shop.scanned++
    byShop.set(q.liveAccountId, shop)

    const order = await prisma.xhsRawOrder.findFirst({
      where: {
        liveAccountId: q.liveAccountId,
        OR: [
          { packageId: q.orderNo },
          { displayOrderNo: q.orderNo },
          { orderId: q.orderNo },
        ],
      },
      select: {
        afterSaleStatusText: true,
        orderStatusText: true,
        isReturned: true,
        actualPaidCent: true,
        rawJson: true,
      },
      orderBy: { updatedAt: 'desc' },
    })

    const bucket = amountBucket(order?.actualPaidCent ?? null)
    byAmount[bucket]++

    const input: ShouldFetchWorkbenchInput = {
      displayOrderNo: q.orderNo,
      officialOrderNo: q.orderNo,
      afterSaleStatusText: order?.afterSaleStatusText ?? undefined,
      orderStatusText: order?.orderStatusText ?? undefined,
      isReturned: Boolean(order?.isReturned),
      raw:
        order?.rawJson && typeof order.rawJson === 'object'
          ? (order.rawJson as Record<string, unknown>)
          : undefined,
    }

    const elig = resolveAfterSalesQueueEligibility(input, {
      cacheMissingOrStale: true,
      cacheCurrentlyValid: false,
    })

    if (!elig.eligible) {
      pruned++
      shop.pruned++
      byAmountPruned[bucket]++
      if (APPLY) {
        await prisma.xhsAfterSalesWorkbenchQueue.update({
          where: { id: q.id },
          data: {
            status: 'done',
            completedAt: new Date(),
            lastError: null,
            errorType: null,
            nextAttemptAt: null,
            runningSince: null,
            workerId: null,
            claimToken: null,
            claimedAt: null,
            triggerReason: 'no_after_sale_signal_pruned',
            priority: 0,
            statusChangedAt: new Date(),
          },
        })
        await writeAfterSalesQueueAudit({
          liveAccountId: q.liveAccountId,
          orderNo: q.orderNo,
          fromStatus: q.status,
          toStatus: 'done',
          reason: 'no_after_sale_signal_pruned',
          source: 'after_sales_queue_rebuild',
        })
      }
      continue
    }

    kept++
    shop.kept++
    priorityKept.set(elig.priority, (priorityKept.get(elig.priority) ?? 0) + 1)
    const ageMs = now - (q.signalDetectedAt?.getTime() ?? q.createdAt.getTime())
    if (oldestKeptPendingMs == null || ageMs > oldestKeptPendingMs) {
      oldestKeptPendingMs = ageMs
    }

    if (APPLY && elig.priority !== q.priority) {
      await prisma.xhsAfterSalesWorkbenchQueue.update({
        where: { id: q.id },
        data: {
          priority: elig.priority,
          triggerReason: elig.reason,
          signalDetectedAt: q.signalDetectedAt ?? new Date(),
        },
      })
    }
  }

  // blocked/failed 只报告
  const blockedFailed = await prisma.xhsAfterSalesWorkbenchQueue.groupBy({
    by: ['status'],
    where: { status: { in: ['blocked', 'failed'] } },
    _count: { _all: true },
  })
  for (const r of blockedFailed) {
    blockedFailedReported += r._count._all
  }

  console.log('=== summary ===')
  console.log({
    scanned,
    pruned,
    kept,
    blockedFailedReported,
    oldestKeptPendingHours:
      oldestKeptPendingMs != null
        ? Number((oldestKeptPendingMs / 3600000).toFixed(2))
        : null,
  })
  console.log('\n=== by shop ===')
  for (const [sid, s] of [...byShop.entries()].sort((a, b) => b[1].scanned - a[1].scanned)) {
    console.log(sid, s)
  }
  console.log('\n=== by amount (display only, not eligibility) ===')
  console.log({ scanned: byAmount, pruned: byAmountPruned })
  console.log('\n=== kept priority distribution ===')
  console.log(Object.fromEntries([...priorityKept.entries()].sort((a, b) => b[0] - a[0])))

  if (!APPLY) {
    console.log('\nDRY-RUN 完成。确认后请加 --apply 落库。')
  } else {
    console.log('\nAPPLY 完成。')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
