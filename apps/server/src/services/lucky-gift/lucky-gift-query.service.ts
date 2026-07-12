import { prisma } from '../../lib/prisma'
import {
  GOOD_REVIEW_SHOPS,
  resolveGoodReviewShopKey,
} from '../../config/good-review-shops.constants'
import { daysSinceWin, shipmentStatusLabel, shippingSourceLabel } from './lucky-gift-status.util'
import type { LuckyGiftShipmentStatus } from './lucky-gift.types'

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
    addressDetail: row.addressDetail ? '***' : row.addressDetail,
    province: null,
    city: null,
    district: null,
    rawAddress: undefined,
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
  const items = rows.map((w) => {
    const status = (w.shipment?.shipmentStatus || 'no_address') as LuckyGiftShipmentStatus
    const source = w.shipment?.shippingStatusSource || 'local'
    const dayN = daysSinceWin(w.winTime)
    const row = {
      id: w.id,
      liveAccountId: w.liveAccountId,
      liveAccountName: w.liveAccountName,
      luckyDrawId: w.luckyDrawId,
      roomId: w.draw?.roomId ?? '',
      giftName: w.draw?.giftName ?? '',
      winnerUserId: w.winnerUserId,
      redId: w.redId,
      winnerNickname: w.winnerNickname,
      avatar: w.avatar,
      recipientName: w.recipientName,
      recipientPhone: w.recipientPhone,
      province: w.province,
      city: w.city,
      district: w.district,
      addressDetail: w.addressDetail,
      fullAddress: w.fullAddress,
      hasAddress: w.hasAddress,
      addressComplete: w.addressComplete,
      addressMissing: parseMissing(w.addressMissingJson),
      firstAddressSeenAt: w.firstAddressSeenAt?.toISOString() ?? null,
      winTime: w.winTime?.toISOString() ?? null,
      winDayN: dayN,
      addressDeadlineHint:
        status === 'no_address' || status === 'incomplete_address'
          ? dayN == null
            ? '平台要求中奖后7日内填写地址'
            : dayN > 7
              ? `已超过7天未填地址（第${dayN}天）`
              : `中奖第${dayN}天，距离7天还剩${7 - dayN + 1}天`
          : null,
      shipDeadlineHint: '平台要求填写地址后15日内发货',
      shipmentStatus: status,
      shipmentStatusLabel: shipmentStatusLabel(status),
      shippingStatusSource: source,
      shippingStatusSourceLabel: shippingSourceLabel(source),
      freightType: 'COLLECT',
      freightLabel: '到付',
      courierCompany: w.shipment?.courierCompany ?? w.officialCourier,
      trackingNo: w.shipment?.trackingNo ?? w.officialTrackingNo,
      markedShippedAt: w.shipment?.markedShippedAt?.toISOString() ?? null,
      markedShippedBy: w.shipment?.markedShippedBy ?? null,
      shipmentNote: w.shipment?.shipmentNote ?? null,
      trackingPending: status === 'shipped' && !(w.shipment?.trackingNo || w.officialTrackingNo),
      rawAddress: {
        province: w.province,
        city: w.city,
        district: w.district,
        detail: w.addressDetail,
      },
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
