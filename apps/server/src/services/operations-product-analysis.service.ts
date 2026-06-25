import type { AnalyzedOrderView } from '../types/analysis'
import { prisma } from '../lib/prisma'
import { dedupeViewsByMetricOrderNo, resolveMetricOrderNo } from './calc-refund-rate.service'
import { attachRawByMatchToViews } from './low-price-brush-order.service'
import {
  pickItemIdFromRaw,
  pickProductNameFromRaw,
  pickQuantityFromRaw,
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

export interface OperationsProductRow {
  productKey: string
  itemId: string
  productName: string
  skuName: string
  productCode: string | null
  ringSize: string
  barType: string
  soldCount: number
  soldAmountYuan: number
  buyerCount: number
  refundCount: number
  returnRate: number | null
  productRole: OperationsProductRole
  productRoleLabel: string
}

function isProductReturnOrder(v: AnalyzedOrderView): boolean {
  return v.productRefundAmountCent > 0 && !v.isFreightRefundOnly
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
    buyers: Set<string>
    refundOrderKeys: Set<string>
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
        buyers: new Set<string>(),
        refundOrderKeys: new Set<string>(),
      } satisfies Bucket)
    buckets.set(productKey, bucket)

    if (view.includedInGmv && view.effectiveGmvCent > 0) {
      bucket.soldCount += qty
      bucket.soldAmountCent += view.effectiveGmvCent
      const buyerKey = view.buyerKey || view.buyerId
      if (buyerKey) bucket.buyers.add(buyerKey)
    }
    if (isProductReturnOrder(view)) {
      bucket.refundOrderKeys.add(orderKey)
    }
  }

  const rows: OperationsProductRow[] = []
  for (const bucket of buckets.values()) {
    const dim = dimensionByKey.get(bucket.productKey)
    const specText = `${bucket.productName} ${bucket.skuName}`
    const ringSize = dim?.ringSize?.trim() || parseRingSizeFromText(specText) || '未识别'
    const barType = dim?.barType?.trim() || parseBarTypeFromText(specText) || '未识别'
    const refundCount = bucket.refundOrderKeys.size
    const returnRate =
      bucket.soldCount + refundCount > 0
        ? refundCount / (bucket.soldCount + refundCount)
        : null
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
      productCode: dim?.productCode ?? null,
      ringSize,
      barType,
      soldCount: bucket.soldCount,
      soldAmountYuan: Math.round(bucket.soldAmountCent / 100),
      buyerCount: bucket.buyers.size,
      refundCount,
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
