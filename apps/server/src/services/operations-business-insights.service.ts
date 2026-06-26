import { OPERATIONS_ANCHOR_RANKING } from '../config/operations-anchor-ranking.config'
import { OPERATIONS_PRODUCT_RANKING } from '../config/operations-product-ranking.config'
import type { ProductDimensionRow } from './operations-product-ranking.service'
import type { AfterSalesReasonRow } from './after-sales-reason-normalize.service'
import type { DailyOperationsAnchorRow } from './daily-operations-report.service'
import type { OperationsProductRow } from './operations-product-analysis.service'
import type { OperationsPriceBandRow } from './operations-price-band.service'
import type { OpsReviewNotePayload } from './ops-review-note.service'
import { buildAllAnchorRankings } from './operations-anchor-ranking.service'
import { buildAfterSalesRankingLists } from './operations-after-sales-ranking.service'
import type {
  BusinessInsightConfidence,
  BusinessInsightEvidence,
  BusinessInsightItem,
  BusinessInsightPriority,
  BusinessInsightType,
  BusinessInsightsPayload,
} from './operations-business-insights.types'
import { buildPriceBandRankingLists } from './operations-price-band-ranking.service'
import { buildProductRankingLists } from './operations-product-ranking-lists.service'
import { getOperationsRankings } from './operations-rankings.service'
import type {
  AfterSalesRankItem,
  AnchorRankItem,
  OperationsRankingsPayload,
  PriceBandRankItem,
  ProductRankListItem,
} from './operations-rankings.types'
import type { UserRole } from '../types/roles'

const MAX_ITEMS = 8
const MAX_AFTER_SALES = 2
const MAX_DATA_QUALITY = 2
const HOT_HEAD_N = 3
const LOW_RETURN_RATE_THRESHOLD = 0.1
const HIGH_RETURN_RATE_THRESHOLD = 0
const ANCHOR_LOW_RETURN_THRESHOLD = 0.3

const PRIORITY_WEIGHT: Record<BusinessInsightPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

const CONFIDENCE_WEIGHT: Record<BusinessInsightConfidence, number> = {
  high: 4,
  medium: 3,
  low: 2,
  insufficient: 1,
}

export interface BusinessInsightsSource {
  startDate: string
  endDate: string
  scope: 'daily' | 'weekly' | 'custom'
  anchors: ReturnType<typeof buildAllAnchorRankings>
  products: ReturnType<typeof buildProductRankingLists>
  priceBands: ReturnType<typeof buildPriceBandRankingLists>
  afterSales: ReturnType<typeof buildAfterSalesRankingLists>
  summaryTraffic?: {
    dealUserCount: number | null
    joinUserCount: number | null
    viewSessionCount: number | null
  }
  extraWarnings?: string[]
}

