import { prisma } from '../../lib/prisma'
import {
  GOOD_REVIEW_SHOPS,
  resolveGoodReviewShopKey,
} from '../../config/good-review-shops.constants'
import { shipmentStatusLabel } from './lucky-gift-status.util'
import type { LuckyGiftShipmentStatus } from './lucky-gift.types'
import { extractAddressSubmittedAt } from './lucky-gift-address-time.util'
import {
  computeAddressDeadlineAt,
  computeDeadlineStatus,
  computeShipDeadlineAt,
  formatAddressExpiryLabel,
  formatDeadlineLabel,
} from './lucky-gift-deadline.util'
import { resolveLuckyGiftAnchorsBatch } from './lucky-gift-anchor-attribution.service'
import { resolveFreightLabelForDisplay } from './lucky-gift-freight.util'
import {
  ensureSfFeesForShipments,
  isSfTrackingNo,
  mapSfFeeForApi,
} from './lucky-gift-sf-fee.service'

export type LuckyGiftListStatusFilter =
  | 'todo'
  | 'pending'
  | 'no_address'
  | 'incomplete_address'
  | 'shipped'
  | 'all'

function parseMissing(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function resolveDateRange(
  range: string | undefined,
  startDate?: string,
  endDate?: string,
): { gte?: Date; lte?: Date } | null {
  const now = new Date()
  if (range === 'all' || (!range && !startDate && !endDate)) return null
  if (range === 'today') {
    return { gte: startOfDay(now), lte: now }
  }
  if (range === '7d') {
    const gte = startOfDay(now)
    gte.setDate(gte.getDate() - 6)
    return { gte, lte: now }
  }
  if (range === '30d') {
    const gte = startOfDay(now)
    gte.setDate(gte.getDate() - 29)
    return { gte, lte: now }
  }
  if (range === 'custom' || startDate || endDate) {
    const out: { gte?: Date; lte?: Date } = {}
    if (startDate) out.gte = new Date(`${startDate}T00:00:00`)
    if (endDate) out.lte = new Date(`${endDate}T23:59:59.999`)
    return out
  }
  return null
}

function statusWhere(status: LuckyGiftListStatusFilter | undefined): Record<string, unknown> | null {
  if (!status || status === 'all') return null
  if (status === 'todo') {
    return { shipmentStatus: { in: ['no_address', 'incomplete_address', 'pending'] } }
  }
  if (status === 'no_address') {
    return { shipmentStatus: { in: ['no_address', 'incomplete_address'] } }
  }
  return { shipmentStatus: status }
}

export function canViewLuckyGiftPii(role: string | undefined | null): boolean {
  const r = String(role || '')
  return r === 'super_admin' || r === 'boss' || r === 'staff'
}

export function maskLuckyGiftPii<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    recipientName: row.recipientName ? '***' : row.recipientName,
    recipientPhone: row.recipientPhone ? '***********' : row.recipientPhone,
    fullAddress: row.fullAddress ? '（无权限查看完整地址）' : row.fullAddress,
  }
}

async function resolveAccountIdFilter(accountId?: string): Promise<string[] | null> {
  if (!accountId || accountId === 'all') return null
  const shopKey = resolveGoodReviewShopKey(accountId)
  if (shopKey) {
    const { resolveOfficialShopAccountForStatus } = await import('../official-shop-account.service')
    const acc = await resolveOfficialShopAccountForStatus(shopKey)
    return acc?.id ? [acc.id] : ['__none__']
  }
  return [accountId]
}

