import { resolveDateRange, type DateRangePreset } from '../utils/date-range'
import { buildRawAnalyzeBundle } from './xhs-api-sync/xhs-analysis-from-raw.service'
import { prepareAnalysisArtifactsFromRaw } from './business-analysis.service'
import { loadNormalizedOrdersFromRaw } from './xhs-api-sync/xhs-json-normalizer.service'
import { centToYuan } from '../utils/money'

export type AnomalyCategory =
  | 'unassigned'
  | 'no_settlement'
  | 'zero_amount'
  | 'abnormal_status'
  | 'missing_package_id'
  | 'duplicate'
  | 'refund_amount'

export interface AnomalyOrderItem {
  category: AnomalyCategory
  categoryLabel: string
  orderId: string
  packageId: string | null
  orderTimeText: string
  gmvYuan: number
  detail: string
  anchorName?: string
}

export interface AnomalySummary {
  category: AnomalyCategory
  categoryLabel: string
  count: number
}

const CATEGORY_LABELS: Record<AnomalyCategory, string> = {
  unassigned: '没有主播归属',
  no_settlement: '没有匹配到结算',
  zero_amount: '金额为 0',
  abnormal_status: '状态异常',
  missing_package_id: 'packageId 缺失',
  duplicate: '重复订单',
  refund_amount: '退款金额异常',
}

