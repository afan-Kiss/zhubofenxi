import { prisma } from '../../lib/prisma'
import type { GoodReviewShopDefinition } from '../../config/good-review-shops.constants'
import {
  fetchAllLuckyGiftDraws,
  fetchLuckyGiftWinners,
  listLuckyGiftShopTargets,
} from './lucky-gift-api.service'
import { deriveLuckyGiftShipmentStatus } from './lucky-gift-status.util'
import { assertIdUnchanged } from './lucky-gift-json.util'
import {
  LUCKY_GIFT_SYNC_STATUS_LABEL,
  type LuckyGiftSyncShopStatus,
} from './lucky-gift-platform-response.util'

export interface LuckyGiftShopSyncResult {
  shopKey: string
  shopName: string
  liveAccountId: string | null
  hostId: string | null
  hostIdSource: 'live_session' | 'cookie' | null
  ok: boolean
  syncStatus: LuckyGiftSyncShopStatus
  syncStatusLabel: string
  error?: string
  drawCount: number
  winnerCount: number
  platformTotal: number | null
  fetchedCount: number
  dedupedCount: number
  detailFailCount: number
  newDrawCount: number
  newWinnerCount: number
  newAddressCount: number
  statusChangeCount: number
  bigintMismatchCount: number
  listMismatch: boolean
  roomsScanned: number
  roomsWithData: number
  lastSyncedAt: string
}

export interface LuckyGiftSyncSummary {
  ok: boolean
  trigger: string
  successShopCount: number
  failedShopCount: number
  confirmedEmptyShopCount: number
  ambiguousEmptyShopCount: number
  partialSuccessShopCount: number
  withDataShopCount: number
  failedShops: Array<{ shopKey: string; shopName: string; error: string; syncStatus: string }>
  newDrawCount: number
  newWinnerCount: number
  newAddressCount: number
  statusChangeCount: number
  shops: LuckyGiftShopSyncResult[]
  syncedAt: string
}

function msToDate(ms: number | null | undefined): Date | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null
  return new Date(ms)
}

function isSyncOk(status: LuckyGiftSyncShopStatus): boolean {
  return status === 'success_with_data' || status === 'confirmed_empty' || status === 'partial_success'
}

function isWithData(status: LuckyGiftSyncShopStatus): boolean {
  return status === 'success_with_data' || status === 'partial_success'
}

async function upsertDraw(params: {
  liveAccountId: string
  liveAccountName: string
  draw: Awaited<ReturnType<typeof fetchAllLuckyGiftDraws>>['draws'][number]
  now: Date
}): Promise<{ created: boolean }> {
  const existing = await prisma.xhsLuckyDraw.findUnique({
    where: {
      liveAccountId_luckyDrawId: {
        liveAccountId: params.liveAccountId,
        luckyDrawId: params.draw.luckyDrawId,
      },
    },
  })
  await prisma.xhsLuckyDraw.upsert({
    where: {
      liveAccountId_luckyDrawId: {
        liveAccountId: params.liveAccountId,
        luckyDrawId: params.draw.luckyDrawId,
      },
    },
    create: {
      liveAccountId: params.liveAccountId,
      liveAccountName: params.liveAccountName,
      luckyDrawId: params.draw.luckyDrawId,
      roomId: params.draw.roomId,
      giftName: params.draw.giftName,
      senderUserId: params.draw.senderUserId,
      senderNickname: params.draw.senderNickname,
      drawStatus: params.draw.drawStatus,
      winnerCount: params.draw.winnerCount,
      createTime: msToDate(params.draw.createTimeMs),
      startTime: msToDate(params.draw.startTimeMs),
      rawJson: JSON.stringify(params.draw.raw),
      firstSeenAt: params.now,
      lastSeenAt: params.now,
      lastSyncedAt: params.now,
    },
    update: {
      liveAccountName: params.liveAccountName,
      roomId: params.draw.roomId || undefined,
      giftName: params.draw.giftName || undefined,
      senderUserId: params.draw.senderUserId,
      senderNickname: params.draw.senderNickname,
      drawStatus: params.draw.drawStatus,
      winnerCount: params.draw.winnerCount,
      createTime: msToDate(params.draw.createTimeMs),
      startTime: msToDate(params.draw.startTimeMs),
      rawJson: JSON.stringify(params.draw.raw),
      lastSeenAt: params.now,
      lastSyncedAt: params.now,
    },
  })
  return { created: !existing }
}

