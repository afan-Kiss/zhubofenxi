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
import {
  getAfterSalesHttpRequestCount,
  getAfterSalesNetworkRequestCount,
  getAfterSalesLocallyThrottledCount,
  AfterSalesRequestError,
} from './after-sales-request-error'
import type { OrderOwnershipVerdict } from './after-sales-order-ownership.service'

const GLOBAL = globalThis as {
  __afterSalesBackfillRunning?: boolean
}

export type AfterSalesBackfillTestDeps = {
  getApiSyncEnabled?: () => Promise<boolean>
  recoverStuck?: () => Promise<void>
  selectTasks?: (
    limits: AfterSalesQueueRateLimits,
  ) => Promise<SelectedAfterSalesQueueTask[]>
  partitionOwnership?: (
    orderNos: string[],
    queueLiveAccountId: string,
  ) => Promise<{ matched: string[]; mismatches: OrderOwnershipVerdict[] }>
  probe?: typeof probeOrdersAfterSaleSignal
  fetchDetail?: typeof fetchAfterSalesWorkbenchByOrderNosWithMeta
  saveCache?: typeof saveWorkbenchCache
  completeTask?: typeof completeAfterSalesQueueTask
  releaseTasks?: typeof releaseClaimedTasksToRetryWait
  openCircuit?: typeof openShopCircuit
  resolveAccountName?: (liveAccountId: string) => Promise<string>
  /** 进入 doRun 后立刻回调（用于互斥锁真实并发测试） */
  onEntered?: () => void | Promise<void>
  /** 覆盖 schema 确保（用于失败阻断测试） */
  ensureSchema?: () => Promise<{ added: string[]; alreadyPresent: string[] }>
}

let backfillTestDeps: AfterSalesBackfillTestDeps | null = null

export function setAfterSalesBackfillDepsForTest(
  deps: AfterSalesBackfillTestDeps | null,
): void {
  backfillTestDeps = deps
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
  /** 兼容字段：严格等于 networkRequests（真实发网） */
  actualHttpRequests: number
  /** 请求执行器尝试次数（含本地冷却/熔断拦截） */
  requestAttempts: number
  /** 真实发往平台的网络请求次数 */
  networkRequests: number
  locallyThrottled: number
  schemaEnsureFailed: boolean
  schemaEnsureError?: string
  skippedReason?: string
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
    requestAttempts: 0,
    networkRequests: 0,
    locallyThrottled: 0,
    schemaEnsureFailed: false,
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
  return /401|403|cookie_missing|cookie.*未配置|缺少 a1|登录失效|鉴权失败|签名失效/i.test(msg)
}

