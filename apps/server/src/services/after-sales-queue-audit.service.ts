/**
 * 售后队列状态变更持久化审计（不落 Cookie）
 */
import { prisma } from '../lib/prisma'

export async function writeAfterSalesQueueAudit(params: {
  liveAccountId: string
  orderNo: string
  fromStatus?: string | null
  toStatus: string
  reason?: string | null
  errorType?: string | null
  force?: boolean
  source?: string | null
  workerId?: string | null
  claimToken?: string | null
  cacheStatus?: string | null
  orderAfterSaleStatus?: string | null
  operator?: string | null
}): Promise<void> {
  try {
    await prisma.xhsAfterSalesQueueAudit.create({
      data: {
        liveAccountId: params.liveAccountId || 'legacy',
        orderNo: params.orderNo.trim(),
        fromStatus: params.fromStatus ?? null,
        toStatus: params.toStatus,
        reason: params.reason ?? null,
        errorType: params.errorType ?? null,
        force: params.force === true,
        source: params.source ?? null,
        workerId: params.workerId ?? null,
        claimToken: params.claimToken ?? null,
        cacheStatus: params.cacheStatus ?? null,
        orderAfterSaleStatus: params.orderAfterSaleStatus ?? null,
        operator: params.operator ?? null,
      },
    })
  } catch {
    // 审计失败不阻断主流程
  }
}

export async function getAfterSalesOpsSummary(): Promise<{
  byShop: Array<{
    liveAccountId: string
    platformName: string
    pending: number
    running: number
    retry_wait: number
    blocked: number
    failed: number
    done: number
    oldestOpenAgeSec: number | null
    lastSuccessAt: string | null
    recentError: string | null
    circuitOpen: boolean
    circuitReason: string | null
    circuitNextProbeAt: string | null
    completedPerMinute: number
    etaMinutes: number | null
  }>
  totals: Record<string, number>
}> {
  const [queues, runtimes, creds] = await Promise.all([
    prisma.xhsAfterSalesWorkbenchQueue.findMany({
      select: {
        liveAccountId: true,
        status: true,
        statusChangedAt: true,
        lastError: true,
        createdAt: true,
      },
    }),
    prisma.shopAfterSalesRuntime.findMany(),
    prisma.platformCredential.findMany({
      where: { enabled: true },
      select: { id: true, platformName: true, displayName: true },
    }),
  ])

  const runtimeByShop = new Map(runtimes.map((r) => [r.liveAccountId, r]))
  const nameById = new Map(
    creds.map((c) => [c.id, c.displayName || c.platformName || c.id]),
  )

  const shopIds = new Set<string>()
  for (const q of queues) shopIds.add(q.liveAccountId || 'legacy')
  for (const c of creds) shopIds.add(c.id)

  const totals: Record<string, number> = {}
  const byShop = [...shopIds].map((liveAccountId) => {
    const rows = queues.filter((q) => (q.liveAccountId || 'legacy') === liveAccountId)
    const count = (s: string) => rows.filter((r) => r.status === s).length
    const pending = count('pending')
    const running = count('running')
    const retry_wait = count('retry_wait')
    const blocked = count('blocked')
    const failed = count('failed')
    const done = count('done')
    for (const [k, v] of Object.entries({
      pending,
      running,
      retry_wait,
      blocked,
      failed,
      done,
    })) {
      totals[k] = (totals[k] ?? 0) + v
    }
    const openRows = rows.filter((r) =>
      ['pending', 'running', 'retry_wait'].includes(r.status),
    )
    let oldestOpenAgeSec: number | null = null
    if (openRows.length) {
      const oldest = openRows.reduce((a, b) =>
        (a.statusChangedAt ?? a.createdAt) < (b.statusChangedAt ?? b.createdAt) ? a : b,
      )
      oldestOpenAgeSec = Math.floor(
        (Date.now() - (oldest.statusChangedAt ?? oldest.createdAt).getTime()) / 1000,
      )
    }
    const rt = runtimeByShop.get(liveAccountId)
    const openLoad = pending + running + retry_wait
    const cpm = Math.max(0, rt?.completedPerMinute ?? 0)
    const etaMinutes =
      openLoad > 0 && cpm > 0 ? Math.ceil(openLoad / Math.max(1, cpm)) : openLoad > 0 ? null : 0
    const recentError =
      rows
        .filter((r) => r.lastError)
        .sort(
          (a, b) =>
            (b.statusChangedAt ?? b.createdAt).getTime() -
            (a.statusChangedAt ?? a.createdAt).getTime(),
        )[0]?.lastError ??
      rt?.lastErrorMessage ??
      null

    return {
      liveAccountId,
      platformName: String(nameById.get(liveAccountId) ?? liveAccountId),
      pending,
      running,
      retry_wait,
      blocked,
      failed,
      done,
      oldestOpenAgeSec,
      lastSuccessAt: rt?.lastSuccessAt?.toISOString() ?? null,
      recentError,
      circuitOpen: Boolean(rt?.circuitOpen),
      circuitReason: rt?.circuitReason ?? null,
      circuitNextProbeAt: rt?.circuitNextProbeAt?.toISOString() ?? null,
      completedPerMinute: cpm,
      etaMinutes,
    }
  })

  return { byShop, totals }
}
