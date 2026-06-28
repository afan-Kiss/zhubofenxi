export type OperationsBiDrillSource =
  | 'daily_summary'
  | 'weekly_summary'
  | 'monthly_summary'
  | 'rankings'
  | 'anchor_ranking'
  | 'product_ranking'
  | 'price_band_ranking'
  | 'after_sales_ranking'
  | 'business_insight'
  | 'risk_warning'
  | 'metric_card'

export type OperationsBiDrillTarget =
  | 'summary_valid_amount'
  | 'summary_orders'
  | 'summary_return_orders'
  | 'summary_return_rate'
  | 'summary_buyer_count'
  | 'summary_deal_conversion'
  | 'anchor_amount'
  | 'anchor_orders'
  | 'anchor_hourly_amount'
  | 'anchor_return_rate'
  | 'product_hot'
  | 'product_amount'
  | 'product_orders'
  | 'product_quantity'
  | 'product_high_return'
  | 'product_slow'
  | 'product_high_aov'
  | 'price_band_amount'
  | 'price_band_orders'
  | 'price_band_return_rate'
  | 'after_sales_reason'
  | 'after_sales_refund_amount'
  | 'business_insight_orders'
  | 'custom'

export interface OperationsBiDrillRequest {
  source: OperationsBiDrillSource
  target: OperationsBiDrillTarget
  startDate: string
  endDate: string
  preset?: string
  scope?: 'daily' | 'weekly' | 'monthly' | 'custom'
  page?: number
  pageSize?: number
  sort?: string

  anchorId?: string
  anchorName?: string

  productKey?: string
  productName?: string
  skuName?: string
  productCode?: string
  ringSize?: string
  barType?: string
  shopName?: string

  priceBandKey?: string
  priceBandLabel?: string

  afterSalesCategory?: string
  afterSalesReason?: string

  insightId?: string
  insightType?: string

  metricKey?: string
}

export interface OperationsBiDrillOrderRow {
  orderId: string
  orderNo: string
  parentOrderNo?: string | null
  payTime?: string | null
  anchorName?: string | null
  liveAccountName?: string | null
  shopName?: string | null

  productKey?: string | null
  productName?: string | null
  skuName?: string | null
  productCode?: string | null
  ringSize?: string | null
  barType?: string | null

  quantity?: number | null
  paymentAmountYuan?: number | null
  validAmountYuan?: number | null
  includedInGmv?: boolean | null
  isLowPriceExcluded?: boolean | null
  orderStatusText?: string | null

  productRefundAmountYuan?: number | null
  freightRefundAmountYuan?: number | null
  isFreightRefundOnly?: boolean | null
  returnReason?: string | null
  afterSaleStatus?: string | null
  normalizedAfterSalesReason?: string | null
  afterSalesCategoryLabel?: string | null

  buyerNickname?: string | null
  buyerDisplayName?: string | null
  buyerMasked?: boolean

  qianfanDetailAvailable: boolean
  inclusionReason?: string | null
}

export interface OperationsBiDrillPayload {
  title: string
  subtitle: string
  explanation: string
  sourceLabel: string
  targetLabel: string
  range: {
    startDate: string
    endDate: string
  }
  summary: {
    orderCount: number
    validAmountYuan: number
    productReturnOrderCount: number
    productReturnRate: number | null
    buyerCount?: number | null
  }
  filters: Array<{
    label: string
    value: string
  }>
  rows: OperationsBiDrillOrderRow[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  dataQuality: {
    reliable: boolean
    warnings: string[]
  }
}
