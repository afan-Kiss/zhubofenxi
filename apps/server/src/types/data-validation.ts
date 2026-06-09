import type { DownloadType } from './download'
import type {
  AnalyzedOrderView,
  FieldMappingResult,
  NormalizedOrder,
  OrderDedupeResult,
  SettlementPreprocessResult,
} from './analysis'

export const ANALYSIS_TRUST_STATUSES = [
  'official_ready',
  'preview_only',
  'blocked',
  'error',
] as const

export type AnalysisTrustStatus = (typeof ANALYSIS_TRUST_STATUSES)[number]

export interface DateRangeSpan {
  start: string | null
  end: string | null
  displayText: string
  validCount: number
}

export interface DownloadTableStatus {
  type: DownloadType
  typeLabel: string
  required: boolean
  downloadStatus: 'success' | 'failed' | 'missing' | 'not_attempted'
  fileName: string | null
  taskId: string | null
  finishedAt: string | null
  errorMessage: string | null
  impact: 'blocked' | 'preview' | 'none'
  hint: string | null
}

export interface DownloadCompletenessCheck {
  tables: DownloadTableStatus[]
  orderOk: boolean
  warnings: string[]
  errors: string[]
}

export interface FileDateRangeCheck {
  type: DownloadType
  typeLabel: string
  actualRange: DateRangeSpan | null
  selectedRange: { startDate: string; endDate: string }
  status: 'ok' | 'warning' | 'blocked' | 'skipped'
  message: string | null
}

export interface FieldRecognitionCheck {
  type: DownloadType
  typeLabel: string
  missingRequired: string[]
  warnings: string[]
  ok: boolean
}

export interface OrderAttributionReconciliation {
  ok: boolean
  anchorOrderCount: number
  unassignedOrderCount: number
  abnormalOrderCount: number
  uniqueOrderCount: number
  leftSum: number
  message: string | null
}

export interface GmvReconciliation {
  ok: boolean
  anchorGmvCent: number
  unassignedGmvCent: number
  abnormalGmvCent: number
  totalGmvCent: number
  leftSumCent: number
  message: string | null
}

export interface SettlementReconciliation {
  orderCount: number
  settledMatchedCount: number
  pendingMatchedCount: number
  ordersWithoutSettlementCount: number
  settlementWithoutOrderCount: number
  nonCurrentOrderSettlementCount: number
  settledAmountCent: number
  pendingAmountCent: number
  refundAmountCent: number
  feeAmountCent: number
  warnings: string[]
}

export interface DataValidationReport {
  selectedRange: { startDate: string; endDate: string }
  completeness: DownloadCompletenessCheck
  fileDateRanges: FileDateRangeCheck[]
  fieldRecognition: FieldRecognitionCheck[]
  orderAttribution: OrderAttributionReconciliation | null
  gmvReconciliation: GmvReconciliation | null
  settlementReconciliation: SettlementReconciliation | null
  warnings: string[]
  errors: string[]
  abnormalReasons: string[]
}

export interface AnalysisContext {
  files: import('./analysis').LatestDownloadFiles
  selectedRange: import('../utils/date-range').DateRangeResolved
  orderMapping: FieldMappingResult
  orderDedupe: OrderDedupeResult
  views: AnalyzedOrderView[]
  settlement?: SettlementPreprocessResult
  hasPendingFile: boolean
  hasSettledFile: boolean
  liveSessionCount: number
  liveRange: DateRangeSpan | null
  orderFileRange: DateRangeSpan
  pendingFileRange: DateRangeSpan | null
  settledFileRange: DateRangeSpan | null
  parseWarnings: string[]
  parseErrors: string[]
}

export const TRUST_STATUS_LABELS: Record<AnalysisTrustStatus, string> = {
  official_ready: '数据可正式汇报',
  preview_only: '仅预览，不建议汇报',
  blocked: '数据异常，禁止汇报',
  error: '分析异常',
}

export const TRUST_STATUS_HINTS: Record<AnalysisTrustStatus, string> = {
  official_ready: '接口采集及关键校验已通过，可作为正式汇报数据。',
  preview_only: '当前数据仅供预览，不建议直接汇报。',
  blocked: '当前数据异常，禁止汇报，请检查同步记录和异常原因。',
  error: '程序异常或解析失败，请稍后重试或联系管理员。',
}

/** 接口采集版数据源标签（替代 Excel 四表文案） */
export const API_COLLECTION_TYPE_LABELS: Record<
  import('./download').DownloadType,
  string
> = {
  order: '订单列表接口',
  live: '直播场次接口',
  pendingSettlement: '待结算接口',
  settledSettlement: '已结算接口',
}
