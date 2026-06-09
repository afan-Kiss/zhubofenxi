import { prisma } from '../lib/prisma'
import {
  normalizeXhsOrderPackage,
} from './xhs-api-sync/xhs-json-normalizer.service'
import { getSyncStrategySettings } from './system-setting.service'
import { getMonthKey } from '../utils/time'
import { resolveRollingDays } from '../utils/date-range'

const POOL_STATUS_KEYWORDS = [
  '待发货',
  '待收货',
  '待配货',
  '预售',
  '未结算',
  '待结算',
  '结算中',
  '退款中',
  '售后中',
  '售后处理',
  '结算异常',
]

const COMPLETED_KEYWORDS = ['已完成', '交易完成', '已签收', '已关闭']
const NO_AFTER_SALE_KEYWORDS = ['无售后', '—', '']

export interface PoolEvaluation {
  packageId: string
  skuId: string
  reasons: string[]
  orderMonth: string | null
  lastStatusText: string
  shouldTrack: boolean
  shouldRemove: boolean
}

function pickSkuId(raw: Record<string, unknown>): string {
  const sku = raw.skuId ?? raw.sku_id ?? raw.skuCode
  return sku != null ? String(sku) : ''
}

function statusTexts(raw: Record<string, unknown>): { order: string; afterSale: string } {
  const order =
    String(raw.statusDesc ?? raw.status_desc ?? raw.orderStatusDesc ?? '').trim()
  const afterSale = String(
    raw.afterSaleStatusDesc ?? raw.after_sale_status_desc ?? '',
  ).trim()
  return { order, afterSale }
}

function hasKeyword(text: string, keywords: string[]): boolean {
  if (!text) return false
  return keywords.some((k) => k && text.includes(k))
}

export function evaluateOrderForPool(
  raw: Record<string, unknown>,
  options?: { recentChangeDays?: number; updatedAt?: Date | null },
): PoolEvaluation {
  const packageId = String(raw.packageId ?? raw.package_id ?? '').trim()
  const skuId = pickSkuId(raw)
  const { order, afterSale } = statusTexts(raw)
  const combined = [order, afterSale].filter(Boolean).join(' ')
  const reasons: string[] = []

  for (const kw of POOL_STATUS_KEYWORDS) {
    if (combined.includes(kw)) reasons.push(kw)
  }

  const norm = normalizeXhsOrderPackage(raw, 0)
  const orderMonth = norm?.orderTime ? getMonthKey(norm.orderTime) : null

  if (options?.updatedAt && options.recentChangeDays) {
    const cutoff = Date.now() - options.recentChangeDays * 86_400_000
    if (options.updatedAt.getTime() >= cutoff) {
      reasons.push('最近状态变化')
    }
  }

  const isCompleted = hasKeyword(order, COMPLETED_KEYWORDS)
  const noAfterSale =
    !afterSale || NO_AFTER_SALE_KEYWORDS.some((k) => afterSale === k)
  const isSettledHint = combined.includes('已结算') || combined.includes('结算成功')
  const hasOpenIssue = reasons.some((r) => r !== '最近状态变化')

  const observationDays = options?.recentChangeDays ?? 30
  let pastObservation = true
  if (norm?.orderTime) {
    const obsMs = observationDays * 86_400_000
    pastObservation = Date.now() - norm.orderTime.getTime() > obsMs
  }

  const shouldRemove =
    Boolean(packageId) &&
    isCompleted &&
    noAfterSale &&
    isSettledHint &&
    pastObservation &&
    !hasOpenIssue

  const shouldTrack = Boolean(packageId) && (hasOpenIssue || !shouldRemove)

  return {
    packageId,
    skuId,
    reasons: [...new Set(reasons)],
    orderMonth,
    lastStatusText: combined || order || afterSale,
    shouldTrack,
    shouldRemove,
  }
}

