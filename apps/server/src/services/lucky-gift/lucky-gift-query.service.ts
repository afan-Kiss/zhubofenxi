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
import { mapSfRouteForApi } from './lucky-gift-sf-route.service'

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

/** 按主播聚合：福袋场次（distinct draw）+ 中奖人发货状态 */
async function buildLuckyGiftAnchorStats(
  winners: Array<{
    id: string
    liveAccountId: string
    liveAccountName: string
    luckyDrawId: string
    winTime: Date | null
    draw: { roomId: string } | null
    shipment: { shipmentStatus: string } | null
  }>,
  accountIds: string[] | null,
) {
  type Acc = {
    anchorId: string
    anchorName: string
    drawKeys: Set<string>
    winnerCount: number
    pending: number
    noAddress: number
    incompleteAddress: number
    shipped: number
  }
  const byKey = new Map<string, Acc>()

  function ensure(anchorId: string, anchorName: string): Acc {
    const key = anchorId || anchorName
    let acc = byKey.get(key)
    if (!acc) {
      acc = {
        anchorId,
        anchorName,
        drawKeys: new Set(),
        winnerCount: 0,
        pending: 0,
        noAddress: 0,
        incompleteAddress: 0,
        shipped: 0,
      }
      byKey.set(key, acc)
    }
    return acc
  }

  const coveredDraws = new Set(winners.map((w) => `${w.liveAccountId}::${w.luckyDrawId}`))
  const allDraws = await prisma.xhsLuckyDraw.findMany({
    where: accountIds ? { liveAccountId: { in: accountIds } } : undefined,
    select: {
      id: true,
      liveAccountId: true,
      liveAccountName: true,
      luckyDrawId: true,
      roomId: true,
      startTime: true,
      createTime: true,
    },
  })
  const orphanDraws = allDraws
    .filter((d) => !coveredDraws.has(`${d.liveAccountId}::${d.luckyDrawId}`))
    .map((d) => ({
      id: `orphan-draw:${d.id}`,
      liveAccountId: d.liveAccountId,
      liveAccountName: d.liveAccountName,
      luckyDrawId: d.luckyDrawId,
      winTime: d.startTime ?? d.createTime,
      draw: { roomId: d.roomId },
    }))

  const resolveRows = [
    ...winners.map((w) => ({
      id: w.id,
      liveAccountId: w.liveAccountId,
      liveAccountName: w.liveAccountName,
      winTime: w.winTime,
      draw: w.draw ? { roomId: w.draw.roomId } : null,
    })),
    ...orphanDraws.map((d) => ({
      id: d.id,
      liveAccountId: d.liveAccountId,
      liveAccountName: d.liveAccountName,
      winTime: d.winTime,
      draw: d.draw,
    })),
  ]
  const anchorMap = await resolveLuckyGiftAnchorsBatch(resolveRows)

  // 同一场福袋若中奖人归属不一致，取票数最多的主播
  const drawVotes = new Map<string, Map<string, { anchorId: string; anchorName: string; n: number }>>()
  const vote = (drawKey: string, anchorId: string, anchorName: string, weight = 1) => {
    let votes = drawVotes.get(drawKey)
    if (!votes) {
      votes = new Map()
      drawVotes.set(drawKey, votes)
    }
    const aKey = anchorId || anchorName
    const cur = votes.get(aKey)
    if (cur) cur.n += weight
    else votes.set(aKey, { anchorId: anchorId || aKey, anchorName, n: weight })
  }

  for (const w of winners) {
    const att = anchorMap.get(w.id)
    const name = att?.anchorName?.trim()
    if (!att || !name) continue
    vote(`${w.liveAccountId}::${w.luckyDrawId}`, att.anchorId ?? name, name)
  }
  for (const d of orphanDraws) {
    const drawKey = `${d.liveAccountId}::${d.luckyDrawId}`
    if (drawVotes.has(drawKey)) continue
    const att = anchorMap.get(d.id)
    const name = att?.anchorName?.trim()
    if (!att || !name) continue
    vote(drawKey, att.anchorId ?? name, name)
  }

  for (const [drawKey, votes] of drawVotes) {
    let best: { anchorId: string; anchorName: string; n: number } | null = null
    for (const v of votes.values()) {
      if (!best || v.n > best.n) best = v
    }
    if (!best) continue
    ensure(best.anchorId, best.anchorName).drawKeys.add(drawKey)
  }

  for (const w of winners) {
    const att = anchorMap.get(w.id)
    const name = att?.anchorName?.trim()
    if (!att || !name) continue
    const acc = ensure(att.anchorId ?? name, name)
    acc.winnerCount += 1
    const st = (w.shipment?.shipmentStatus || 'no_address') as LuckyGiftShipmentStatus
    if (st === 'pending') acc.pending += 1
    else if (st === 'no_address') acc.noAddress += 1
    else if (st === 'incomplete_address') acc.incompleteAddress += 1
    else if (st === 'shipped') acc.shipped += 1
  }

  return [...byKey.values()]
    .map((a) => ({
      anchorId: a.anchorId,
      anchorName: a.anchorName,
      drawCount: a.drawKeys.size,
      winnerCount: a.winnerCount,
      pending: a.pending,
      noAddress: a.noAddress,
      incompleteAddress: a.incompleteAddress,
      shipped: a.shipped,
    }))
    .filter((a) => a.drawCount > 0 || a.winnerCount > 0)
    .sort(
      (a, b) =>
        b.drawCount - a.drawCount ||
        b.winnerCount - a.winnerCount ||
        a.anchorName.localeCompare(b.anchorName, 'zh-CN'),
    )
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
  const anchors = await buildLuckyGiftAnchorStats(winners, accountIds)
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
    anchors,
  }
}

