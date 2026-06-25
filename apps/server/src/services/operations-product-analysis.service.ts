import type { AnalyzedOrderView } from '../types/analysis'
import { prisma } from '../lib/prisma'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
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
import { isDailyReportSoldOrder } from './daily-report-order.util'

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
  return v.productRefundAmountCent > 0 && !v.isFreightRefundOnly
}

/** 商品退货率（订单维度）：退货订单数 / 有效成交订单数 */
export function computeProductReturnRateByOrder(
  soldOrderCount: number,
  returnOrderCount: number,
): number | null {
  if (soldOrderCount <= 0) return null
  return returnOrderCount / soldOrderCount
}

export async function buildOperationsProductAnalysis(
  views: AnalyzedOrderView[],
  rawByMatch: Map<string, Record<string, unknown>>,
): Promise<OperationsProductRow[]> {
  const withRaw = attachRawByMatchToViews(views, rawByMatch)
  const deduped = dedupeViewsByMetricOrderNo(withRaw)
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
        buyers: new Set<string>(),
        returnOrderKeys: new Set<string>(),
        shopAmountCent: new Map<string, number>(),
      } satisfies Bucket)
    buckets.set(productKey, bucket)

    if (isDailyReportSoldOrder(view)) {
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
    const returnOrderCount = bucket.returnOrderKeys.size
    const returnRate = computeProductReturnRateByOrder(soldOrderCount, returnOrderCount)
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

export async function buildOperationsProductDetail(params: {
  views: AnalyzedOrderView[]
  rawByMatch: Map<string, Record<string, unknown>>
  productKey: string
}): Promise<OperationsProductRow | null> {
  const rows = await buildOperationsProductAnalysis(params.views, params.rawByMatch)
  return rows.find((r) => r.productKey === params.productKey) ?? null
}