async function upsertWinnerAndShipment(params: {
  liveAccountId: string
  liveAccountName: string
  luckyDrawId: string
  winner: Awaited<ReturnType<typeof fetchLuckyGiftWinners>>['winners'][number]
  winTime: Date | null
  now: Date
}): Promise<{ created: boolean; newAddress: boolean; statusChanged: boolean }> {
  const w = params.winner
  const existing = await prisma.xhsLuckyWinner.findUnique({
    where: {
      liveAccountId_luckyDrawId_winnerKey: {
        liveAccountId: params.liveAccountId,
        luckyDrawId: params.luckyDrawId,
        winnerKey: w.winnerKey,
      },
    },
    include: { shipment: true },
  })

  const incomingHasAddress = Boolean(w.hasAddress && w.addressComplete)
  const firstAddressSeenAt =
    incomingHasAddress ? existing?.firstAddressSeenAt ?? params.now : existing?.firstAddressSeenAt ?? null

  const newAddress = incomingHasAddress && !(existing?.hasAddress && existing.addressComplete)

  const preserveAddress = Boolean(existing?.hasAddress && existing.addressComplete) && !incomingHasAddress

  const winner = await prisma.xhsLuckyWinner.upsert({
    where: {
      liveAccountId_luckyDrawId_winnerKey: {
        liveAccountId: params.liveAccountId,
        luckyDrawId: params.luckyDrawId,
        winnerKey: w.winnerKey,
      },
    },
    create: {
      liveAccountId: params.liveAccountId,
      liveAccountName: params.liveAccountName,
      luckyDrawId: params.luckyDrawId,
      winnerUserId: w.winnerUserId,
      winnerKey: w.winnerKey,
      redId: w.redId,
      winnerNickname: w.winnerNickname,
      avatar: w.avatar,
      recipientName: w.address?.name ?? null,
      recipientPhone: w.address?.phone ?? null,
      province: w.address?.province ?? null,
      city: w.address?.city ?? null,
      district: w.address?.district ?? null,
      addressDetail: w.address?.detail ?? null,
      fullAddress: w.fullAddress,
      hasAddress: w.hasAddress,
      addressComplete: w.addressComplete,
      addressMissingJson: JSON.stringify(w.addressMissing),
      firstAddressSeenAt,
      winTime: params.winTime,
      officialCourier: w.officialCourier,
      officialTrackingNo: w.officialTrackingNo,
      officialShipped: w.officialShipped,
      rawJson: JSON.stringify(w.raw),
    },
    update: {
      liveAccountName: params.liveAccountName,
      winnerUserId: w.winnerUserId || undefined,
      redId: w.redId,
      winnerNickname: w.winnerNickname || undefined,
      avatar: w.avatar,
      recipientName: preserveAddress
        ? existing?.recipientName ?? null
        : w.address?.name ?? existing?.recipientName ?? null,
      recipientPhone: preserveAddress
        ? existing?.recipientPhone ?? null
        : w.address?.phone ?? existing?.recipientPhone ?? null,
      province: preserveAddress ? existing?.province ?? null : w.address?.province ?? existing?.province ?? null,
      city: preserveAddress ? existing?.city ?? null : w.address?.city ?? existing?.city ?? null,
      district: preserveAddress ? existing?.district ?? null : w.address?.district ?? existing?.district ?? null,
      addressDetail: preserveAddress
        ? existing?.addressDetail ?? null
        : w.address?.detail ?? existing?.addressDetail ?? null,
      fullAddress: preserveAddress ? existing?.fullAddress ?? null : w.fullAddress ?? existing?.fullAddress ?? null,
      hasAddress: preserveAddress ? existing?.hasAddress ?? false : w.hasAddress,
      addressComplete: preserveAddress ? existing?.addressComplete ?? false : w.addressComplete,
      addressMissingJson: preserveAddress
        ? existing?.addressMissingJson ?? '[]'
        : JSON.stringify(w.addressMissing),
      firstAddressSeenAt,
      winTime: params.winTime ?? undefined,
      // 平台偶发不回 logistics 时保留库内已有官方单号，避免同步抹掉
      officialCourier: w.officialCourier ?? existing?.officialCourier ?? null,
      officialTrackingNo: w.officialTrackingNo ?? existing?.officialTrackingNo ?? null,
      officialShipped: Boolean(w.officialShipped || existing?.officialShipped),
      rawJson: JSON.stringify(w.raw),
    },
  })

  const prevStatus = existing?.shipment?.shipmentStatus ?? null
  const localMarkedShipped =
    existing?.shipment?.shipmentStatus === 'shipped' &&
    existing.shipment.shippingStatusSource === 'local'
  const mergedOfficialShipped = Boolean(
    w.officialShipped ||
      (existing?.officialShipped && (w.officialTrackingNo || existing.officialTrackingNo)),
  )
  const mergedOfficialTracking = w.officialTrackingNo ?? existing?.officialTrackingNo ?? null
  const mergedOfficialCourier = w.officialCourier ?? existing?.officialCourier ?? null

  let nextStatus = deriveLuckyGiftShipmentStatus({
    hasAddress: preserveAddress ? Boolean(existing?.hasAddress) : w.hasAddress,
    addressComplete: preserveAddress ? Boolean(existing?.addressComplete) : w.addressComplete,
    markedShipped: localMarkedShipped,
    officialShipped: mergedOfficialShipped,
  })
  let shippingStatusSource = existing?.shipment?.shippingStatusSource ?? 'local'
  let courierCompany = existing?.shipment?.courierCompany ?? null
  let trackingNo = existing?.shipment?.trackingNo ?? null
  let markedShippedAt = existing?.shipment?.markedShippedAt ?? null
  let markedShippedBy = existing?.shipment?.markedShippedBy ?? null

  if (mergedOfficialShipped) {
    nextStatus = 'shipped'
    shippingStatusSource = shippingStatusSource === 'local' && localMarkedShipped ? 'local' : 'official'
    if (mergedOfficialTracking) {
      shippingStatusSource = 'official'
      courierCompany = mergedOfficialCourier ?? courierCompany
      trackingNo = mergedOfficialTracking
    }
    markedShippedAt = markedShippedAt ?? params.now
    markedShippedBy = markedShippedBy ?? 'official'
  }

  const shipment = await prisma.luckyGiftShipment.upsert({
    where: { winnerId: winner.id },
    create: {
      winnerId: winner.id,
      shipmentStatus: nextStatus,
      shippingStatusSource,
      freightType: 'COLLECT',
      courierCompany,
      trackingNo,
      markedShippedAt,
      markedShippedBy,
    },
    update: {
      shipmentStatus: nextStatus,
      shippingStatusSource,
      courierCompany,
      trackingNo,
      markedShippedAt,
      markedShippedBy,
      shipmentNote: existing?.shipment?.shipmentNote ?? undefined,
    },
  })

  const statusChanged = prevStatus != null && prevStatus !== shipment.shipmentStatus
  if (statusChanged) {
    await prisma.luckyGiftShipmentLog.create({
      data: {
        shipmentId: shipment.id,
        winnerId: winner.id,
        action: 'sync_status',
        fromStatus: prevStatus,
        toStatus: shipment.shipmentStatus,
        operatorName: 'system-sync',
        note:
          shippingStatusSource === 'official'
            ? '同步平台物流状态'
            : '同步地址后重算发货状态',
      },
    })
  }

  return { created: !existing, newAddress, statusChanged }
}

