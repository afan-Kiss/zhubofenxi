import {
  OPERATIONS_PRODUCT_RANKING,
  type ProductRankingBasis,
} from '../config/operations-product-ranking.config'
import type { OpsReviewNotePayload } from './ops-review-note.service'
import type { OperationsProductRow } from './operations-product-analysis.service'
import { computeProductReturnRateByOrder } from './operations-product-analysis.service'

export interface ProductRankDataQuality {
  basis: ProductRankingBasis
  reliable: boolean
  warning?: string
}

export type ProductRankingType = 'hot' | 'slow' | 'high_return' | 'sample_too_small'

export interface ProductRankItem {
  productKey: string
  productName: string
  skuName: string
  shopName: string
  productCode: string | null
  ringSize: string
  barType: string
  soldCount: number
  soldOrderCount: number
  /** 有效成交金额（元） */
  validAmountYuan: number
  buyerCount: number
  returnOrderCount: number
  returnRate: number | null
  rankReason: string
  rankingType: ProductRankingType
  dataQuality: ProductRankDataQuality
  sampleTooSmall: boolean
  productRoleLabel: string
}

export interface ProductRankingQuality {
  hotReliable: boolean
  slowReliable: boolean
  highReturnReliable: boolean
  warnings: string[]
}

export interface ProductDimensionRow {
  productKey: string
  productCode?: string | null
  productName?: string | null
  skuName?: string | null
  ringSize?: string | null
  barType?: string | null
  productRole?: string | null
}

function rowToRankBase(p: OperationsProductRow): Omit<ProductRankItem, 'rankReason' | 'rankingType' | 'dataQuality' | 'sampleTooSmall'> {
  return {
    productKey: p.productKey,
    productName: p.productName,
    skuName: p.skuName,
    shopName: p.shopName || '—',
    productCode: p.productCode,
    ringSize: p.ringSize,
    barType: p.barType,
    soldCount: p.soldCount,
    soldOrderCount: p.soldOrderCount,
    validAmountYuan: p.soldAmountYuan,
    buyerCount: p.buyerCount,
    returnOrderCount: p.returnOrderCount,
    returnRate: p.returnRate,
    productRoleLabel: p.productRoleLabel,
  }
}

/** 热卖：有效成交金额 → 成交订单 → 成交件数 */
export function sortHotProducts(a: OperationsProductRow, b: OperationsProductRow): number {
  if (b.soldAmountYuan !== a.soldAmountYuan) return b.soldAmountYuan - a.soldAmountYuan
  if (b.soldOrderCount !== a.soldOrderCount) return b.soldOrderCount - a.soldOrderCount
  return b.soldCount - a.soldCount
}

/** 高退货：退货率 → 退货订单 → 成交订单 */
export function sortHighReturnProducts(a: OperationsProductRow, b: OperationsProductRow): number {
  const rateDiff = (b.returnRate ?? 0) - (a.returnRate ?? 0)
  if (rateDiff !== 0) return rateDiff
  if (b.returnOrderCount !== a.returnOrderCount) return b.returnOrderCount - a.returnOrderCount
  return b.soldOrderCount - a.soldOrderCount
}

export function isManualSlowCandidateRole(role: string | null | undefined): boolean {
  if (!role?.trim()) return false
  const v = role.trim().toLowerCase()
  return OPERATIONS_PRODUCT_RANKING.slowManualRoles.some(
    (token) => v === token.toLowerCase() || v.includes(token.toLowerCase()),
  )
}

function normalizeCandidateToken(raw: string): string {
  return raw.trim().toLowerCase()
}

function buildManualSlowCandidateKeys(params: {
  dimensions: ProductDimensionRow[]
  reviewNote: OpsReviewNotePayload | null
}): Map<string, ProductDimensionRow | null> {
  const map = new Map<string, ProductDimensionRow | null>()
  for (const dim of params.dimensions) {
    if (isManualSlowCandidateRole(dim.productRole)) {
      map.set(dim.productKey, dim)
    }
  }
  const noteLists = [
    params.reviewNote?.trafficProducts ?? [],
    params.reviewNote?.mainProducts ?? [],
    params.reviewNote?.profitProducts ?? [],
  ]
  for (const list of noteLists) {
    for (const token of list) {
      const t = normalizeCandidateToken(token)
      if (!t) continue
      if (t.startsWith('item:') || t.startsWith('name:')) {
        map.set(token.trim(), null)
      }
    }
  }
  return map
}

