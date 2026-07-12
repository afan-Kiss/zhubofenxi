/**
 * 售后工作台补查队列：状态机、冷却恢复、按店隔离
 */
import { prisma } from '../lib/prisma'
import type { AfterSalesWorkbenchRefund } from './xhs-after-sales-workbench.service'
import {
  AFTER_SALES_RUNNING_TIMEOUT_MS,
  AFTER_SALES_SHOP_AUTH_BLOCK_THRESHOLD,
  AFTER_SALES_SHOP_SIGN_BLOCK_THRESHOLD,
  DEFAULT_AFTER_SALES_QUEUE_LIMITS,
  type AfterSalesQueueDisposition,
  type AfterSalesQueueErrorType,
  type AfterSalesQueueRateLimits,
  type AfterSalesQueueStatus,
} from './after-sales-queue.types'
import { logWarn } from '../utils/server-log'

interface ShopRuntimeState {
  cooldownUntil: number
  consecutiveCoolingCount: number
  consecutiveSignFailureCount: number
  consecutiveAuthFailureCount: number
  lastSuccessAt: number | null
  lastErrorType: AfterSalesQueueErrorType | null
  batchStop: boolean
}

const shopRuntime = new Map<string, ShopRuntimeState>()

function shopKey(liveAccountId: string): string {
  return liveAccountId || 'legacy'
}

function getShopState(liveAccountId: string): ShopRuntimeState {
  const key = shopKey(liveAccountId)
  let s = shopRuntime.get(key)
  if (!s) {
    s = {
      cooldownUntil: 0,
      consecutiveCoolingCount: 0,
      consecutiveSignFailureCount: 0,
      consecutiveAuthFailureCount: 0,
      lastSuccessAt: null,
      lastErrorType: null,
      batchStop: false,
    }
    shopRuntime.set(key, s)
  }
  return s
}

export function resetAfterSalesQueueBatchShopFlags(): void {
  for (const s of shopRuntime.values()) {
    s.batchStop = false
  }
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
    select: { id: true, liveAccountId: true, orderNo: true, temporaryAttemptCount: true },
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
        temporaryAttemptCount: { increment: 1 },
        attempts: { increment: 1 },
      },
    })
    logWarn('售后补查', `running 超时恢复：shop=${row.liveAccountId} order=${row.orderNo}`)
  }
  return stuck.length
}

export async function hasValidWorkbenchCache(
  liveAccountId: string,
  orderNo: string,
): Promise<boolean> {
  const row = await prisma.xhsAfterSalesWorkbenchCache.findUnique({
    where: {
      liveAccountId_orderNo: { liveAccountId, orderNo: orderNo.trim() },
    },
    select: { fetchStatus: true },
  })
  return row?.fetchStatus === 'success' || row?.fetchStatus === 'empty'
}

export async function selectAfterSalesQueueTasks(
  limits: AfterSalesQueueRateLimits = DEFAULT_AFTER_SALES_QUEUE_LIMITS,
): Promise<
  Array<{
    id: string
    liveAccountId: string
    orderNo: string
    temporaryAttemptCount: number
  }>
> {
  await recoverStuckAfterSalesRunningTasks()
  resetAfterSalesQueueBatchShopFlags()

  const now = new Date()
  // SQLite 存 naive datetime；Prisma DateTime 过滤在部分环境下会匹配不到到期任务
  const candidateLimit = limits.globalPerMinute * 4
  const candidates = await prisma.$queryRaw<
    Array<{
      id: string
      liveAccountId: string
      orderNo: string
      status: string
      temporaryAttemptCount: number
    }>
  >`
    SELECT id, liveAccountId, orderNo, status, temporaryAttemptCount
    FROM XhsAfterSalesWorkbenchQueue
    WHERE status = 'pending'
       OR (status = 'retry_wait' AND (nextAttemptAt IS NULL OR nextAttemptAt <= datetime('now')))
    ORDER BY COALESCE(nextAttemptAt, createdAt) ASC, createdAt ASC
    LIMIT ${candidateLimit}
  `

  const selected: typeof candidates = []
  const perShop = new Map<string, number>()

  for (const row of candidates) {
    if (selected.length >= limits.globalPerMinute) break

    const sid = shopKey(row.liveAccountId)
    const state = getShopState(row.liveAccountId)

    if (state.batchStop) continue
    if (state.cooldownUntil > Date.now()) continue

    const shopCount = perShop.get(sid) ?? 0
    if (shopCount >= limits.perShopPerMinute) continue

    if (await hasValidWorkbenchCache(row.liveAccountId, row.orderNo)) {
      await prisma.xhsAfterSalesWorkbenchQueue.update({
        where: { id: row.id },
        data: {
          status: 'done',
          errorType: null,
          lastError: null,
          completedAt: now,
          runningSince: null,
        },
      })
      continue
    }

    selected.push(row)
    perShop.set(sid, shopCount + 1)
  }

  const now2 = new Date()
  for (const row of selected) {
    await prisma.xhsAfterSalesWorkbenchQueue.update({
      where: { id: row.id },
      data: { status: 'running', runningSince: now2, lastAttemptAt: now2 },
    })
  }

  return selected
}