export async function getLuckyGiftSummary(params?: { accountId?: string }) {
  const accountIds = await resolveAccountIdFilter(params?.accountId)
  const winnerWhere = accountIds ? { liveAccountId: { in: accountIds } } : {}
  const winners = await prisma.xhsLuckyWinner.findMany({
    where: winnerWhere,
    include: { shipment: true, draw: true },
  })
  const todayStart = startOfDay(new Date())
  let pending = 0
  let noAddress = 0
  let incomplete = 0
  let shipped = 0
  let todayNew = 0
  for (const w of winners) {
    const st = (w.shipment?.shipmentStatus || 'no_address') as LuckyGiftShipmentStatus
    if (st === 'pending') pending += 1
    else if (st === 'no_address') noAddress += 1
    else if (st === 'incomplete_address') incomplete += 1
    else if (st === 'shipped') shipped += 1
    if (w.createdAt >= todayStart) todayNew += 1
  }
  const drawCount = await prisma.xhsLuckyDraw.count({
    where: accountIds ? { liveAccountId: { in: accountIds } } : undefined,
  })
  const run = await prisma.luckyGiftSyncRun.findUnique({ where: { id: 'default' } })
  const metas = await prisma.luckyGiftSyncMeta.findMany()
  let lastSummary: {
    withDataShopCount?: number
    confirmedEmptyShopCount?: number
    ambiguousEmptyShopCount?: number
    partialSuccessShopCount?: number
    newWinnerCount?: number
    shops?: Array<{
      shopKey: string
      syncStatus?: string
      syncStatusLabel?: string
      fetchedCount?: number
      winnerCount?: number
      error?: string
      lastSyncedAt?: string
    }>
  } | null = null
  try {
    lastSummary = run?.summaryJson ? JSON.parse(run.summaryJson) : null
  } catch {
    lastSummary = null
  }
  const lastShopMap = new Map((lastSummary?.shops ?? []).map((s) => [s.shopKey, s]))

  const shopStats = []
  for (const shop of GOOD_REVIEW_SHOPS) {
    const { resolveOfficialShopAccountForStatus } = await import('../official-shop-account.service')
    const acc = await resolveOfficialShopAccountForStatus(shop.shopKey)
    const liveAccountId = acc?.id
    const shopWinners = liveAccountId
      ? winners.filter((w) => w.liveAccountId === liveAccountId)
      : []
    let sPending = 0
    let sNo = 0
    let sInc = 0
    let sShip = 0
    for (const w of shopWinners) {
      const st = (w.shipment?.shipmentStatus || 'no_address') as LuckyGiftShipmentStatus
      if (st === 'pending') sPending += 1
      else if (st === 'no_address') sNo += 1
      else if (st === 'incomplete_address') sInc += 1
      else if (st === 'shipped') sShip += 1
    }
    const meta = liveAccountId ? metas.find((m) => m.liveAccountId === liveAccountId) : null
    const lastShop = lastShopMap.get(shop.shopKey)
    shopStats.push({
      shopKey: shop.shopKey,
      shopName: shop.shopName,
      liveAccountId: liveAccountId ?? null,
      pending: sPending,
      noAddress: sNo,
      incompleteAddress: sInc,
      shipped: sShip,
      winnerCount: shopWinners.length,
      drawCount: liveAccountId
        ? await prisma.xhsLuckyDraw.count({ where: { liveAccountId } })
        : 0,
      lastSyncedAt: meta?.lastSuccessAt?.toISOString() ?? meta?.lastSyncedAt?.toISOString() ?? lastShop?.lastSyncedAt ?? null,
      lastError: meta?.lastError ?? lastShop?.error ?? null,
      syncStatus: lastShop?.syncStatus ?? null,
      syncStatusLabel: lastShop?.syncStatusLabel ?? null,
      fetchedDrawCount: lastShop?.fetchedCount ?? meta?.fetchedCount ?? null,
      fetchedWinnerCount: lastShop?.winnerCount ?? meta?.winnerCount ?? null,
    })
  }

  return {
    pending,
    noAddress,
    incompleteAddress: incomplete,
    shipped,
    todayNew,
    totalWinners: winners.length,
    totalDraws: drawCount,
    todo: pending + noAddress + incomplete,
    sync: {
      lastSyncedAt: run?.lastSyncedAt?.toISOString() ?? null,
      lastTrigger: run?.lastTrigger ?? null,
      successShopCount: run?.successShopCount ?? 0,
      failedShopCount: run?.failedShopCount ?? 0,
      withDataShopCount: lastSummary?.withDataShopCount ?? 0,
      confirmedEmptyShopCount: lastSummary?.confirmedEmptyShopCount ?? 0,
      ambiguousEmptyShopCount: lastSummary?.ambiguousEmptyShopCount ?? 0,
      partialSuccessShopCount: lastSummary?.partialSuccessShopCount ?? 0,
      failedShops: (() => {
        try {
          return JSON.parse(run?.failedShopsJson || '[]')
        } catch {
          return []
        }
      })(),
      newDrawCount: run?.newDrawCount ?? 0,
      newWinnerCount: lastSummary?.newWinnerCount ?? 0,
      newAddressCount: run?.newAddressCount ?? 0,
      statusChangeCount: run?.statusChangeCount ?? 0,
    },
    shops: shopStats,
  }
}

