/**
 * 售后工作台补查：老板视角任务日志（补什么 / 为什么 / 影响）
 * 同店打包 keywords 批量拉取，逐单写缓存/完结队列。
 */
import { prisma } from '../lib/prisma'
import {
  completeAfterSalesQueueTask,
  selectAfterSalesQueueTasks,
  type SelectedAfterSalesQueueTask,
} from './after-sales-queue.service'
import {
  DEFAULT_AFTER_SALES_QUEUE_LIMITS,
  type AfterSalesQueueRateLimits,
} from './after-sales-queue.types'
import {
  fetchAfterSalesWorkbenchByOrderNo,
  fetchAfterSalesWorkbenchByOrderNos,
  pickBuyerUserIdFromRawJson,
  saveWorkbenchCache,
  type AfterSalesWorkbenchRefund,
} from './xhs-after-sales-workbench.service'
import {
  TaskProgressReporter,
  taskFail,
  taskStart,
} from '../utils/task-log'
import { logInfo } from '../utils/server-log'
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

async function loadFallbackBuyerUserId(
  liveAccountId: string,
  orderNo: string,
): Promise<string | undefined> {
  const rawOrder = await prisma.xhsRawOrder.findFirst({
    where: {
      liveAccountId,
      OR: [{ packageId: orderNo }, { orderId: orderNo }],
    },
    select: { rawJson: true, buyerId: true },
  })
  return pickBuyerUserIdFromRawJson(
    rawOrder?.rawJson as Record<string, unknown> | undefined,
    rawOrder?.buyerId,
  )
}

