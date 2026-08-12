/**
 * 验收：平台 HTTP 500 触顶不落 failed；重开清零 temporaryAttemptCount
 * 运行：npx tsx apps/server/scripts/accept-after-sales-transient-park.ts
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { AFTER_SALES_MAX_TEMPORARY_ATTEMPTS } from '../src/services/after-sales-queue.types'
import { completeAfterSalesQueueTask } from '../src/services/after-sales-queue.service'
import { enqueueWorkbenchSync } from '../src/services/xhs-after-sales-workbench.service'

const SHOP = `accept-as-shop-${Date.now()}`
const ORDER = `P800ACCEPT${String(Date.now()).slice(-10)}`

async function main() {
  console.log('accept-after-sales-transient-park')

  await prisma.xhsAfterSalesWorkbenchQueue.deleteMany({
    where: { liveAccountId: SHOP, orderNo: ORDER },
  })

  const created = await prisma.xhsAfterSalesWorkbenchQueue.create({
    data: {
      liveAccountId: SHOP,
      orderNo: ORDER,
      status: 'running',
      temporaryAttemptCount: AFTER_SALES_MAX_TEMPORARY_ATTEMPTS - 1,
      attempts: 3,
      claimToken: 'accept-token',
      workerId: 'accept-worker',
      runningSince: new Date(),
      claimedAt: new Date(),
      statusChangedAt: new Date(),
    },
  })

  const status = await completeAfterSalesQueueTask({
    queueId: created.id,
    liveAccountId: SHOP,
    orderNo: ORDER,
    result: {
      fetchStatus: 'error',
      fetchError: '小红书接口请求失败 HTTP 500',
    },
    httpStatus: 500,
    claimToken: 'accept-token',
    workerId: 'accept-worker',
  })
  assert.equal(status, 'retry_wait', '平台 500 触顶应停车到 retry_wait，而不是 failed')

  const parked = await prisma.xhsAfterSalesWorkbenchQueue.findUniqueOrThrow({
    where: { id: created.id },
  })
  assert.equal(parked.status, 'retry_wait')
  assert.equal(parked.errorType, 'http_500')
  assert.equal(parked.temporaryAttemptCount, 0, '触顶停车应清零临时重试计数')
  assert.ok(parked.nextAttemptAt, '应有下次尝试时间')
  assert.ok(
    (parked.nextAttemptAt!.getTime() - Date.now()) > 5 * 60 * 60_000,
    '触顶停车应长退避（约 6 小时）',
  )

  // 模拟到期重开：走 ensure 强制 reopen 路径前，先把 nextAttemptAt 置为过去并标 failed（旧数据形态）
  await prisma.xhsAfterSalesWorkbenchQueue.update({
    where: { id: created.id },
    data: {
      status: 'failed',
      errorType: 'attempt_cap',
      lastError: '重试次数过多已停止（99次）：HTTP 500',
      temporaryAttemptCount: 99,
      nextAttemptAt: null,
    },
  })

  const reopen = await enqueueWorkbenchSync(ORDER, SHOP, {
    force: true,
    source: 'accept-after-sales-transient-park',
  })
  assert.equal(reopen.reopened, true, 'failed+attempt_cap 应可重开')

  const afterReopen = await prisma.xhsAfterSalesWorkbenchQueue.findUniqueOrThrow({
    where: { id: created.id },
  })
  assert.equal(afterReopen.status, 'pending')
  assert.equal(
    afterReopen.temporaryAttemptCount,
    0,
    '重开必须清零 temporaryAttemptCount，否则会立刻再次触顶',
  )
  assert.equal(afterReopen.errorType, null)
  assert.equal(afterReopen.lastError, null)

  await prisma.xhsAfterSalesWorkbenchQueue.deleteMany({
    where: { liveAccountId: SHOP, orderNo: ORDER },
  })
  await prisma.shopAfterSalesRuntime.deleteMany({ where: { liveAccountId: SHOP } }).catch(() => {})

  console.log('OK accept-after-sales-transient-park')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
