/**
 * 售后补查完整性：全局 + 当前查询范围（支付单号池）分开统计
 */
import { prisma } from '../lib/prisma'
import { getAfterSalesQueueStatusCounts } from './after-sales-queue.service'
import { liveAccountOrderKey } from '../utils/live-account-cache-key.util'

export type AfterSalesCompletenessStatus =
  | 'complete'
  | 'partial'
  | 'pending'
  | 'blocked'
  | 'failed'

export interface AfterSalesCompleteness {
  status: AfterSalesCompletenessStatus
  pendingCount: number
  retryWaitCount: number
  blockedCount: number
  failedCount: number
  runningCount: number
  doneCount: number
  affectedOrderCount: number
  affectedGmv: number
  affectedAnchorIds: string[]
  affectedAnchorNames: string[]
  affectedShopIds: string[]
  affectedShopNames: string[]
  oldestOpenAt: string | null
  /** @deprecated 用 oldestOpenAt */
  oldestPendingAt: string | null
  lastSuccessfulFetchAt: string | null
  lastSuccessAt: string | null
  lastEmptySuccessAt: string | null
  globalPendingCount: number
  note: string
  scope: 'global' | 'range'
}

export type RelevantOrderRef = {
  liveAccountId: string
  orderNo: string
  payAmountYuan?: number
  anchorId?: string | null
  anchorName?: string | null
  shopName?: string | null
}

function emptyCompleteness(
  scope: 'global' | 'range',
  overrides?: Partial<AfterSalesCompleteness>,
): AfterSalesCompleteness {
  return {
    status: 'complete',
    pendingCount: 0,
    retryWaitCount: 0,
    blockedCount: 0,
    failedCount: 0,
    runningCount: 0,
    doneCount: 0,
    affectedOrderCount: 0,
    affectedGmv: 0,
    affectedAnchorIds: [],
    affectedAnchorNames: [],
    affectedShopIds: [],
    affectedShopNames: [],
    oldestOpenAt: null,
    oldestPendingAt: null,
    lastSuccessfulFetchAt: null,
    lastSuccessAt: null,
    lastEmptySuccessAt: null,
    globalPendingCount: 0,
    note: '售后补查已完成，退款与签收可按当前结果查看。',
    scope,
    ...overrides,
  }
}

export function decideStatus(counts: {
  pendingCount: number
  retryWaitCount: number
  runningCount: number
  blockedCount: number
  failedCount: number
}): {
  status: AfterSalesCompletenessStatus
  note: string
} {
  const open = counts.pendingCount + counts.retryWaitCount + counts.runningCount
  if (counts.blockedCount > 0) {
    if (open > 0) {
      return {
        status: 'blocked',
        note: '部分店铺受阻，其他任务仍处理中；当前范围退款与签收可能不完整。',
      }
    }
    return {
      status: 'blocked',
      note: '当前范围售后补查受阻（Cookie/签名），退款与签收可能不完整。',
    }
  }
  if (counts.failedCount > 0) {
    if (open > 0) {
      return {
        status: 'failed',
        note: '当前范围有失败任务且仍有待处理，退款与签收请暂作过程数据。',
      }
    }
    return {
      status: 'failed',
      note: '当前范围存在售后补查失败，退款与签收可能不完整。',
    }
  }
  if (open > 0) {
    if (open > 200) {
      return {
        status: 'pending',
        note: '当前范围售后补查进行中，退款单数/退款金额/签收金额可能继续变化。',
      }
    }
    return {
      status: 'partial',
      note: '当前范围售后补查部分完成，退款与签收仍可能继续更新。',
    }
  }
  return {
    status: 'complete',
    note: '当前范围售后补查已完成，退款与签收可按当前结果查看。',
  }
}

async function loadFetchTimestamps(): Promise<{
  lastSuccessAt: string | null
  lastEmptySuccessAt: string | null
}> {
  const [ok, empty] = await Promise.all([
    prisma.xhsAfterSalesWorkbenchCache.findFirst({
      where: { fetchStatus: 'success' },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    }),
    prisma.xhsAfterSalesWorkbenchCache.findFirst({
      where: { fetchStatus: 'empty' },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    }),
  ])
  return {
    lastSuccessAt: ok?.fetchedAt?.toISOString() ?? null,
    lastEmptySuccessAt: empty?.fetchedAt?.toISOString() ?? null,
  }
}

/** 全局积压摘要（次要提示用） */
export async function resolveGlobalAfterSalesCompleteness(): Promise<AfterSalesCompleteness> {
  const counts = await getAfterSalesQueueStatusCounts()
  const pendingCount = counts.pending ?? 0
  const retryWaitCount = counts.retry_wait ?? 0
  const blockedCount = counts.blocked ?? 0
  const failedCount = counts.failed ?? 0
  const runningCount = counts.running ?? 0
  const doneCount = counts.done ?? 0
  const { status, note } = decideStatus({
    pendingCount,
    retryWaitCount,
    runningCount,
    blockedCount,
    failedCount,
  })
  const [oldest, fetchTs] = await Promise.all([
    prisma.xhsAfterSalesWorkbenchQueue.findFirst({
      where: { status: { in: ['pending', 'retry_wait', 'running'] } },
      orderBy: { statusChangedAt: 'asc' },
      select: { statusChangedAt: true, createdAt: true },
    }),
    loadFetchTimestamps(),
  ])
  const oldestOpenAt =
    oldest?.statusChangedAt?.toISOString() ?? oldest?.createdAt?.toISOString() ?? null
  const lastSuccessfulFetchAt = fetchTs.lastSuccessAt ?? fetchTs.lastEmptySuccessAt
  return emptyCompleteness('global', {
    status: status === 'complete' ? 'complete' : status,
    pendingCount,
    retryWaitCount,
    blockedCount,
    failedCount,
    runningCount,
    doneCount,
    oldestOpenAt,
    oldestPendingAt: oldestOpenAt,
    lastSuccessfulFetchAt,
    lastSuccessAt: fetchTs.lastSuccessAt,
    lastEmptySuccessAt: fetchTs.lastEmptySuccessAt,
    globalPendingCount: pendingCount + retryWaitCount + runningCount,
    note: note.replace(/^当前范围/, '全局'),
  })
}

