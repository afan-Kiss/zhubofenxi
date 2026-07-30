/**
 * 店铺售后熔断持久化：跨进程 / 跨批次有效
 * 读路径只用 findUnique/findMany，避免每批对全店 upsert 抢 SQLite 写锁
 */
import { prisma } from '../lib/prisma'
import type { AfterSalesQueueErrorType } from './after-sales-queue.types'
import {
  AFTER_SALES_SHOP_AUTH_BLOCK_THRESHOLD,
  AFTER_SALES_SHOP_SIGN_BLOCK_THRESHOLD,
} from './after-sales-queue.types'

const AUTH_CIRCUIT_TYPES = new Set([
  'cookie_missing',
  'cookie_expired',
  'http_401',
  'http_403',
])
const SIGN_CIRCUIT_TYPES = new Set(['sign_env_missing', 'sign_python2_interpreter'])

export interface ShopCircuitSnapshot {
  liveAccountId: string
  circuitOpen: boolean
  circuitReason: string | null
  circuitOpenedAt: Date | null
  circuitNextProbeAt: Date | null
  cooldownUntil: Date | null
  cookieHealthy: boolean
  signEnvHealthy: boolean
  allowProbe: boolean
}

type RuntimeRow = {
  liveAccountId: string
  circuitOpen: boolean
  circuitReason: string | null
  circuitOpenedAt: Date | null
  circuitNextProbeAt: Date | null
  cooldownUntil: Date | null
  consecutiveAuthFail: number
  consecutiveSignFail: number
}

function snapshotFromRow(row: RuntimeRow): ShopCircuitSnapshot {
  const now = Date.now()
  const nextProbe = row.circuitNextProbeAt?.getTime() ?? 0
  const allowProbe = row.circuitOpen && nextProbe > 0 && nextProbe <= now
  return {
    liveAccountId: row.liveAccountId,
    circuitOpen: Boolean(row.circuitOpen),
    circuitReason: row.circuitReason,
    circuitOpenedAt: row.circuitOpenedAt,
    circuitNextProbeAt: row.circuitNextProbeAt,
    cooldownUntil: row.cooldownUntil,
    cookieHealthy: !AUTH_CIRCUIT_TYPES.has(String(row.circuitReason ?? '')),
    signEnvHealthy: !SIGN_CIRCUIT_TYPES.has(String(row.circuitReason ?? '')),
    allowProbe,
  }
}

/** 仅写路径需要保证行存在；读路径勿调用 */
async function ensureRow(liveAccountId: string, platformName = '') {
  return prisma.shopAfterSalesRuntime.upsert({
    where: { liveAccountId },
    create: { liveAccountId, platformName, updatedAt: new Date() },
    update: platformName ? { platformName } : {},
  })
}

async function findOrCreateRow(liveAccountId: string): Promise<RuntimeRow> {
  const key = liveAccountId || 'legacy'
  const existing = await prisma.shopAfterSalesRuntime.findUnique({
    where: { liveAccountId: key },
  })
  if (existing) return existing
  try {
    return await prisma.shopAfterSalesRuntime.create({
      data: { liveAccountId: key, platformName: '', updatedAt: new Date() },
    })
  } catch {
    const again = await prisma.shopAfterSalesRuntime.findUnique({
      where: { liveAccountId: key },
    })
    if (again) return again
    throw new Error(`shopAfterSalesRuntime create failed: ${key}`)
  }
}

export async function loadShopCircuit(
  liveAccountId: string,
): Promise<ShopCircuitSnapshot> {
  const row = await findOrCreateRow(liveAccountId || 'legacy')
  return snapshotFromRow(row)
}

export async function loadShopCircuits(
  liveAccountIds: string[],
): Promise<Map<string, ShopCircuitSnapshot>> {
  const keys = [...new Set(liveAccountIds.map((id) => id || 'legacy'))]
  const out = new Map<string, ShopCircuitSnapshot>()
  if (keys.length === 0) return out

  const rows = await prisma.shopAfterSalesRuntime.findMany({
    where: { liveAccountId: { in: keys } },
  })
  const have = new Set(rows.map((r) => r.liveAccountId))
  for (const row of rows) {
    out.set(row.liveAccountId, snapshotFromRow(row))
  }
  // 缺行极少：仅补建缺失店铺，避免每批全量 upsert
  for (const key of keys) {
    if (have.has(key)) continue
    out.set(key, await loadShopCircuit(key))
  }
  return out
}

