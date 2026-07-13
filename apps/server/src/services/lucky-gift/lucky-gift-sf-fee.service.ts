import { prisma } from '../../lib/prisma'
import { loadSfWaybillConfigFromEnv, querySfWaybillFee } from '../sf-waybill-fee.service'

export type SfFeeStatus = 'unknown' | 'querying' | 'available' | 'not_billed' | 'failed'

const AVAILABLE_TTL_MS = 24 * 3_600_000
const NOT_BILLED_RETRY_MS = 6 * 3_600_000
const FAILED_BACKOFF_MS = 30 * 60_000

function isSfTrackingNo(no: string | null | undefined): boolean {
  return /^SF\d{10,}$/i.test(String(no || '').trim())
}

function yuanToCent(yuan: number): number {
  return Math.round(yuan * 100)
}

function centToYuan(cent: number | null | undefined): number | null {
  if (cent == null) return null
  return Math.round(cent) / 100
}

export function shouldQuerySfFee(input: {
  trackingNo: string | null | undefined
  shipmentStatus: string
  sfFeeStatus: string | null | undefined
  sfFeeQueriedAt: Date | null | undefined
  sfFeeTrackingNo: string | null | undefined
  force?: boolean
}): boolean {
  const tracking = String(input.trackingNo || '').trim().toUpperCase()
  if (!isSfTrackingNo(tracking)) return false
  if (input.shipmentStatus !== 'shipped' && input.shipmentStatus !== 'pending') return false
  if (input.force) return true

  if (input.sfFeeTrackingNo && input.sfFeeTrackingNo !== tracking) return true

  const status = input.sfFeeStatus || 'unknown'
  const queriedAt = input.sfFeeQueriedAt?.getTime() ?? 0
  const age = Date.now() - queriedAt

  if (status === 'available' && age < AVAILABLE_TTL_MS) return false
  if (status === 'not_billed' && age < NOT_BILLED_RETRY_MS) return false
  if (status === 'failed' && age < FAILED_BACKOFF_MS) return false
  if (status === 'querying' && age < 60_000) return false
  if (status === 'unknown') return true
  if (status === 'available' && age >= AVAILABLE_TTL_MS) return true
  if (status === 'not_billed' && age >= NOT_BILLED_RETRY_MS) return true
  if (status === 'failed' && age >= FAILED_BACKOFF_MS) return true
  return false
}

export async function queryAndCacheSfFeeForShipment(
  shipmentId: string,
  trackingNo: string,
  force = false,
): Promise<{
  sfFeeStatus: SfFeeStatus
  sfMonthlyFeeYuan: number | null
  sfFeeQueriedAt: string | null
  sfFeeError: string | null
}> {
  const cfg = loadSfWaybillConfigFromEnv()
  const tracking = trackingNo.trim().toUpperCase()

  if (!cfg) {
    return {
      sfFeeStatus: 'unknown',
      sfMonthlyFeeYuan: null,
      sfFeeQueriedAt: null,
      sfFeeError: null,
    }
  }

  await prisma.luckyGiftShipment.update({
    where: { id: shipmentId },
    data: { sfFeeStatus: 'querying', sfFeeTrackingNo: tracking },
  })

  let result: Awaited<ReturnType<typeof querySfWaybillFee>>
  try {
    result = await querySfWaybillFee(tracking, cfg)
  } catch (err) {
    const now = new Date()
    const message = err instanceof Error ? err.message : '顺丰费用查询异常'
    await prisma.luckyGiftShipment.update({
      where: { id: shipmentId },
      data: {
        sfFeeStatus: 'failed',
        sfFeeQueriedAt: now,
        sfFeeError: message,
        sfFeeTrackingNo: tracking,
        sfMonthlyFeeCent: null,
      },
    })
    return {
      sfFeeStatus: 'failed',
      sfMonthlyFeeYuan: null,
      sfFeeQueriedAt: now.toISOString(),
      sfFeeError: message,
    }
  }
  const now = new Date()

  if (result.ok && result.totalFeeYuan != null) {
    await prisma.luckyGiftShipment.update({
      where: { id: shipmentId },
      data: {
        sfMonthlyFeeCent: yuanToCent(result.totalFeeYuan),
        sfFeeStatus: 'available',
        sfFeeQueriedAt: now,
        sfFeeError: null,
        sfFeeTrackingNo: tracking,
      },
    })
    return {
      sfFeeStatus: 'available',
      sfMonthlyFeeYuan: result.totalFeeYuan,
      sfFeeQueriedAt: now.toISOString(),
      sfFeeError: null,
    }
  }

  const notBilled = result.notBilled
  const status: SfFeeStatus = notBilled ? 'not_billed' : 'failed'
  await prisma.luckyGiftShipment.update({
    where: { id: shipmentId },
    data: {
      sfFeeStatus: status,
      sfFeeQueriedAt: now,
      sfFeeError: notBilled ? null : result.error,
      sfFeeTrackingNo: tracking,
      sfMonthlyFeeCent: null,
    },
  })
  return {
    sfFeeStatus: status,
    sfMonthlyFeeYuan: null,
    sfFeeQueriedAt: now.toISOString(),
    sfFeeError: notBilled ? null : result.error,
  }
}

export async function ensureSfFeesForShipments(
  shipments: Array<{
    shipmentId: string
    trackingNo: string | null
    shipmentStatus: string
    sfFeeStatus: string | null
    sfFeeQueriedAt: Date | null
    sfFeeTrackingNo: string | null
  }>,
  options?: { force?: boolean; maxQueries?: number },
): Promise<void> {
  if (!loadSfWaybillConfigFromEnv()) return

  const max = options?.maxQueries ?? 5
  let queried = 0
  for (const s of shipments) {
    if (queried >= max) break
    if (
      !shouldQuerySfFee({
        trackingNo: s.trackingNo,
        shipmentStatus: s.shipmentStatus,
        sfFeeStatus: s.sfFeeStatus,
        sfFeeQueriedAt: s.sfFeeQueriedAt,
        sfFeeTrackingNo: s.sfFeeTrackingNo,
        force: options?.force,
      })
    ) {
      continue
    }
    try {
      await queryAndCacheSfFeeForShipment(s.shipmentId, s.trackingNo!, options?.force)
      queried += 1
    } catch (err) {
      console.warn(
        `[lucky-gift] sf fee query failed shipment=${s.shipmentId}:`,
        err instanceof Error ? err.message : err,
      )
    }
    await new Promise((r) => setTimeout(r, 80))
  }
}

export function mapSfFeeForApi(shipment: {
  sfMonthlyFeeCent: number | null
  sfFeeStatus: string | null
  sfFeeQueriedAt: Date | null
  sfFeeError: string | null
  trackingNo: string | null
}): {
  sfMonthlyFeeYuan: number | null
  sfFeeStatus: SfFeeStatus
  sfFeeQueriedAt: string | null
  sfFeeError: string | null
  isSfTracking: boolean
} {
  const tracking = String(shipment.trackingNo || '').trim()
  return {
    sfMonthlyFeeYuan: centToYuan(shipment.sfMonthlyFeeCent),
    sfFeeStatus: (shipment.sfFeeStatus as SfFeeStatus) || 'unknown',
    sfFeeQueriedAt: shipment.sfFeeQueriedAt?.toISOString() ?? null,
    sfFeeError: shipment.sfFeeError ?? null,
    isSfTracking: isSfTrackingNo(tracking),
  }
}

export { centToYuan, isSfTrackingNo }
