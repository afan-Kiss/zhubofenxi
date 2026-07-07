import type { UserRole } from '../types/roles'
import type { AnalyzedOrderView } from '../types/analysis'
import { prisma } from '../lib/prisma'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import { getAnchorPerformanceViews, getBoardScopedViewsForRange } from './board-scoped-views.service'
import {
  pickItemIdFromRaw,
  pickProductNameFromRaw,
  pickQuantityFromRaw,
  pickShopNameFromRaw,
  pickSkuNameFromRaw,
  parseBarTypeFromText,
  parseRingSizeFromText,
  resolveProductKey,
} from './operations-product-fields.util'
import {
  productRoleLabel,
  resolveProductRole,
  type OperationsProductRole,
} from '../config/operations-product-role.config'
import { isValidRevenueOrder, dedupeValidRevenueViewsByOrderNoBestValue } from './valid-revenue-order.service'
import { viewCountsAsPaidOrder } from './business-metrics.service'
import { viewCountsAsRefundOrder } from './order-refund-metrics.service'

export interface OperationsProductRow {
  productKey: string
  itemId: string
  productName: string
  skuName: string
  shopName: string
  productCode: string | null
  ringSize: string
  barType: string
  soldCount: number
  soldOrderCount: number
  paidOrderCount: number
  soldAmountYuan: number
  buyerCount: number
  returnOrderCount: number
  returnRate: number | null
  productRole: OperationsProductRole
  productRoleLabel: string
}

function resolveShopNameFromView(view: AnalyzedOrderView & { raw?: Record<string, unknown> }): string {
  const liveAccountName = (view.liveAccountName ?? '').trim()
  if (liveAccountName && liveAccountName !== '—') return liveAccountName
  const fromRaw = pickShopNameFromRaw(view.raw)
  if (fromRaw && fromRaw !== '—') return fromRaw
  return ''
}

