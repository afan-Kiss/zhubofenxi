import type { DailyOperationsAnchorRow } from './daily-operations-report.service'
import type { OperationsProductRow } from './operations-product-analysis.service'
import type { OpsReviewNotePayload } from './ops-review-note.service'
import { buildAllAnchorRankings } from './operations-anchor-ranking.service'
import { buildDailyProductRankings } from './operations-product-ranking-lists.service'
import type { DailyReportRankingsSlice } from './operations-rankings.types'

export async function buildDailyReportRankingsSlice(params: {
  anchors: DailyOperationsAnchorRow[]
  products: OperationsProductRow[]
  limit?: number
}): Promise<DailyReportRankingsSlice> {
  const limit = params.limit ?? 10
  const anchorRankings = buildAllAnchorRankings(params.anchors, limit)
  const productRankings = buildDailyProductRankings({ products: params.products, limit })
  return {
    products: {
      hot: productRankings.hot,
      highReturn: productRankings.highReturn,
    },
    anchors: {
      byAmount: anchorRankings.byAmount,
      byOrders: anchorRankings.byOrders,
      byHourlyAmount: anchorRankings.byHourlyAmount,
      byDealConversion: anchorRankings.byDealConversion,
      byNewFollowers: anchorRankings.byNewFollowers,
      byReturnRate: anchorRankings.byReturnRate,
    },
  }
}

export function buildDailyReportDataQualityWarnings(params: {
  summary: {
    dealUserCount: number | null
    joinUserCount: number | null
    viewSessionCount: number | null
  }
  rankings: DailyReportRankingsSlice
  reviewNote: { problemText?: string; reasonText?: string } | null
}): string[] {
  const warnings: string[] = []
  if (params.summary.dealUserCount == null) {
    warnings.push('官方成交人数缺失，成交率不可计算')
  }
  if (params.summary.joinUserCount == null) {
    warnings.push('官方进房人数缺失')
  }
  if (params.summary.viewSessionCount == null) {
    warnings.push('官方场观字段缺失')
  }
  for (const list of Object.values(params.rankings.products)) {
    warnings.push(...list.dataQuality.warnings)
  }
  for (const list of Object.values(params.rankings.anchors)) {
    warnings.push(...list.dataQuality.warnings)
  }
  if (
    params.rankings.products.highReturn.items.length === 0 &&
    params.rankings.products.highReturn.sampleTooSmall?.length
  ) {
    warnings.push('高退货商品均未达正式榜样本门槛')
  }
  if (params.rankings.products.hot.items.length === 0) {
    warnings.push('今日无有效成交商品，热卖榜为空')
  }
  const problem = params.reviewNote?.problemText?.trim()
  const reason = params.reviewNote?.reasonText?.trim()
  if (problem) warnings.push(`人工复盘问题：${problem.slice(0, 80)}`)
  if (reason) warnings.push(`人工复盘原因：${reason.slice(0, 80)}`)
  return [...new Set(warnings)]
}
