/**
 * 店铺售后熔断持久化：跨进程 / 跨批次有效
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

async function ensureRow(liveAccountId: string, platformName = '') {
  return prisma.shopAfterSalesRuntime.upsert({
    where: { liveAccountId },
    create: { liveAccountId, platformName, updatedAt: new Date() },
    update: platformName ? { platformName } : {},
  })
}

export async function loadShopCircuit(
  liveAccountId: string,
): Promise<ShopCircuitSnapshot> {
  const key = liveAccountId || 'legacy'
  const row = await ensureRow(key)
  const now = Date.now()
  const nextProbe = row.circuitNextProbeAt?.getTime() ?? 0
  const allowProbe = row.circuitOpen && nextProbe > 0 && nextProbe <= now
  return {
    liveAccountId: key,
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

export async function loadShopCircuits(
  liveAccountIds: string[],
): Promise<Map<string, ShopCircuitSnapshot>> {
  const out = new Map<string, ShopCircuitSnapshot>()
  await Promise.all(
    [...new Set(liveAccountIds.map((id) => id || 'legacy'))].map(async (id) => {
      out.set(id, await loadShopCircuit(id))
    }),
  )
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
    params.errorType === 'platform_cooling' || params.errorType === 'http_429'

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
