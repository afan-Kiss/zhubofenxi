import { QIANFAN_SHOPS, resolveCanonicalShopName, type QianfanShopName } from './qianfan-shops.constants'

export const GOOD_REVIEW_SHOP_KEYS = [
  'shiyuju',
  'hetianyayu',
  'xiangyu',
  'xyxiangyu',
] as const

export type GoodReviewShopKey = (typeof GOOD_REVIEW_SHOP_KEYS)[number]

export interface GoodReviewShopDefinition {
  shopKey: GoodReviewShopKey
  shopName: QianfanShopName
}

export const GOOD_REVIEW_SHOPS: GoodReviewShopDefinition[] = [
  { shopKey: 'shiyuju', shopName: '拾玉居和田玉' },
  { shopKey: 'hetianyayu', shopName: '和田雅玉' },
  { shopKey: 'xiangyu', shopName: '祥钰珠宝' },
  { shopKey: 'xyxiangyu', shopName: 'XY祥钰珠宝' },
]

const SHOP_KEY_BY_NAME = new Map<QianfanShopName, GoodReviewShopKey>(
  GOOD_REVIEW_SHOPS.map((s) => [s.shopName, s.shopKey]),
)

const SHOP_NAME_BY_KEY = new Map<GoodReviewShopKey, QianfanShopName>(
  GOOD_REVIEW_SHOPS.map((s) => [s.shopKey, s.shopName]),
)

export function isGoodReviewShopKey(value: string): value is GoodReviewShopKey {
  return (GOOD_REVIEW_SHOP_KEYS as readonly string[]).includes(value)
}

export function resolveGoodReviewShopKey(raw: string): GoodReviewShopKey | null {
  const trimmed = String(raw || '').trim()
  if (isGoodReviewShopKey(trimmed)) return trimmed
  const canonical = resolveCanonicalShopName(trimmed)
  if (canonical) return SHOP_KEY_BY_NAME.get(canonical) ?? null
  return null
}

export function getGoodReviewShopName(shopKey: GoodReviewShopKey): QianfanShopName {
  return SHOP_NAME_BY_KEY.get(shopKey) ?? QIANFAN_SHOPS[0]
}

export function listGoodReviewShopTargets(shop?: string): GoodReviewShopDefinition[] {
  if (!shop || shop === 'all') return [...GOOD_REVIEW_SHOPS]
  const key = resolveGoodReviewShopKey(shop)
  if (!key) return []
  return GOOD_REVIEW_SHOPS.filter((s) => s.shopKey === key)
}
