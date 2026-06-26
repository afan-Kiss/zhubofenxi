import type { OperationsBiDrillContextProps, OperationsBiDrillRequest } from '../../../pages/operations/operationsBiDrillTypes'

export function buildAnchorAmountDrill(
  ctx: OperationsBiDrillContextProps,
  anchorName: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: 'anchor_ranking',
    target: 'anchor_amount',
    anchorName,
  }
}

export function buildAnchorOrdersDrill(
  ctx: OperationsBiDrillContextProps,
  anchorName: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: 'anchor_ranking',
    target: 'anchor_orders',
    anchorName,
  }
}

export function buildAnchorReturnRateDrill(
  ctx: OperationsBiDrillContextProps,
  anchorName: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: 'anchor_ranking',
    target: 'anchor_return_rate',
    anchorName,
  }
}

export function buildProductHotDrill(
  ctx: OperationsBiDrillContextProps,
  productKey: string,
  productName?: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: 'product_ranking',
    target: 'product_hot',
    productKey,
    productName,
  }
}

export function buildProductOrdersDrill(
  ctx: OperationsBiDrillContextProps,
  productKey: string,
  productName?: string,
): OperationsBiDrillRequest {
  return buildProductHotDrill(ctx, productKey, productName)
}

export function buildProductHighReturnDrill(
  ctx: OperationsBiDrillContextProps,
  productKey: string,
  productName?: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: 'product_ranking',
    target: 'product_high_return',
    productKey,
    productName,
  }
}

export function buildPriceBandAmountDrill(
  ctx: OperationsBiDrillContextProps,
  bandLabel: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: 'price_band_ranking',
    target: 'price_band_amount',
    priceBandLabel: bandLabel,
    priceBandKey: bandLabel,
  }
}

export function buildPriceBandOrdersDrill(
  ctx: OperationsBiDrillContextProps,
  bandLabel: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: 'price_band_ranking',
    target: 'price_band_orders',
    priceBandLabel: bandLabel,
    priceBandKey: bandLabel,
  }
}

export function buildPriceBandReturnRateDrill(
  ctx: OperationsBiDrillContextProps,
  bandLabel: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: 'price_band_ranking',
    target: 'price_band_return_rate',
    priceBandLabel: bandLabel,
    priceBandKey: bandLabel,
  }
}

export function buildAfterSalesReasonDrill(
  ctx: OperationsBiDrillContextProps,
  category: string,
  categoryLabel: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: 'after_sales_ranking',
    target: 'after_sales_reason',
    afterSalesCategory: category,
    afterSalesReason: categoryLabel,
  }
}

export function buildAfterSalesRefundAmountDrill(
  ctx: OperationsBiDrillContextProps,
  category: string,
  categoryLabel: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: 'after_sales_ranking',
    target: 'after_sales_refund_amount',
    afterSalesCategory: category,
    afterSalesReason: categoryLabel,
  }
}

function resolveDailyDrillSource(
  ctx: OperationsBiDrillContextProps,
): OperationsBiDrillRequest['source'] {
  if (ctx.source === 'rankings') return 'rankings'
  if (ctx.scope === 'weekly') return 'weekly_summary'
  if (ctx.scope === 'monthly') return 'monthly_summary'
  return 'daily_summary'
}

export function buildDailyAmountDrill(
  ctx: OperationsBiDrillContextProps,
  dateKey: string,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    source: resolveDailyDrillSource(ctx),
    target: 'summary_valid_amount',
    startDate: dateKey,
    endDate: dateKey,
    scope: 'daily',
  }
}

export function buildSummaryValidAmountDrill(
  ctx: OperationsBiDrillContextProps,
): OperationsBiDrillRequest {
  return {
    ...ctx,
    target: 'summary_valid_amount',
  }
}