async function finalizeOneTask(params: {
  item: SelectedAfterSalesQueueTask
  result: AfterSalesWorkbenchRefund
  accountName: string
  reporter: TaskProgressReporter
  counters: {
    success: number
    failed: number
    retryWait: number
    blocked: number
  }
  stat: {
    success: number
    failed: number
    retryWait: number
    blocked: number
    empty: number
  }
}): Promise<void> {
  const { item, result, accountName, reporter, counters, stat } = params
  if (result.fetchStatus !== 'failed') {
    await saveWorkbenchCache(result, item.liveAccountId)
  }
  const finalStatus = await completeAfterSalesQueueTask({
    queueId: item.id,
    liveAccountId: item.liveAccountId,
    orderNo: item.orderNo,
    result,
    claimToken: item.claimToken,
    workerId: item.workerId,
  })
  if (finalStatus === 'done') {
    counters.success++
    if (result.fetchStatus === 'empty') stat.empty++
    else stat.success++
    reporter.tick(true, `当前账号=${accountName}，接口=售后工作台批量`)
  } else if (finalStatus === 'retry_wait') {
    counters.retryWait++
    stat.retryWait++
    reporter.tick(false, `当前账号=${accountName}，冷却等待，接口=售后工作台批量`)
  } else if (finalStatus === 'blocked') {
    counters.blocked++
    stat.blocked++
    reporter.tick(false, `当前账号=${accountName}，店铺阻塞，接口=售后工作台批量`)
  } else {
    counters.failed++
    stat.failed++
    reporter.tick(false, `当前账号=${accountName}，接口=售后工作台批量`)
  }
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
  // 总闸：与经营订单同步同源；关闭时零 HTTP（仍可恢复超时 running）
  const { getApiSyncSettings } = await import('./system-setting.service')
  const settings = await getApiSyncSettings()
  const { recoverStuckAfterSalesRunningTasks } = await import('./after-sales-queue.service')
  await recoverStuckAfterSalesRunningTasks()

  if (!settings.apiSyncEnabled) {
    logInfo('售后补查', '售后补查已暂停（apiSyncEnabled=false），本次不拉取平台。')
    return { processed: 0, success: 0, failed: 0, retryWait: 0, blocked: 0 }
  }

  const pending = await selectAfterSalesQueueTasks(limits)

  if (pending.length === 0) {
    return { processed: 0, success: 0, failed: 0, retryWait: 0, blocked: 0 }
  }

  const started = Date.now()
  const shopCount = new Set(pending.map((p) => p.liveAccountId)).size
  taskStart(
    '售后补查',
    `本次调度 ${pending.length} 笔售后详情（约 ${shopCount} 店批量 keywords，每店≤${limits.perShopPerMinute} 单/请求，最多 ${limits.maxShopsPerBatch} 店），用于完善退款/品退统计，不会改动支付金额。`,
  )

  const reporter = new TaskProgressReporter('售后补查', pending.length, 5, 15_000)
  const counters = { success: 0, failed: 0, retryWait: 0, blocked: 0 }
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

  const byShop = new Map<string, SelectedAfterSalesQueueTask[]>()
  for (const item of pending) {
    const list = byShop.get(item.liveAccountId) ?? []
    list.push(item)
    byShop.set(item.liveAccountId, list)
  }

  for (const [liveAccountId, items] of byShop) {
    const accountName = await resolveAccountName(liveAccountId)
    currentAccount = accountName
    const stat = accountStats.get(liveAccountId) ?? {
      accountName,
      liveAccountId,
      processed: 0,
      success: 0,
      failed: 0,
      retryWait: 0,
      blocked: 0,
      empty: 0,
    }
    stat.processed += items.length

    const orderNos = items.map((i) => i.orderNo)
    let results: Map<string, AfterSalesWorkbenchRefund>
    try {
      results = await fetchAfterSalesWorkbenchByOrderNos(orderNos, liveAccountId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      for (const item of items) {
        await finalizeOneTask({
          item,
          result: {
            orderNo: item.orderNo,
            packageId: item.orderNo,
            officialRefundAmountCent: 0,
            freightRefundAmountCent: 0,
            expectedRefundAmountCent: 0,
            appliedAmountCent: 0,
            appliedShipFeeAmountCent: 0,
            payAmountCent: 0,
            settlementAmountCent: 0,
            refundIncludesFreight: false,
            hasFreightOnlyRefund: false,
            buyerUserId: null,
            afterSaleReason: null,
            afterSaleStatus: null,
            successReturnCount: 0,
            returnsIds: [],
            fetchedAt: null,
            liveAccountId,
            fetchStatus: 'failed',
            fetchError: msg.slice(0, 500),
          },
          accountName,
          reporter,
          counters,
          stat,
        })
      }
      accountStats.set(liveAccountId, stat)
      continue
    }

    // HTTP 整批失败：同一错误写回所有单
    const firstFailed = [...results.values()].find((r) => r.fetchStatus === 'failed')
    const allFailed =
      results.size > 0 && [...results.values()].every((r) => r.fetchStatus === 'failed')
    if (allFailed && firstFailed) {
      for (const item of items) {
        await finalizeOneTask({
          item,
          result: results.get(item.orderNo) ?? firstFailed,
          accountName,
          reporter,
          counters,
          stat,
        })
      }
      accountStats.set(liveAccountId, stat)
      continue
    }

    for (const item of items) {
      let result = results.get(item.orderNo)
      if (!result) {
        result = {
          orderNo: item.orderNo,
          packageId: item.orderNo,
          officialRefundAmountCent: 0,
          freightRefundAmountCent: 0,
          expectedRefundAmountCent: 0,
          appliedAmountCent: 0,
          appliedShipFeeAmountCent: 0,
          payAmountCent: 0,
          settlementAmountCent: 0,
          refundIncludesFreight: false,
          hasFreightOnlyRefund: false,
          buyerUserId: null,
          afterSaleReason: null,
          afterSaleStatus: null,
          successReturnCount: 0,
          returnsIds: [],
          fetchedAt: null,
          liveAccountId,
          fetchStatus: 'empty',
          fetchError: null,
        }
      }

      // 批量未命中：单笔 + 买家 ID 兜底，避免假 success+0
      if (result.fetchStatus === 'empty') {
        const fallbackBuyerUserId = await loadFallbackBuyerUserId(liveAccountId, item.orderNo)
        if (fallbackBuyerUserId) {
          result = await fetchAfterSalesWorkbenchByOrderNo(item.orderNo, liveAccountId, {
            fallbackBuyerUserId,
          })
        }
      }

      await finalizeOneTask({
        item,
        result,
        accountName,
        reporter,
        counters,
        stat,
      })
    }
    accountStats.set(liveAccountId, stat)
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
    `${pending.length} 笔补查结束，成功 ${counters.success}，冷却等待 ${counters.retryWait}，阻塞 ${counters.blocked}，永久失败 ${counters.failed}，用时 ${durationSec} 秒。最后处理账号=${lastAccount}`,
  )

  return {
    processed: pending.length,
    success: counters.success,
    failed: counters.failed,
    retryWait: counters.retryWait,
    blocked: counters.blocked,
  }
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
