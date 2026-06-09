import { getAnchorConfigSync } from '../services/anchor.service'

const SHOP_LIKE_KEYWORDS = ['珠宝', '旗舰店', '专营店', '官方店', '店铺', '祥钰']

export function getKnownAnchorNames(): string[] {
  return getAnchorConfigSync()
    .anchors.filter((a) => a.enabled)
    .map((a) => a.name)
}

export function isShopOrInvalidAnchorLabel(name: string | null | undefined): boolean {
  const n = (name ?? '').trim()
  const known = getKnownAnchorNames()
  if (!n || n === '未知' || n === '未归属') return true
  if (known.some((k) => n === k)) return false
  if (SHOP_LIKE_KEYWORDS.some((kw) => n.includes(kw))) return true
  if (n.length > 8 && !known.some((k) => n.includes(k))) {
    return SHOP_LIKE_KEYWORDS.some((kw) => n.includes(kw))
  }
  return false
}

/** 从直播昵称尝试映射到已启用主播名，否则返回 null（不走店铺名） */
export function mapLiveNickToKnownAnchor(name: string | null | undefined): string | null {
  const n = (name ?? '').trim()
  if (!n || isShopOrInvalidAnchorLabel(n)) return null
  for (const k of getKnownAnchorNames()) {
    if (n === k || n.includes(k)) return k
  }
  return null
}