function applyShopOutcome(
  liveAccountId: string,
  disposition: AfterSalesQueueDisposition,
  errorType: AfterSalesQueueErrorType,
): void {
  const state = getShopState(liveAccountId)
  state.lastErrorType = errorType

  if (disposition === 'done') {
    state.consecutiveCoolingCount = 0
    state.consecutiveSignFailureCount = 0
    state.consecutiveAuthFailureCount = 0
    state.lastSuccessAt = Date.now()
    state.batchStop = false
    return
  }

  if (disposition === 'retry_wait') {
    if (errorType === 'platform_cooling' || errorType === 'http_429') {
      state.consecutiveCoolingCount++
      state.batchStop = true
      const extraMs = Math.min(300_000, state.consecutiveCoolingCount * 60_000)
      state.cooldownUntil = Date.now() + extraMs
    } else if (errorType === 'sign_generation_failed') {
      state.consecutiveSignFailureCount++
    }
    return
  }

  if (disposition === 'blocked') {
    if (errorType === 'http_401' || errorType === 'http_403' || errorType === 'cookie_expired') {
      state.consecutiveAuthFailureCount++
      state.batchStop = true
    }
    if (
      errorType === 'sign_env_missing' ||
      errorType === 'sign_python2_interpreter' ||
      state.consecutiveSignFailureCount >= AFTER_SALES_SHOP_SIGN_BLOCK_THRESHOLD
    ) {
      state.batchStop = true
    }
    if (state.consecutiveAuthFailureCount >= AFTER_SALES_SHOP_AUTH_BLOCK_THRESHOLD) {
      state.batchStop = true
    }
  }
}

export async function completeAfterSalesQueueTask(params: {
  queueId: string
  liveAccountId: string
  orderNo: string
  result: Pick<AfterSalesWorkbenchRefund, 'fetchStatus' | 'fetchError'>
  httpStatus?: number | null
}): Promise<AfterSalesQueueStatus> {
  const { queueId, liveAccountId, result, httpStatus } = params
  const now = new Date()

  if (result.fetchStatus === 'success' || result.fetchStatus === 'empty') {
    applyShopOutcome(liveAccountId, 'done', 'unknown')
    await prisma.xhsAfterSalesWorkbenchQueue.update({
      where: { id: queueId },
      data: {
        status: 'done',
        errorType: null,
        lastError: null,
        nextAttemptAt: null,
        completedAt: now,
        lastAttemptAt: now,
        runningSince: null,
        attempts: { increment: 1 },
      },
    })
    return 'done'
  }

  const { errorType, disposition } = classifyWorkbenchQueueError(result.fetchError, httpStatus)
  applyShopOutcome(liveAccountId, disposition, errorType)

  if (disposition === 'retry_wait') {
    const row = await prisma.xhsAfterSalesWorkbenchQueue.findUnique({
      where: { id: queueId },
      select: { temporaryAttemptCount: true },
    })
    const tempCount = (row?.temporaryAttemptCount ?? 0) + 1
    const nextAt = computeNextAttemptAt(tempCount, result.fetchError)
    await prisma.xhsAfterSalesWorkbenchQueue.update({
      where: { id: queueId },
      data: {
        status: 'retry_wait',
        errorType,
        lastError: result.fetchError,
        nextAttemptAt: nextAt,
        lastAttemptAt: now,
        runningSince: null,
        temporaryAttemptCount: { increment: 1 },
        attempts: { increment: 1 },
      },
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
        runningSince: null,
        temporaryAttemptCount: { increment: 1 },
        attempts: { increment: 1 },
      },
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
      runningSince: null,
      permanentFailureCount: { increment: 1 },
      attempts: { increment: 1 },
    },
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
