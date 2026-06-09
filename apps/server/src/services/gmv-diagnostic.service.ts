import type { NormalizedOrder } from '../types/analysis'
import { prisma } from '../lib/prisma'
import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { clampPagination, paginatedResponse } from '../utils/pagination'
import {
  explainOrderGmvInclusion,
  type GmvOrderInclusionDetail,
} from './gmv-order-inclusion.service'

function pickProductTitle(raw: Record<string, unknown>): string {
  const skus = raw.skus
  if (!Array.isArray(skus) || skus.length === 0) return '—'
  const first = skus[0] as Record<string, unknown>
  return String(first.skuName ?? first.displayName ?? first.name ?? '—').trim() || '—'
}

function buildInclusionDetails(
  orders: NormalizedOrder[],
  range: ReturnType<typeof resolveDateRange>,
): GmvOrderInclusionDetail[] {
  const artifacts = prepareAnalysisArtifactsFromRaw({
    orders,
    liveSessions: [],
    pendingRecords: [],
    settledRecords: [],
    hasPending: false,
    hasSettled: false,
    warnings: [],
  })

  const uniqueIds = new Set(artifacts.dedupe.uniqueOrders.map((o) => o.matchOrderId))
  const dupNoteByMatch = new Map<string, string>()
  for (const g of artifacts.dedupe.duplicateOrders) {
    dupNoteByMatch.set(
      g.orderId,
      `同 matchOrderId 共 ${g.count} 行，去重后合并为 1 条`,
    )
  }

  const allOrders = [
    ...artifacts.dedupe.uniqueOrders,
    ...artifacts.dedupe.abnormalOrders,
  ]

  return allOrders.map((o) => {
    const multiSkuMerged = o.errors.some((e) => e.includes('多 SKU'))
    return explainOrderGmvInclusion(o, range, {
      inDedupedUnique: uniqueIds.has(o.matchOrderId),
      dedupeNote: dupNoteByMatch.get(o.matchOrderId) ?? null,
      multiSkuMerged,
    })
  })
}

export async function buildGmvDiagnostics(
  preset: DateRangePreset,
  startDate?: string,
  endDate?: string,
  page?: number,
  pageSize?: number,
) {
  const range = resolveDateRange(preset, startDate, endDate)
  const bundle = await buildRawAnalyzeBundle(range)

  const orders: NormalizedOrder[] = bundle?.orders ?? []
  const artifacts = bundle ? prepareAnalysisArtifactsFromRaw(bundle) : null
  const views = artifacts?.views ?? []
  const sumOrderGmvCent = views.reduce((s, v) => s + v.effectiveGmvCent, 0)
  const sumReceivableCent = views.reduce((s, v) => s + v.receivableAmountCent, 0)

  const dashboardGmvCent = sumOrderGmvCent

  const differenceCent = sumReceivableCent - sumOrderGmvCent

  const details = bundle
    ? buildInclusionDetails(orders, range)
    : []

  const mapDetailRow = (d: GmvOrderInclusionDetail) => ({
    orderId: d.bizOrderId,
    packageId: d.packageId,
    productTitle: d.productTitle,
    productGmvCent: d.gmvCent,
    receivableCent: d.receivableAmountCent,
    freightCent: 0,
    platformDiscountCent: 0,
    actualPaidCent: d.actualSellerReceiveAmountCent,
    gmvCent: d.gmvCent,
    sourceUsed: d.sourceUsed,
    warning: d.warning,
    includedInGmv: d.includedInGmv,
    amountNote: d.includeReason ?? d.excludeReason ?? '—',
    gmvTimeField: d.gmvTimeField,
    gmvTimeValue: d.gmvTimeValue,
    rawStatus: d.rawStatus,
    rawAfterSaleStatus: d.rawAfterSaleStatus,
  })

  const allRows = details.map(mapDetailRow)
  const { page: p, pageSize: ps } = clampPagination(page, pageSize)
  const start = (p - 1) * ps
  const pageItems = allRows.slice(start, start + ps)
  const detailsPage = paginatedResponse(pageItems, p, ps, allRows.length)

  const includedCount = details.filter((d) => d.includedInGmv).length

  return {
    range: { preset, startDate: range.startDate, endDate: range.endDate },
    dashboardGmvCent,
    sumOrderGmvCent,
    sumReceivableCent,
    differenceCent,
    includedOrderCount: includedCount,
    warning:
      differenceCent !== 0
        ? '应收金额与商品 GMV 不一致，首页 GMV 已按商品金额统计'
        : null,
    detailsPage,
  }
}

export async function buildGmvOrderDiagnostic(
  packageId: string,
  preset: DateRangePreset,
  startDate?: string,
  endDate?: string,
) {
  const range = resolveDateRange(preset, startDate, endDate)
  const row = await prisma.xhsRawOrder.findFirst({ where: { packageId } })
  if (!row) {
    return { found: false as const, packageId, range }
  }

  const { normalizeXhsOrderPackage } = await import(
    './xhs-api-sync/xhs-json-normalizer.service'
  )
  const raw = row.rawJson as Record<string, unknown>
  const order = normalizeXhsOrderPackage(raw, 1)

  const bundle = await buildRawAnalyzeBundle(range)
  const inBundle = bundle?.orders.some((o) => o.matchOrderId === packageId) ?? false
  const details = bundle ? buildInclusionDetails(bundle.orders, range) : []
  const detail =
    details.find((d) => d.packageId === packageId || d.matchOrderId === packageId) ??
    explainOrderGmvInclusion(order, range, { inDedupedUnique: false })

  return {
    found: true as const,
    packageId,
    range: { preset, startDate: range.startDate, endDate: range.endDate },
    inSelectedRangeBundle: inBundle,
    rawJson: raw,
    normalized: {
      packageId: order.packageId,
      bizOrderId: order.bizOrderId,
      matchOrderId: order.matchOrderId,
      productTitle: pickProductTitle(raw),
      gmvCent: order.gmvCent,
      receivableAmountCent: order.receivableAmountCent,
      actualSellerReceiveAmountCent: order.actualSellerReceiveAmountCent,
      orderStatusText: order.orderStatusText,
      afterSaleStatusText: order.afterSaleStatusText,
      isReturned: order.isReturned,
      isSigned: order.isSigned,
      isQualityReturn: order.isQualityReturn,
      orderTime: order.orderTime?.toISOString() ?? null,
      orderTimeText: order.orderTimeText,
      gmvSourceUsed: order.gmvSourceUsed,
      errors: order.errors,
    },
    inclusion: detail,
  }
}