function pickDominantShopName(shopAmountCent: Map<string, number>): string {
  if (shopAmountCent.size === 0) return ''
  return [...shopAmountCent.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}

function isProductReturnOrder(v: AnalyzedOrderView): boolean {
  return viewCountsAsRefundOrder(v)
}

export { isProductReturnOrder }

/** 商品退货率（订单维度）：退款订单数 / 支付订单数 */
export function computeProductReturnRateByOrder(
  paidOrderCount: number,
  refundOrderCount: number,
): number | null {
  if (paidOrderCount <= 0) return null
  return refundOrderCount / paidOrderCount
}

export async function buildOperationsProductAnalysis(
  views: AnalyzedOrderView[],
  rawByMatch: Map<string, Record<string, unknown>>,
): Promise<OperationsProductRow[]> {
  const withRaw = attachRawByMatchToViews(views, rawByMatch)
  const deduped = dedupeValidRevenueViewsByOrderNoBestValue(withRaw)
  const dimensionRows = await prisma.productDimension.findMany()
  const dimensionByKey = new Map(dimensionRows.map((d) => [d.productKey, d]))

  type Bucket = {
    productKey: string
    itemId: string
    productName: string
    skuName: string
    soldCount: number
    soldAmountCent: number
    soldOrderKeys: Set<string>
    paidOrderKeys: Set<string>
    buyers: Set<string>
    returnOrderKeys: Set<string>
    shopAmountCent: Map<string, number>
  }

  const buckets = new Map<string, Bucket>()

  for (const view of deduped) {
    const orderKey = resolveMetricOrderNo(view) || view.orderId
    if (!orderKey) continue
    const raw = (view as { raw?: Record<string, unknown> }).raw ?? {}
    const itemId = pickItemIdFromRaw(raw)
    const productName = pickProductNameFromRaw(raw) || '未知商品'
    const skuName = pickSkuNameFromRaw(raw)
    const productKey = resolveProductKey({ itemId, productName, skuName })
    const qty = pickQuantityFromRaw(raw)

    const bucket =
      buckets.get(productKey) ??
      ({
        productKey,
        itemId,
        productName,
        skuName,
        soldCount: 0,
        soldAmountCent: 0,
        soldOrderKeys: new Set<string>(),
        paidOrderKeys: new Set<string>(),
        buyers: new Set<string>(),
        returnOrderKeys: new Set<string>(),
        shopAmountCent: new Map<string, number>(),
      } satisfies Bucket)
    buckets.set(productKey, bucket)

    if (viewCountsAsPaidOrder(view)) {
      bucket.paidOrderKeys.add(orderKey)
    }

    if (isValidRevenueOrder(view)) {
      bucket.soldCount += qty
      bucket.soldAmountCent += view.effectiveGmvCent
      bucket.soldOrderKeys.add(orderKey)
      const buyerKey = view.buyerKey || view.buyerId
      if (buyerKey) bucket.buyers.add(buyerKey)
      const shopName = resolveShopNameFromView(view)
      if (shopName) {
        bucket.shopAmountCent.set(
          shopName,
          (bucket.shopAmountCent.get(shopName) ?? 0) + view.effectiveGmvCent,
        )
      }
    }
    if (isProductReturnOrder(view)) {
      bucket.returnOrderKeys.add(orderKey)
    }
  }

  const rows: OperationsProductRow[] = []
  for (const bucket of buckets.values()) {
    const dim = dimensionByKey.get(bucket.productKey)
    const specText = `${bucket.productName} ${bucket.skuName}`
    const ringSize = dim?.ringSize?.trim() || parseRingSizeFromText(specText) || '未识别'
    const barType = dim?.barType?.trim() || parseBarTypeFromText(specText) || '未识别'
    const soldOrderCount = bucket.soldOrderKeys.size
    const paidOrderCount = bucket.paidOrderKeys.size
    const returnOrderCount = [...bucket.returnOrderKeys].filter((key) =>
      bucket.paidOrderKeys.has(key),
    ).length
    const returnRate = computeProductReturnRateByOrder(paidOrderCount, returnOrderCount)
    const role = resolveProductRole({
      soldCount: bucket.soldCount,
      returnRate,
      manualRole: dim?.productRole,
    })
    rows.push({
      productKey: bucket.productKey,
      itemId: bucket.itemId,
      productName: bucket.productName,
      skuName: bucket.skuName,
      shopName: pickDominantShopName(bucket.shopAmountCent) || '—',
      productCode: dim?.productCode ?? null,
      ringSize,
      barType,
      soldCount: bucket.soldCount,
      soldOrderCount,
      paidOrderCount,
      soldAmountYuan: Math.round(bucket.soldAmountCent / 100),
      buyerCount: bucket.buyers.size,
      returnOrderCount,
      returnRate,
      productRole: role,
      productRoleLabel: productRoleLabel(role),
    })
  }

  return rows.sort((a, b) => b.soldAmountYuan - a.soldAmountYuan)
}

/** 全日期范围重建商品分析（正确去重 paidOrderCount / buyerCount，避免逐日快照累加偏差） */
export async function buildProductsForDateRange(params: {
  startDate: string
  endDate: string
  role?: UserRole
  username?: string
}): Promise<OperationsProductRow[]> {
  const scoped = await getBoardScopedViewsForRange({
    preset: 'custom',
    startDate: params.startDate,
    endDate: params.endDate,
    role: params.role,
    username: params.username,
  })
  const performanceViews = await getAnchorPerformanceViews(scoped.views, scoped.rawByMatch)
  return buildOperationsProductAnalysis(performanceViews, scoped.rawByMatch)
}

export async function buildOperationsProductDetail(params: {
  views: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
  productKey: string
}): Promise<OperationsProductRow | null> {
  const rows = await buildOperationsProductAnalysis(params.views, params.rawByMatch)
  return rows.find((r) => r.productKey === params.productKey) ?? null
}