export async function recordShopAfterSalesSuccess(liveAccountId: string): Promise<void> {
  const key = liveAccountId || 'legacy'
  const now = new Date()
  await prisma.shopAfterSalesRuntime.upsert({
    where: { liveAccountId: key },
    create: {
      liveAccountId: key,
      circuitOpen: false,
      lastSuccessAt: now,
      consecutiveAuthFail: 0,
      consecutiveSignFail: 0,
      consecutiveCooling: 0,
      cooldownUntil: null,
      completedPerMinute: 1,
      updatedAt: now,
    },
    update: {
      circuitOpen: false,
      circuitReason: null,
      circuitOpenedAt: null,
      circuitNextProbeAt: null,
      consecutiveAuthFail: 0,
      consecutiveSignFail: 0,
      consecutiveCooling: 0,
      cooldownUntil: null,
      lastSuccessAt: now,
      lastErrorType: null,
      lastErrorMessage: null,
      completedPerMinute: { increment: 1 },
      updatedAt: now,
    },
  })
}

export async function openShopCircuit(params: {
  liveAccountId: string
  errorType: AfterSalesQueueErrorType | string
  message?: string | null
  platformName?: string
  probeBackoffMs?: number
}): Promise<void> {
  const key = params.liveAccountId || 'legacy'
  const now = new Date()
  const backoff = params.probeBackoffMs ?? 30 * 60_000
  const row = await ensureRow(key, params.platformName)
  const auth =
    AUTH_CIRCUIT_TYPES.has(params.errorType) ||
    row.consecutiveAuthFail + 1 >= AFTER_SALES_SHOP_AUTH_BLOCK_THRESHOLD
  const sign =
    SIGN_CIRCUIT_TYPES.has(params.errorType) ||
    row.consecutiveSignFail + 1 >= AFTER_SALES_SHOP_SIGN_BLOCK_THRESHOLD
  const cooling =
    params.errorType === 'platform_cooling' ||
    params.errorType === 'http_429' ||
    params.errorType === 'http_500'

  await prisma.shopAfterSalesRuntime.update({
    where: { liveAccountId: key },
    data: {
      circuitOpen: auth || sign || cooling,
      circuitReason: String(params.errorType),
      circuitOpenedAt: now,
      circuitNextProbeAt: new Date(now.getTime() + backoff),
      consecutiveAuthFail: auth ? { increment: 1 } : undefined,
      consecutiveSignFail: sign ? { increment: 1 } : undefined,
      consecutiveCooling: cooling ? { increment: 1 } : undefined,
      cooldownUntil: cooling ? new Date(now.getTime() + Math.min(300_000, backoff)) : undefined,
      lastErrorType: String(params.errorType),
      lastErrorMessage: params.message ?? null,
      updatedAt: now,
    },
  })
}

export async function markShopProbeFailed(
  liveAccountId: string,
  errorType: string,
  message?: string | null,
): Promise<void> {
  const key = liveAccountId || 'legacy'
  const now = new Date()
  const row = await ensureRow(key)
  const extend = Math.min(
    6 * 60 * 60_000,
    Math.max(30 * 60_000, (row.consecutiveAuthFail + 1) * 30 * 60_000),
  )
  await prisma.shopAfterSalesRuntime.update({
    where: { liveAccountId: key },
    data: {
      circuitOpen: true,
      circuitReason: errorType,
      circuitNextProbeAt: new Date(now.getTime() + extend),
      consecutiveAuthFail: { increment: 1 },
      lastErrorType: errorType,
      lastErrorMessage: message ?? null,
      updatedAt: now,
    },
  })
}

/** 每批结束后衰减 completedPerMinute，避免长期估算失真 */
export async function decayShopCompletedPerMinute(): Promise<void> {
  await prisma.shopAfterSalesRuntime.updateMany({
    data: { completedPerMinute: 0 },
  })
}

export function isAuthOrSignCircuitError(errorType: string | null | undefined): boolean {
  const t = String(errorType ?? '')
  return AUTH_CIRCUIT_TYPES.has(t) || SIGN_CIRCUIT_TYPES.has(t)
}
