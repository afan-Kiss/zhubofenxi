export interface Anchor {
  id: string
  name: string
  color: string
  enabled: boolean
  createdAt: string
}

export interface TimeRule {
  id: string
  name: string
  startTime: string
  endTime: string
  anchorId: string
  enabled: boolean
}

export interface AnchorConfig {
  version: number
  anchors: Anchor[]
  timeRules: TimeRule[]
}

export type AttributionType =
  | 'live_anchor_field'
  | 'live_time_rule'
  | 'time_rule'
  | 'unassigned'
  | 'abnormal'

export interface LiveSession {
  id: string
  sourceRowIndex: number
  startTime: Date
  endTime: Date
  startTimeText: string
  endTimeText: string
  anchorName?: string
  anchorId?: string
  durationMinutes: number
  errors: string[]
  raw: Record<string, unknown>
}

export interface OrderAttribution {
  anchorId: string
  anchorName: string
  attributionType: AttributionType
  matchedRuleId?: string
  matchedRuleName?: string
  matchedLiveSessionId?: string
  matchedLiveStartTime?: string
  matchedLiveEndTime?: string
  attributionWarning?: string
}

export interface AttributionValidation {
  orderCountOk: boolean
  gmvOk: boolean
  orderCountMessage?: string
  gmvMessage?: string
}

export interface UnmatchedBillSummary {
  count: number
  amountCent: number
}