export async function upsertTrackingPoolEntry(
  evaluation: PoolEvaluation,
  syncJobId?: string | null,
): Promise<void> {
  if (!evaluation.packageId) return

  if (evaluation.shouldRemove) {
    await prisma.orderTrackingPool.updateMany({
      where: {
        packageId: evaluation.packageId,
        skuId: evaluation.skuId,
        status: 'active',
      },
      data: {
        status: 'removed',
        removedAt: new Date(),
        lastCheckedAt: new Date(),
        syncJobId: syncJobId ?? null,
      },
    })
    return
  }

  if (!evaluation.shouldTrack) return

  const reasons = evaluation.reasons.join(',')
  await prisma.orderTrackingPool.upsert({
    where: {
      packageId_skuId: {
        packageId: evaluation.packageId,
        skuId: evaluation.skuId,
      },
    },
    create: {
      packageId: evaluation.packageId,
      skuId: evaluation.skuId,
      reasons,
      status: 'active',
      orderMonth: evaluation.orderMonth,
      lastStatusText: evaluation.lastStatusText,
      syncJobId: syncJobId ?? null,
    },
    update: {
      reasons,
      status: 'active',
      removedAt: null,
      orderMonth: evaluation.orderMonth ?? undefined,
      lastStatusText: evaluation.lastStatusText,
      lastCheckedAt: new Date(),
      syncJobId: syncJobId ?? null,
    },
  })
}

export async function refreshTrackingPoolFromRaw(syncJobId?: string | null): Promise<{
  active: number
  added: number
  removed: number
}> {
  const strategy = await getSyncStrategySettings()

  const rawOrders = await prisma.xhsRawOrder.findMany({
    select: { packageId: true, rawJson: true, updatedAt: true, orderTime: true },
  })

  const pendingRows = await prisma.xhsRawPendingSettlement.findMany({
    select: { packageId: true },
  })
  const pendingPackageIds = new Set(
    pendingRows.map((r) => r.packageId).filter(Boolean) as string[],
  )

  let removed = 0
  for (const row of rawOrders) {
    const raw = row.rawJson as Record<string, unknown>
    const evalResult = evaluateOrderForPool(raw, {
      recentChangeDays: strategy.orderRollingDays,
      updatedAt: row.updatedAt,
    })
    if (!evalResult.packageId && row.packageId) {
      evalResult.packageId = row.packageId
    }
    if (pendingPackageIds.has(evalResult.packageId)) {
      if (!evalResult.reasons.includes('待结算')) evalResult.reasons.push('待结算')
      evalResult.shouldTrack = true
      evalResult.shouldRemove = false
    }
    if (evalResult.shouldRemove) removed++
    await upsertTrackingPoolEntry(evalResult, syncJobId)
  }

  for (const packageId of pendingPackageIds) {
    if (!packageId) continue
    await upsertTrackingPoolEntry(
      {
        packageId,
        skuId: '',
        reasons: ['待结算'],
        orderMonth: null,
        lastStatusText: '待结算',
        shouldTrack: true,
        shouldRemove: false,
      },
      syncJobId,
    )
  }

  const active = await prisma.orderTrackingPool.count({ where: { status: 'active' } })
  return { active, added: active, removed }
}

export async function getActivePoolPackageIds(): Promise<string[]> {
  const rows = await prisma.orderTrackingPool.findMany({
    where: { status: 'active' },
    select: { packageId: true },
  })
  return [...new Set(rows.map((r) => r.packageId))]
}

export async function recheckTrackingPool(syncJobId?: string | null): Promise<number> {
  const activeRows = await prisma.orderTrackingPool.findMany({
    where: { status: 'active' },
    select: { packageId: true, skuId: true },
  })
  const strategy = await getSyncStrategySettings()
  let checked = 0

  for (const entry of activeRows) {
    const order = await prisma.xhsRawOrder.findFirst({
      where: { packageId: entry.packageId },
    })
    if (!order) continue
    const evalResult = evaluateOrderForPool(order.rawJson as Record<string, unknown>, {
      recentChangeDays: strategy.afterSaleObservationDays,
      updatedAt: order.updatedAt,
    })
    evalResult.packageId = entry.packageId
    evalResult.skuId = entry.skuId
    await upsertTrackingPoolEntry(evalResult, syncJobId)
    checked++
  }
  return checked
}
