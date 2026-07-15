/**
 * 售后工作台补查队列：公平按店调度、原子认领、持久化熔断
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import type { AfterSalesWorkbenchRefund } from './xhs-after-sales-workbench.service'
import {
  AFTER_SALES_RUNNING_TIMEOUT_MS,
  DEFAULT_AFTER_SALES_QUEUE_LIMITS,
  type AfterSalesQueueDisposition,
  type AfterSalesQueueErrorType,
  type AfterSalesQueueRateLimits,
  type AfterSalesQueueStatus,
} from './after-sales-queue.types'
import { logInfo, logWarn } from '../utils/server-log'
import {
  extractOrderAfterSaleContextFromRaw,
  isWorkbenchCacheCurrentlyValid,
  type OrderAfterSaleContext,
  type WorkbenchCacheSnapshot,
} from './workbench-cache-validity.service'
import { writeAfterSalesQueueAudit } from './after-sales-queue-audit.service'
import {
  isAuthOrSignCircuitError,
  loadShopCircuits,
  markShopProbeFailed,
  openShopCircuit,
  recordShopAfterSalesSuccess,
  type ShopCircuitSnapshot,
} from './shop-after-sales-runtime.service'
import { listEnabledLiveAccountsWithCookie } from './live-account.service'

/** 本批临时停止（不跨批次） */
const batchStopShops = new Set<string>()

export type SelectedAfterSalesQueueTask = {
  id: string
  liveAccountId: string
  orderNo: string
  temporaryAttemptCount: number
  claimToken: string
  workerId: string
}

export type ShopSelectStats = {
  liveAccountId: string
  candidates: number
  claimed: number
  skippedCooldown: number
  skippedBlocked: number
  skippedValidCache: number
}

function shopKey(liveAccountId: string): string {
  return liveAccountId || 'legacy'
}

export function resetAfterSalesQueueBatchShopFlags(): void {
  batchStopShops.clear()
}

export function parseCooldownSecondsFromError(message: string): number | null {
  const m = message.match(/冷却[^（]*（\s*(\d+)\s*s\s*）/i) ?? message.match(/(\d+)\s*s/i)
  if (!m) return null
  const sec = Number(m[1])
  return Number.isFinite(sec) && sec > 0 ? sec : null
}

export function classifyWorkbenchQueueError(
  errorMessage: string | null | undefined,
  httpStatus?: number | null,
): { errorType: AfterSalesQueueErrorType; disposition: AfterSalesQueueDisposition } {
  const msg = (errorMessage ?? '').trim()

  if (/冷却|cooldown|熔断|throttl|rate.?limit/i.test(msg) || httpStatus === 429) {
    return { errorType: httpStatus === 429 ? 'http_429' : 'platform_cooling', disposition: 'retry_wait' }
  }
  if (httpStatus === 502) return { errorType: 'http_502', disposition: 'retry_wait' }
  if (httpStatus === 503) return { errorType: 'http_503', disposition: 'retry_wait' }
  if (httpStatus === 504) return { errorType: 'http_504', disposition: 'retry_wait' }
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(msg)) {
    return { errorType: 'network_timeout', disposition: 'retry_wait' }
  }

  if (
    /python2_interpreter_not_supported|future feature annotations|SyntaxError.*annotations/i.test(msg)
  ) {
    return { errorType: 'sign_python2_interpreter', disposition: 'blocked' }
  }
  if (
    /xhshow|python_module_missing|未找到可用 Python|signer_disabled|script_not_found|sign_env_missing/i.test(
      msg,
    )
  ) {
    return { errorType: 'sign_env_missing', disposition: 'blocked' }
  }
  if (/签名生成失败|sign_generation_failed/i.test(msg)) {
    return { errorType: 'sign_generation_failed', disposition: 'retry_wait' }
  }

  if (/cookie.*未配置|cookie 未配置|缺少 a1|cookie_missing/i.test(msg)) {
    return { errorType: 'cookie_missing', disposition: 'blocked' }
  }
  if (/cookie.*过期|失效|expired/i.test(msg) && !/401|403/.test(msg)) {
    return { errorType: 'cookie_expired', disposition: 'blocked' }
  }
  if (httpStatus === 401 || /\b401\b/.test(msg)) {
    return { errorType: 'http_401', disposition: 'blocked' }
  }
  if (httpStatus === 403 || /\b403\b/.test(msg)) {
    return { errorType: 'http_403', disposition: 'blocked' }
  }

  if (/无效订单号|永久不存在|not.?found.*after/i.test(msg)) {
    return { errorType: 'permanent_not_found', disposition: 'failed' }
  }
  if (/数据结构|必要主键|不可重试/i.test(msg)) {
    return { errorType: 'permanent_invalid', disposition: 'failed' }
  }

  if (msg) return { errorType: 'unknown', disposition: 'retry_wait' }
  return { errorType: 'unknown', disposition: 'failed' }
}

