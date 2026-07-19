const STORAGE_KEY = 'lucky-gift-page-cache-v1'

export interface LuckyGiftListCachePayload {
  items: unknown[]
  total: number
}

export interface LuckyGiftPageCacheStore {
  summary: unknown | null
  lists: Record<string, LuckyGiftListCachePayload>
  savedAt: number
}

function readStore(): LuckyGiftPageCacheStore | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LuckyGiftPageCacheStore
    if (!parsed || typeof parsed !== 'object') return null
    return {
      summary: parsed.summary ?? null,
      lists: parsed.lists && typeof parsed.lists === 'object' ? parsed.lists : {},
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    }
  } catch {
    return null
  }
}

function writeStore(store: LuckyGiftPageCacheStore): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* quota / private mode */
  }
}

export function buildLuckyGiftListCacheKey(input: {
  shopKey: string
  status: string
  dateRange: string
  startDate: string
  endDate: string
  keyword: string
}): string {
  return [
    input.shopKey,
    input.status,
    input.dateRange,
    input.startDate,
    input.endDate,
    input.keyword.trim(),
  ].join('|')
}

/** 与后端 listLuckyGifts 一致：查单号时跨状态；手机号不当单号 */
export function looksLikeLuckyGiftTrackingKeyword(raw: string): boolean {
  const k = raw.replace(/\s+/g, '')
  if (k.length < 8) return false
  if (/^1\d{10}$/.test(k)) return false
  return /^(sf|yt|zt|jd|sto|yd|ems)?\d{8,}$/i.test(k) || /^[A-Za-z]{0,4}\d{10,}$/.test(k)
}

export function readLuckyGiftSummaryCache<T>(): T | null {
  const store = readStore()
  return (store?.summary as T | null) ?? null
}

export function readLuckyGiftListCache<T>(listKey: string): { items: T[]; total: number } | null {
  const store = readStore()
  const hit = store?.lists[listKey]
  if (!hit || !Array.isArray(hit.items)) return null
  return { items: hit.items as T[], total: Number(hit.total ?? hit.items.length) }
}

export function writeLuckyGiftSummaryCache(summary: unknown): void {
  const store = readStore() ?? { summary: null, lists: {}, savedAt: 0 }
  store.summary = summary
  store.savedAt = Date.now()
  writeStore(store)
}

export function writeLuckyGiftListCache(listKey: string, payload: LuckyGiftListCachePayload): void {
  const store = readStore() ?? { summary: null, lists: {}, savedAt: 0 }
  store.lists[listKey] = payload
  store.savedAt = Date.now()
  writeStore(store)
}