/**
 * 售后回填前：本地订单归属预检（不发平台请求）
 */
import { prisma } from '../lib/prisma'
import { logWarn } from '../utils/server-log'

export type OrderOwnershipVerdict =
  | { kind: 'MATCH'; orderNo: string; liveAccountId: string }
  | {
      kind: 'SHOP_MISMATCH'
      orderNo: string
      queueLiveAccountId: string
      actualLiveAccountId: string
    }
  | { kind: 'ORDER_OWNER_NOT_FOUND'; orderNo: string; queueLiveAccountId: string }
  | {
      kind: 'ORDER_OWNER_CONFLICT'
      orderNo: string
      queueLiveAccountId: string
      actualLiveAccountIds: string[]
    }

function normalizeOrderNo(orderNo: string): string {
  return String(orderNo ?? '').trim()
}

/** 纯函数：由本地查到的店铺 ID 列表判定归属（便于单测） */
export function decideOwnershipFromOwners(
  orderNo: string,
  queueLiveAccountId: string,
  ownerLiveAccountIds: string[],
): OrderOwnershipVerdict {
  const oid = normalizeOrderNo(orderNo)
  const queueId = String(queueLiveAccountId ?? '').trim() || 'legacy'
  if (!oid) {
    return { kind: 'ORDER_OWNER_NOT_FOUND', orderNo: oid, queueLiveAccountId: queueId }
  }

  const owners = [
    ...new Set(
      ownerLiveAccountIds
        .map((id) => String(id ?? '').trim() || 'legacy')
        .filter(Boolean),
    ),
  ]

  if (owners.length === 0) {
    return { kind: 'ORDER_OWNER_NOT_FOUND', orderNo: oid, queueLiveAccountId: queueId }
  }

  if (owners.length > 1) {
    return {
      kind: 'ORDER_OWNER_CONFLICT',
      orderNo: oid,
      queueLiveAccountId: queueId,
      actualLiveAccountIds: owners,
    }
  }

  const actual = owners[0]!
  if (actual !== queueId) {
    return {
      kind: 'SHOP_MISMATCH',
      orderNo: oid,
      queueLiveAccountId: queueId,
      actualLiveAccountId: actual,
    }
  }

  return { kind: 'MATCH', orderNo: oid, liveAccountId: actual }
}

/** 在全库按 packageId / orderId / displayOrderNo 查找归属店铺 */
export async function resolveOrderOwnership(
  orderNo: string,
  queueLiveAccountId: string,
): Promise<OrderOwnershipVerdict> {
  const oid = normalizeOrderNo(orderNo)
  const queueId = String(queueLiveAccountId ?? '').trim() || 'legacy'
  if (!oid) {
    return { kind: 'ORDER_OWNER_NOT_FOUND', orderNo: oid, queueLiveAccountId: queueId }
  }

  const rows = await prisma.xhsRawOrder.findMany({
    where: {
      OR: [{ packageId: oid }, { orderId: oid }, { displayOrderNo: oid }],
    },
    select: { liveAccountId: true, packageId: true, orderId: true },
    take: 20,
  })

  const owners = rows.map((r) => String(r.liveAccountId ?? '').trim() || 'legacy')
  const verdict = decideOwnershipFromOwners(oid, queueId, owners)

  if (verdict.kind === 'ORDER_OWNER_NOT_FOUND') {
    logWarn(
      '售后归属',
      `ORDER_OWNER_NOT_FOUND orderNo=${oid} queueLiveAccountId=${queueId}`,
    )
  } else if (verdict.kind === 'ORDER_OWNER_CONFLICT') {
    logWarn(
      '售后归属',
      `ORDER_OWNER_CONFLICT orderNo=${oid} queueLiveAccountId=${queueId} actual=${verdict.actualLiveAccountIds.join(',')}`,
    )
  } else if (verdict.kind === 'SHOP_MISMATCH') {
    logWarn(
      '售后归属',
      `SHOP_MISMATCH orderNo=${oid} queueLiveAccountId=${queueId} actualLiveAccountId=${verdict.actualLiveAccountId}`,
    )
  }

  return verdict
}

export async function partitionOrdersByOwnership(
  orderNos: string[],
  queueLiveAccountId: string,
): Promise<{
  matched: string[]
  mismatches: OrderOwnershipVerdict[]
}> {
  const matched: string[] = []
  const mismatches: OrderOwnershipVerdict[] = []
  for (const orderNo of orderNos) {
    const v = await resolveOrderOwnership(orderNo, queueLiveAccountId)
    if (v.kind === 'MATCH') matched.push(v.orderNo)
    else mismatches.push(v)
  }
  return { matched, mismatches }
}
