import type {
  BusinessInsightItem,
  BossSummaryItem,
  OperationsRankingsPayload,
} from '../../pages/operations/operationsReportTypes'
import type {
  OperationsBiDrillContextProps,
  OperationsBiDrillRequest,
  OperationsBiDrillTarget,
} from '../../pages/operations/operationsBiDrillTypes'

export function anchorDrillTarget(rankingType: string): OperationsBiDrillTarget {
  if (rankingType.includes('return')) return 'anchor_return_rate'
  if (rankingType.includes('hourly')) return 'anchor_hourly_amount'
  if (rankingType.includes('order')) return 'anchor_orders'
  return 'anchor_amount'
}

/** 官方流量榜不提供订单下钻 */
export function anchorRankingSupportsDrill(rankingType: string): boolean {
  return !(
    rankingType === 'anchor_by_deal_conversion' ||
    rankingType === 'anchor_by_new_followers' ||
    rankingType === 'anchor_by_follower_conversion'
  )
}

export const ANCHOR_TRAFFIC_RANKING_NOTE =
  '这是官方流量指标，不是订单直接组成的，所以不提供订单明细。'

export function productDrillTarget(rankingType: string): OperationsBiDrillTarget {
  if (rankingType.includes('slow')) return 'product_slow'
  if (rankingType.includes('return')) return 'product_high_return'
  if (rankingType.includes('quantity')) return 'product_quantity'
  if (rankingType.includes('order')) return 'product_orders'
  if (rankingType.includes('hot')) return 'product_hot'
  if (rankingType.includes('aov') || rankingType.includes('Average')) return 'product_high_aov'
  return 'product_amount'
}

export function priceBandDrillTarget(rankingType: string): OperationsBiDrillTarget {
  if (rankingType.includes('return')) return 'price_band_return_rate'
  if (rankingType.includes('order')) return 'price_band_orders'
  return 'price_band_amount'
}

export function buildInsightDrillRequest(
  item: BusinessInsightItem,
  rangeStartDate: string,
  rangeEndDate: string,
  scope: OperationsBiDrillRequest['scope'],
): OperationsBiDrillRequest | null {
  if (item.type === 'data_quality_warning') return null

  const base: OperationsBiDrillRequest = {
    source: 'business_insight',
    target: 'business_insight_orders',
    startDate: rangeStartDate,
    endDate: rangeEndDate,
    scope,
    insightId: item.id,
    insightType: item.type,
  }

  const entity = item.relatedEntity
  if (entity.type === 'anchor') {
    return { ...base, anchorName: entity.name }
  }
  if (entity.type === 'product') {
    return { ...base, productKey: entity.id, productName: entity.name }
  }
  if (entity.type === 'price_band') {
    return { ...base, priceBandKey: entity.id, priceBandLabel: entity.name }
  }
  if (entity.type === 'after_sales_reason') {
    return { ...base, afterSalesCategory: entity.id, afterSalesReason: entity.name }
  }
  return base
}

export function buildBossSummaryDrillRequest(
  item: BossSummaryItem,
  drillContext: OperationsBiDrillContextProps,
  data: OperationsRankingsPayload,
): OperationsBiDrillRequest | null {
  if (item.empty) return null

  if (item.title === '成交冠军主播') {
    const row = data.anchors.byAmount.items[0]
    if (!row) return null
    return {
      ...drillContext,
      source: 'anchor_ranking',
      target: 'anchor_amount',
      anchorName: row.anchorName,
    }
  }
  if (item.title === '订单冠军主播') {
    const row = data.anchors.byOrders.items[0]
    if (!row) return null
    return {
      ...drillContext,
      source: 'anchor_ranking',
      target: 'anchor_orders',
      anchorName: row.anchorName,
    }
  }
  if (item.title === '热卖商品') {
    const row = data.products.hot.items[0]
    if (!row) return null
    return {
      ...drillContext,
      source: 'product_ranking',
      target: 'product_hot',
      productKey: row.productKey,
      productName: row.productName,
    }
  }
  if (item.title === '高退货风险商品') {
    const row = data.products.highReturn.items[0] ?? data.products.highReturn.sampleTooSmall?.[0]
    if (!row) return null
    return {
      ...drillContext,
      source: 'product_ranking',
      target: 'product_high_return',
      productKey: row.productKey,
      productName: row.productName,
    }
  }
  if (item.title === '成交金额最高价格带') {
    const row = data.priceBands.byAmount.items[0]
    if (!row) return null
    return {
      ...drillContext,
      source: 'price_band_ranking',
      target: 'price_band_amount',
      priceBandKey: row.bandLabel,
      priceBandLabel: row.bandLabel,
    }
  }
  if (item.title === '最大售后原因') {
    const row = data.afterSales.byReason.items[0]
    if (!row) return null
    return {
      ...drillContext,
      source: 'after_sales_ranking',
      target: 'after_sales_reason',
      afterSalesCategory: row.category,
      afterSalesReason: row.categoryLabel,
    }
  }
  return null
}