async function doRunAfterSalesBackfillBatch(
  limits: AfterSalesQueueRateLimits,
): Promise<AfterSalesBatchMetrics> {
  const deps = backfillTestDeps
  if (deps?.onEntered) await deps.onEntered()

  // 历史 SQLite 缺列：失败必须阻断，不得领取任务/访问平台
  try {
    if (deps?.ensureSchema) {
      await deps.ensureSchema()
    } else {
      const { ensureAfterSalesSchemaOnce, getAfterSalesSchemaState } = await import(
        './after-sales-queue-schema-ensure.service'
      )
      const state = getAfterSalesSchemaState()
      if (state.status === 'failed') {
        // Once 失败后已清空，允许再次尝试
      }
      await ensureAfterSalesSchemaOnce()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logWarn(
      '售后补查',
      `售后补查暂停：队列表结构升级失败，未领取任务，未请求平台。${message}`,
    )
    return emptyMetrics({
      schemaEnsureFailed: true,
      schemaEnsureError: message.slice(0, 500),
      skippedReason: 'SCHEMA_ENSURE_FAILED',
    })
  }

  const metrics = emptyMetrics()
  const apiEnabled = deps?.getApiSyncEnabled
    ? await deps.getApiSyncEnabled()
    : (await (await import('./system-setting.service')).getApiSyncSettings()).apiSyncEnabled

  if (deps?.recoverStuck) await deps.recoverStuck()
  else {
    const { recoverStuckAfterSalesRunningTasks } = await import('./after-sales-queue.service')
    await recoverStuckAfterSalesRunningTasks()
  }

  if (!apiEnabled) {
    logInfo('售后补查', '售后补查已暂停（apiSyncEnabled=false），本次不拉取平台。')
    return metrics
  }

  const pending = deps?.selectTasks
    ? await deps.selectTasks(limits)
    : await selectAfterSalesQueueTasks(limits)
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

  const partitionOwnership = deps?.partitionOwnership ?? partitionOrdersByOwnership
  const probeFn = deps?.probe ?? probeOrdersAfterSaleSignal
  const fetchDetailFn = deps?.fetchDetail ?? fetchAfterSalesWorkbenchByOrderNosWithMeta
  const saveCacheFn = deps?.saveCache ?? saveWorkbenchCache
  const completeFn = deps?.completeTask ?? completeAfterSalesQueueTask
  const releaseFn = deps?.releaseTasks ?? releaseClaimedTasksToRetryWait
  const openCircuitFn = deps?.openCircuit ?? openShopCircuit
  const nameFn = deps?.resolveAccountName ?? resolveAccountName

  // 将 finalize 绑到可替换 complete/save
  async function finalizeTaskLocal(params: {
    item: SelectedAfterSalesQueueTask
    result: AfterSalesWorkbenchRefund
    metrics: AfterSalesBatchMetrics
    resultTag: string
  }): Promise<void> {
    const { item, result, metrics: m, resultTag } = params
    if (result.fetchStatus !== 'failed') {
      await saveCacheFn(result, item.liveAccountId)
    }
    const finalStatus = await completeFn({
      queueId: item.id,
      liveAccountId: item.liveAccountId,
      orderNo: item.orderNo,
      result,
      claimToken: item.claimToken,
      workerId: item.workerId,
    })
    m.processed++
    if (finalStatus === 'done') {
      m.success++
      if (resultTag === 'NO_AFTER_SALE') m.noAfterSale++
      else if (resultTag === 'AFTER_SALE_DETAIL_SAVED') m.detailsSaved++
      else if (
        resultTag === 'AFTER_SALE_PROCESSING_SAVED' ||
        resultTag === 'AFTER_SALE_TERMINAL_SAVED' ||
        resultTag === 'AFTER_SALE_UNKNOWN_SAVED'
      ) {
        if (resultTag === 'AFTER_SALE_PROCESSING_SAVED') m.processingDetailsSaved++
        m.detailsSaved++
      }
    } else if (finalStatus === 'retry_wait') {
      m.retryWait++
      m.unknown++
    } else if (finalStatus === 'blocked') {
      m.blocked++
      if (isAuthError(result.fetchError ?? '')) m.authFailed++
    } else {
      m.failed++
    }
  }

  let shopIndex = 0
  for (const [liveAccountId, items] of byShop) {
    shopIndex++
    const accountName = await nameFn(liveAccountId)
    const shopSafe = items.filter((i) => i.liveAccountId === liveAccountId)

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
        await releaseFn({
          tasks: chunk,
          reason: 'SHOP_CIRCUIT_SKIP_REMAINING',
        })
        metrics.retryWait += chunk.length
        continue
      }

      const orderNos = chunk.map((c) => c.orderNo)
      const byOrder = new Map(chunk.map((c) => [c.orderNo, c]))

      const { matched, mismatches } = await partitionOwnership(orderNos, liveAccountId)
      metrics.ownershipMatched += matched.length
      for (const m of mismatches) {
        const item = byOrder.get(m.orderNo)
        if (!item) continue
        if (m.kind === 'SHOP_MISMATCH') metrics.ownershipMismatch++
        else if (m.kind === 'ORDER_OWNER_NOT_FOUND') metrics.ownerNotFound++
        else if (m.kind === 'ORDER_OWNER_CONFLICT') metrics.ownerConflict++
        await finalizeTaskLocal({
          item,
          result: failedRefund(m.orderNo, liveAccountId, m.kind),
          metrics,
          resultTag: m.kind,
        })
        reporter.tick(false, `当前账号=${accountName}，归属异常=${m.kind}`)
      }

      if (matched.length === 0) continue
      const matchedItems = matched.map((o) => byOrder.get(o)!).filter(Boolean)

      let probes: OrderProbeResult[] = []
      try {
        const probe = await probeFn({
          liveAccountId,
          orderNos: matched,
        })
        const attempts = probe.requestAttempts ?? probe.counters?.requestAttempts ?? 0
        const network =
          probe.networkRequests ??
          probe.counters?.networkRequests ??
          probe.httpRequests ??
          0
        const local = probe.counters?.locallyThrottled ?? 0
        metrics.orderListRequests += attempts
        metrics.requestAttempts += attempts
        metrics.networkRequests += network
        metrics.actualHttpRequests += network
        metrics.locallyThrottled += local
        if (attempts > 1) {
          metrics.paginationRequests += attempts - 1
        }
        probes = probe.results
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const attempts = getAfterSalesHttpRequestCount(e)
        const network = getAfterSalesNetworkRequestCount(e)
        const local = getAfterSalesLocallyThrottledCount(e)
        metrics.orderListRequests += attempts
        metrics.requestAttempts += attempts
        metrics.networkRequests += network
        metrics.actualHttpRequests += network
        metrics.locallyThrottled += local
        if (e instanceof AfterSalesRequestError && (e.causeCode === 'local_throttled' || e.causeCode === 'local_circuit_open')) {
          if (local === 0) metrics.locallyThrottled++
        }
        if (isRateLimitError(msg) || isAuthError(msg)) {
          shopStop = true
          if (isRateLimitError(msg)) metrics.rateLimited++
          if (isAuthError(msg)) metrics.authFailed++
          await openCircuitFn({
            liveAccountId,
            errorType: isAuthError(msg) ? 'http_401' : 'http_429',
            message: msg.slice(0, 200),
            probeBackoffMs: 60_000,
          })
          logWarn(
            '售后补查',
            `店铺熔断 account=${accountName} reason=${msg.slice(0, 120)} remaining=${matchedItems.length} 请求尝试=${attempts} 真实平台请求=${network} 本地拦截=${local || metrics.locallyThrottled}`,
          )
          await releaseFn({
            tasks: matchedItems,
            reason: msg.slice(0, 500),
          })
          metrics.retryWait += matchedItems.length
          continue
        }
        for (const item of matchedItems) {
          await finalizeTaskLocal({
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
          await finalizeTaskLocal({
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
          await finalizeTaskLocal({
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

      try {
        const {
          results: detailMap,
          httpRequests,
          requestAttempts: detailAttempts,
          networkRequests: detailNetwork,
          counters: detailCounters,
        } = await fetchDetailFn(needDetail, liveAccountId)
        const attempts = detailCounters?.requestAttempts ?? detailAttempts ?? 0
        const network =
          detailCounters?.networkRequests ?? detailNetwork ?? httpRequests ?? 0
        const local = detailCounters?.locallyThrottled ?? 0
        metrics.detailRequests += attempts
        metrics.requestAttempts += attempts
        metrics.networkRequests += network
        metrics.actualHttpRequests += network
        metrics.locallyThrottled += local
        if (attempts > 1) {
          metrics.paginationRequests += attempts - 1
        }

        for (const orderNo of needDetail) {
          const item = byOrder.get(orderNo)!
          const result = detailMap.get(orderNo)
          if (!result || result.fetchStatus === 'failed') {
            await finalizeTaskLocal({
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
            await finalizeTaskLocal({
              item,
              result: failedRefund(orderNo, liveAccountId, 'AFTER_SALE_SIGNAL_WITHOUT_DETAIL'),
              metrics,
              resultTag: 'AFTER_SALE_SIGNAL_WITHOUT_DETAIL',
            })
            reporter.tick(false, `当前账号=${accountName}，详情未返回`)
            continue
          }
          const terminal =
            (result.rejectedRecordCount ?? 0) +
              (result.canceledRecordCount ?? 0) +
              (result.closedRecordCount ?? 0) >
            0
          const unknownOnly =
            (result.unknownRecordCount ?? 0) > 0 &&
            (result.successReturnCount ?? 0) === 0 &&
            (result.processingRecordCount ?? 0) === 0
          const tag =
            (result.successReturnCount ?? 0) > 0
              ? 'AFTER_SALE_DETAIL_SAVED'
              : unknownOnly
                ? 'AFTER_SALE_UNKNOWN_SAVED'
                : terminal
                  ? 'AFTER_SALE_TERMINAL_SAVED'
                  : 'AFTER_SALE_PROCESSING_SAVED'
          await finalizeTaskLocal({ item, result, metrics, resultTag: tag })
          reporter.tick(true, `当前账号=${accountName}，详情已保存`)
          shopMatched++
          shopSuccess++
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const attempts = getAfterSalesHttpRequestCount(e)
        const network = getAfterSalesNetworkRequestCount(e)
        const local = getAfterSalesLocallyThrottledCount(e)
        metrics.detailRequests += attempts
        metrics.requestAttempts += attempts
        metrics.networkRequests += network
        metrics.actualHttpRequests += network
        metrics.locallyThrottled += local
        if (attempts > 1) metrics.paginationRequests += attempts - 1
        if (
          e instanceof AfterSalesRequestError &&
          (e.causeCode === 'local_throttled' || e.causeCode === 'local_circuit_open') &&
          local === 0
        ) {
          metrics.locallyThrottled++
        }
        if (isRateLimitError(msg) || isAuthError(msg)) {
          shopStop = true
          if (isRateLimitError(msg)) metrics.rateLimited++
          if (isAuthError(msg)) metrics.authFailed++
          await openCircuitFn({
            liveAccountId,
            errorType: isAuthError(msg) ? 'http_401' : 'http_429',
            message: msg.slice(0, 200),
            probeBackoffMs: 60_000,
          })
          const remain = needDetail.map((o) => byOrder.get(o)!).filter(Boolean)
          await releaseFn({
            tasks: remain,
            reason: msg.slice(0, 500),
          })
          metrics.retryWait += remain.length
          logWarn(
            '售后补查',
            `详情熔断 account=${accountName} reason=${msg.slice(0, 120)} remaining=${remain.length} 请求尝试=${attempts} 真实平台请求=${network} 本地拦截=${local}`,
          )
          continue
        }
        for (const orderNo of needDetail) {
          const item = byOrder.get(orderNo)!
          await finalizeTaskLocal({
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
    `claimed=${metrics.claimed} 无售后=${metrics.noAfterSale} 详情保存=${metrics.detailsSaved} 未知/重试=${metrics.retryWait} 请求尝试数=${metrics.requestAttempts} 真实平台请求数=${metrics.networkRequests} 本地拦截数=${metrics.locallyThrottled}（列表${metrics.orderListRequests}+详情${metrics.detailRequests}）`,
  )

  logInfo(
    '售后补查',
    `批次统计 noAfterSale=${metrics.noAfterSale} detailsSaved=${metrics.detailsSaved} processingSaved=${metrics.processingDetailsSaved} unknown=${metrics.unknown} requestAttempts=${metrics.requestAttempts} networkRequests=${metrics.networkRequests} actualHttpRequests=${metrics.actualHttpRequests} locallyThrottled=${metrics.locallyThrottled} ownershipMismatch=${metrics.ownershipMismatch}`,
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