/** 快递单号形态：查单号时默认「待发货」筛会挡住已发货结果 */
export function looksLikeTrackingKeyword(raw: string): boolean {
  const k = raw.replace(/\s+/g, '')
  if (k.length < 8) return false
  // 11 位手机号勿当作单号，否则会误开跨状态搜索
  if (/^1\d{10}$/.test(k)) return false
  return /^(sf|yt|zt|jd|sto|yd|ems)?\d{8,}$/i.test(k) || /^[A-Za-z]{0,4}\d{10,}$/.test(k)
}

function matchLuckyGiftAnchorFilter(
  att: { anchorId: string | null; anchorName: string | null } | undefined,
  anchorId?: string,
  anchorName?: string,
): boolean {
  const id = String(anchorId || '').trim()
  const name = String(anchorName || '').trim()
  if (!id && !name) return true
  if (!att) return false
  if (id && att.anchorId && att.anchorId === id) return true
  if (name && att.anchorName?.trim() === name) return true
  // extra-* id 时用名称兜底
  if (id.startsWith('extra-') && name && att.anchorName?.trim() === name) return true
  if (id.startsWith('extra-') && !name) {
    const fromId = id.slice('extra-'.length)
    return Boolean(fromId && att.anchorName?.trim() === fromId)
  }
  return false
}

export async function listLuckyGifts(params: {
  accountId?: string
  status?: LuckyGiftListStatusFilter
  dateRange?: string
  startDate?: string
  endDate?: string
  keyword?: string
  /** 主播下钻：按归属过滤（需先解析归属，内存分页） */
  anchorId?: string
  anchorName?: string
  page?: number
  pageSize?: number
  role?: string | null
}) {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50))
  const accountIds = await resolveAccountIdFilter(params.accountId)
  const dateFilter = resolveDateRange(params.dateRange, params.startDate, params.endDate)
  const keyword = String(params.keyword || '').trim()
  const trackingSearch = keyword.length > 0 && looksLikeTrackingKeyword(keyword)
  const anchorId = String(params.anchorId || '').trim() || undefined
  const anchorName = String(params.anchorName || '').trim() || undefined
  const anchorFilter = Boolean(anchorId || anchorName)
  // 查物流号时跨状态；普通关键词仍尊重状态筛选
  const shipFilter = trackingSearch ? undefined : statusWhere(params.status)

  const where: Record<string, unknown> = {}
  if (accountIds) where.liveAccountId = { in: accountIds }
  if (dateFilter) where.winTime = dateFilter
  if (shipFilter) where.shipment = shipFilter
  if (keyword) {
    const trackingVariants = trackingSearch
      ? Array.from(
          new Set([keyword, keyword.toUpperCase(), keyword.toLowerCase(), keyword.replace(/\s+/g, '')]),
        )
      : [keyword]
    const trackingOr = trackingVariants.flatMap((k) => [
      { officialTrackingNo: { contains: k } },
      { shipment: { trackingNo: { contains: k } } },
    ])
    where.OR = [
      { winnerNickname: { contains: keyword } },
      { recipientName: { contains: keyword } },
      { recipientPhone: { contains: keyword } },
      { fullAddress: { contains: keyword } },
      { luckyDrawId: { contains: keyword } },
      { draw: { giftName: { contains: keyword } } },
      { draw: { roomId: { contains: keyword } } },
      { redId: { contains: keyword } },
      { officialCourier: { contains: keyword } },
      { shipment: { courierCompany: { contains: keyword } } },
      ...trackingOr,
    ]
  }

  // 主播归属在应用层解析，下钻时先取全量再过滤分页
  const fetched = await prisma.xhsLuckyWinner.findMany({
    where,
    include: { shipment: true, draw: true },
    orderBy: [{ liveAccountName: 'asc' }, { winTime: 'desc' }, { recipientName: 'asc' }],
    skip: anchorFilter ? 0 : (page - 1) * pageSize,
    take: anchorFilter ? 3000 : pageSize,
  })
  const totalBeforeAnchor = anchorFilter
    ? fetched.length
    : await prisma.xhsLuckyWinner.count({ where })

  const showPii = canViewLuckyGiftPii(params.role)
  const anchorMap = await resolveLuckyGiftAnchorsBatch(fetched)
  const filtered = anchorFilter
    ? fetched.filter((w) => matchLuckyGiftAnchorFilter(anchorMap.get(w.id), anchorId, anchorName))
    : fetched
  const total = anchorFilter ? filtered.length : totalBeforeAnchor
  const rows = anchorFilter
    ? filtered.slice((page - 1) * pageSize, page * pageSize)
    : filtered

  const sfCandidates = rows
    .filter((w) => {
      if (!w.shipment?.id) return false
      const status = w.shipment.shipmentStatus || 'no_address'
      const tracking = w.shipment.trackingNo ?? w.officialTrackingNo
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
    const sfRoute = shipment
      ? mapSfRouteForApi({
          sfRouteStatus: shipment.sfRouteStatus,
          sfRouteLabel: shipment.sfRouteLabel,
          sfRouteQueriedAt: shipment.sfRouteQueriedAt,
          sfRouteError: shipment.sfRouteError,
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
      isSfTracking: sfFee?.isSfTracking ?? sfRoute?.isSfTracking ?? false,
      sfRouteStatus: sfRoute?.sfRouteStatus ?? 'unknown',
      sfRouteLabel: sfRoute?.sfRouteLabel ?? null,
      sfRouteQueriedAt: sfRoute?.sfRouteQueriedAt ?? null,
      sfRouteError: sfRoute?.sfRouteError ?? null,
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