export function computeNextAttemptAt(
  temporaryAttemptCount: number,
  errorMessage?: string | null,
  now = Date.now(),
): Date {
  const platformSec = errorMessage ? parseCooldownSecondsFromError(errorMessage) : null
  if (platformSec != null) {
    const jitterMs = Math.floor(Math.random() * 15_000)
    return new Date(now + platformSec * 1000 + jitterMs)
  }
  const n = Math.max(1, temporaryAttemptCount)
  const minutes = n <= 1 ? 5 : n === 2 ? 10 : n === 3 ? 20 : 60
  const jitterMs = Math.floor(Math.random() * 30_000)
  return new Date(now + minutes * 60_000 + jitterMs)
}

export async function recoverStuckAfterSalesRunningTasks(
  timeoutMs = AFTER_SALES_RUNNING_TIMEOUT_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs)
  const stuck = await prisma.xhsAfterSalesWorkbenchQueue.findMany({
    where: { status: 'running', runningSince: { lt: cutoff } },
    select: {
      id: true,
      liveAccountId: true,
      orderNo: true,
      temporaryAttemptCount: true,
      status: true,
      claimToken: true,
      workerId: true,
    },
  })
  if (stuck.length === 0) return 0
  const now = new Date()
  for (const row of stuck) {
    const nextAt = computeNextAttemptAt(row.temporaryAttemptCount + 1, 'running_timeout')
    await prisma.xhsAfterSalesWorkbenchQueue.update({
      where: { id: row.id },
      data: {
        status: 'retry_wait',
        errorType: 'running_timeout',
        lastError: 'running 超时，已安全恢复为 retry_wait',
        nextAttemptAt: nextAt,
        lastAttemptAt: now,
        runningSince: null,
        workerId: null,
        claimToken: null,
        claimedAt: null,
        statusChangedAt: now,
        temporaryAttemptCount: { increment: 1 },
        attempts: { increment: 1 },
      },
    })
    await writeAfterSalesQueueAudit({
      liveAccountId: row.liveAccountId,
      orderNo: row.orderNo,
      fromStatus: 'running',
      toStatus: 'retry_wait',
      reason: 'running_timeout',
      errorType: 'running_timeout',
      workerId: row.workerId,
      claimToken: row.claimToken,
    })
    logWarn('售后补查', `running 超时恢复：shop=${row.liveAccountId} order=${row.orderNo}`)
  }
  return stuck.length
}

export async function loadOrderAfterSaleContext(
  liveAccountId: string,
  orderNo: string,
): Promise<OrderAfterSaleContext> {
  const trimmed = orderNo.trim()
  const row = await prisma.xhsRawOrder.findFirst({
    where: {
      liveAccountId,
      OR: [{ packageId: trimmed }, { orderId: trimmed }],
    },
    select: { rawJson: true, updatedAt: true, orderTime: true },
    orderBy: { updatedAt: 'desc' },
  })
  const raw =
    row?.rawJson && typeof row.rawJson === 'object'
      ? (row.rawJson as Record<string, unknown>)
      : {}
  return extractOrderAfterSaleContextFromRaw(raw, {
    orderUpdatedAt: row?.updatedAt ?? null,
    orderTime: row?.orderTime ?? null,
  })
}

