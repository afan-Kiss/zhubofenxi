export const LEGACY_LIVE_ACCOUNT_ID = 'legacy'

export function resolveLiveAccountId(id?: string | null): string {
  return id?.trim() || LEGACY_LIVE_ACCOUNT_ID
}

export function liveAccountOrderKey(
  liveAccountId: string | undefined | null,
  orderNo: string,
): string {
  return `${resolveLiveAccountId(liveAccountId)}::${orderNo.trim()}`
}

export function liveAccountPackageKey(
  liveAccountId: string | undefined | null,
  packageId: string,
): string {
  return `${resolveLiveAccountId(liveAccountId)}::${packageId.trim()}`
}

export type LiveAccountOrderQuery = {
  liveAccountId: string
  orderNo: string
}

/** 从售后 workbench 合并 map 中按直播号+订单号查找（键格式 liveAccountId::orderNo） */
export function lookupWorkbenchRefund<T>(
  map: Map<string, T>,
  liveAccountId: string | undefined | null,
  orderNo: string | undefined | null,
): T | undefined {
  const no = orderNo?.trim()
  if (!no) return undefined
  return map.get(liveAccountOrderKey(liveAccountId, no))
}

export function lookupLiveAccountScopedMap<T>(
  map: Map<string, T> | undefined,
  liveAccountId: string | undefined | null,
  orderNo: string | undefined | null,
): T | undefined {
  const no = orderNo?.trim()
  if (!map || !no) return undefined
  return map.get(liveAccountOrderKey(liveAccountId, no)) ?? map.get(no)
}

export function buildLiveAccountOrderQueries(
  orders: Array<{
    liveAccountId?: string | null
    displayOrderNo?: string
    officialOrderNo?: string
    packageId?: string
    sourceType?: string | null
    dealSource?: string | null
    offlineDealKey?: string | null
    raw?: Record<string, unknown>
  }>,
): LiveAccountOrderQuery[] {
  const seen = new Set<string>()
  const out: LiveAccountOrderQuery[] = []
  for (const o of orders) {
    const orderNo = (o.displayOrderNo || o.officialOrderNo || o.packageId || '').trim()
    if (!orderNo) continue
    // 线下成交无平台订单号，禁止进入千帆售后查询
    if (/^OFF-/i.test(orderNo) || /^offline:/i.test(orderNo)) continue
    if (o.dealSource === 'offline' || o.sourceType === 'offline_deal' || o.offlineDealKey) continue
    if (o.raw && (o.raw.dealSource === 'offline' || o.raw.sourceType === 'offline_deal')) continue
    const liveAccountId = resolveLiveAccountId(o.liveAccountId)
    const key = liveAccountOrderKey(liveAccountId, orderNo)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ liveAccountId, orderNo })
  }
  return out
}
