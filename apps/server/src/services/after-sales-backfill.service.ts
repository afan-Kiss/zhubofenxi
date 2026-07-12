/**
 * 售后工作台补查：老板视角任务日志（补什么 / 为什么 / 影响）
 */
import { prisma } from '../lib/prisma'
import {
  completeAfterSalesQueueTask,
  selectAfterSalesQueueTasks,
} from './after-sales-queue.service'
import {
  DEFAULT_AFTER_SALES_QUEUE_LIMITS,
  type AfterSalesQueueRateLimits,
} from './after-sales-queue.types'
import {
  fetchAfterSalesWorkbenchByOrderNo,
  pickBuyerUserIdFromRawJson,
  saveWorkbenchCache,
} from './xhs-after-sales-workbench.service'
import {
  TaskProgressReporter,
  taskFail,
  taskStart,
} from '../utils/task-log'
import {
  logAfterSaleSyncComplete,
  logAfterSaleSyncStart,
} from '../utils/sync-cmd-log'

async function resolveAccountName(liveAccountId: string): Promise<string> {
  if (!liveAccountId || liveAccountId === 'legacy') return '默认账号'
  const row = await prisma.platformCredential.findUnique({
    where: { id: liveAccountId },
    select: { displayName: true },
  })
  return row?.displayName?.trim() || liveAccountId
}

export async function runAfterSalesBackfillBatch(
  limits: AfterSalesQueueRateLimits = DEFAULT_AFTER_SALES_QUEUE_LIMITS,
): Promise<{
  processed: number
  success: number
  failed: number
  retryWait: number
  blocked: number
}> {
  const pending = await selectAfterSalesQueueTasks(limits)

  if (pending.length === 0) {
    return { processed: 0, success: 0, failed: 0, retryWait: 0, blocked: 0 }
  }

  const started = Date.now()
  taskStart(
    '售后补查',
    `本次调度 ${pending.length} 笔售后详情（全局≤${limits.globalPerMinute}/分，每店≤${limits.perShopPerMinute}/分），用于完善退款/品退统计，不会改动支付金额。`,
  )

  const reporter = new TaskProgressReporter('售后补查', pending.length, 5, 15_000)
  let success = 0
  let failed = 0
  let retryWait = 0
  let blocked = 0
  let currentAccount = ''

  const accountStats = new Map<
    string,
    {
      accountName: string
      liveAccountId: string
      processed: number
      success: number
      failed: number
      retryWait: number
      blocked: number
      empty: number
    }
  >()

  for (const item of pending) {
    const accountName = await resolveAccountName(item.liveAccountId)
    currentAccount = accountName
    const statKey = item.liveAccountId || 'legacy'
    const stat = accountStats.get(statKey) ?? {
      accountName,
      liveAccountId: item.liveAccountId,
      processed: 0,
      success: 0,
      failed: 0,
      retryWait: 0,
      blocked: 0,
      empty: 0,
    }
    stat.processed++
    try {
      const rawOrder = await prisma.xhsRawOrder.findFirst({
        where: {
          liveAccountId: item.liveAccountId,
          OR: [{ packageId: item.orderNo }, { orderId: item.orderNo }],
        },
        select: { rawJson: true, buyerId: true },
      })
      const fallbackBuyerUserId = pickBuyerUserIdFromRawJson(
        rawOrder?.rawJson as Record<string, unknown> | undefined,
        rawOrder?.buyerId,
      )
      const result = await fetchAfterSalesWorkbenchByOrderNo(item.orderNo, item.liveAccountId, {
        fallbackBuyerUserId,
      })
      if (result.fetchStatus !== 'failed') {
        await saveWorkbenchCache(result, item.liveAccountId)
      }
      const finalStatus = await completeAfterSalesQueueTask({
        queueId: item.id,
        liveAccountId: item.liveAccountId,
        orderNo: item.orderNo,
        result,
      })
      if (finalStatus === 'done') {
        success++
        if (result.fetchStatus === 'empty') stat.empty++
        else stat.success++
        reporter.tick(true, `当前账号=${accountName}，接口=售后工作台详情`)
      } else if (finalStatus === 'retry_wait') {
        retryWait++
        stat.retryWait++
        reporter.tick(false, `当前账号=${accountName}，冷却等待，接口=售后工作台详情`)
      } else if (finalStatus === 'blocked') {
        blocked++
        stat.blocked++
        reporter.tick(false, `当前账号=${accountName}，店铺阻塞，接口=售后工作台详情`)
      } else {
        failed++
        stat.failed++
        reporter.tick(false, `当前账号=${accountName}，接口=售后工作台详情`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await completeAfterSalesQueueTask({
        queueId: item.id,
        liveAccountId: item.liveAccountId,
        orderNo: item.orderNo,
        result: { fetchStatus: 'failed', fetchError: msg.slice(0, 500) },
      })
      failed++
      stat.failed++
      reporter.tick(false, `当前账号=${accountName}，接口=售后工作台详情`)
    }
    accountStats.set(statKey, stat)
  }

  const accountList = [...accountStats.values()]
  for (let i = 0; i < accountList.length; i++) {
    const stat = accountList[i]!
    const ctx = {
      accountName: stat.accountName,
      liveAccountId: stat.liveAccountId,
      accountIndex: i + 1,
      accountTotal: accountList.length,
    }
    logAfterSaleSyncStart(ctx, `补查队列 ${stat.processed} 笔订单`)
    const apiRows = stat.success + stat.empty
    logAfterSaleSyncComplete({
      ctx,
      apiRows,
      matchedOrders: stat.success,
      unmatched: stat.empty + stat.failed + stat.retryWait + stat.blocked,
    })
  }

  const durationSec = Math.round((Date.now() - started) / 1000)
  const lastAccount = currentAccount || '—'

  reporter.finish(
    `${pending.length} 笔补查结束，成功 ${success}，冷却等待 ${retryWait}，阻塞 ${blocked}，永久失败 ${failed}，用时 ${durationSec} 秒。最后处理账号=${lastAccount}`,
  )

  return { processed: pending.length, success, failed, retryWait, blocked }
}

export async function logAfterSalesBackfillFailure(
  accountName: string,
  reason: string,
): Promise<void> {
  taskFail(
    '售后补查',
    `账号=${accountName}，接口=售后工作台详情，原因=${reason}。本次只影响售后补查，不影响已同步订单和支付金额。`,
  )
}
