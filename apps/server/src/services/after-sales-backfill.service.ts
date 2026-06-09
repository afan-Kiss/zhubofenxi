/**
 * 售后工作台补查：老板视角任务日志（补什么 / 为什么 / 影响）
 */
import { prisma } from '../lib/prisma'
import { syncWorkbenchForOrderNo } from './xhs-after-sales-workbench.service'
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

export async function runAfterSalesBackfillBatch(limit = 60): Promise<{
  processed: number
  success: number
  failed: number
}> {
  const pending = await prisma.xhsAfterSalesWorkbenchQueue.findMany({
    where: { status: 'pending' },
    take: limit,
    orderBy: { createdAt: 'asc' },
  })

  if (pending.length === 0) {
    return { processed: 0, success: 0, failed: 0 }
  }

  const started = Date.now()
  taskStart(
    '售后补查',
    `本次发现 ${pending.length} 笔订单缺少售后详情，正在补查售后状态、退款原因、退款金额，用于完善退款/品退/买家售后统计，不会改动支付金额。`,
  )

  const reporter = new TaskProgressReporter('售后补查', pending.length, 10, 15_000)
  let success = 0
  let failed = 0
  let currentAccount = ''

  const accountStats = new Map<
    string,
    { accountName: string; liveAccountId: string; processed: number; success: number; failed: number; empty: number }
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
      empty: 0,
    }
    stat.processed++
    try {
      const result = await syncWorkbenchForOrderNo(item.orderNo, item.liveAccountId)
      if (result.fetchStatus === 'failed') {
        failed++
        stat.failed++
        reporter.tick(false, `当前账号=${accountName}，接口=售后工作台详情`)
      } else if (result.fetchStatus === 'empty') {
        success++
        stat.empty++
        reporter.tick(true, `当前账号=${accountName}，接口=售后工作台详情`)
      } else {
        success++
        stat.success++
        reporter.tick(true, `当前账号=${accountName}，接口=售后工作台详情`)
      }
    } catch {
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
      unmatched: stat.empty + stat.failed,
    })
  }

  const durationSec = Math.round((Date.now() - started) / 1000)
  const lastAccount = currentAccount || '—'

  if (failed > 0) {
    reporter.finish(
      `${pending.length} 笔订单补查结束，成功 ${success}，失败 ${failed}，用时 ${durationSec} 秒。` +
        `失败订单可稍后自动重试；不影响已同步订单与支付金额。最后处理账号=${lastAccount}`,
    )
  } else {
    reporter.finish(
      `${pending.length} 笔订单补查完成，成功 ${success}，失败 ${failed}，用时 ${durationSec} 秒。` +
        `不影响支付金额与订单主数据。`,
    )
  }

  return { processed: pending.length, success, failed }
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
