import { prisma } from '../../lib/prisma'
import { deriveLuckyGiftShipmentStatus } from './lucky-gift-status.util'
import type { LuckyGiftShipmentStatus } from './lucky-gift.types'

export async function markLuckyGiftShipped(params: {
  winnerId: string
  courierCompany?: string | null
  trackingNo?: string | null
  note?: string | null
  operatorId?: string | null
  operatorName?: string | null
  undo?: boolean
}) {
  const winner = await prisma.xhsLuckyWinner.findUnique({
    where: { id: params.winnerId },
    include: { shipment: true },
  })
  if (!winner) throw new Error('中奖记录不存在')

  let shipment = winner.shipment
  if (!shipment) {
    const status = deriveLuckyGiftShipmentStatus({
      hasAddress: winner.hasAddress,
      addressComplete: winner.addressComplete,
      markedShipped: false,
      officialShipped: winner.officialShipped,
    })
    shipment = await prisma.luckyGiftShipment.create({
      data: {
        winnerId: winner.id,
        shipmentStatus: status,
        shippingStatusSource: 'local',
        freightType: 'COLLECT',
      },
    })
  }

  const fromStatus = shipment.shipmentStatus
  if (params.undo) {
    if (shipment.shippingStatusSource === 'official') {
      throw new Error('平台官方已发货状态不可撤销为未发')
    }
    const toStatus = deriveLuckyGiftShipmentStatus({
      hasAddress: winner.hasAddress,
      addressComplete: winner.addressComplete,
      markedShipped: false,
      officialShipped: false,
    })
    const updated = await prisma.luckyGiftShipment.update({
      where: { id: shipment.id },
      data: {
        shipmentStatus: toStatus,
        shippingStatusSource: 'local',
        courierCompany: params.courierCompany ?? null,
        trackingNo: params.trackingNo ?? null,
        markedShippedAt: null,
        markedShippedBy: null,
        shipmentNote: params.note ?? shipment.shipmentNote,
      },
    })
    await prisma.luckyGiftShipmentLog.create({
      data: {
        shipmentId: updated.id,
        winnerId: winner.id,
        action: 'undo_shipped',
        fromStatus,
        toStatus,
        operatorId: params.operatorId ?? null,
        operatorName: params.operatorName ?? null,
        note: params.note ?? '撤销已发标记',
      },
    })
    return updated
  }

  if (!winner.addressComplete) {
    throw new Error('地址不完整，不能标记发货')
  }

  const toStatus: LuckyGiftShipmentStatus = 'shipped'
  const updated = await prisma.luckyGiftShipment.update({
    where: { id: shipment.id },
    data: {
      shipmentStatus: toStatus,
      shippingStatusSource: 'local',
      freightType: 'COLLECT',
      courierCompany: params.courierCompany?.trim() || shipment.courierCompany,
      trackingNo: params.trackingNo?.trim() || shipment.trackingNo,
      markedShippedAt: new Date(),
      markedShippedBy: params.operatorName || params.operatorId || 'unknown',
      shipmentNote: params.note ?? shipment.shipmentNote,
    },
  })
  await prisma.luckyGiftShipmentLog.create({
    data: {
      shipmentId: updated.id,
      winnerId: winner.id,
      action: 'mark_shipped',
      fromStatus,
      toStatus,
      operatorId: params.operatorId ?? null,
      operatorName: params.operatorName ?? null,
      note: params.note ?? null,
      metaJson: JSON.stringify({
        courierCompany: updated.courierCompany,
        trackingNo: updated.trackingNo,
      }),
    },
  })
  return updated
}

export async function batchMarkLuckyGiftShipped(params: {
  winnerIds: string[]
  courierCompany?: string | null
  trackingNo?: string | null
  note?: string | null
  operatorId?: string | null
  operatorName?: string | null
}) {
  const results: Array<{ winnerId: string; ok: boolean; error?: string }> = []
  for (const winnerId of params.winnerIds) {
    try {
      await markLuckyGiftShipped({
        winnerId,
        courierCompany: params.courierCompany,
        trackingNo: params.trackingNo,
        note: params.note,
        operatorId: params.operatorId,
        operatorName: params.operatorName,
      })
      results.push({ winnerId, ok: true })
    } catch (err) {
      results.push({
        winnerId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return {
    successCount: results.filter((r) => r.ok).length,
    failCount: results.filter((r) => !r.ok).length,
    results,
  }
}
