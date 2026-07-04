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
  priceBandKey?: string
  priceBandLabel?: string
  afterSalesCategory?: string
  afterSalesReason?: string
  insightId?: string
  insightType?: string
  metricKey?: string
}

export interface OperationsBiDrillContextProps {
  source: OperationsBiDrillSource
  startDate: string
  endDate: string
  scope?: 'daily' | 'weekly' | 'monthly' | 'custom'
  preset?: string
}

export interface OperationsBiDrillOrderRow {
  orderId: string
  orderNo: string
  payTime?: string | null
  anchorName?: string | null
  shopName?: string | null
  productName?: string | null
  skuName?: string | null
  quantity?: number | null
  validAmountYuan?: number | null
  productRefundAmountYuan?: number | null
  orderStatusText?: string | null
  afterSaleStatus?: string | null
  normalizedAfterSalesReason?: string | null
  buyerNickname?: string | null
  buyerDisplayName?: string | null
  inclusionReason?: string | null
  includedInValidRevenue?: boolean | null
  validRevenueReason?: string | null
  qianfanDetailAvailable: boolean
}

export interface OperationsBiDrillPayload {
  title: string
  subtitle: string
  explanation: string
  sourceLabel: string
  targetLabel: string
  range: { startDate: string; endDate: string }
  summary: {
    orderCount: number
    validAmountYuan: number
    refundAmountYuan?: number
    productReturnOrderCount: number
    productReturnRate: number | null
    buyerCount?: number | null
  }
  filters: Array<{ label: string; value: string }>
  rows: OperationsBiDrillOrderRow[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  dataQuality: { reliable: boolean; warnings: string[] }
}