function formatMoney(yuan: number): string {
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}`
}

function formatRate(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

function stableId(parts: Array<string | number | undefined>): string {
  return parts.filter((p) => p != null && String(p).length > 0).join('|')
}

function evidence(
  label: string,
  value: string | number | null,
  source: BusinessInsightEvidence['source'],
  opts?: { unit?: string; rankingType?: string; rank?: number },
): BusinessInsightEvidence {
  return {
    label,
    value,
    unit: opts?.unit,
    source,
    rankingType: opts?.rankingType,
    rank: opts?.rank,
  }
}

function makeItem(params: {
  id: string
  type: BusinessInsightType
  priority: BusinessInsightPriority
  title: string
  reason: string
  suggestedAction: string
  evidence: BusinessInsightEvidence[]
  relatedEntity: BusinessInsightItem['relatedEntity']
  confidence: BusinessInsightConfidence
  warnings?: string[]
}): BusinessInsightItem | null {
  if (params.evidence.length === 0) return null
  return {
    id: params.id,
    type: params.type,
    priority: params.priority,
    title: params.title,
    reason: params.reason,
    suggestedAction: params.suggestedAction,
    evidence: params.evidence,
    relatedEntity: params.relatedEntity,
    dataQuality: {
      reliable: params.confidence === 'high' || params.confidence === 'medium',
      confidence: params.confidence,
      warnings: params.warnings ?? [],
    },
  }
}

function productReturnRate(p: ProductRankListItem): number | null {
  if (p.returnRate != null) return p.returnRate
  if (p.soldOrderCount > 0) return p.returnOrderCount / p.soldOrderCount
  return null
}

function anchorReturnRate(a: AnchorRankItem): number | null {
  if (a.returnRate != null) return a.returnRate
  if (a.soldOrderCount > 0) return a.returnOrderCount / a.soldOrderCount
  return null
}

function impactScore(item: BusinessInsightItem): number {
  let amount = 0
  for (const ev of item.evidence) {
    if (typeof ev.value === 'number' && /金额|成交/.test(ev.label)) {
      amount = Math.max(amount, ev.value)
    }
  }
  const riskBoost = item.type === 'review_product' || item.type === 'after_sales_check' ? 1000 : 0
  return amount + riskBoost
}

function sortInsights(items: BusinessInsightItem[]): BusinessInsightItem[] {
  return [...items].sort((a, b) => {
    const pw = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
    if (pw !== 0) return pw
    const cw =
      CONFIDENCE_WEIGHT[b.dataQuality.confidence] -
      CONFIDENCE_WEIGHT[a.dataQuality.confidence]
    if (cw !== 0) return cw
    return impactScore(b) - impactScore(a)
  })
}

function dedupeAndLimit(items: BusinessInsightItem[]): BusinessInsightItem[] {
  const productTypes = new Set<string>()
  const anchorTypes = new Set<string>()
  const afterSalesCount = { n: 0 }
  const dataQualityCount = { n: 0 }
  const result: BusinessInsightItem[] = []

  const sorted = sortInsights(items)

  for (const item of sorted) {
    if (item.type === 'data_quality_warning') {
      if (dataQualityCount.n >= MAX_DATA_QUALITY) continue
      dataQualityCount.n += 1
      result.push(item)
      continue
    }

    if (item.type === 'after_sales_check') {
      if (afterSalesCount.n >= MAX_AFTER_SALES) continue
      afterSalesCount.n += 1
      result.push(item)
      continue
    }

    if (item.relatedEntity.type === 'product') {
      const key = item.relatedEntity.id ?? item.relatedEntity.name
      if (productTypes.has(key)) continue
      if (item.type === 'promote_product' && productTypes.has(`${key}:review`)) continue
      productTypes.add(key)
      if (item.type === 'review_product') productTypes.add(`${key}:review`)
      result.push(item)
      continue
    }

    if (item.relatedEntity.type === 'anchor') {
      const key = item.relatedEntity.name
      const hasReview = anchorTypes.has(`${key}:review_anchor`)
      const hasSchedule = anchorTypes.has(`${key}:increase_anchor_schedule`)
      if (item.type === 'increase_anchor_schedule' && hasReview) continue
      if (item.type === 'review_anchor' && hasSchedule) {
        const idx = result.findIndex(
          (r) =>
            r.relatedEntity.type === 'anchor' &&
            r.relatedEntity.name === key &&
            r.type === 'increase_anchor_schedule',
        )
        if (idx >= 0) result.splice(idx, 1)
      }
      anchorTypes.add(`${key}:${item.type}`)
      result.push(item)
      continue
    }

    result.push(item)
  }

  return result.slice(0, MAX_ITEMS)
}

function buildPromoteProductInsights(
  source: BusinessInsightsSource,
  skipProductKeys: Set<string>,
): BusinessInsightItem[] {
  const items: BusinessInsightItem[] = []
  const hot = source.products.hot
  if (!hot.dataQuality.reliable) return items

  for (const [idx, p] of hot.items.slice(0, HOT_HEAD_N).entries()) {
    if (skipProductKeys.has(p.productKey)) continue
    if (p.validAmountYuan <= 0 || p.soldOrderCount <= 0) continue
    const rate = productReturnRate(p)
    if (rate != null && rate >= LOW_RETURN_RATE_THRESHOLD) continue

    const warnings: string[] = []
    let confidence: BusinessInsightConfidence = 'high'
    if (rate == null) {
      warnings.push('退货率字段缺失，建议结合售后明细复核')
      confidence = 'medium'
    }

    const insight = makeItem({
      id: stableId(['promote_product', p.productKey, source.startDate, source.endDate]),
      type: 'promote_product',
      priority: confidence === 'high' ? 'medium' : 'low',
      title: `继续主推：${p.productName}`,
      reason: `该商品位于热卖榜前 ${idx + 1}，有效成交 ${formatMoney(p.validAmountYuan)}，退货率 ${formatRate(rate)}。`,
      suggestedAction: '建议继续主推该商品，并保留当前讲解话术/主播组合。',
      evidence: [
        evidence('热卖榜排名', idx + 1, 'product_ranking', {
          rankingType: hot.rankingType,
          rank: idx + 1,
        }),
        evidence('有效成交金额', formatMoney(p.validAmountYuan), 'product_ranking', {
          rankingType: hot.rankingType,
        }),
        evidence('成交订单数', p.soldOrderCount, 'product_ranking', {
          rankingType: hot.rankingType,
        }),
        evidence('退货率', formatRate(rate), 'product_ranking', {
          rankingType: hot.rankingType,
        }),
      ],
      relatedEntity: { type: 'product', id: p.productKey, name: p.productName },
      confidence,
      warnings,
    })
    if (insight) items.push(insight)
  }
  return items
}

function buildHighReturnProductInsights(source: BusinessInsightsSource): {
  items: BusinessInsightItem[]
  skipKeys: Set<string>
} {
  const items: BusinessInsightItem[] = []
  const skipKeys = new Set<string>()
  const list = source.products.highReturn

  for (const [idx, p] of list.items.entries()) {
    if (p.soldOrderCount < OPERATIONS_PRODUCT_RANKING.minSoldOrderCountForHighReturn) continue
    const rate = productReturnRate(p)
    if (rate == null || rate <= HIGH_RETURN_RATE_THRESHOLD) continue
    skipKeys.add(p.productKey)

    const insight = makeItem({
      id: stableId(['review_product', p.productKey, source.startDate, source.endDate]),
      type: 'review_product',
      priority: 'high',
      title: `复查高退货商品：${p.productName}`,
      reason: `商品退货订单率 ${p.returnOrderCount}/${p.soldOrderCount}（${formatRate(rate)}），位于高退货正式榜第 ${idx + 1} 位。`,
      suggestedAction:
        '建议复查实物描述、瑕疵说明、圈口/尺寸说明、主播话术和质检环节。',
      evidence: [
        evidence(
          '商品退货订单率',
          `${p.returnOrderCount}/${p.soldOrderCount}`,
          'product_ranking',
          { rankingType: list.rankingType, rank: idx + 1 },
        ),
        evidence('成交订单数', p.soldOrderCount, 'product_ranking', {
          rankingType: list.rankingType,
        }),
        evidence('退货订单数', p.returnOrderCount, 'product_ranking', {
          rankingType: list.rankingType,
        }),
        evidence('榜单排名', idx + 1, 'product_ranking', {
          rankingType: list.rankingType,
          rank: idx + 1,
        }),
      ],
      relatedEntity: { type: 'product', id: p.productKey, name: p.productName },
      confidence: list.dataQuality.confidence === 'high' ? 'high' : 'medium',
    })
    if (insight) items.push(insight)
  }

  for (const [idx, p] of (list.sampleTooSmall ?? []).slice(0, 3).entries()) {
    if (skipKeys.has(p.productKey)) continue
    const rate = productReturnRate(p)
    if (rate == null || rate <= HIGH_RETURN_RATE_THRESHOLD) continue
    skipKeys.add(p.productKey)

    const insight = makeItem({
      id: stableId(['review_product_sample', p.productKey, source.startDate, source.endDate]),
      type: 'review_product',
      priority: 'low',
      title: `复查高退货商品：${p.productName}`,
      reason: `商品退货订单率 ${p.returnOrderCount}/${p.soldOrderCount}；样本不足，仅作为风险提示，不作为正式结论。`,
      suggestedAction:
        '建议复查实物描述、瑕疵说明、圈口/尺寸说明、主播话术和质检环节。',
      evidence: [
        evidence(
          '商品退货订单率',
          `${p.returnOrderCount}/${p.soldOrderCount}`,
          'product_ranking',
          { rankingType: list.rankingType },
        ),
        evidence('成交订单数', p.soldOrderCount, 'product_ranking', {
          rankingType: list.rankingType,
        }),
        evidence('退货订单数', p.returnOrderCount, 'product_ranking', {
          rankingType: list.rankingType,
        }),
        evidence('参考排名', idx + 1, 'product_ranking', {
          rankingType: list.rankingType,
          rank: idx + 1,
        }),
      ],
      relatedEntity: { type: 'product', id: p.productKey, name: p.productName },
      confidence: 'low',
      warnings: ['样本不足，仅作为风险提示，不作为正式结论'],
    })
    if (insight) items.push(insight)
  }

  return { items, skipKeys }
}

function buildSlowProductInsights(source: BusinessInsightsSource): BusinessInsightItem[] {
  const slow = source.products.slow
  if (slow.dataQuality.basis === 'insufficient_data') return []
  if (!slow.dataQuality.reliable && slow.items.length === 0) return []

  const items: BusinessInsightItem[] = []
  for (const [idx, p] of slow.items.slice(0, 3).entries()) {
    if (p.soldOrderCount > 0 || p.validAmountYuan > 0) continue

    const insight = makeItem({
      id: stableId(['review_slow', p.productKey, source.startDate, source.endDate]),
      type: 'review_product',
      priority: 'medium',
      title: `复盘主推未成交：${p.productName}`,
      reason: '该商品在人工主推候选池中，但本期无有效成交。',
      suggestedAction:
        '建议复盘该商品是否价格不合适、主播不匹配、讲解不足、图片/实拍信息不足，必要时暂停主推或更换主播测试。',
      evidence: [
        evidence('主推候选', p.productRoleLabel, 'product_ranking', {
          rankingType: slow.rankingType,
        }),
        evidence('有效成交金额', formatMoney(p.validAmountYuan), 'product_ranking', {
          rankingType: slow.rankingType,
        }),
        evidence('成交订单数', p.soldOrderCount, 'product_ranking', {
          rankingType: slow.rankingType,
        }),
        evidence('榜单说明', p.rankReason, 'product_ranking', {
          rankingType: slow.rankingType,
          rank: idx + 1,
        }),
      ],
      relatedEntity: { type: 'product', id: p.productKey, name: p.productName },
      confidence: slow.dataQuality.confidence === 'insufficient' ? 'medium' : 'high',
    })
    if (insight) items.push(insight)
  }
  return items
}

function buildAnchorScheduleInsights(source: BusinessInsightsSource): BusinessInsightItem[] {
  const items: BusinessInsightItem[] = []
  const byAmount = source.anchors.byAmount
  const byHourly = source.anchors.byHourlyAmount
  if (!byAmount.dataQuality.reliable) return items

  const candidates = new Map<string, { anchor: AnchorRankItem; amountRank?: number; hourlyRank?: number }>()

  for (const [idx, a] of byAmount.items.slice(0, 3).entries()) {
    candidates.set(a.anchorName, { anchor: a, amountRank: idx + 1 })
  }
  for (const [idx, a] of byHourly.items.slice(0, 3).entries()) {
    const existing = candidates.get(a.anchorName) ?? { anchor: a }
    existing.hourlyRank = idx + 1
    candidates.set(a.anchorName, existing)
  }

  for (const { anchor, amountRank, hourlyRank } of candidates.values()) {
    const rate = anchorReturnRate(anchor)
    if (rate != null && rate > ANCHOR_LOW_RETURN_THRESHOLD) continue

    const shortLive =
      anchor.liveDurationMinutes < OPERATIONS_ANCHOR_RANKING.minLiveDurationMinutesForHourly
    const priority: BusinessInsightPriority = shortLive ? 'medium' : 'high'
    const warnings = shortLive ? ['直播时长不足 30 分钟，加场建议仅作参考'] : []

    const ev: BusinessInsightEvidence[] = []
    if (amountRank != null) {
      ev.push(
        evidence('成交金额排名', amountRank, 'anchor_ranking', {
          rankingType: byAmount.rankingType,
          rank: amountRank,
        }),
      )
    }
    if (hourlyRank != null) {
      ev.push(
        evidence('每小时成交排名', hourlyRank, 'anchor_ranking', {
          rankingType: byHourly.rankingType,
          rank: hourlyRank,
        }),
      )
    }
    ev.push(
      evidence('有效成交金额', formatMoney(anchor.validAmountYuan), 'anchor_ranking', {
        rankingType: byAmount.rankingType,
      }),
      evidence('成交订单', anchor.soldOrderCount, 'anchor_ranking', {
        rankingType: byAmount.rankingType,
      }),
      evidence('退货率', formatRate(rate), 'anchor_ranking', {
        rankingType: byAmount.rankingType,
      }),
    )
    if (anchor.hourlyAmountYuan != null) {
      ev.push(
        evidence('每小时成交', formatMoney(anchor.hourlyAmountYuan), 'anchor_ranking', {
          rankingType: byHourly.rankingType,
        }),
      )
    }

    const insight = makeItem({
      id: stableId(['increase_anchor_schedule', anchor.anchorName, source.startDate, source.endDate]),
      type: 'increase_anchor_schedule',
      priority,
      title: `可考虑加场：${anchor.anchorName}`,
      reason: `主播成交金额/效率表现靠前，退货率 ${formatRate(rate)}。`,
      suggestedAction:
        '建议优先安排该主播承接主力货盘或主力价格带，观察加场后的成交稳定性。',
      evidence: ev,
      relatedEntity: { type: 'anchor', name: anchor.anchorName },
      confidence: shortLive ? 'medium' : 'high',
      warnings,
    })
    if (insight) items.push(insight)
  }
  return items
}

function buildLowConversionAnchorInsights(source: BusinessInsightsSource): BusinessInsightItem[] {
  const list = source.anchors.byDealConversion
  if (!list.dataQuality.reliable || list.dataQuality.basis !== 'official_live_traffic') {
    return []
  }

  const qualified = list.items.filter(
    (a) =>
      a.dealUserCount != null &&
      a.joinUserCount != null &&
      a.joinUserCount > 0 &&
      a.dealConversionRate != null,
  )
  if (qualified.length === 0) return []

  const joinValues = qualified.map((a) => a.joinUserCount ?? 0).sort((a, b) => a - b)
  const joinMedian = joinValues[Math.floor(joinValues.length / 2)] ?? 0
  const rates = qualified.map((a) => a.dealConversionRate!).sort((a, b) => a - b)
  const rateMedian = rates[Math.floor(rates.length / 2)] ?? 0

  const items: BusinessInsightItem[] = []
  for (const [idx, a] of qualified.entries()) {
    const highTraffic = (a.joinUserCount ?? 0) >= Math.max(joinMedian, 500)
    const lowConversion = a.dealConversionRate! <= rateMedian
    if (!highTraffic || !lowConversion) continue

    const insight = makeItem({
      id: stableId(['review_anchor', a.anchorName, source.startDate, source.endDate]),
      type: 'review_anchor',
      priority: 'high',
      title: `复盘转化偏低主播：${a.anchorName}`,
      reason: `进房 ${a.joinUserCount} 人，成交人数 ${a.dealUserCount}，成交率 ${formatRate(a.dealConversionRate)}，低于同区间中位 ${formatRate(rateMedian)}。`,
      suggestedAction:
        '建议复盘开场承接、产品匹配、逼单节奏、价格锚点和互动话术。',
      evidence: [
        evidence('进房人数', a.joinUserCount, 'anchor_ranking', {
          rankingType: list.rankingType,
        }),
        evidence('成交人数', a.dealUserCount, 'anchor_ranking', {
          rankingType: list.rankingType,
        }),
        evidence('成交率', formatRate(a.dealConversionRate), 'anchor_ranking', {
          rankingType: list.rankingType,
          rank: idx + 1,
        }),
        evidence('成交率榜排名', idx + 1, 'anchor_ranking', {
          rankingType: list.rankingType,
          rank: idx + 1,
        }),
      ],
      relatedEntity: { type: 'anchor', name: a.anchorName },
      confidence: 'high',
    })
    if (insight) items.push(insight)
  }
  return items.slice(0, 2)
}

function buildPriceBandInsights(source: BusinessInsightsSource): BusinessInsightItem[] {
  const items: BusinessInsightItem[] = []
  const byShare = source.priceBands.byShare
  if (!byShare.dataQuality.reliable) return items

  for (const [idx, band] of byShare.items.slice(0, 2).entries()) {
    if (band.soldOrderCount <= 0 || band.validAmountYuan <= 0) continue
    const rate = band.productReturnOrderRate
    if (rate != null && rate > 0.5) continue
    if (band.sampleTooSmall) continue

    const returnList = source.priceBands.byReturnRate
    const formalReturn = returnList.items.find((b) => b.bandLabel === band.bandLabel)
    if (formalReturn?.sampleTooSmall) continue

    const insight = makeItem({
      id: stableId(['focus_price_band', band.bandLabel, source.startDate, source.endDate]),
      type: 'focus_price_band',
      priority: idx === 0 ? 'medium' : 'low',
      title: `重点经营价格带：${band.bandLabel}`,
      reason: `该价格带成交金额占比 ${band.amountSharePercent ?? '—'}%，成交 ${band.soldOrderCount} 单。`,
      suggestedAction:
        '建议围绕该价格带补充货盘、优化主播话术，并作为近期主力成交带观察。',
      evidence: [
        evidence('成交金额', formatMoney(band.validAmountYuan), 'price_band_ranking', {
          rankingType: byShare.rankingType,
          rank: idx + 1,
        }),
        evidence('金额占比', `${band.amountSharePercent ?? '—'}%`, 'price_band_ranking', {
          rankingType: byShare.rankingType,
        }),
        evidence('成交订单', band.soldOrderCount, 'price_band_ranking', {
          rankingType: byShare.rankingType,
        }),
        evidence(
          '商品退货订单率',
          formatRate(band.productReturnOrderRate),
          'price_band_ranking',
          { rankingType: byShare.rankingType },
        ),
      ],
      relatedEntity: { type: 'price_band', id: band.bandLabel, name: band.bandLabel },
      confidence: rate != null ? 'high' : 'medium',
      warnings: rate == null ? ['价格带退货率字段缺失'] : [],
    })
    if (insight) items.push(insight)
  }
  return items
}

function afterSalesAction(category: string, label: string): string {
  const text = `${category} ${label}`.toLowerCase()
  if (/size_mismatch|尺寸|圈口|大小/.test(text)) {
    return '建议加强圈口、尺寸、佩戴效果说明，发货前补充实拍确认信息。'
  }
  if (/quality|质量|瑕疵|品退/.test(text)) {
    return '建议复查质检流程、主播瑕疵说明和发货前复核。'
  }
  if (/描述|实物不符|色差|图片/.test(text)) {
    return '建议复查直播话术、商品标题、实拍图和灯光色差说明。'
  }
  return '建议运营查看售后原因明细，判断是否集中在某类商品或主播。'
}

function buildAfterSalesInsights(source: BusinessInsightsSource): BusinessInsightItem[] {
  const items: BusinessInsightItem[] = []
  const byReason = source.afterSales.byReason
  const byAmount = source.afterSales.byRefundAmount
  if (!byReason.dataQuality.reliable) return items

  const seen = new Set<string>()
  const candidates: AfterSalesRankItem[] = []
  for (const r of byReason.items.slice(0, 3)) {
    if (r.orderCount > 0) candidates.push(r)
  }
  for (const r of byAmount.items.slice(0, 3)) {
    if (r.refundAmountYuan > 0 && !candidates.some((c) => c.category === r.category)) {
      candidates.push(r)
    }
  }

  for (const r of candidates) {
    if (seen.has(r.category)) continue
    seen.add(r.category)
    if (r.orderCount <= 0) continue

    const insight = makeItem({
      id: stableId(['after_sales_check', r.category, source.startDate, source.endDate]),
      type: 'after_sales_check',
      priority: r.orderCount >= 10 ? 'high' : 'medium',
      title: `售后原因排查：${r.categoryLabel}`,
      reason: `「${r.categoryLabel}」售后订单 ${r.orderCount} 单，退款金额 ${formatMoney(r.refundAmountYuan)}。`,
      suggestedAction: afterSalesAction(r.category, r.categoryLabel),
      evidence: [
        evidence('售后订单数', r.orderCount, 'after_sales_ranking', {
          rankingType: byReason.rankingType,
        }),
        evidence('退款金额', formatMoney(r.refundAmountYuan), 'after_sales_ranking', {
          rankingType: byAmount.rankingType,
        }),
        evidence('占比', `${r.sharePercent ?? '—'}%`, 'after_sales_ranking', {
          rankingType: byReason.rankingType,
        }),
        evidence('原因分类', r.categoryLabel, 'after_sales_ranking', {
          rankingType: byReason.rankingType,
        }),
      ],
      relatedEntity: {
        type: 'after_sales_reason',
        id: r.category,
        name: r.categoryLabel,
      },
      confidence: 'high',
    })
    if (insight) items.push(insight)
  }
  return items
}

function buildDataQualityInsights(source: BusinessInsightsSource): BusinessInsightItem[] {
  const items: BusinessInsightItem[] = []
  const slow = source.products.slow

  if (slow.dataQuality.basis === 'insufficient_data') {
    const insight = makeItem({
      id: stableId(['data_quality_slow_pool', source.startDate, source.endDate]),
      type: 'data_quality_warning',
      priority: 'medium',
      title: '补充主推商品池，才能可靠判断滞销',
      reason: slow.dataQuality.warnings[0] ?? '无人工主推候选池，无法识别主推未成交商品。',
      suggestedAction:
        '建议在 ProductDimension.productRole 或 OpsReviewNote 中维护 traffic/main/profit 主推商品，系统才能识别主推未成交商品。',
      evidence: [
        evidence('滞销榜状态', 'insufficient_data', 'operations_rankings', {
          rankingType: slow.rankingType,
        }),
        evidence('数据依据', slow.dataQuality.basis, 'operations_rankings', {
          rankingType: slow.rankingType,
        }),
        evidence('说明', slow.subtitle, 'operations_rankings', {
          rankingType: slow.rankingType,
        }),
      ],
      relatedEntity: { type: 'system', name: '数据维护' },
      confidence: 'insufficient',
    })
    if (insight) items.push(insight)
  }

  const traffic = source.summaryTraffic
  const dealMissing =
    source.anchors.byDealConversion.dataQuality.missingFields?.includes('dealUserCount') ||
    traffic?.dealUserCount == null
  const joinMissing =
    source.anchors.byDealConversion.dataQuality.missingFields?.includes('joinUserCount') ||
    traffic?.joinUserCount == null

  if (dealMissing || joinMissing) {
    const insight = makeItem({
      id: stableId(['data_quality_traffic', source.startDate, source.endDate]),
      type: 'data_quality_warning',
      priority: 'low',
      title: '补充官方直播流量字段，才能生成成交率建议',
      reason: [
        dealMissing ? '官方成交人数缺失' : null,
        joinMissing ? '官方进房人数缺失' : null,
      ]
        .filter(Boolean)
        .join('；'),
      suggestedAction:
        '请确认直播场次 traffic 同步正常，包含进房人数与成交人数后再查看成交率相关建议。',
      evidence: [
        evidence(
          '成交人数',
          traffic?.dealUserCount ?? null,
          source.scope === 'daily' ? 'daily_report' : 'weekly_report',
        ),
        evidence(
          '进房人数',
          traffic?.joinUserCount ?? null,
          source.scope === 'daily' ? 'daily_report' : 'weekly_report',
        ),
        evidence(
          '场观',
          traffic?.viewSessionCount ?? null,
          source.scope === 'daily' ? 'daily_report' : 'weekly_report',
        ),
      ],
      relatedEntity: { type: 'system', name: '数据维护' },
      confidence: 'insufficient',
      warnings: source.anchors.byDealConversion.dataQuality.warnings,
    })
    if (insight) items.push(insight)
  }

  return items
}

export function buildBusinessInsightsFromSource(
  source: BusinessInsightsSource,
): BusinessInsightsPayload {
  const { items: highReturnItems, skipKeys } = buildHighReturnProductInsights(source)
  const raw: BusinessInsightItem[] = [
    ...highReturnItems,
    ...buildPromoteProductInsights(source, skipKeys),
    ...buildSlowProductInsights(source),
    ...buildLowConversionAnchorInsights(source),
    ...buildAnchorScheduleInsights(source),
    ...buildPriceBandInsights(source),
    ...buildAfterSalesInsights(source),
    ...buildDataQualityInsights(source),
  ]

  const items = dedupeAndLimit(raw.filter((x): x is BusinessInsightItem => x != null))
  const warnings = [
    ...(source.extraWarnings ?? []),
    ...items.flatMap((i) => i.dataQuality.warnings),
  ]

  return {
    items,
    dataQuality: {
      reliable: items.some((i) => i.dataQuality.reliable),
      warnings: [...new Set(warnings)].slice(0, 12),
    },
  }
}

export function buildBusinessInsightsFromRankings(
  source: BusinessInsightsSource,
  _rankings: OperationsRankingsPayload,
): BusinessInsightsPayload {
  return buildBusinessInsightsFromSource(source)
}

export function buildBusinessInsightsSourceFromComponents(params: {
  startDate: string
  endDate: string
  scope: 'daily' | 'weekly' | 'custom'
  anchors: DailyOperationsAnchorRow[]
  products: OperationsProductRow[]
  priceBands: OperationsPriceBandRow[]
  afterSalesReasons: AfterSalesReasonRow[]
  dimensions: ProductDimensionRow[]
  reviewNote: OpsReviewNotePayload | null
  limit?: number
  summaryTraffic?: BusinessInsightsSource['summaryTraffic']
  extraWarnings?: string[]
}): BusinessInsightsSource {
  const limit = params.limit ?? 10
  return {
    startDate: params.startDate,
    endDate: params.endDate,
    scope: params.scope,
    anchors: buildAllAnchorRankings(params.anchors, limit),
    products: buildProductRankingLists({
      products: params.products,
      dimensions: params.dimensions,
      reviewNote: params.reviewNote,
      limit,
    }),
    priceBands: buildPriceBandRankingLists(params.priceBands, limit),
    afterSales: buildAfterSalesRankingLists(params.afterSalesReasons, limit),
    summaryTraffic: params.summaryTraffic,
    extraWarnings: params.extraWarnings,
  }
}

export async function buildOperationsBusinessInsights(params: {
  startDate: string
  endDate: string
  scope: 'daily' | 'weekly' | 'custom'
  limit?: number
  role?: UserRole
  username?: string
}): Promise<BusinessInsightsPayload> {
  try {
    const rankings = await getOperationsRankings({
      startDate: params.startDate,
      endDate: params.endDate,
      scope: params.scope,
      limit: params.limit ?? 10,
      role: params.role,
      username: params.username,
    })
    const source: BusinessInsightsSource = {
      startDate: rankings.range.startDate,
      endDate: rankings.range.endDate,
      scope: params.scope,
      anchors: rankings.anchors,
      products: rankings.products,
      priceBands: rankings.priceBands,
      afterSales: rankings.afterSales,
      extraWarnings: rankings.dataQuality.warnings,
    }
    return buildBusinessInsightsFromRankings(source, rankings)
  } catch (e) {
    return {
      items: [],
      dataQuality: {
        reliable: false,
        warnings: [
          `经营建议生成失败：${e instanceof Error ? e.message : '未知错误'}`,
        ],
      },
    }
  }
}