export async function syncLuckyGiftShop(
  shop: GoodReviewShopDefinition,
  trigger: string,
  options?: { maxDraws?: number; limitRooms?: number },
): Promise<LuckyGiftShopSyncResult> {
  const now = new Date()
  const base: LuckyGiftShopSyncResult = {
    shopKey: shop.shopKey,
    shopName: shop.shopName,
    liveAccountId: null,
    hostId: null,
    hostIdSource: null,
    ok: false,
    syncStatus: 'request_failed',
    syncStatusLabel: LUCKY_GIFT_SYNC_STATUS_LABEL.request_failed,
    drawCount: 0,
    winnerCount: 0,
    platformTotal: null,
    fetchedCount: 0,
    dedupedCount: 0,
    detailFailCount: 0,
    newDrawCount: 0,
    newWinnerCount: 0,
    newAddressCount: 0,
    statusChangeCount: 0,
    bigintMismatchCount: 0,
    listMismatch: false,
    roomsScanned: 0,
    roomsWithData: 0,
    lastSyncedAt: now.toISOString(),
  }

  try {
    const list = await fetchAllLuckyGiftDraws({
      shop,
      trigger,
      maxDraws: options?.maxDraws,
      limitRooms: options?.limitRooms,
    })
    base.liveAccountId = list.accountId
    base.hostId = list.hostId
    base.hostIdSource = list.hostIdSource
    base.platformTotal = list.platformTotal
    base.fetchedCount = list.fetchedCount
    base.dedupedCount = list.dedupedCount
    base.roomsScanned = list.roomsScanned
    base.roomsWithData = list.roomsWithData
    base.syncStatus = list.syncStatus
    base.syncStatusLabel = LUCKY_GIFT_SYNC_STATUS_LABEL[list.syncStatus]
    base.error = list.syncStatusError
    base.listMismatch =
      list.platformTotal != null &&
      (list.fetchedCount !== list.platformTotal || list.dedupedCount !== list.platformTotal)

    if (
      list.syncStatus === 'auth_failed' ||
      list.syncStatus === 'parse_failed' ||
      list.syncStatus === 'request_failed' ||
      list.syncStatus === 'parameter_failed'
    ) {
      base.ok = false
      base.error = list.syncStatusError || base.syncStatusLabel
      await prisma.luckyGiftSyncMeta.upsert({
        where: { liveAccountId: list.accountId },
        create: {
          liveAccountId: list.accountId,
          liveAccountName: list.accountName,
          lastSyncedAt: now,
          lastError: base.error?.slice(0, 500) ?? null,
          lastTrigger: trigger,
        },
        update: {
          liveAccountName: list.accountName,
          lastSyncedAt: now,
          lastError: base.error?.slice(0, 500) ?? null,
          lastTrigger: trigger,
        },
      })
      return base
    }

    for (const draw of list.draws) {
      assertIdUnchanged(draw.luckyDrawId, draw.luckyDrawId, `${shop.shopName} luckyDrawId`)
      const up = await upsertDraw({
        liveAccountId: list.accountId,
        liveAccountName: list.accountName,
        draw,
        now,
      })
      if (up.created) base.newDrawCount += 1

      try {
        const detail = await fetchLuckyGiftWinners({
          shop,
          luckyDrawId: draw.luckyDrawId,
          trigger,
          hostId: list.hostId,
        })
        if (detail.draw && detail.draw.luckyDrawId !== draw.luckyDrawId) {
          base.bigintMismatchCount += 1
        }
        assertIdUnchanged(draw.luckyDrawId, draw.luckyDrawId, `${shop.shopName} detail luckyDrawId`)

        const winTime = msToDate(draw.createTimeMs) ?? msToDate(draw.startTimeMs)
        for (const winner of detail.winners) {
          const r = await upsertWinnerAndShipment({
            liveAccountId: list.accountId,
            liveAccountName: list.accountName,
            luckyDrawId: draw.luckyDrawId,
            winner,
            winTime,
            now,
          })
          if (r.created) base.newWinnerCount += 1
          if (r.newAddress) base.newAddressCount += 1
          if (r.statusChanged) base.statusChangeCount += 1
        }
      } catch (err) {
        base.detailFailCount += 1
        console.warn(
          `[lucky-gift] detail fail shop=${shop.shopName} draw=${draw.luckyDrawId}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }

    if (base.detailFailCount > 0 && base.fetchedCount > 0) {
      base.syncStatus = 'partial_success'
      base.syncStatusLabel = LUCKY_GIFT_SYNC_STATUS_LABEL.partial_success
      base.error = `${base.detailFailCount} 个福袋详情拉取失败`
    }

    base.drawCount = await prisma.xhsLuckyDraw.count({
      where: { liveAccountId: list.accountId },
    })
    base.winnerCount = await prisma.xhsLuckyWinner.count({
      where: { liveAccountId: list.accountId },
    })
    base.ok = isSyncOk(base.syncStatus)

    await prisma.luckyGiftSyncMeta.upsert({
      where: { liveAccountId: list.accountId },
      create: {
        liveAccountId: list.accountId,
        liveAccountName: list.accountName,
        lastSyncedAt: now,
        lastSuccessAt: base.ok ? now : null,
        lastTrigger: trigger,
        drawCount: base.drawCount,
        winnerCount: base.winnerCount,
        platformTotal: base.platformTotal,
        fetchedCount: base.fetchedCount,
        dedupedCount: base.dedupedCount,
        detailFailCount: base.detailFailCount,
        newDrawCount: base.newDrawCount,
        newAddressCount: base.newAddressCount,
        statusChangeCount: base.statusChangeCount,
      },
      update: {
        liveAccountName: list.accountName,
        lastSyncedAt: now,
        lastSuccessAt: base.ok ? now : base.drawCount > 0 ? now : undefined,
        lastError: base.ok ? null : base.error?.slice(0, 500) ?? null,
        lastTrigger: trigger,
        drawCount: base.drawCount,
        winnerCount: base.winnerCount,
        platformTotal: base.platformTotal,
        fetchedCount: base.fetchedCount,
        dedupedCount: base.dedupedCount,
        detailFailCount: base.detailFailCount,
        newDrawCount: base.newDrawCount,
        newAddressCount: base.newAddressCount,
        statusChangeCount: base.statusChangeCount,
      },
    })

    return base
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    base.error = message
    base.syncStatus = message.includes('Cookie') || message.includes('登录') ? 'auth_failed' : 'request_failed'
    base.syncStatusLabel = LUCKY_GIFT_SYNC_STATUS_LABEL[base.syncStatus]
    if (base.liveAccountId) {
      await prisma.luckyGiftSyncMeta.upsert({
        where: { liveAccountId: base.liveAccountId },
        create: {
          liveAccountId: base.liveAccountId,
          liveAccountName: shop.shopName,
          lastSyncedAt: now,
          lastError: message.slice(0, 500),
          lastTrigger: trigger,
        },
        update: {
          lastSyncedAt: now,
          lastError: message.slice(0, 500),
          lastTrigger: trigger,
        },
      })
    }
    return base
  }
}

let syncLock: Promise<LuckyGiftSyncSummary> | null = null

export async function syncLuckyGifts(params: {
  trigger: string
  shopKey?: string
  maxDraws?: number
  limitRooms?: number
}): Promise<LuckyGiftSyncSummary> {
  if (syncLock) return syncLock
  syncLock = (async () => {
    const shops = listLuckyGiftShopTargets(params.shopKey)
    const results: LuckyGiftShopSyncResult[] = []
    for (const shop of shops) {
      results.push(
        await syncLuckyGiftShop(shop, params.trigger, {
          maxDraws: params.maxDraws,
          limitRooms: params.limitRooms,
        }),
      )
    }
    const failed = results.filter((r) => !r.ok)
    const summary: LuckyGiftSyncSummary = {
      ok: failed.length === 0,
      trigger: params.trigger,
      successShopCount: results.filter((r) => r.ok).length,
      failedShopCount: failed.length,
      withDataShopCount: results.filter((r) => isWithData(r.syncStatus)).length,
      confirmedEmptyShopCount: results.filter((r) => r.syncStatus === 'confirmed_empty').length,
      ambiguousEmptyShopCount: results.filter((r) => r.syncStatus === 'ambiguous_empty').length,
      partialSuccessShopCount: results.filter((r) => r.syncStatus === 'partial_success').length,
      failedShops: failed.map((r) => ({
        shopKey: r.shopKey,
        shopName: r.shopName,
        error: r.error || r.syncStatusLabel,
        syncStatus: r.syncStatus,
      })),
      newDrawCount: results.reduce((s, r) => s + r.newDrawCount, 0),
      newWinnerCount: results.reduce((s, r) => s + r.newWinnerCount, 0),
      newAddressCount: results.reduce((s, r) => s + r.newAddressCount, 0),
      statusChangeCount: results.reduce((s, r) => s + r.statusChangeCount, 0),
      shops: results,
      syncedAt: new Date().toISOString(),
    }
    await prisma.luckyGiftSyncRun.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        lastSyncedAt: new Date(),
        lastTrigger: params.trigger,
        successShopCount: summary.successShopCount,
        failedShopCount: summary.failedShopCount,
        failedShopsJson: JSON.stringify(summary.failedShops),
        newDrawCount: summary.newDrawCount,
        newAddressCount: summary.newAddressCount,
        statusChangeCount: summary.statusChangeCount,
        summaryJson: JSON.stringify(summary),
      },
      update: {
        lastSyncedAt: new Date(),
        lastTrigger: params.trigger,
        successShopCount: summary.successShopCount,
        failedShopCount: summary.failedShopCount,
        failedShopsJson: JSON.stringify(summary.failedShops),
        newDrawCount: summary.newDrawCount,
        newAddressCount: summary.newAddressCount,
        statusChangeCount: summary.statusChangeCount,
        summaryJson: JSON.stringify(summary),
      },
    })
    return summary
  })().finally(() => {
    syncLock = null
  })
  return syncLock
}
