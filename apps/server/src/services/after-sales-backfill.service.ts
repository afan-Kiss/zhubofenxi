/**
 * 售后工作台补查（纠错版）：
 * 归属预检 → 订单列表批量探测 → 仅有售后才批量详情 → 分单完结
 * 禁止 empty→逐单→买家ID 请求放大；进程级互斥锁防重叠。
 */
import { prisma } from '../lib/prisma'
import {
  completeAfterSalesQueueTask,
  releaseClaimedTasksToRetryWait,
  selectAfterSalesQueueTasks,
  type SelectedAfterSalesQueueTask,
} from './after-sales-queue.service'
import {
  AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS,
  DEFAULT_AFTER_SALES_QUEUE_LIMITS,
  type AfterSalesQueueRateLimits,
} from './after-sales-queue.types'
import { partitionOrdersByOwnership } from './after-sales-order-ownership.service'
import {
  probeOrdersAfterSaleSignal,
  type OrderProbeResult,
} from './after-sales-order-list-probe.service'
import {
  fetchAfterSalesWorkbenchByOrderNosWithMeta,
  saveWorkbenchCache,
  type AfterSalesWorkbenchRefund,
} from './xhs-after-sales-workbench.service'
import { TaskProgressReporter, taskFail, taskStart } from '../utils/task-log'
import { logInfo, logWarn } from '../utils/server-log'
import {
  logAfterSaleSyncComplete,
  logAfterSaleSyncStart,
} from '../utils/sync-cmd-log'
import { openShopCircuit } from './shop-after-sales-runtime.service'

const GLOBAL = globalThis as {
  __afterSalesBackfillRunning?: boolean
}

export interface AfterSalesBatchMetrics {
  claimed: number
  ownershipMatched: number
  ownershipMismatch: number
  ownerNotFound: number
  ownerConflict: number
  orderListRequests: number
  detailRequests: number
  paginationRequests: number
  actualHttpRequests: number
  noAfterSale: number
  hasAfterSaleSignal: number
  detailsSaved: number
  processingDetailsSaved: number
  unknown: number
  retryWait: number
  rateLimited: number
  authFailed: number
  failed: number
  skippedBecauseRunning: boolean
  processed: number
  success: number
  blocked: number
}

function emptyMetrics(partial?: Partial<AfterSalesBatchMetrics>): AfterSalesBatchMetrics {
  return {
    claimed: 0,
    ownershipMatched: 0,
    ownershipMismatch: 0,
    ownerNotFound: 0,
    ownerConflict: 0,
    orderListRequests: 0,
    detailRequests: 0,
    paginationRequests: 0,
    actualHttpRequests: 0,
    noAfterSale: 0,
    hasAfterSaleSignal: 0,
    detailsSaved: 0,
    processingDetailsSaved: 0,
    unknown: 0,
    retryWait: 0,
    rateLimited: 0,
    authFailed: 0,
    failed: 0,
    skippedBecauseRunning: false,
    processed: 0,
    success: 0,
    blocked: 0,
    ...partial,
  }
}

async function resolveAccountName(liveAccountId: string): Promise<string> {
  if (!liveAccountId || liveAccountId === 'legacy') return '默认账号'
  const row = await prisma.platformCredential.findUnique({
    where: { id: liveAccountId },
    select: { displayName: true },
  })
  return row?.displayName?.trim() || liveAccountId
}

function failedRefund(
  orderNo: string,
  liveAccountId: string,
  code: string,
): AfterSalesWorkbenchRefund {
  return {
    orderNo,
    packageId: orderNo,
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
    fetchError: code.slice(0, 500),
  }
}

function emptyNoAfterSale(
  orderNo: string,
  liveAccountId: string,
): AfterSalesWorkbenchRefund {
  return {
    orderNo,
    packageId: orderNo,
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
    afterSaleStatus: '无售后',
    successReturnCount: 0,
    matchedRecordCount: 0,
    returnsIds: [],
    fetchedAt: new Date(),
    liveAccountId,
    fetchStatus: 'empty',
    fetchError: null,
  }
}

function isRateLimitError(msg: string): boolean {
  return /429|冷却|cooldown|throttl|rate.?limit|访问频繁|风险控制/i.test(msg)
}

