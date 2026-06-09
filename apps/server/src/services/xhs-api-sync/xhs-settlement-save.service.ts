import { prisma } from '../../lib/prisma'
import { Prisma } from '@prisma/client'
import { stableSettlementId } from './xhs-settlement-sync.service'

function extractSettleBillMap(item: Record<string, unknown>): Record<string, unknown> {
  const bill = item.settleBill
  if (!Array.isArray(bill)) return item
  const map: Record<string, unknown> = { ...item }
  for (const entry of bill) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const code = e.code != null ? String(e.code) : ''
    if (code) map[code] = e
  }
  return map
}

function pickBillValue(map: Record<string, unknown>, code: string): unknown {
  const field = map[code]
  if (field && typeof field === 'object' && !Array.isArray(field)) {
    const f = field as Record<string, unknown>
    if (f.value !== undefined && f.value !== null && String(f.value).trim() !== '') {
      return f.value
    }
    if (f.displayValue !== undefined && f.displayValue !== null) {
      return f.displayValue
    }
  }
  return map[code]
}

function parseDateTime(raw: unknown): Date | null {
  if (raw == null) return null
  if (typeof raw === 'number') {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? null : d
}

function extractMeta(item: Record<string, unknown>): {
  settleNo: string | null
  packageId: string | null
  orderTime: Date | null
  settleTime: Date | null
} {
  const map = extractSettleBillMap(item)
  const settleNoRaw = pickBillValue(map, 'SETTLE_NO') ?? item.settleNo
  const packageIdRaw = pickBillValue(map, 'PACKAGE_ID') ?? item.packageId
  const orderTime = parseDateTime(pickBillValue(map, 'ORDER_CREATE_TIME') ?? item.orderCreateTime)
  const settleTime = parseDateTime(pickBillValue(map, 'SETTLE_TIME') ?? item.settleTime)
  return {
    settleNo: settleNoRaw != null ? String(settleNoRaw).trim() || null : null,
    packageId: packageIdRaw != null ? String(packageIdRaw).trim() || null : null,
    orderTime,
    settleTime,
  }
}

export async function savePendingSettlementItem(
  item: Record<string, unknown>,
  syncJobId: string | null | undefined,
): Promise<boolean> {
  const id = stableSettlementId(item)
  const meta = extractMeta(item)
  const rawJson = item as Prisma.InputJsonValue

  await prisma.xhsRawPendingSettlement.upsert({
    where: { id },
    create: {
      id,
      settleNo: meta.settleNo,
      packageId: meta.packageId,
      orderTime: meta.orderTime,
      rawJson,
      syncJobId: syncJobId ?? null,
    },
    update: {
      settleNo: meta.settleNo,
      packageId: meta.packageId,
      orderTime: meta.orderTime,
      rawJson,
      syncJobId: syncJobId ?? null,
    },
  })
  return true
}

export async function saveSettledSettlementItem(
  item: Record<string, unknown>,
  syncJobId: string | null | undefined,
): Promise<boolean> {
  const id = stableSettlementId(item)
  const meta = extractMeta(item)
  const rawJson = item as Prisma.InputJsonValue

  await prisma.xhsRawSettledSettlement.upsert({
    where: { id },
    create: {
      id,
      settleNo: meta.settleNo,
      packageId: meta.packageId,
      orderTime: meta.orderTime,
      settleTime: meta.settleTime,
      rawJson,
      syncJobId: syncJobId ?? null,
    },
    update: {
      settleNo: meta.settleNo,
      packageId: meta.packageId,
      orderTime: meta.orderTime,
      settleTime: meta.settleTime,
      rawJson,
      syncJobId: syncJobId ?? null,
    },
  })
  return true
}
