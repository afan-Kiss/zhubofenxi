import { createHash } from 'node:crypto'

function pickString(raw: Record<string, unknown> | undefined, keys: string[]): string {
  if (!raw) return ''
  for (const k of keys) {
    const v = raw[k]
    if (v != null && String(v).trim()) return String(v).trim()
  }
  return ''
}

export function pickProductNameFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    const name =
      first.productName ??
      first.itemName ??
      first.displayName ??
      first.name ??
      first.skuName
    if (name != null && String(name).trim()) return String(name).trim()
  }
  return pickString(raw, ['productName', 'product_name', 'title', 'itemName', 'goodsName'])
}

export function pickSkuNameFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    const name = first.skuName ?? first.displayName ?? first.name ?? first.spec
    if (name != null && String(name).trim()) return String(name).trim()
  }
  return pickString(raw, ['skuName', 'sku_name', 'spec', 'specification'])
}

export function pickItemIdFromRaw(raw: Record<string, unknown> | undefined): string {
  if (!raw) return ''
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    const first = skus[0] as Record<string, unknown>
    const id = first.itemId ?? first.item_id ?? first.skuId ?? first.sku_id
    if (id != null && String(id).trim()) return String(id).trim()
  }
  return pickString(raw, ['itemId', 'item_id', 'skuId', 'sku_id', 'productId'])
}

export function pickQuantityFromRaw(raw: Record<string, unknown> | undefined): number {
  if (!raw) return 1
  const skus = raw.skus
  if (Array.isArray(skus) && skus.length > 0) {
    let total = 0
    for (const row of skus) {
      if (!row || typeof row !== 'object') continue
      const sku = row as Record<string, unknown>
      const n = Number(sku.skuQuantity ?? sku.quantity ?? sku.qty ?? 1)
      total += Number.isFinite(n) && n > 0 ? n : 1
    }
    return total > 0 ? total : 1
  }
  const n = Number(raw.quantity ?? raw.qty ?? raw.skuQuantity ?? 1)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 1
}

const RING_SIZE_RE = /(?:圈口|手寸|内径)[：:\s]*([0-9]{2}(?:\.[0-9])?)/i
const BAR_TYPE_RE = /(?:条型|款式|类型)[：:\s]*([\u4e00-\u9fa5A-Za-z0-9]+)/

export function parseRingSizeFromText(text: string): string | null {
  const m = RING_SIZE_RE.exec(text)
  return m?.[1]?.trim() ?? null
}

export function parseBarTypeFromText(text: string): string | null {
  const m = BAR_TYPE_RE.exec(text)
  return m?.[1]?.trim() ?? null
}

export function resolveProductKey(params: {
  itemId?: string
  productName?: string
  skuName?: string
}): string {
  const itemId = params.itemId?.trim()
  if (itemId) return `item:${itemId}`
  const name = params.productName?.trim() || '未知商品'
  const sku = params.skuName?.trim() || ''
  const hash = createHash('sha1').update(`${name}|${sku}`).digest('hex').slice(0, 16)
  return `name:${hash}`
}
