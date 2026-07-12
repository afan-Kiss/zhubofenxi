/**
 * 安全恢复历史冷却/临时失败售后队列任务
 * npx tsx apps/server/scripts/recover-after-sales-cooling-tasks.ts [--apply] [--shop=] [--limit=20]
 */
import { prisma } from '../src/lib/prisma'
import {
  classifyWorkbenchQueueError,
  computeNextAttemptAt,
} from '../src/services/after-sales-queue.service'

const APPLY = process.argv.includes('--apply')
const SHOP_ARG = process.argv.find((a) => a.startsWith('--shop='))?.split('=')[1]?.trim()
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
const ERROR_TYPE_ARG = process.argv.find((a) => a.startsWith('--error-type='))?.split('=')[1]?.trim()
const BEFORE_ARG = process.argv.find((a) => a.startsWith('--before='))?.split('=')[1]?.trim()

const DEFAULT_LIMIT = 20
const limit = LIMIT_ARG ? Math.max(1, Number.parseInt(LIMIT_ARG, 10) || DEFAULT_LIMIT) : DEFAULT_LIMIT

const RECOVERABLE_ERROR_TYPES = new Set([
  'platform_cooling',
  'http_429',
  'http_502',
  'http_503',
  'http_504',
  'network_timeout',
  'sign_generation_failed',
  'sign_python2_interpreter',
  'unknown',
])

async function resolveShopIds(shopKey?: string): Promise<string[] | null> {
  if (!shopKey) return null
  const rows = await prisma.platformCredential.findMany({
    where: {
      OR: [
        { id: shopKey },
        { displayName: { contains: shopKey } },
      ],
    },
    select: { id: true, displayName: true },
  })
  if (rows.length === 0) return []
  return rows.map((r) => r.id)
}

async function main(): Promise<void> {
  const shopIds = await resolveShopIds(SHOP_ARG)
  if (shopIds && shopIds.length === 0) {
    console.error(`未找到店铺：${SHOP_ARG}`)
    process.exit(1)
  }

  const where: Record<string, unknown> = {
    status: { in: ['failed', 'retry_wait'] },
  }
  if (shopIds) where.liveAccountId = { in: shopIds }
  if (BEFORE_ARG) {
    where.updatedAt = { lte: new Date(BEFORE_ARG) }
  }

  const rows = await prisma.xhsAfterSalesWorkbenchQueue.findMany({
    where,
    orderBy: { updatedAt: 'asc' },
    take: APPLY ? limit : 5000,
    select: {
      id: true,
      liveAccountId: true,
      orderNo: true,
      status: true,
      errorType: true,
      lastError: true,
      attempts: true,
      temporaryAttemptCount: true,
      permanentFailureCount: true,
      updatedAt: true,
      createdAt: true,
    },
  })

  const names = new Map(
    (await prisma.platformCredential.findMany({ select: { id: true, displayName: true } })).map(
      (r) => [r.id, r.displayName ?? r.id],
    ),
  )

  let toRetry = 0
  let toBlocked = 0
  let keepFailed = 0
  const byShop: Record<string, number> = {}
  const byErrorType: Record<string, number> = {}

  const actions: Array<{
    id: string
    orderNo: string
    shop: string
    from: string
    to: 'retry_wait' | 'blocked' | 'failed'
    errorType: string
  }> = []

  for (const row of rows) {
    const shop = names.get(row.liveAccountId) ?? row.liveAccountId
    byShop[shop] = (byShop[shop] ?? 0) + 1
    const inferred = classifyWorkbenchQueueError(row.lastError)
    const errType = (row.errorType ?? inferred.errorType) as string
    if (ERROR_TYPE_ARG && errType !== ERROR_TYPE_ARG) continue

    let target: 'retry_wait' | 'blocked' | 'failed' = 'failed'
    if (inferred.disposition === 'blocked') {
      target = 'blocked'
      toBlocked++
    } else if (
      inferred.disposition === 'retry_wait' ||
      RECOVERABLE_ERROR_TYPES.has(errType) ||
      (row.lastError?.includes('冷却') ?? false)
    ) {
      target = 'retry_wait'
      toRetry++
    } else {
      keepFailed++
    }
    byErrorType[errType] = (byErrorType[errType] ?? 0) + 1
    if (actions.length < limit) {
      actions.push({
        id: row.id,
        orderNo: row.orderNo,
        shop,
        from: row.status,
        to: target,
        errorType: errType,
      })
    }
  }

  console.log('=== recover-after-sales-cooling-tasks ===')
  console.log('mode', APPLY ? 'apply' : 'dry-run')
  console.log('matched', rows.length)
  console.log('to_retry_wait', toRetry)
  console.log('to_blocked', toBlocked)
  console.log('keep_failed', keepFailed)
  console.log('by_shop', byShop)
  console.log('by_errorType', byErrorType)
  console.log('sample_actions', actions.slice(0, 10))

  if (!APPLY) {
    console.log(`dry-run 完成；加 --apply --limit=${limit} 执行恢复（默认上限 ${DEFAULT_LIMIT}）`)
    return
  }

  let applied = 0
  const now = Date.now()
  for (const act of actions) {
    if (applied >= limit) break
    const row = rows.find((r) => r.id === act.id)
    if (!row) continue
    if (act.to === 'retry_wait') {
      const temp = row.temporaryAttemptCount || row.attempts || 1
      const jitterMin = applied % 5
      const nextAt = computeNextAttemptAt(temp, row.lastError, now + jitterMin * 12_000)
      await prisma.xhsAfterSalesWorkbenchQueue.update({
        where: { id: row.id },
        data: {
          status: 'retry_wait',
          errorType: act.errorType,
          nextAttemptAt: nextAt,
          runningSince: null,
          lastError: row.lastError
            ? `${row.lastError}\n[recovered ${new Date().toISOString()}]`
            : `[recovered ${new Date().toISOString()}]`,
        },
      })
      applied++
    } else if (act.to === 'blocked') {
      await prisma.xhsAfterSalesWorkbenchQueue.update({
        where: { id: row.id },
        data: {
          status: 'blocked',
          errorType: act.errorType,
          nextAttemptAt: null,
          runningSince: null,
        },
      })
      applied++
    }
  }
  console.log('applied', applied)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