function matchManualCandidate(
  product: OperationsProductRow,
  candidates: Map<string, ProductDimensionRow | null>,
): boolean {
  if (candidates.has(product.productKey)) return true
  const nameKey = normalizeCandidateToken(product.productName)
  const skuKey = normalizeCandidateToken(`${product.productName}|${product.skuName}`)
  for (const key of candidates.keys()) {
    const nk = normalizeCandidateToken(key)
    if (nk === nameKey || nk === skuKey) return true
    if (nameKey && nk.includes(nameKey)) return true
  }
  return false
}

function stubRowFromDimension(dim: ProductDimensionRow): OperationsProductRow {
  return {
    productKey: dim.productKey,
    itemId: dim.productKey.replace(/^item:/, ''),
    productName: dim.productName?.trim() || dim.productKey,
    skuName: dim.skuName?.trim() || '',
    shopName: '—',
    productCode: dim.productCode ?? null,
    ringSize: dim.ringSize?.trim() || '未识别',
    barType: dim.barType?.trim() || '未识别',
    soldCount: 0,
    soldOrderCount: 0,
    soldAmountYuan: 0,
    buyerCount: 0,
    returnOrderCount: 0,
    returnRate: null,
    productRole: 'normal',
    productRoleLabel: dim.productRole?.trim() || '常规',
  }
}

export function buildHotProductRankings(products: OperationsProductRow[]): ProductRankItem[] {
  const reliableQuality: ProductRankDataQuality = {
    basis: 'valid_performance_view',
    reliable: true,
  }
  return products
    .filter((p) => p.soldOrderCount > 0 && p.soldAmountYuan > 0)
    .sort(sortHotProducts)
    .slice(0, OPERATIONS_PRODUCT_RANKING.hotRankLimit)
    .map((p) => ({
      ...rowToRankBase(p),
      rankReason: '按有效成交金额、成交订单、成交件数排序',
      rankingType: 'hot' as const,
      dataQuality: reliableQuality,
      sampleTooSmall: false,
    }))
}

export function buildHighReturnProductRankings(products: OperationsProductRow[]): {
  formal: ProductRankItem[]
  sampleTooSmall: ProductRankItem[]
} {
  const minOrders = OPERATIONS_PRODUCT_RANKING.minSoldOrderCountForHighReturn
  const withReturns = products.filter(
    (p) => p.returnOrderCount > 0 && p.returnRate != null && p.returnRate > 0,
  )
  const formalPool = withReturns.filter((p) => p.soldOrderCount >= minOrders)
  const samplePool = withReturns.filter(
    (p) => p.soldOrderCount > 0 && p.soldOrderCount < minOrders,
  )

  const formalQuality: ProductRankDataQuality = {
    basis: 'valid_performance_view',
    reliable: true,
  }
  const sampleQuality: ProductRankDataQuality = {
    basis: 'manual_product_dimension',
    reliable: false,
    warning: `成交订单不足 ${minOrders} 单，样本不足，仅参考`,
  }

  const formal = formalPool
    .sort(sortHighReturnProducts)
    .slice(0, OPERATIONS_PRODUCT_RANKING.highReturnRankLimit)
    .map((p) => ({
      ...rowToRankBase(p),
      rankReason: `商品退货订单率 ${p.returnOrderCount}/${p.soldOrderCount}`,
      rankingType: 'high_return' as const,
      dataQuality: formalQuality,
      sampleTooSmall: false,
    }))

  const sampleTooSmall = samplePool
    .sort(sortHighReturnProducts)
    .slice(0, OPERATIONS_PRODUCT_RANKING.highReturnRankLimit)
    .map((p) => ({
      ...rowToRankBase(p),
      rankReason: `样本不足：退货订单 ${p.returnOrderCount} / 成交订单 ${p.soldOrderCount}`,
      rankingType: 'sample_too_small' as const,
      dataQuality: sampleQuality,
      sampleTooSmall: true,
    }))

  return { formal, sampleTooSmall }
}

