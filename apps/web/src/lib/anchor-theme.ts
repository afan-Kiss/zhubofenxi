/** 主播主题色：优先配置色，否则按稳定 id/名称 hash，禁止按列表序号取色。 */

export const DEFAULT_ANCHOR_COLOR = '#94a3b8'

/** 新建主播推荐色板（非展示序号映射） */
export const ANCHOR_COLOR_PALETTE: string[] = [
  '#f43f5e',
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#0ea5e9',
  '#FF2442',
  '#FF8A3D',
  '#14b8a6',
  '#8b5cf6',
]

export type AnchorColorSource = {
  id?: string | null
  anchorId?: string | null
  name?: string | null
  anchorName?: string | null
  color?: string | null
}

export type AnchorTheme = {
  main: string
  softBackground: string
  border: string
  text: string
  chartFill: string
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function isValidAnchorColor(color: string | null | undefined): boolean {
  if (typeof color !== 'string') return false
  return HEX_RE.test(color.trim())
}

function normalizeHex(color: string): string {
  const raw = color.trim()
  if (!HEX_RE.test(raw)) return DEFAULT_ANCHOR_COLOR
  if (raw.length === 4) {
    const r = raw[1]!
    const g = raw[2]!
    const b = raw[3]!
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return raw.toLowerCase()
}

function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 由稳定 id 确定性生成 hex（有 id 时忽略名称，改名不变色）；无 id 时才用名称 */
export function fallbackAnchorColor(anchorId: string, anchorName: string): string {
  const id = anchorId.trim()
  const name = anchorName.trim()
  const key = id || name
  if (!key) return DEFAULT_ANCHOR_COLOR
  const idx = hashString(key) % ANCHOR_COLOR_PALETTE.length
  return ANCHOR_COLOR_PALETTE[idx] ?? DEFAULT_ANCHOR_COLOR
}

function stableKey(anchor: AnchorColorSource): { id: string; name: string } {
  const id = String(anchor.id ?? anchor.anchorId ?? '').trim()
  const name = String(anchor.name ?? anchor.anchorName ?? '').trim()
  return { id, name }
}

export function resolveAnchorColor(anchor: AnchorColorSource): string {
  if (isValidAnchorColor(anchor.color)) {
    return normalizeHex(anchor.color!)
  }
  const { id, name } = stableKey(anchor)
  if (id || name) {
    return fallbackAnchorColor(id || name, name || id)
  }
  return DEFAULT_ANCHOR_COLOR
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = normalizeHex(hex).slice(1)
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  }
}

function mixWithWhite(hex: string, whiteRatio: number): string {
  const { r, g, b } = hexToRgb(hex)
  const t = Math.min(1, Math.max(0, whiteRatio))
  const mix = (c: number) => Math.round(c * (1 - t) + 255 * t)
  const toHex = (c: number) => c.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const t = Math.min(1, Math.max(0, amount))
  const d = (c: number) => Math.round(c * (1 - t))
  const toHex = (c: number) => c.toString(16).padStart(2, '0')
  return `#${toHex(d(r))}${toHex(d(g))}${toHex(d(b))}`
}

export function resolveAnchorTheme(anchor: AnchorColorSource): AnchorTheme {
  const main = resolveAnchorColor(anchor)
  return {
    main,
    softBackground: mixWithWhite(main, 0.92),
    border: mixWithWhite(main, 0.72),
    text: darken(main, 0.28),
    chartFill: main,
  }
}

/** 用于配色冲突提示：欧氏距离过近则视为相似 */
export function colorsTooSimilar(a: string, b: string): boolean {
  if (!isValidAnchorColor(a) || !isValidAnchorColor(b)) return false
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  const dr = ra.r - rb.r
  const dg = ra.g - rb.g
  const db = ra.b - rb.b
  const dist = Math.sqrt(dr * dr + dg * dg + db * db)
  return dist < 48
}
