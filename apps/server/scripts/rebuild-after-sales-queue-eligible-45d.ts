/**
 * 近 45 天：有售后信号且缓存缺失/过期 → 重新入队（不直接打平台）
 *
 * npx tsx apps/server/scripts/rebuild-after-sales-queue-eligible-45d.ts
 */
import { syncEligibleAfterSalesWorkbenchFromRaw } from '../src/services/xhs-after-sales-workbench.service'
import { prisma } from '../src/lib/prisma'

async function main(): Promise<void> {
  console.log('rebuild-after-sales-queue-eligible-45d\n')
  const result = await syncEligibleAfterSalesWorkbenchFromRaw({
    lookbackDays: 45,
    source: 'rebuild-after-sales-queue-eligible-45d',
  })
  console.log({
    scanned: result.scanned,
    eligibleKeys: result.eligible,
    enqueued: result.enqueued,
    batch: result.batch,
  })

  const pending = await prisma.xhsAfterSalesWorkbenchQueue.count({
    where: { status: 'pending' },
  })
  const retryWait = await prisma.xhsAfterSalesWorkbenchQueue.count({
    where: { status: 'retry_wait' },
  })
  console.log({ pendingNow: pending, retryWaitNow: retryWait })
  console.log('\nDONE（未请求平台；由 worker 限流消费）')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
