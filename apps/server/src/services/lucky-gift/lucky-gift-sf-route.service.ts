import { prisma } from '../../lib/prisma'
import {
  classifySfRouteNodes,
  loadSfWaybillConfigFromEnv,
  querySfWaybillRoute,
  type SfRouteOutcome,
} from '../sf-waybill-fee.service'
import { isSfTrackingNo, queryAndCacheSfFeeForShipment } from './lucky-gift-sf-fee.service'

export type SfRouteStatus = SfRouteOutcome | 'querying'

const SIGNED_TTL_MS = 7 * 24 * 3_600_000
const ABNORMAL_TTL_MS = 24 * 3_600_000
const IN_TRANSIT_TTL_MS = 6 * 3_600_000
const FAILED_BACKOFF_MS = 30 * 60_000

export function shouldQuerySfRoute(input: {
  trackingNo: string | null | undefined
  shipmentStatus: string
  sfRouteStatus: string | null | undefined
  sfRouteQueriedAt: Date | null | undefined
  sfRouteTrackingNo: string | null | undefined
  force?: boolean
}): boolean {
  const tracking = String(input.trackingNo || '').trim().toUpperCase()
  if (!isSfTrackingNo(tracking)) return false
  if (input.shipmentStatus !== 'shipped' && input.shipmentStatus !== 'pending') return false
  if (input.force) return true
  if (input.sfRouteTrackingNo && input.sfRouteTrackingNo !== tracking) return true

  const status = input.sfRouteStatus || 'unknown'
  const queriedAt = input.sfRouteQueriedAt?.getTime() ?? 0
  const age = Date.now() - queriedAt

  if (status === 'querying' && age < 60_000) return false
  if (status === 'unknown') return true
  if (status === 'signed' && age < SIGNED_TTL_MS) return false
  if ((status === 'rejected' || status === 'returned') && age < ABNORMAL_TTL_MS) return false
  if (status === 'in_transit' && age < IN_TRANSIT_TTL_MS) return false
  if (status === 'failed' && age < FAILED_BACKOFF_MS) return false
  return true
}

export async function queryAndCacheSfRouteForShipment(
  shipmentId: string,
  trackingNo: string,
  phone?: string | null,
  force = false,
): Promise<{
  sfRouteStatus: SfRouteStatus
  sfRouteLabel: string | null
  sfRouteQueriedAt: string | null
  sfRouteError: string | null
}> {
  const cfg = loadSfWaybillConfigFromEnv()
  const tracking = trackingNo.trim().toUpperCase()

  if (!cfg) {
    return {
      sfRouteStatus: 'unknown',
      sfRouteLabel: null,
      sfRouteQueriedAt: null,
      sfRouteError: '顺丰配置缺失',
    }
  }

  await prisma.luckyGiftShipment.update({
    where: { id: shipmentId },
    data: { sfRouteStatus: 'querying', sfRouteTrackingNo: tracking },
  })

  let result: Awaited<ReturnType<typeof querySfWaybillRoute>>
  try {
    result = await querySfWaybillRoute(tracking, cfg, { phone })
  } catch (err) {
    const now = new Date()
    const message = err instanceof Error ? err.message : '顺丰轨迹查询异常'
    await prisma.luckyGiftShipment.update({
      where: { id: shipmentId },
      data: {
        sfRouteStatus: 'failed',
        sfRouteQueriedAt: now,
        sfRouteError: message,
        sfRouteTrackingNo: tracking,
        sfRouteLabel: null,
      },
    })
    return {
      sfRouteStatus: 'failed',
      sfRouteLabel: null,
      sfRouteQueriedAt: now.toISOString(),
      sfRouteError: message,
    }
  }

  const now = new Date()
  if (!result.ok) {
    await prisma.luckyGiftShipment.update({
      where: { id: shipmentId },
      data: {
        sfRouteStatus: 'failed',
        sfRouteQueriedAt: now,
        sfRouteError: result.error,
        sfRouteTrackingNo: tracking,
        sfRouteLabel: null,
      },
    })
    return {
      sfRouteStatus: 'failed',
      sfRouteLabel: null,
      sfRouteQueriedAt: now.toISOString(),
      sfRouteError: result.error,
    }
  }

  // 若 API 返回空轨迹但 ok，用 classify 再确认
  const classified =
    result.nodes.length > 0 ? classifySfRouteNodes(result.nodes) : { outcome: result.outcome, label: result.label }
  const status = (classified.outcome === 'failed' ? 'unknown' : classified.outcome) as SfRouteStatus

  await prisma.luckyGiftShipment.update({
    where: { id: shipmentId },
    data: {
      sfRouteStatus: status,
      sfRouteLabel: classified.label,
      sfRouteQueriedAt: now,
      sfRouteError: null,
      sfRouteTrackingNo: tracking,
    },
  })

  // 拒收/退回时顺带尝试刷新月结运费
  if (status === 'rejected' || status === 'returned') {
    try {
      await queryAndCacheSfFeeForShipment(shipmentId, tracking, false)
    } catch {
      /* fee optional */
    }
  }

  return {
    sfRouteStatus: status,
    sfRouteLabel: classified.label,
    sfRouteQueriedAt: now.toISOString(),
    sfRouteError: null,
  }
}

