import { resolveCanonicalShopName, normalizeShopLabel, type QianfanShopName } from '../config/qianfan-shops.constants'

export { resolveCanonicalShopName, normalizeShopLabel }

/** 统一店铺/直播间名称（别名归一） */
export function normalizeShopName(raw: string): QianfanShopName | null {
  return resolveCanonicalShopName(raw)
}

export function shopNamesMatch(a: string, b: string): boolean {
  const ca = normalizeShopName(a)
  const cb = normalizeShopName(b)
  if (ca && cb) return ca === cb
  const la = normalizeShopLabel(a).toLowerCase()
  const lb = normalizeShopLabel(b).toLowerCase()
  if (!la || !lb) return false
  return la === lb || la.includes(lb) || lb.includes(la)
}

export function orderLiveRoomMatchesSchedule(
  orderLiveAccountName: string,
  scheduleShopName: string,
  scheduleLiveRoomName: string,
): boolean {
  const orderLabel = normalizeShopLabel(orderLiveAccountName)
  if (!orderLabel) return false
  if (shopNamesMatch(orderLabel, scheduleLiveRoomName)) return true
  if (shopNamesMatch(orderLabel, scheduleShopName)) return true
  const orderCanonical = normalizeShopName(orderLabel)
  const roomCanonical = normalizeShopName(scheduleLiveRoomName)
  const shopCanonical = normalizeShopName(scheduleShopName)
  if (orderCanonical && roomCanonical && orderCanonical === roomCanonical) return true
  if (orderCanonical && shopCanonical && orderCanonical === shopCanonical) return true
  return false
}