export interface AnomalyDataResult {
  range: { preset: string; startDate: string; endDate: string }
  summaries: AnomalySummary[]
  items: AnomalyOrderItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function buildAnomalyData(params: {
  preset?: string
  startDate?: string
  endDate?: string
  category?: AnomalyCategory
  page?: number
  pageSize?: number
}): Promise<AnomalyDataResult> {
  const preset = (params.preset ?? 'thisMonth') as DateRangePreset
  const range = resolveDateRange(preset, params.startDate, params.endDate)
  const page = Math.max(1, Math.floor(params.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(params.pageSize ?? 50)))

  const allItems: AnomalyOrderItem[] = []
  const bundle = await buildRawAnalyzeBundle(range)

  if (bundle && bundle.orders.length > 0) {
    const artifacts = prepareAnalysisArtifactsFromRaw(bundle)
    const views = artifacts.views
    const orderIds = new Set(artifacts.dedupe.uniqueOrders.map((o) => o.matchOrderId))

    const matchedIds = new Set<string>()
    if (artifacts.settlement) {
      for (const r of [
        ...artifacts.settlement.settledRecords,
        ...artifacts.settlement.pendingRecords,
      ]) {
        if (r.orderId && orderIds.has(r.orderId)) {
          matchedIds.add(r.orderId)
        }
      }
    }

    for (const v of views) {
      if (v.attributionType === 'unassigned') {
        allItems.push({
          category: 'unassigned',
          categoryLabel: CATEGORY_LABELS.unassigned,
          orderId: v.orderId,
          packageId: v.packageId ?? null,
          orderTimeText: v.orderTimeText,
          gmvYuan: centToYuan(v.gmvCent),
          detail: '无法匹配主播时间规则或直播场次',
          anchorName: v.anchorName,
        })
      }
      if (v.attributionType === 'abnormal') {
        allItems.push({
          category: 'abnormal_status',
          categoryLabel: CATEGORY_LABELS.abnormal_status,
          orderId: v.orderId,
          packageId: v.packageId ?? null,
          orderTimeText: v.orderTimeText,
          gmvYuan: centToYuan(v.gmvCent),
          detail: '订单规范化失败或缺少关键字段',
        })
      }
      if (v.gmvCent <= 0) {
        allItems.push({
          category: 'zero_amount',
          categoryLabel: CATEGORY_LABELS.zero_amount,
          orderId: v.orderId,
          packageId: v.packageId ?? null,
          orderTimeText: v.orderTimeText,
          gmvYuan: 0,
          detail: 'GMV 为 0，不参与 GMV 汇总',
        })
      }
      if (!v.packageId?.trim()) {
        allItems.push({
          category: 'missing_package_id',
          categoryLabel: CATEGORY_LABELS.missing_package_id,
          orderId: v.orderId,
          packageId: null,
          orderTimeText: v.orderTimeText,
          gmvYuan: centToYuan(v.gmvCent),
          detail: '缺少 packageId，使用 orderId 兜底',
        })
      }
      if ((bundle.hasPending || bundle.hasSettled) && !matchedIds.has(v.orderId) && v.gmvCent > 0) {
        allItems.push({
          category: 'no_settlement',
          categoryLabel: CATEGORY_LABELS.no_settlement,
          orderId: v.orderId,
          packageId: v.packageId ?? null,
          orderTimeText: v.orderTimeText,
          gmvYuan: centToYuan(v.gmvCent),
          detail: '当前范围内订单未匹配到待结算/已结算记录',
        })
      }
      if (v.isReturned && v.returnAmountCent > v.gmvCent && v.gmvCent > 0) {
        allItems.push({
          category: 'refund_amount',
          categoryLabel: CATEGORY_LABELS.refund_amount,
          orderId: v.orderId,
          packageId: v.packageId ?? null,
          orderTimeText: v.orderTimeText,
          gmvYuan: centToYuan(v.gmvCent),
          detail: `退款 ${centToYuan(v.returnAmountCent)} 元大于 GMV ${centToYuan(v.gmvCent)} 元`,
        })
      }
      if (v.isReturned && v.returnAmountCent <= 0) {
        allItems.push({
          category: 'refund_amount',
          categoryLabel: CATEGORY_LABELS.refund_amount,
          orderId: v.orderId,
          packageId: v.packageId ?? null,
          orderTimeText: v.orderTimeText,
          gmvYuan: centToYuan(v.gmvCent),
          detail: '已识别退货但退款金额为 0',
        })
      }
    }

    for (const dup of artifacts.dedupe.duplicateOrders) {
      allItems.push({
        category: 'duplicate',
        categoryLabel: CATEGORY_LABELS.duplicate,
        orderId: dup.orderId,
        packageId: null,
        orderTimeText: '—',
        gmvYuan: dup.finalGmvCent / 100,
        detail: `重复 ${dup.count} 条，已去重保留 1 条`,
      })
    }
  } else {
    const allOrders = await loadNormalizedOrdersFromRaw()
    for (const o of allOrders) {
      if (!o.orderTime) continue
      const ms = o.orderTime.getTime()
      if (ms < range.startTimeMs || ms > range.endTimeMs) continue
      if (!o.packageId?.trim()) {
        allItems.push({
          category: 'missing_package_id',
          categoryLabel: CATEGORY_LABELS.missing_package_id,
          orderId: o.matchOrderId,
          packageId: null,
          orderTimeText: o.orderTimeText,
          gmvYuan: centToYuan(o.gmvCent),
          detail: '缺少 packageId',
        })
      }
      if (o.gmvCent <= 0) {
        allItems.push({
          category: 'zero_amount',
          categoryLabel: CATEGORY_LABELS.zero_amount,
          orderId: o.matchOrderId,
          packageId: o.packageId ?? null,
          orderTimeText: o.orderTimeText,
          gmvYuan: 0,
          detail: 'GMV 为 0',
        })
      }
    }
  }

  const summaries: AnomalySummary[] = (
    Object.keys(CATEGORY_LABELS) as AnomalyCategory[]
  ).map((category) => ({
    category,
    categoryLabel: CATEGORY_LABELS[category],
    count: allItems.filter((i) => i.category === category).length,
  }))

  const filtered = params.category
    ? allItems.filter((i) => i.category === params.category)
    : allItems

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)

  return {
    range: { preset, startDate: range.startDate, endDate: range.endDate },
    summaries,
    items,
    total,
    page,
    pageSize,
    totalPages,
  }
}