export async function hasValidWorkbenchCache(
  liveAccountId: string,
  orderNo: string,
  orderCtx?: OrderAfterSaleContext,
): Promise<boolean> {
  const row = await prisma.xhsAfterSalesWorkbenchCache.findUnique({
    where: {
      liveAccountId_orderNo: { liveAccountId, orderNo: orderNo.trim() },
    },
    select: {
      fetchStatus: true,
      fetchedAt: true,
      updatedAt: true,
      officialRefundAmountCent: true,
      expectedRefundAmountCent: true,
      appliedAmountCent: true,
      appliedShipFeeAmountCent: true,
      successReturnCount: true,
      returnRefundCount: true,
      refundOnlyCount: true,
      hasReturnRefund: true,
      hasRefundOnly: true,
      afterSaleStatus: true,
      afterSaleReason: true,
      afterSaleType: true,
      returnTypeCodes: true,
      classificationSource: true,
      returnsIds: true,
      refundIncludesFreight: true,
    },
  })
  if (!row) return false
  const ctx = orderCtx ?? (await loadOrderAfterSaleContext(liveAccountId, orderNo))
  const snapshot: WorkbenchCacheSnapshot = {
    fetchStatus: row.fetchStatus,
    fetchedAt: row.fetchedAt,
    updatedAt: row.updatedAt,
    officialRefundAmountCent: row.officialRefundAmountCent,
    freightRefundAmountCent: row.appliedShipFeeAmountCent,
    expectedRefundAmountCent: row.expectedRefundAmountCent,
    appliedAmountCent: row.appliedAmountCent,
    appliedShipFeeAmountCent: row.appliedShipFeeAmountCent,
    successReturnCount: row.successReturnCount,
    returnRefundCount: row.returnRefundCount,
    refundOnlyCount: row.refundOnlyCount,
    hasReturnRefund: row.hasReturnRefund,
    hasRefundOnly: row.hasRefundOnly,
    hasFreightOnlyRefund:
      (row.appliedShipFeeAmountCent ?? 0) > 0 && (row.officialRefundAmountCent ?? 0) === 0,
    afterSaleStatus: row.afterSaleStatus,
    afterSaleReason: row.afterSaleReason,
    afterSaleType: row.afterSaleType,
    returnTypeCodes: row.returnTypeCodes,
    classificationSource: row.classificationSource,
    returnsIds: row.returnsIds,
    refundIncludesFreight: row.refundIncludesFreight,
  }
  return isWorkbenchCacheCurrentlyValid(snapshot, ctx)
}

/** 原子认领：仅当仍为可执行状态时写入 running */
export async function claimAfterSalesQueueTask(params: {
  id: string
  workerId: string
}): Promise<{ claimed: boolean; claimToken: string | null }> {
  const claimToken = randomUUID()
  const nowIso = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')
  const changed = await prisma.$executeRaw`
    UPDATE XhsAfterSalesWorkbenchQueue
    SET
      status = 'running',
      workerId = ${params.workerId},
      claimToken = ${claimToken},
      claimedAt = ${nowIso},
      runningSince = ${nowIso},
      lastAttemptAt = ${nowIso},
      statusChangedAt = ${nowIso}
    WHERE id = ${params.id}
      AND (
        status = 'pending'
        OR (
          status = 'retry_wait'
          AND (nextAttemptAt IS NULL OR nextAttemptAt <= datetime('now'))
        )
      )
  `
  return { claimed: Number(changed) === 1, claimToken: Number(changed) === 1 ? claimToken : null }
}

async function loadDueCandidatesForShop(
  liveAccountId: string,
  take: number,
): Promise<
  Array<{
    id: string
    liveAccountId: string
    orderNo: string
    status: string
    temporaryAttemptCount: number
  }>
> {
  return prisma.$queryRaw`
    SELECT id, liveAccountId, orderNo, status, temporaryAttemptCount
    FROM XhsAfterSalesWorkbenchQueue
    WHERE liveAccountId = ${liveAccountId}
      AND (
        status = 'pending'
        OR (status = 'retry_wait' AND (nextAttemptAt IS NULL OR nextAttemptAt <= datetime('now')))
      )
    ORDER BY COALESCE(nextAttemptAt, createdAt) ASC, createdAt ASC
    LIMIT ${take}
  `
}

