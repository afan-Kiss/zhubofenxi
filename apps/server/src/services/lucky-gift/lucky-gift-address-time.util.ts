/** 从平台原始响应提取地址提交时间 */

function parseTimestamp(v: unknown): Date | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const s = String(v).trim()
  if (!s) return null
  const n = Number(s)
  if (Number.isFinite(n) && n > 1e9) {
    const ms = n < 1e12 ? n * 1000 : n
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

export type AddressSubmittedSource = 'platform' | 'first_seen_estimate'

export function extractAddressSubmittedAt(
  rawJson: string | null | undefined,
  firstAddressSeenAt: Date | null | undefined,
): { at: Date | null; source: AddressSubmittedSource | null } {
  if (!rawJson) {
    if (firstAddressSeenAt) {
      return { at: firstAddressSeenAt, source: 'first_seen_estimate' }
    }
    return { at: null, source: null }
  }

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(rawJson) as Record<string, unknown>
  } catch {
    if (firstAddressSeenAt) {
      return { at: firstAddressSeenAt, source: 'first_seen_estimate' }
    }
    return { at: null, source: null }
  }

  const address = asRecord(raw.address)
  const candidates: unknown[] = [
    address?.update_time,
    address?.updateTime,
    address?.address_update_time,
    address?.addressUpdateTime,
    address?.submit_time,
    address?.submitTime,
    address?.created_time,
    address?.createdTime,
    raw.address_update_time,
    raw.addressUpdateTime,
    raw.update_time,
    raw.updateTime,
  ]

  for (const c of candidates) {
    const d = parseTimestamp(c)
    if (d) return { at: d, source: 'platform' }
  }

  if (firstAddressSeenAt) {
    return { at: firstAddressSeenAt, source: 'first_seen_estimate' }
  }
  return { at: null, source: null }
}