/**
 * 当前页面完整性：仅统计相关支付订单池对应的队列任务
 * relevantOrderKeys / relevantViews 必须与页面支付时间订单池一致
 */
export async function resolveAfterSalesCompleteness(params?: {
  startDate?: string
  endDate?: string
  relevantOrderKeys?: Array<{ liveAccountId: string; orderNo: string }>
  relevantViews?: RelevantOrderRef[]
}): Promise<AfterSalesCompleteness> {
  const global = await resolveGlobalAfterSalesCompleteness()

  const refs: RelevantOrderRef[] = []
  if (params?.relevantViews?.length) {
    const seen = new Set<string>()
    for (const v of params.relevantViews) {
      const no = (v.orderNo || '').trim()
      if (!no) continue
      const key = liveAccountOrderKey(v.liveAccountId, no)
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({ ...v, orderNo: no })
    }
  } else if (params?.relevantOrderKeys?.length) {
    const seen = new Set<string>()
    for (const k of params.relevantOrderKeys) {
      const no = (k.orderNo || '').trim()
      if (!no) continue
      const key = liveAccountOrderKey(k.liveAccountId, no)
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({ liveAccountId: k.liveAccountId, orderNo: no })
    }
  } else {
    // 无范围 → 兼容旧调用，返回全局
    return global
  }

  if (refs.length === 0) {
    return emptyCompleteness('range', {
      globalPendingCount: global.globalPendingCount,
      lastSuccessAt: global.lastSuccessAt,
      lastEmptySuccessAt: global.lastEmptySuccessAt,
      lastSuccessfulFetchAt: global.lastSuccessfulFetchAt,
      note: '当前范围无支付订单，售后补查提示按范围清空。',
    })
  }

  const queues = await prisma.xhsAfterSalesWorkbenchQueue.findMany({
    where: {
      OR: refs.map((r) => ({
        liveAccountId: r.liveAccountId || 'legacy',
        orderNo: r.orderNo,
      })),
    },
    select: {
      liveAccountId: true,
      orderNo: true,
      status: true,
      statusChangedAt: true,
      createdAt: true,
    },
  })

  const byKey = new Map(
    queues.map((q) => [liveAccountOrderKey(q.liveAccountId, q.orderNo), q]),
  )

  let pendingCount = 0
  let retryWaitCount = 0
  let runningCount = 0
  let blockedCount = 0
  let failedCount = 0
  let doneCount = 0

  const affectedKeys = new Set<string>()
  const affectedAnchorIds = new Set<string>()
  const affectedAnchorNames = new Set<string>()
  const affectedShopIds = new Set<string>()
  const affectedShopNames = new Set<string>()
  let affectedGmv = 0
  let oldestOpenAt: string | null = null

  for (const ref of refs) {
    const key = liveAccountOrderKey(ref.liveAccountId, ref.orderNo)
    const q = byKey.get(key)
    const status = q?.status ?? 'missing'
    if (status === 'pending') pendingCount++
    else if (status === 'retry_wait') retryWaitCount++
    else if (status === 'running') runningCount++
    else if (status === 'blocked') blockedCount++
    else if (status === 'failed') failedCount++
    else if (status === 'done') doneCount++

    const openLike = ['pending', 'retry_wait', 'running', 'blocked', 'failed'].includes(status)
    if (!openLike) continue

    if (!affectedKeys.has(key)) {
      affectedKeys.add(key)
      affectedGmv += Number(ref.payAmountYuan ?? 0) || 0
      if (ref.anchorId) affectedAnchorIds.add(ref.anchorId)
      if (ref.anchorName) affectedAnchorNames.add(ref.anchorName)
      affectedShopIds.add(ref.liveAccountId || 'legacy')
      if (ref.shopName) affectedShopNames.add(ref.shopName)
    }
    const ts = (q?.statusChangedAt ?? q?.createdAt)?.toISOString() ?? null
    if (ts && (!oldestOpenAt || ts < oldestOpenAt)) oldestOpenAt = ts
  }

  const { status, note } = decideStatus({
    pendingCount,
    retryWaitCount,
    runningCount,
    blockedCount,
    failedCount,
  })

  // 范围已 complete 时，不因全局历史积压升级状态；仅附带 globalPendingCount
  return emptyCompleteness('range', {
    status,
    pendingCount,
    retryWaitCount,
    runningCount,
    blockedCount,
    failedCount,
    doneCount,
    affectedOrderCount: affectedKeys.size,
    affectedGmv: Math.round(affectedGmv * 100) / 100,
    affectedAnchorIds: [...affectedAnchorIds],
    affectedAnchorNames: [...affectedAnchorNames],
    affectedShopIds: [...affectedShopIds],
    affectedShopNames: [...affectedShopNames],
    oldestOpenAt,
    oldestPendingAt: oldestOpenAt,
    lastSuccessfulFetchAt: global.lastSuccessfulFetchAt,
    lastSuccessAt: global.lastSuccessAt,
    lastEmptySuccessAt: global.lastEmptySuccessAt,
    globalPendingCount: global.globalPendingCount,
    note:
      status === 'complete' && global.globalPendingCount > 0
        ? `${note}（全局另有 ${global.globalPendingCount} 笔历史待处理，不影响当前范围）`
        : note,
  })
}
