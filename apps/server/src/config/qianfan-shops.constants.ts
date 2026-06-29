/** 千帆正式四店（与总控台 canonical 名称一致） */
export const QIANFAN_SHOPS = [
  '拾玉居和田玉',
  '和田雅玉',
  '祥钰珠宝',
  'XY祥钰珠宝',
] as const

export type QianfanShopName = (typeof QIANFAN_SHOPS)[number]

/** 可选 .env 兜底变量（兼容映射，不强制改名） */
export const QIANFAN_SHOP_ENV_KEYS: Record<QianfanShopName, string> = {
  拾玉居和田玉: 'QIANFAN_COOKIE_SHIYUJU',
  和田雅玉: 'QIANFAN_COOKIE_HETIANYAYU',
  祥钰珠宝: 'QIANFAN_COOKIE_XIANGYU',
  XY祥钰珠宝: 'QIANFAN_COOKIE_XYXIANGYU',
}

const ALIAS_RULES: Array<{ shop: QianfanShopName; patterns: RegExp[] }> = [
  { shop: 'XY祥钰珠宝', patterns: [/XY\s*祥钰/i, /XY祥钰珠宝/i] },
  { shop: '拾玉居和田玉', patterns: [/拾玉居/i] },
  { shop: '和田雅玉', patterns: [/和田雅玉/i] },
  { shop: '祥钰珠宝', patterns: [/^祥钰珠宝$/i, /(?<!XY)祥钰(?!珠宝)/i] },
]

export function normalizeShopLabel(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
}

export function resolveCanonicalShopName(raw: string): QianfanShopName | null {
  const label = normalizeShopLabel(raw)
  if (!label) return null
  if ((QIANFAN_SHOPS as readonly string[]).includes(label)) {
    return label as QianfanShopName
  }
  for (const rule of ALIAS_RULES) {
    if (rule.patterns.some((p) => p.test(label))) return rule.shop
  }
  return null
}

export function readEnvFallbackCookie(shopName: QianfanShopName): string | null {
  const key = QIANFAN_SHOP_ENV_KEYS[shopName]
  const val = String(process.env[key] || '').trim()
  return val || null
}