export async function listLuckyGifts(params: {
  accountId?: string
  status?: LuckyGiftListStatusFilter
  dateRange?: string
  startDate?: string
  endDate?: string
  keyword?: string
  page?: number
  pageSize?: number
  role?: string | null
}) {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50))
  const accountIds = await resolveAccountIdFilter(params.accountId)
  const shipFilter = statusWhere(params.status)
  const dateFilter = resolveDateRange(params.dateRange, params.startDate, params.endDate)
  const keyword = String(params.keyword || '').trim()

  const where: Record<string, unknown> = {}
  if (accountIds) where.liveAccountId = { in: accountIds }
  if (dateFilter) where.winTime = dateFilter
  if (shipFilter) where.shipment = shipFilter
  if (keyword) {
    where.OR = [
      { winnerNickname: { contains: keyword } },
      { recipientName: { contains: keyword } },
      { recipientPhone: { contains: keyword } },
      { fullAddress: { contains: keyword } },
      { luckyDrawId: { contains: keyword } },
      { draw: { giftName: { contains: keyword } } },
      { draw: { roomId: { contains: keyword } } },
      { redId: { contains: keyword } },
      { officialTrackingNo: { contains: keyword } },
      { officialCourier: { contains: keyword } },
      { shipment: { trackingNo: { contains: keyword } } },
      { shipment: { courierCompany: { contains: keyword } } },
    ]
  }

  const [total, rows] = await Promise.all([
    prisma.xhsLuckyWinner.count({ where }),
    prisma.xhsLuckyWinner.findMany({
      where,
      include: { shipment: true, draw: true },
      orderBy: [{ liveAccountName: 'asc' }, { winTime: 'desc' }, { recipientName: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  const showPii = canViewLuckyGiftPii(params.role)
  const anchorMap = await resolveLuckyGiftAnchorsBatch(rows)

  const sfCandidates = rows
    .filter((w) => {
      const status = w.shipment?.shipmentStatus || 'no_address'
      const tracking = w.shipment?.trackingNo ?? w.officialTrackingNo
      if (status === 'shipped') return true
      return status === 'pending' && isSfTrackingNo(tracking)
    })
    .map((w) => ({
      shipmentId: w.shipment!.id,
      trackingNo: w.shipment?.trackingNo ?? w.officialTrackingNo,
      shipmentStatus: w.shipment?.shipmentStatus || 'shipped',
      sfFeeStatus: w.shipment?.sfFeeStatus ?? null,
      sfFeeQueriedAt: w.shipment?.sfFeeQueriedAt ?? null,
      sfFeeTrackingNo: w.shipment?.sfFeeTrackingNo ?? null,
    }))
  const sfFeeUiEnabled = process.env.LUCKY_GIFT_SF_FEE_UI === '1'
  if (sfFeeUiEnabled) {
    try {
      await ensureSfFeesForShipments(sfCandidates, { maxQueries: 8 })
    } catch (err) {
      console.warn(
        '[lucky-gift] batch sf fee refresh skipped:',
        err instanceof Error ? err.message : err,
      )
    }
  }

  const shipmentIds = rows.map((w) => w.shipment?.id).filter(Boolean) as string[]
  const refreshedShipments =
    sfFeeUiEnabled && shipmentIds.length > 0
      ? await prisma.luckyGiftShipment.findMany({ where: { id: { in: shipmentIds } } })
      : []
  const shipmentById = new Map(refreshedShipments.map((s) => [s.id, s]))

  const items = rows.map((w) => {
    const status = (w.shipment?.shipmentStatus || 'no_address') as LuckyGiftShipmentStatus
    const source = w.shipment?.shippingStatusSource || 'local'
    const giftName = w.draw?.giftName ?? ''
    const anchor = anchorMap.get(w.id)
    const shipment = w.shipment?.id ? shipmentById.get(w.shipment.id) ?? w.shipment : w.shipment

    const addrSubmitted = extractAddressSubmittedAt(w.rawJson, w.firstAddressSeenAt)
    const now = new Date()

    let addressDeadlineAt: string | null = null
    let addressDeadlineStatus: string | null = null
    let addressDeadlineLabel: string | null = null
    let shipDeadlineAt: string | null = null
    let shipDeadlineLabel: string | null = null
    let addressSubmittedAt: string | null = null
    let addressSubmittedAtSource: string | null = null

    if (w.winTime && (status === 'no_address' || status === 'incomplete_address')) {
      const deadline = computeAddressDeadlineAt(w.winTime)
      const st = computeDeadlineStatus(deadline, now)
      addressDeadlineAt = deadline.toISOString()
      addressDeadlineStatus = st
      addressDeadlineLabel = formatAddressExpiryLabel(deadline, now)
    }

    if (
      status === 'pending' &&
      w.addressComplete &&
      addrSubmitted.at
    ) {
      addressSubmittedAt = addrSubmitted.at.toISOString()
      addressSubmittedAtSource = addrSubmitted.source
      const shipDeadline = computeShipDeadlineAt(addrSubmitted.at)
      const prefix =
        addrSubmitted.source === 'first_seen_estimate' ? '预计最晚发货' : '最晚发货'
      shipDeadlineAt = shipDeadline.toISOString()
      shipDeadlineLabel = formatDeadlineLabel(
        shipDeadline,
        prefix,
        computeDeadlineStatus(shipDeadline, now),
      )
    }

    const sfFee = shipment
      ? mapSfFeeForApi({
          sfMonthlyFeeCent: shipment.sfMonthlyFeeCent,
          sfFeeStatus: shipment.sfFeeStatus,
          sfFeeQueriedAt: shipment.sfFeeQueriedAt,
          sfFeeError: shipment.sfFeeError,
          trackingNo: shipment.trackingNo ?? w.officialTrackingNo,
        })
      : null

    const row = {
      id: w.id,
      liveAccountId: w.liveAccountId,
      liveAccountName: w.liveAccountName,
      luckyDrawId: w.luckyDrawId,
      giftName,
      winnerNickname: w.winnerNickname,
      redId: w.redId,
      recipientName: w.recipientName,
      recipientPhone: w.recipientPhone,
      fullAddress: w.fullAddress,
      hasAddress: w.hasAddress,
      addressComplete: w.addressComplete,
      addressMissing: parseMissing(w.addressMissingJson),
      winTime: w.winTime?.toISOString() ?? null,
      addressDeadlineAt,
      addressDeadlineStatus,
      addressDeadlineLabel,
      addressSubmittedAt,
      addressSubmittedAtSource,
      shipDeadlineAt,
      shipDeadlineLabel,
      shipmentStatus: status,
      shipmentStatusLabel: shipmentStatusLabel(status),
      shippingStatusSource: source,
      freightLabel: resolveFreightLabelForDisplay(giftName),
      courierCompany: shipment?.courierCompany ?? w.officialCourier,
      trackingNo: shipment?.trackingNo ?? w.officialTrackingNo,
      markedShippedAt: shipment?.markedShippedAt?.toISOString() ?? null,
      shipmentNote: shipment?.shipmentNote ?? null,
      trackingPending: status === 'shipped' && !(shipment?.trackingNo || w.officialTrackingNo),
      anchorName: anchor?.anchorName ?? null,
      anchorId: anchor?.anchorId ?? null,
      anchorAttributionSource: anchor?.anchorAttributionSource ?? 'unresolved',
      sfMonthlyFeeYuan: sfFee?.sfMonthlyFeeYuan ?? null,
      sfFeeStatus: sfFee?.sfFeeStatus ?? 'unknown',
      sfFeeQueriedAt: sfFee?.sfFeeQueriedAt ?? null,
      sfFeeError: sfFee?.sfFeeError ?? null,
      isSfTracking: sfFee?.isSfTracking ?? false,
    }
    return showPii ? row : maskLuckyGiftPii(row)
  })

  return {
    page,
    pageSize,
    total,
    items,
    canViewPii: showPii,
  }
}

export async function getLuckyGiftSyncStatus() {
  const run = await prisma.luckyGiftSyncRun.findUnique({ where: { id: 'default' } })
  const metas = await prisma.luckyGiftSyncMeta.findMany()
  return {
    lastSyncedAt: run?.lastSyncedAt?.toISOString() ?? null,
    lastTrigger: run?.lastTrigger ?? null,
    successShopCount: run?.successShopCount ?? 0,
    failedShopCount: run?.failedShopCount ?? 0,
    failedShops: (() => {
      try {
        return JSON.parse(run?.failedShopsJson || '[]')
      } catch {
        return []
      }
    })(),
    newDrawCount: run?.newDrawCount ?? 0,
    newAddressCount: run?.newAddressCount ?? 0,
    statusChangeCount: run?.statusChangeCount ?? 0,
    shops: metas.map((m) => ({
      liveAccountId: m.liveAccountId,
      liveAccountName: m.liveAccountName,
      lastSyncedAt: m.lastSyncedAt?.toISOString() ?? null,
      lastSuccessAt: m.lastSuccessAt?.toISOString() ?? null,
      lastError: m.lastError,
      drawCount: m.drawCount,
      winnerCount: m.winnerCount,
      platformTotal: m.platformTotal,
      fetchedCount: m.fetchedCount,
      dedupedCount: m.dedupedCount,
      detailFailCount: m.detailFailCount,
      listMismatch:
        m.platformTotal != null &&
        (m.fetchedCount !== m.platformTotal || m.dedupedCount !== m.platformTotal),
    })),
  }
}
