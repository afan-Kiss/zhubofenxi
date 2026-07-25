/**
 * 修复卡死的售后 running 任务（默认 dry-run）
 *
 * npm run repair:after-sales-stuck-running
 * npm run repair:after-sales-stuck-running -- --apply
 *
 * 不调用平台、不改熔断、不改 pending 目标单。
 */
import { prisma } from '../src/lib/prisma'
import {
  decideStuckRunningDisposition,
  isRunningTimedOut,
  recoverStuckAfterSalesRunningTasksDetailed,
} from '../src/services/after-sales-queue.service'
import { resolveAfterSalesQueueEligibility } from '../src/services/after-sales-fetch-decision.service'
import { AFTER_SALES_RUNNING_TIMEOUT_MS } from '../src/services/after-sales-queue.types'
import {
  getOfficialQualityPackageIdSet,
  loadAllQualityBadCases,
} from '../src/services/quality-badcase-store.service'
import { liveAccountPackageKey } from '../src/utils/live-account-cache-key.util'

const APPLY = process.argv.includes('--apply')
const TARGET_GUARD = 'P800331172827463091'

async function dryRun(): Promise<void> {
  const running = await prisma.xhsAfterSalesWorkbenchQueue.findMany({
    where: { status: 'running' },
    select: {
      id: true,
      liveAccountId: true,
      orderNo: true,
      priority: true,
      claimToken: true,
      temporaryAttemptCount: true,
      runningSince: true,
      claimedAt: true,
      lastAttemptAt: true,
      statusChangedAt: true,
      updatedAt: true,
    },
  })

  let fresh = 0
  let timedOut = 0
  let closeNoSignal = 0
  let restoreRetry = 0
  let timestampMissing = 0
  const byShop = new Map<string, { scanned: number; close: number; retry: number }>()
  const byPriority = new Map<number, number>()
  const nowMs = Date.now()

  let officialSet: Set<string>
  try {
    officialSet = getOfficialQualityPackageIdSet(await loadAllQualityBadCases())
  } catch {
    officialSet = new Set()
  }

  for (const row of running) {
    const shop = byShop.get(row.liveAccountId) ?? { scanned: 0, close: 0, retry: 0 }
    shop.scanned++
    byShop.set(row.liveAccountId, shop)
    byPriority.set(row.priority, (byPriority.get(row.priority) ?? 0) + 1)

    const info = isRunningTimedOut(row, { nowMs, timeoutMs: AFTER_SALES_RUNNING_TIMEOUT_MS })
    if (!info.timedOut) {
      fresh++
      continue
    }
    timedOut++
    if (info.timestampMissing) timestampMissing++

    const order = await prisma.xhsRawOrder.findFirst({
      where: {
        liveAccountId: row.liveAccountId,
        OR: [
          { packageId: row.orderNo },
          { displayOrderNo: row.orderNo },
          { orderId: row.orderNo },
        ],
      },
      select: {
        afterSaleStatusText: true,
        orderStatusText: true,
        isReturned: true,
        rawJson: true,
      },
      orderBy: { updatedAt: 'desc' },
    })

    const elig = resolveAfterSalesQueueEligibility(
      {
        displayOrderNo: row.orderNo,
        officialOrderNo: row.orderNo,
        liveAccountId: row.liveAccountId,
        afterSaleStatusText: order?.afterSaleStatusText ?? undefined,
        orderStatusText: order?.orderStatusText ?? undefined,
        isReturned: Boolean(order?.isReturned),
        raw:
          order?.rawJson && typeof order.rawJson === 'object'
            ? (order.rawJson as Record<string, unknown>)
            : undefined,
      },
      {
        officialQualityCaseMatched: officialSet.has(
          liveAccountPackageKey(row.liveAccountId, row.orderNo),
        ),
        cacheMissingOrStale: true,
        cacheCurrentlyValid: false,
      },
    )

    const disposition = decideStuckRunningDisposition(elig.eligible)
    if (disposition === 'done') {
      closeNoSignal++
      shop.close++
    } else {
      restoreRetry++
      shop.retry++
    }
  }

  const target = await prisma.xhsAfterSalesWorkbenchQueue.findFirst({
    where: { orderNo: TARGET_GUARD },
    select: { status: true, priority: true, triggerReason: true },
  })

  console.log('repair-after-sales-stuck-running mode=DRY-RUN\n')
  console.log('=== summary ===')
  console.log({
    scannedRunning: running.length,
    freshNotTimedOut: fresh,
    timedOut,
    willCloseNoSignal: closeNoSignal,
    willRestoreRetryWait: restoreRetry,
    timestampMissing,
    casConflictSkipped: 0,
  })
  console.log('\n=== by shop ===')
  for (const [sid, s] of [...byShop.entries()].sort((a, b) => b[1].scanned - a[1].scanned)) {
    console.log(sid, s)
  }
  console.log('\n=== by priority (running) ===')
  console.log(Object.fromEntries([...byPriority.entries()].sort((a, b) => b[0] - a[0])))
  console.log('\n=== target order guard (must not be rewritten by this script unless stuck running) ===')
  console.log({ orderNo: TARGET_GUARD, queue: target })
  console.log('\nDRY-RUN 完成。确认后请加 --apply 落库。')
}

async function apply(): Promise<void> {
  console.log('repair-after-sales-stuck-running mode=APPLY\n')
  const beforeTarget = await prisma.xhsAfterSalesWorkbenchQueue.findFirst({
    where: { orderNo: TARGET_GUARD },
    select: { id: true, status: true, priority: true, triggerReason: true, updatedAt: true },
  })
  const stats = await recoverStuckAfterSalesRunningTasksDetailed(AFTER_SALES_RUNNING_TIMEOUT_MS)
  const afterTarget = await prisma.xhsAfterSalesWorkbenchQueue.findFirst({
    where: { orderNo: TARGET_GUARD },
    select: { id: true, status: true, priority: true, triggerReason: true, updatedAt: true },
  })

  console.log('=== apply summary ===')
  console.log(stats)
  console.log('\n=== target order ===')
  console.log({ before: beforeTarget, after: afterTarget })
  if (
    beforeTarget &&
    afterTarget &&
    beforeTarget.status !== 'running' &&
    (beforeTarget.status !== afterTarget.status ||
      beforeTarget.priority !== afterTarget.priority ||
      beforeTarget.triggerReason !== afterTarget.triggerReason)
  ) {
    console.error('ERROR: 非 running 的目标订单被改动，请立即检查')
    process.exitCode = 1
  }
  console.log('\nAPPLY 完成。')
}

async function main(): Promise<void> {
  if (APPLY) await apply()
  else await dryRun()
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