export async function refreshLuckyGiftSfRoutes(options?: {
  maxQueries?: number
  force?: boolean
  accountIds?: string[] | null
}): Promise<{
  scanned: number
  queried: number
  rejected: number
  returned: number
  signed: number
  failed: number
}> {
  const max = Math.min(80, Math.max(1, options?.maxQueries ?? 40))
  const force = Boolean(options?.force)
  const where: Record<string, unknown> = {
    shipmentStatus: { in: ['shipped', 'pending'] },
    OR: [{ trackingNo: { startsWith: 'SF' } }, { trackingNo: { startsWith: 'sf' } }],
  }
  if (options?.accountIds?.length) {
    where.winner = { liveAccountId: { in: options.accountIds } }
  }

  const rows = await prisma.luckyGiftShipment.findMany({
    where,
    include: { winner: { select: { recipientPhone: true, liveAccountId: true } } },
    orderBy: { markedShippedAt: 'desc' },
    take: 400,
  })

  let scanned = 0
  let queried = 0
  let rejected = 0
  let returned = 0
  let signed = 0
  let failed = 0

  for (const s of rows) {
    scanned += 1
    if (queried >= max) break
    if (
      !shouldQuerySfRoute({
        trackingNo: s.trackingNo,
        shipmentStatus: s.shipmentStatus,
        sfRouteStatus: s.sfRouteStatus,
        sfRouteQueriedAt: s.sfRouteQueriedAt,
        sfRouteTrackingNo: s.sfRouteTrackingNo,
        force,
      })
    ) {
      continue
    }
    try {
      const r = await queryAndCacheSfRouteForShipment(
        s.id,
        s.trackingNo!,
        s.winner?.recipientPhone,
        force,
      )
      queried += 1
      if (r.sfRouteStatus === 'rejected') rejected += 1
      else if (r.sfRouteStatus === 'returned') returned += 1
      else if (r.sfRouteStatus === 'signed') signed += 1
      else if (r.sfRouteStatus === 'failed') failed += 1
    } catch (err) {
      failed += 1
      console.warn(
        `[lucky-gift] sf route query failed shipment=${s.id}:`,
        err instanceof Error ? err.message : err,
      )
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  return { scanned, queried, rejected, returned, signed, failed }
}

function centToYuan(cent: number | null | undefined): number | null {
  if (cent == null) return null
  return Math.round(cent) / 100
}

export async function getLuckyGiftSfRouteStats(accountIds?: string[] | null) {
  const shipmentWhere: Record<string, unknown> = {}
  if (accountIds?.length) {
    shipmentWhere.winner = { liveAccountId: { in: accountIds } }
  }

  const shipped = await prisma.luckyGiftShipment.findMany({
    where: {
      ...shipmentWhere,
      shipmentStatus: { in: ['shipped', 'pending'] },
      trackingNo: { not: null },
    },
    select: {
      trackingNo: true,
      sfRouteStatus: true,
      sfRouteError: true,
      sfMonthlyFeeCent: true,
      sfFeeStatus: true,
    },
  })

  const abnormal = await prisma.luckyGiftShipment.findMany({
    where: {
      ...shipmentWhere,
      sfRouteStatus: { in: ['rejected', 'returned'] },
    },
    include: {
      winner: {
        select: {
          id: true,
          winnerNickname: true,
          liveAccountName: true,
          liveAccountId: true,
          luckyDrawId: true,
          draw: { select: { giftName: true } },
        },
      },
    },
    orderBy: { sfRouteQueriedAt: 'desc' },
    take: 200,
  })

  let sfTracking = 0
  let rejected = 0
  let returned = 0
  let signed = 0
  let inTransit = 0
  let unknown = 0
  let failed = 0
  let feeCentTotal = 0
  let feeKnown = 0
  let feeMissing = 0
  let billedShippedFeeCent = 0
  let billedShippedFeeCount = 0
  const errorCounts = new Map<string, number>()

  for (const s of shipped) {
    if (!isSfTrackingNo(s.trackingNo)) continue
    sfTracking += 1
    const st = s.sfRouteStatus || 'unknown'
    if (st === 'rejected') rejected += 1
    else if (st === 'returned') returned += 1
    else if (st === 'signed') signed += 1
    else if (st === 'in_transit') inTransit += 1
    else if (st === 'failed') {
      failed += 1
      const err = String(s.sfRouteError || '').trim() || '查询失败'
      errorCounts.set(err, (errorCounts.get(err) || 0) + 1)
    } else unknown += 1

    if (s.sfMonthlyFeeCent != null && s.sfFeeStatus === 'available') {
      billedShippedFeeCent += s.sfMonthlyFeeCent
      billedShippedFeeCount += 1
    }
  }

  for (const s of abnormal) {
    if (s.sfMonthlyFeeCent != null && s.sfFeeStatus === 'available') {
      feeCentTotal += s.sfMonthlyFeeCent
      feeKnown += 1
    } else {
      feeMissing += 1
    }
  }

  let commonRouteError: string | null = null
  let commonRouteErrorCount = 0
  for (const [err, n] of errorCounts) {
    if (n > commonRouteErrorCount) {
      commonRouteError = err
      commonRouteErrorCount = n
    }
  }
  const permissionBlocked =
    failed > 0 &&
    Boolean(commonRouteError && /无对应服务权限|A1004|未开通|没有权限/.test(commonRouteError))

  return {
    sfTrackingCount: sfTracking,
    rejectedCount: rejected,
    returnedCount: returned,
    abnormalCount: rejected + returned,
    signedCount: signed,
    inTransitCount: inTransit,
    unknownCount: unknown,
    failedCount: failed,
    commonRouteError,
    permissionBlocked,
    /** 拒收+退回中，已出账月结运费合计（元） */
    abnormalFeeYuan: Math.round(feeCentTotal) / 100,
    abnormalFeeKnownCount: feeKnown,
    abnormalFeeMissingCount: feeMissing,
    /** 全部顺丰已发中已出账月结运费（含正常签收；路由未开通时也可看） */
    billedShippedFeeYuan: Math.round(billedShippedFeeCent) / 100,
    billedShippedFeeCount,
    items: abnormal.map((s) => ({
      shipmentId: s.id,
      winnerId: s.winner.id,
      winnerNickname: s.winner.winnerNickname,
      liveAccountName: s.winner.liveAccountName,
      giftName: s.winner.draw?.giftName ?? '',
      trackingNo: s.trackingNo,
      sfRouteStatus: s.sfRouteStatus,
      sfRouteLabel: s.sfRouteLabel,
      sfRouteQueriedAt: s.sfRouteQueriedAt?.toISOString() ?? null,
      sfMonthlyFeeYuan: centToYuan(s.sfMonthlyFeeCent),
      sfFeeStatus: s.sfFeeStatus,
    })),
  }
}

export function mapSfRouteForApi(shipment: {
  sfRouteStatus: string | null
  sfRouteLabel: string | null
  sfRouteQueriedAt: Date | null
  sfRouteError: string | null
  trackingNo: string | null
}): {
  sfRouteStatus: string
  sfRouteLabel: string | null
  sfRouteQueriedAt: string | null
  sfRouteError: string | null
  isSfTracking: boolean
} {
  return {
    sfRouteStatus: shipment.sfRouteStatus || 'unknown',
    sfRouteLabel: shipment.sfRouteLabel ?? null,
    sfRouteQueriedAt: shipment.sfRouteQueriedAt?.toISOString() ?? null,
    sfRouteError: shipment.sfRouteError ?? null,
    isSfTracking: isSfTrackingNo(shipment.trackingNo),
  }
}