export async function selectAfterSalesQueueTasks(
  limits: AfterSalesQueueRateLimits = DEFAULT_AFTER_SALES_QUEUE_LIMITS,
  opts?: { workerId?: string },
): Promise<SelectedAfterSalesQueueTask[]> {
  await recoverStuckAfterSalesRunningTasks()
  resetAfterSalesQueueBatchShopFlags()

  const workerId = opts?.workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`
  const accounts = await listEnabledLiveAccountsWithCookie()
  const shopIds = accounts.map((a) => a.id)
  if (shopIds.length === 0) return []

  const circuits = await loadShopCircuits(shopIds)
  const perShopCap = limits.perShopPerMinute
  const globalCap = limits.globalPerMinute
  const shopStats: ShopSelectStats[] = []

  // 每店独立拉候选，再轮询合并，避免单店饿死其他店
  const shopQueues = new Map<string, Array<{
    id: string
    liveAccountId: string
    orderNo: string
    status: string
    temporaryAttemptCount: number
  }>>()

  await Promise.all(
    shopIds.map(async (sid) => {
      const circuit = circuits.get(sid)
      const stats: ShopSelectStats = {
        liveAccountId: sid,
        candidates: 0,
        claimed: 0,
        skippedCooldown: 0,
        skippedBlocked: 0,
        skippedValidCache: 0,
      }
      shopStats.push(stats)

      if (circuit?.circuitOpen && !circuit.allowProbe) {
        stats.skippedBlocked++
        shopQueues.set(sid, [])
        return
      }
      if (circuit?.cooldownUntil && circuit.cooldownUntil.getTime() > Date.now()) {
        stats.skippedCooldown++
        shopQueues.set(sid, [])
        return
      }

      const take = circuit?.allowProbe ? 1 : Math.max(perShopCap * 3, 6)
      const rows = await loadDueCandidatesForShop(sid, take)
      stats.candidates = rows.length
      // probe：熔断中只放 1 笔
      shopQueues.set(sid, circuit?.allowProbe ? rows.slice(0, 1) : rows)
    }),
  )

  const selectedMeta: Array<{
    id: string
    liveAccountId: string
    orderNo: string
    temporaryAttemptCount: number
  }> = []
  const perShopPicked = new Map<string, number>()
  const orderCtxByKey = new Map<string, OrderAfterSaleContext>()

  // 轮询
  let progress = true
  while (selectedMeta.length < globalCap && progress) {
    progress = false
    for (const sid of shopIds) {
      if (selectedMeta.length >= globalCap) break
      if (batchStopShops.has(sid)) continue
      const picked = perShopPicked.get(sid) ?? 0
      if (picked >= perShopCap) continue
      const q = shopQueues.get(sid)
      if (!q?.length) continue
      const row = q.shift()!
      progress = true

      const ctxKey = `${row.liveAccountId}::${row.orderNo}`
      let orderCtx = orderCtxByKey.get(ctxKey)
      if (!orderCtx) {
        orderCtx = await loadOrderAfterSaleContext(row.liveAccountId, row.orderNo)
        orderCtxByKey.set(ctxKey, orderCtx)
      }
      if (await hasValidWorkbenchCache(row.liveAccountId, row.orderNo, orderCtx)) {
        const now = new Date()
        await prisma.xhsAfterSalesWorkbenchQueue.update({
          where: { id: row.id },
          data: {
            status: 'done',
            errorType: null,
            lastError: null,
            completedAt: now,
            runningSince: null,
            workerId: null,
            claimToken: null,
            claimedAt: null,
            statusChangedAt: now,
          },
        })
        const st = shopStats.find((s) => s.liveAccountId === sid)
        if (st) st.skippedValidCache++
        continue
      }

      selectedMeta.push({
        id: row.id,
        liveAccountId: row.liveAccountId,
        orderNo: row.orderNo,
        temporaryAttemptCount: row.temporaryAttemptCount,
      })
      perShopPicked.set(sid, picked + 1)
    }
  }

  const claimed: SelectedAfterSalesQueueTask[] = []
  for (const row of selectedMeta) {
    const { claimed: ok, claimToken } = await claimAfterSalesQueueTask({
      id: row.id,
      workerId,
    })
    if (!ok || !claimToken) continue
    claimed.push({
      ...row,
      claimToken,
      workerId,
    })
    const st = shopStats.find((s) => s.liveAccountId === row.liveAccountId)
    if (st) st.claimed++
    await writeAfterSalesQueueAudit({
      liveAccountId: row.liveAccountId,
      orderNo: row.orderNo,
      fromStatus: 'pending|retry_wait',
      toStatus: 'running',
      reason: 'atomic_claim',
      workerId,
      claimToken,
      source: 'selectAfterSalesQueueTasks',
    })
  }

  logInfo(
    '售后补查',
    `公平调度 worker=${workerId} claimed=${claimed.length}/${selectedMeta.length} shops=${shopStats
      .map(
        (s) =>
          `${s.liveAccountId.slice(0, 6)}:c${s.candidates}/cl${s.claimed}/bl${s.skippedBlocked}/cd${s.skippedCooldown}`,
      )
      .join(' ')}`,
  )

  return claimed
}

async function applyShopOutcomePersistent(
  liveAccountId: string,
  disposition: AfterSalesQueueDisposition,
  errorType: AfterSalesQueueErrorType,
  message?: string | null,
): Promise<void> {
  if (disposition === 'done') {
    await recordShopAfterSalesSuccess(liveAccountId)
    return
  }
  if (disposition === 'retry_wait') {
    if (errorType === 'platform_cooling' || errorType === 'http_429') {
      batchStopShops.add(shopKey(liveAccountId))
      await openShopCircuit({
        liveAccountId,
        errorType,
        message,
        probeBackoffMs: 60_000,
      })
    }
    return
  }
  if (disposition === 'blocked' || isAuthOrSignCircuitError(errorType)) {
    batchStopShops.add(shopKey(liveAccountId))
    await openShopCircuit({ liveAccountId, errorType, message })
  }
}

export async function completeAfterSalesQueueTask(params: {
  queueId: string
  liveAccountId: string
  orderNo: string
  result: Pick<AfterSalesWorkbenchRefund, 'fetchStatus' | 'fetchError'>
  httpStatus?: number | null
  claimToken?: string | null
  workerId?: string | null
}): Promise<AfterSalesQueueStatus> {
  const { queueId, liveAccountId, result, httpStatus } = params
  const now = new Date()

  const current = await prisma.xhsAfterSalesWorkbenchQueue.findUnique({
    where: { id: queueId },
    select: {
      status: true,
      claimToken: true,
      workerId: true,
      temporaryAttemptCount: true,
    },
  })
  if (!current) return 'failed'
  if (params.claimToken && current.claimToken && params.claimToken !== current.claimToken) {
    logWarn('售后补查', `旧 claimToken 放弃覆盖：queue=${queueId}`)
    return current.status as AfterSalesQueueStatus
  }
  if (params.workerId && current.workerId && params.workerId !== current.workerId) {
    logWarn('售后补查', `旧 worker 放弃覆盖：queue=${queueId}`)
    return current.status as AfterSalesQueueStatus
  }

  const clearClaim = {
    runningSince: null as Date | null,
    workerId: null as string | null,
    claimToken: null as string | null,
    claimedAt: null as Date | null,
    statusChangedAt: now,
  }

  if (result.fetchStatus === 'success' || result.fetchStatus === 'empty') {
    await applyShopOutcomePersistent(liveAccountId, 'done', 'unknown')
    await prisma.xhsAfterSalesWorkbenchQueue.update({
      where: { id: queueId },
      data: {
        status: 'done',
        errorType: null,
        lastError: null,
        nextAttemptAt: null,
        completedAt: now,
        lastAttemptAt: now,
        attempts: { increment: 1 },
        ...clearClaim,
      },
    })
    await writeAfterSalesQueueAudit({
      liveAccountId,
      orderNo: params.orderNo,
      fromStatus: current.status,
      toStatus: 'done',
      reason: result.fetchStatus,
      workerId: params.workerId,
      claimToken: params.claimToken,
      cacheStatus: result.fetchStatus,
      source: 'completeAfterSalesQueueTask',
    })
    return 'done'
  }

  const { errorType, disposition } = classifyWorkbenchQueueError(result.fetchError, httpStatus)
  await applyShopOutcomePersistent(liveAccountId, disposition, errorType, result.fetchError)

  // probe 失败延长熔断
  const circuit = (await loadShopCircuits([liveAccountId])).get(shopKey(liveAccountId))
  if (circuit?.circuitOpen && disposition === 'blocked') {
    await markShopProbeFailed(liveAccountId, errorType, result.fetchError)
  }

  if (disposition === 'retry_wait') {
    const tempCount = (current.temporaryAttemptCount ?? 0) + 1
    const nextAt = computeNextAttemptAt(tempCount, result.fetchError)
    await prisma.xhsAfterSalesWorkbenchQueue.update({
      where: { id: queueId },
      data: {
        status: 'retry_wait',
        errorType,
        lastError: result.fetchError,
        nextAttemptAt: nextAt,
        lastAttemptAt: now,
        temporaryAttemptCount: { increment: 1 },
        attempts: { increment: 1 },
        ...clearClaim,
      },
    })
    await writeAfterSalesQueueAudit({
      liveAccountId,
      orderNo: params.orderNo,
      fromStatus: current.status,
      toStatus: 'retry_wait',
      reason: errorType,
      errorType,
      workerId: params.workerId,
      claimToken: params.claimToken,
    })
    return 'retry_wait'
  }

  if (disposition === 'blocked') {
    await prisma.xhsAfterSalesWorkbenchQueue.update({
      where: { id: queueId },
      data: {
        status: 'blocked',
        errorType,
        lastError: result.fetchError,
        nextAttemptAt: null,
        lastAttemptAt: now,
        temporaryAttemptCount: { increment: 1 },
        attempts: { increment: 1 },
        ...clearClaim,
      },
    })
    await writeAfterSalesQueueAudit({
      liveAccountId,
      orderNo: params.orderNo,
      fromStatus: current.status,
      toStatus: 'blocked',
      reason: errorType,
      errorType,
      workerId: params.workerId,
      claimToken: params.claimToken,
    })
    logWarn(
      '售后补查',
      `店铺阻塞：shop=${liveAccountId} order=${params.orderNo} errorType=${errorType}`,
    )
    return 'blocked'
  }

  await prisma.xhsAfterSalesWorkbenchQueue.update({
    where: { id: queueId },
    data: {
      status: 'failed',
      errorType,
      lastError: result.fetchError,
      nextAttemptAt: null,
      lastAttemptAt: now,
      permanentFailureCount: { increment: 1 },
      attempts: { increment: 1 },
      ...clearClaim,
    },
  })
  await writeAfterSalesQueueAudit({
    liveAccountId,
    orderNo: params.orderNo,
    fromStatus: current.status,
    toStatus: 'failed',
    reason: errorType,
    errorType,
    workerId: params.workerId,
    claimToken: params.claimToken,
  })
  return 'failed'
}

export async function getAfterSalesQueueStatusCounts(): Promise<Record<string, number>> {
  const rows = await prisma.xhsAfterSalesWorkbenchQueue.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  const out: Record<string, number> = {}
  for (const r of rows) {
    out[r.status] = r._count._all
  }
  return out
}

export async function getShopExternalHealth(
  liveAccountId: string,
): Promise<{ cookieHealthy: boolean; signEnvHealthy: boolean }> {
  const circuit = (await loadShopCircuits([liveAccountId])).get(shopKey(liveAccountId))
  if (!circuit) return { cookieHealthy: true, signEnvHealthy: true }
  return {
    cookieHealthy: !circuit.circuitOpen || !isAuthOrSignCircuitError(circuit.circuitReason),
    signEnvHealthy: !circuit.circuitOpen || circuit.circuitReason !== 'sign_env_missing',
  }
}

/** 测试导出：轮询合并算法纯函数版 */
export function mergeShopCandidatesRoundRobin<T extends { liveAccountId: string }>(
  byShop: Map<string, T[]>,
  shopOrder: string[],
  globalCap: number,
  perShopCap: number,
): T[] {
  const queues = new Map(shopOrder.map((s) => [s, [...(byShop.get(s) ?? [])]]))
  const out: T[] = []
  const picked = new Map<string, number>()
  let progress = true
  while (out.length < globalCap && progress) {
    progress = false
    for (const sid of shopOrder) {
      if (out.length >= globalCap) break
      if ((picked.get(sid) ?? 0) >= perShopCap) continue
      const q = queues.get(sid)
      if (!q?.length) continue
      out.push(q.shift()!)
      picked.set(sid, (picked.get(sid) ?? 0) + 1)
      progress = true
    }
  }
  return out
}

export type { ShopCircuitSnapshot }
