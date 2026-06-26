export type BusinessInsightType =
  | 'promote_product'
  | 'pause_product'
  | 'review_product'
  | 'review_anchor'
  | 'increase_anchor_schedule'
  | 'optimize_anchor_product_match'
  | 'focus_price_band'
  | 'after_sales_check'
  | 'data_quality_warning'

export type BusinessInsightPriority = 'high' | 'medium' | 'low'

export type BusinessInsightConfidence =
  | 'high'
  | 'medium'
  | 'low'
  | 'insufficient'

export interface BusinessInsightEvidence {
  label: string
  value: string | number | null
  unit?: string
  source:
    | 'operations_rankings'
    | 'daily_report'
    | 'weekly_report'
    | 'product_ranking'
    | 'anchor_ranking'
    | 'price_band_ranking'
    | 'after_sales_ranking'
    | 'manual_review_note'
  rankingType?: string
  rank?: number
}

export interface BusinessInsightEntity {
  type: 'anchor' | 'product' | 'price_band' | 'after_sales_reason' | 'system'
  id?: string
  name: string
}

export type BusinessInsightActionStatus = 'pending' | 'handled' | 'ignored' | 'reviewed'

export interface BusinessInsightActionState {
  status: BusinessInsightActionStatus
  note?: string
  reviewResult?: string
  remindTomorrow?: boolean
  updatedAt?: string
}

export interface BusinessInsightDataQuality {
  reliable: boolean
  confidence: BusinessInsightConfidence
  warnings: string[]
}

export interface BusinessInsightItem {
  id: string
  type: BusinessInsightType
  priority: BusinessInsightPriority
  title: string
  reason: string
  suggestedAction: string
  evidence: BusinessInsightEvidence[]
  relatedEntity: BusinessInsightEntity
  dataQuality: BusinessInsightDataQuality
  actionState?: BusinessInsightActionState
}

export interface BusinessInsightsPayload {
  items: BusinessInsightItem[]
  dataQuality: {
    reliable: boolean
    warnings: string[]
  }
}