function isAuthError(msg: string): boolean {
  return /401|403|cookie|登录|鉴权|签名失效|失效/i.test(msg)
}

async function finalizeTask(params: {
  item: SelectedAfterSalesQueueTask
  result: AfterSalesWorkbenchRefund
  metrics: AfterSalesBatchMetrics
  resultTag: string
}): Promise<void> {
  const { item, result, metrics, resultTag } = params
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
  metrics.processed++
  if (finalStatus === 'done') {
    metrics.success++
    if (resultTag === 'NO_AFTER_SALE') metrics.noAfterSale++
    else if (resultTag === 'AFTER_SALE_DETAIL_SAVED') metrics.detailsSaved++
    else if (resultTag === 'AFTER_SALE_PROCESSING_SAVED') {
      metrics.processingDetailsSaved++
      metrics.detailsSaved++
    }
  } else if (finalStatus === 'retry_wait') {
    metrics.retryWait++
    metrics.unknown++
  } else if (finalStatus === 'blocked') {
    metrics.blocked++
    if (isAuthError(result.fetchError ?? '')) metrics.authFailed++
  } else {
    metrics.failed++
  }
}

async function doRunAfterSalesBackfillBatch(
  limits: AfterSalesQueueRateLimits,
): Promise<AfterSalesBatchMetrics> {
  const metrics = emptyMetrics()
  const { getApiSyncSettings } = await import('./system-setting.service')
  const settings = await getApiSyncSettings()
  const { recoverStuckAfterSalesRunningTasks } = await import('./after-sales-queue.service')
  await recoverStuckAfterSalesRunningTasks()

  if (!settings.apiSyncEnabled) {
    logInfo('售后补查', '售后补查已暂停（apiSyncEnabled=false），本次不拉取平台。')
    return metrics
  }

  const pending = await selectAfterSalesQueueTasks(limits)
  metrics.claimed = pending.length
  if (pending.length === 0) return metrics

  const shopCount = new Set(pending.map((p) => p.liveAccountId)).size
  taskStart(
    '售后补查',
    `本次调度 ${pending.length} 笔（${shopCount} 店）：先归属校验→订单列表探测→有售后再批量详情；每店≤${AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS} 单。`,
  )

  const reporter = new TaskProgressReporter('售后补查', pending.length, 5, 15_000)
  const byShop = new Map<string, SelectedAfterSalesQueueTask[]>()
  for (const item of pending) {
    const list = byShop.get(item.liveAccountId) ?? []
    list.push(item)
    byShop.set(item.liveAccountId, list)
  }

  let shopIndex = 0
  for (const [liveAccountId, items] of byShop) {
    shopIndex++
    const accountName = await resolveAccountName(liveAccountId)
    const shopSafe = items.filter((i) => i.liveAccountId === liveAccountId)

    // 分块 10
    const chunks: SelectedAfterSalesQueueTask[][] = []
    for (let i = 0; i < shopSafe.length; i += AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS) {
      chunks.push(shopSafe.slice(i, i + AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS))
    }

    logAfterSaleSyncStart(
      {
        accountName,
        liveAccountId,
        accountIndex: shopIndex,
        accountTotal: byShop.size,
      },
      `补查队列 ${shopSafe.length} 笔订单`,
    )

    let shopStop = false
    let shopMatched = 0
    let shopSuccess = 0

    for (const chunk of chunks) {
      if (shopStop) {
        await releaseClaimedTasksToRetryWait({
          tasks: chunk,
          reason: 'SHOP_CIRCUIT_SKIP_REMAINING',
        })
        metrics.retryWait += chunk.length
        continue
      }

      const orderNos = chunk.map((c) => c.orderNo)
      const byOrder = new Map(chunk.map((c) => [c.orderNo, c]))

      // 1) 归属预检
      const { matched, mismatches } = await partitionOrdersByOwnership(orderNos, liveAccountId)
      metrics.ownershipMatched += matched.length
      for (const m of mismatches) {
        const item = byOrder.get(m.orderNo)
        if (!item) continue
        if (m.kind === 'SHOP_MISMATCH') metrics.ownershipMismatch++
        else if (m.kind === 'ORDER_OWNER_NOT_FOUND') metrics.ownerNotFound++
        else if (m.kind === 'ORDER_OWNER_CONFLICT') metrics.ownerConflict++
        await finalizeTask({
          item,
          result: failedRefund(m.orderNo, liveAccountId, m.kind),
          metrics,
          resultTag: m.kind,
        })
        reporter.tick(false, `当前账号=${accountName}，归属异常=${m.kind}`)
      }

      if (matched.length === 0) continue
      const matchedItems = matched.map((o) => byOrder.get(o)!).filter(Boolean)

      // 2) 订单列表批量探测
      let probes: OrderProbeResult[] = []
      try {
        const probe = await probeOrdersAfterSaleSignal({
          liveAccountId,
          orderNos: matched,
        })
        metrics.orderListRequests += probe.httpRequests
        metrics.actualHttpRequests += probe.httpRequests
        if (probe.httpRequests > 1) {
          metrics.paginationRequests += probe.httpRequests - 1
        }
        probes = probe.results
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (isRateLimitError(msg) || isAuthError(msg)) {
          shopStop = true
          if (isRateLimitError(msg)) metrics.rateLimited++
          if (isAuthError(msg)) metrics.authFailed++
          await openShopCircuit({
            liveAccountId,
            errorType: isAuthError(msg) ? 'http_401' : 'http_429',
            message: msg.slice(0, 200),
            probeBackoffMs: 60_000,
          })
          logWarn(
            '售后补查',
            `店铺熔断 account=${accountName} reason=${msg.slice(0, 120)} remaining=${matchedItems.length}`,
          )
          await releaseClaimedTasksToRetryWait({
            tasks: matchedItems,
            reason: msg.slice(0, 500),
          })
          metrics.retryWait += matchedItems.length
          // 同店后续 chunk 也退回
          continue
        }
        for (const item of matchedItems) {
          await finalizeTask({
            item,
            result: failedRefund(item.orderNo, liveAccountId, msg),
            metrics,
            resultTag: 'FAILED',
          })
          reporter.tick(false, `当前账号=${accountName}，订单列表失败`)
        }
        continue
      }

      const needDetail: string[] = []
      for (const p of probes) {
        const item = byOrder.get(p.orderNo)
        if (!item) continue
        if (p.state === 'NO_AFTER_SALE') {
          await finalizeTask({
            item,
            result: emptyNoAfterSale(p.orderNo, liveAccountId),
            metrics,
            resultTag: 'NO_AFTER_SALE',
          })
          reporter.tick(true, `当前账号=${accountName}，无售后`)
          shopMatched++
          shopSuccess++
          continue
        }
        if (p.state === 'UNKNOWN') {
          await finalizeTask({
            item,
            result: failedRefund(p.orderNo, liveAccountId, p.reason),
            metrics,
            resultTag: 'UNKNOWN',
          })
          reporter.tick(false, `当前账号=${accountName}，未知=${p.reason}`)
          continue
        }
        metrics.hasAfterSaleSignal++
        needDetail.push(p.orderNo)
      }

      if (needDetail.length === 0) continue

      // 3) 仅有售后订单 → 一次详情（含分页，按实际 HTTP 计数）
      try {
        const { results: detailMap, httpRequests } =
          await fetchAfterSalesWorkbenchByOrderNosWithMeta(needDetail, liveAccountId)
        metrics.detailRequests += httpRequests
        metrics.actualHttpRequests += httpRequests
        if (httpRequests > 1) {
          metrics.paginationRequests += httpRequests - 1
        }

        for (const orderNo of needDetail) {
          const item = byOrder.get(orderNo)!
          const result = detailMap.get(orderNo)
          if (!result || result.fetchStatus === 'failed') {
            await finalizeTask({
              item,
              result:
                result ??
                failedRefund(orderNo, liveAccountId, 'AFTER_SALE_DETAIL_FAILED'),
              metrics,
              resultTag: 'FAILED',
            })
            reporter.tick(false, `当前账号=${accountName}，详情失败`)
            continue
          }
          if (result.fetchStatus === 'empty' || (result.matchedRecordCount ?? 0) === 0) {
            // 列表有售后信号但详情未命中 → 重试，禁止买家ID兜底
            await finalizeTask({
              item,
              result: failedRefund(orderNo, liveAccountId, 'AFTER_SALE_SIGNAL_WITHOUT_DETAIL'),
              metrics,
              resultTag: 'AFTER_SALE_SIGNAL_WITHOUT_DETAIL',
            })
            reporter.tick(false, `当前账号=${accountName}，详情未返回`)
            continue
          }
          const tag =
            (result.successReturnCount ?? 0) > 0
              ? 'AFTER_SALE_DETAIL_SAVED'
              : 'AFTER_SALE_PROCESSING_SAVED'
          await finalizeTask({ item, result, metrics, resultTag: tag })
          reporter.tick(true, `当前账号=${accountName}，详情已保存`)
          shopMatched++
          shopSuccess++
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (isRateLimitError(msg) || isAuthError(msg)) {
          shopStop = true
          if (isRateLimitError(msg)) metrics.rateLimited++
          if (isAuthError(msg)) metrics.authFailed++
          await openShopCircuit({
            liveAccountId,
            errorType: isAuthError(msg) ? 'http_401' : 'http_429',
            message: msg.slice(0, 200),
            probeBackoffMs: 60_000,
          })
          const remain = needDetail.map((o) => byOrder.get(o)!).filter(Boolean)
          await releaseClaimedTasksToRetryWait({
            tasks: remain,
            reason: msg.slice(0, 500),
          })
          metrics.retryWait += remain.length
          logWarn(
            '售后补查',
            `详情熔断 account=${accountName} reason=${msg.slice(0, 120)} remaining=${remain.length}`,
          )
          continue
        }
        for (const orderNo of needDetail) {
          const item = byOrder.get(orderNo)!
          await finalizeTask({
            item,
            result: failedRefund(orderNo, liveAccountId, msg),
            metrics,
            resultTag: 'FAILED',
          })
          reporter.tick(false, `当前账号=${accountName}，详情异常`)
        }
      }
    }

    logAfterSaleSyncComplete({
      ctx: {
        accountName,
        liveAccountId,
        accountIndex: shopIndex,
        accountTotal: byShop.size,
      },
      apiRows: shopMatched,
      matchedOrders: shopSuccess,
      unmatched: Math.max(0, shopSafe.length - shopSuccess),
    })
  }

  reporter.finish(
    `claimed=${metrics.claimed} 无售后=${metrics.noAfterSale} 详情保存=${metrics.detailsSaved} 未知/重试=${metrics.retryWait} HTTP=${metrics.actualHttpRequests}（列表${metrics.orderListRequests}+详情${metrics.detailRequests}）`,
  )

  logInfo(
    '售后补查',
    `批次统计 noAfterSale=${metrics.noAfterSale} detailsSaved=${metrics.detailsSaved} processingSaved=${metrics.processingDetailsSaved} unknown=${metrics.unknown} http=${metrics.actualHttpRequests} ownershipMismatch=${metrics.ownershipMismatch}`,
  )

  return metrics
}

export async function runAfterSalesBackfillBatch(
  limits: AfterSalesQueueRateLimits = DEFAULT_AFTER_SALES_QUEUE_LIMITS,
): Promise<AfterSalesBatchMetrics> {
  if (GLOBAL.__afterSalesBackfillRunning) {
    logInfo('售后补查', 'ALREADY_RUNNING：跳过重叠执行')
    return emptyMetrics({ skippedBecauseRunning: true })
  }
  GLOBAL.__afterSalesBackfillRunning = true
  try {
    return await doRunAfterSalesBackfillBatch(limits)
  } finally {
    GLOBAL.__afterSalesBackfillRunning = false
  }
}

export async function logAfterSalesBackfillFailure(
  accountName: string,
  reason: string,
): Promise<void> {
  taskFail(
    '售后补查',
    `账号=${accountName}，接口=售后工作台，原因=${reason}。本次只影响售后补查，不影响已同步订单和支付金额。`,
  )
}

/** 测试辅助：重置互斥锁 */
export function resetAfterSalesBackfillLockForTest(): void {
  GLOBAL.__afterSalesBackfillRunning = false
}