export function buildSlowProductRankings(params: {
  products: OperationsProductRow[]
  dimensions: ProductDimensionRow[]
  reviewNote: OpsReviewNotePayload | null
}): { items: ProductRankItem[]; dataQuality: ProductRankDataQuality } {
  const candidates = buildManualSlowCandidateKeys(params)
  const hasManualPool = candidates.size > 0

  if (!hasManualPool) {
    return {
      items: [],
      dataQuality: {
        basis: 'insufficient_data',
        reliable: false,
        warning: '无官方曝光/讲解数据，且无人工主推候选池，暂无法可靠判断滞销',
      },
    }
  }

  const productByKey = new Map(params.products.map((p) => [p.productKey, p]))
  const slowRows: OperationsProductRow[] = []

  for (const [key, dim] of candidates.entries()) {
    const existing = productByKey.get(key)
    if (existing) {
      if (existing.soldOrderCount === 0 && existing.soldAmountYuan === 0) {
        slowRows.push(existing)
      }
      continue
    }
    if (dim) {
      slowRows.push(stubRowFromDimension(dim))
    }
  }

  for (const product of params.products) {
    if (product.soldOrderCount > 0 || product.soldAmountYuan > 0) continue
    if (!matchManualCandidate(product, candidates)) continue
    if (!slowRows.some((r) => r.productKey === product.productKey)) {
      slowRows.push(product)
    }
  }

  const dataQuality: ProductRankDataQuality = {
    basis: 'manual_product_dimension',
    reliable: slowRows.length > 0,
    warning:
      slowRows.length === 0
        ? '已有人工主推候选池，但本周候选商品均有成交，暂不展示低成交榜'
        : undefined,
  }

  const items = slowRows
    .sort((a, b) => a.soldAmountYuan - b.soldAmountYuan || a.soldOrderCount - b.soldOrderCount)
    .slice(0, OPERATIONS_PRODUCT_RANKING.slowRankLimit)
    .map((p) => ({
      ...rowToRankBase(p),
      rankReason: '人工主推/候选商品本周未成交或低成交',
      rankingType: 'slow' as const,
      dataQuality,
      sampleTooSmall: false,
    }))

  return { items, dataQuality }
}

export function buildWeeklyProductRankings(params: {
  products: OperationsProductRow[]
  dimensions: ProductDimensionRow[]
  reviewNote: OpsReviewNotePayload | null
}): {
  hotProducts: ProductRankItem[]
  slowProducts: ProductRankItem[]
  highReturnProducts: ProductRankItem[]
  highReturnSampleTooSmall: ProductRankItem[]
  productRankingQuality: ProductRankingQuality
} {
  const hotProducts = buildHotProductRankings(params.products)
  const { formal: highReturnProducts, sampleTooSmall: highReturnSampleTooSmall } =
    buildHighReturnProductRankings(params.products)
  const slow = buildSlowProductRankings(params)

  const warnings: string[] = []
  if (hotProducts.length === 0) {
    warnings.push('本周无有效成交商品，热卖榜为空')
  }
  if (slow.dataQuality.warning) warnings.push(slow.dataQuality.warning)
  else if (!slow.dataQuality.reliable && slow.items.length === 0) {
    warnings.push('滞销榜数据不足')
  }
  if (highReturnProducts.length === 0 && highReturnSampleTooSmall.length > 0) {
    warnings.push(
      `高退货商品均未达到最少 ${OPERATIONS_PRODUCT_RANKING.minSoldOrderCountForHighReturn} 单成交门槛，正式榜为空`,
    )
  }
  if (highReturnProducts.length === 0 && highReturnSampleTooSmall.length === 0) {
    warnings.push('本周无达到样本门槛的高退货商品')
  }

  return {
    hotProducts,
    slowProducts: slow.items,
    highReturnProducts,
    highReturnSampleTooSmall,
    productRankingQuality: {
      hotReliable: hotProducts.length > 0,
      slowReliable: slow.dataQuality.reliable && slow.items.length > 0,
      highReturnReliable: highReturnProducts.length > 0,
      warnings,
    },
  }
}


export function mergeProductRowsList(rows: OperationsProductRow[]): OperationsProductRow[] {
  const map = new Map<string, OperationsProductRow>()
  for (const p of rows) {
    const existing = map.get(p.productKey)
    if (!existing) {
      map.set(p.productKey, { ...p })
      continue
    }
    existing.soldCount += p.soldCount
    existing.soldOrderCount += p.soldOrderCount
    existing.soldAmountYuan += p.soldAmountYuan
    existing.buyerCount += p.buyerCount
    existing.returnOrderCount += p.returnOrderCount
    existing.returnRate = computeProductReturnRateByOrder(
      existing.soldOrderCount,
      existing.returnOrderCount,
    )
  }
  return [...map.values()]
}
