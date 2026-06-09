import type { BuyerProfileData } from './buyer-profile'

export const BUYER_PROFILE_CACHE_TTL_MS = 30 * 60 * 1000
/** 与后端 BUYER_RANKING_CACHE_VERSION 对齐；变更时递增 STORAGE_KEY */
export const BUYER_PROFILE_EXPECTED_CACHE_VERSION =
  'buyer_summary_unified_refund_v13_low_price_filter'
const STORAGE_KEY = 'buyer-profile-cache-v5'
const CACHE_KEY = 'buyers|profile'

export interface BuyerProfileCacheEntry {
  key: string
  data: BuyerProfileData
  lastUpdatedAt: string
  savedAt: number
  cacheVersion: string
}

export function isBuyerProfileDataCacheCompatible(
  data: BuyerProfileData | null | undefined,
): boolean {
  if (!data) return false
  if (data.cacheCompatible === false) return false
  const expected = data.expectedCacheVersion ?? BUYER_PROFILE_EXPECTED_CACHE_VERSION
  const version = String(data.cacheVersion ?? '').trim()
  if (!version) return false
  return version === expected
}

function readEntry(): BuyerProfileCacheEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BuyerProfileCacheEntry
    if (parsed?.key !== CACHE_KEY) return null
    if (!isBuyerProfileDataCacheCompatible(parsed.data)) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    const version = String(parsed.cacheVersion ?? parsed.data.cacheVersion ?? '').trim()
    if (version !== BUYER_PROFILE_EXPECTED_CACHE_VERSION) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function readBuyerProfileCache(): BuyerProfileCacheEntry | null {
  return readEntry()
}

export function writeBuyerProfileCache(data: BuyerProfileData): BuyerProfileCacheEntry | null {
  if (!isBuyerProfileDataCacheCompatible(data)) {
    clearBuyerProfileCache()
    return null
  }
  const entry: BuyerProfileCacheEntry = {
    key: CACHE_KEY,
    data,
    lastUpdatedAt: data.sampleMeta?.lastUpdatedAt ?? data.updatedAt ?? new Date().toISOString(),
    savedAt: Date.now(),
    cacheVersion: String(data.cacheVersion ?? BUYER_PROFILE_EXPECTED_CACHE_VERSION),
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    /* quota */
  }
  return entry
}

export function isBuyerProfileCacheFresh(entry: BuyerProfileCacheEntry, now = Date.now()): boolean {
  return now - entry.savedAt < BUYER_PROFILE_CACHE_TTL_MS
}

export function clearBuyerProfileCache(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem('buyer-profile-cache-v4')
  } catch {
    /* ignore */
  }
}
