import type { DownloadType } from './download'

export type SettlementDirection = 'income' | 'refund' | 'fee' | 'unknown'
export type SettlementType = 'pending' | 'settled'
export type AttributionType =
  | 'order_anchor_field'
  | 'live_anchor_field'
  | 'live_time_rule'
  | 'time_rule'
  | 'unassigned'
  | 'abnormal'

export interface ParsedExcelFile {
  fileName: string
  filePath: string
  sheetName: string
  headers: string[]
  rowCount: number
  rawRows: unknown[][]
}

export interface ExcelParseResult {
  filePath: string
  sheetName: string
  headers: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  rawRows: unknown[][]
}

export type MatchConfidence = 'exact' | 'fuzzy' | 'manual' | 'missing'

export interface FieldDefinition {
  key: string
  label: string
  required?: boolean
  recommended?: boolean
  keywords: string[]
}

export interface FieldMappingEntry {
  key: string
  label: string
  header: string | null
  confidence: MatchConfidence
  required: boolean
}

export interface FieldMappingResult {
  fileId: string
  fileType: DownloadType
  fileName: string
  mappings: FieldMappingEntry[]
  missingRequiredFields: string[]
  warnings: string[]
}

export type OrderSourceType =
  | 'order_list'
  | 'order_detail'
  | 'excel_order'
  | 'after_sale'
  | 'settlement'

export interface NormalizedOrder {
  sourceRowIndex: number
  /** 业务订单号（内部/匹配，可能为纯数字） */
  orderId: string
  packageId: string
  bizOrderId: string
  /** 官方展示订单号（P 前缀完整字符串） */
  officialOrderNo: string
  displayOrderNo: string
  /** 结算/去重匹配主键：优先 packageId */
  matchOrderId: string
  /** 支付时间（有则用于日期范围统计） */
  paymentTime?: Date | null
  /** 下单时间（支付时间缺失时兜底） */
  orderedAt?: Date | null
  orderTime: Date | null
  orderTimeText: string
  monthKey: string
  buyerId: string
  /** 订单原始字段中的主播 ID（若有） */
  orderAnchorId?: string
  /** 订单原始字段中的主播名称（若有） */
  orderAnchorName?: string
  /** 订单关联直播场次 ID（若有） */
  orderLiveId?: string
  /** 来源直播号 ID */
  liveAccountId?: string
  /** 来源直播号名称 */
  liveAccountName?: string
  /** 商品 GMV（与 productAmountCent 相同） */
  gmvCent: number
  productAmountCent: number
  receivableAmountCent: number
  freightCent: number
  platformDiscountCent: number
  actualPaidCent: number
  actualSellerReceiveAmountCent: number
  gmvSourceUsed: string
  amountWarnings: string[]
  orderStatusText: string
  afterSaleStatusText: string
  reasonText: string
  isSigned: boolean
  isReturned: boolean
  isQualityReturn: boolean
  actualSigned: boolean
  actualSignedAmountCent: number
  errors: string[]
  raw: Record<string, unknown>
  /** 数据来源：仅 isPrimaryOrder=true 且非 after_sale/settlement 可进主指标 */
  sourceType?: OrderSourceType
  isPrimaryOrder?: boolean
}

export interface DuplicateOrderGroup {
  orderId: string
  count: number
  amountConsistent: boolean
  finalGmvCent: number
  originalGmvCents: number[]
  sourceRowIndexes: number[]
}

export interface OrderDedupeResult {
  uniqueOrders: NormalizedOrder[]
  duplicateOrders: DuplicateOrderGroup[]
  abnormalOrders: NormalizedOrder[]
  summary: {
    rawRowCount: number
    uniqueOrderCount: number
    abnormalCount: number
    totalGmvCent: number
  }
}

export interface AnalysisRange {
  startTime: Date
  endTime: Date
  displayText: string
  isCrossMonth: boolean
  monthKeys: string[]
  warnings: string[]
}

export interface Anchor {
  id: string
  name: string
  color: string
  enabled: boolean
  /** 主播登录账号绑定（与系统 username 匹配） */
  externalId?: string | null
}

export interface TimeRule {
  id: string
  name: string
  startTime: string
  endTime: string
  anchorId: string
  enabled: boolean
  /** 毫秒时间戳；null/undefined 表示历史规则，对全部订单生效 */
  effectiveFromMs?: number | null
}

export interface AnchorConfig {
  anchors: Anchor[]
  timeRules: TimeRule[]
}

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

export interface SettlementRecord {
  sourceRowIndex: number
  settlementType: SettlementType
  orderId: string
  amountCent: number
  settlementTime?: Date
  settlementTimeText?: string
  statusText: string
  direction: SettlementDirection
  errors: string[]
  raw: Record<string, unknown>
}

export interface SettlementPreprocessResult {
  pendingRecords: SettlementRecord[]
  settledRecords: SettlementRecord[]
  abnormalPendingRecords: SettlementRecord[]
  abnormalSettledRecords: SettlementRecord[]
}

export interface AnalyzedOrderView {
  orderId: string
  packageId: string
  bizOrderId: string
  /** 全站展示用官方订单号 */
  displayOrderNo: string
  officialOrderNo: string
  matchOrderId: string
  orderTimeText: string
  buyerId: string
  anchorId: string
  anchorName: string
  liveAccountId?: string
  liveAccountName?: string
  attributionType: AttributionType
  matchedRuleName?: string
  matchedLiveStartTime?: string
  matchedLiveEndTime?: string
  gmvCent: number
  productAmountCent: number
  receivableAmountCent: number
  freightCent: number
  platformDiscountCent: number
  actualPaidCent: number
  actualSellerReceiveAmountCent: number
  actualSignedAmountCent: number
  orderStatusText: string
  afterSaleStatusText: string
  isSigned: boolean
  isReturned: boolean
  isActualSigned: boolean
  /** 订单状态维度签收（含已完成/交易成功，与退款无关） */
  statusSigned?: boolean
  /** 退货退款类售后（成功商品退款 + 类型=return_refund） */
  isReturnRefundOrder?: boolean
  /** 仅退款类售后（成功商品退款 + 类型=refund_only） */
  isRefundOnlyOrder?: boolean
  /** 有真实退款但售后类型未知 */
  isRefundTypeUnknown?: boolean
  /** 退货退款/仅退款分类来源 */
  returnRefundClassificationSource?: string
  isQualityReturn: boolean
  returnAmountCent: number
  /** 商品退款金额（分），不含运费补偿 */
  productRefundAmountCent: number
  /** 买家排行 / Drawer / 买家导出专用：订单级商品退款（分） */
  buyerProductRefundAmountCent?: number
  buyerProductRefundSource?: string
  buyerProductRefundAmountWarning?: string | null
  afterSalesWorkbenchRefundAmountCent?: number
  refundIncludesFreight?: boolean
  /** 运费补偿金额（分） */
  freightRefundAmountCent: number
  /** 真实售后退款（分），不含关闭无退款、不含仅退运费 */
  realAfterSaleAmountCent: number
  isFreightRefundOnly: boolean
  afterSaleClosedNoRefund: boolean
  /** 申请售后后又取消 / 关闭无退款 */
  afterSaleCancelled?: boolean
  /** 售后工作台/聚合：存在退货退款申请（含处理中） */
  hasReturnRefundApplication?: boolean
  /** 工作台/聚合识别到仅退款申请（含处理中，不要求已退款） */
  hasRefundOnlyApplication?: boolean
  isReturnRefund: boolean
  isRefundOnly: boolean
  isRealProductRefund: boolean
  afterSaleCategory: string
  afterSaleStatusLabel: string
  afterSaleDisplayType: string
  isSizeMismatch: boolean
  returnAmountWarning?: string | null
  reasonText: string
  /** 有效 GMV（统一口径，看板/排行/报表均使用） */
  effectiveGmvCent: number
  paymentBaseCent: number
  paymentBaseSource: string
  includedInGmv: boolean
  countsForSigned: boolean
  countsForGrossProfit: boolean
  gmvExcludeReason: string | null
  /** 统计支付金额（有支付时间且已支付） */
  statPaidAmountCent?: number
  /** 买家 Drawer：官方真实已支付（分），不用应收兜底 */
  officialPaidAmountCent?: number
  officialPaidAmountSource?: string
  officialPaidConfirmed?: boolean
  /** 买家 Drawer：应收 = 商品 + 运费 */
  buyerReceivableAmountCent?: number
  /** 买家唯一聚合键 */
  buyerKey?: string
  buyerNickname?: string
  buyerDisplayName?: string
  buyerDisplayLabel?: string
  buyerShortCode?: string
  afterSalesWorkbenchReason?: string
  afterSaleReasonText?: string
  /** 严格品退：最终有效成功售后原因为商品问题 */
  strictQualityRefund?: boolean
  hasHistoricalQualityReason?: boolean
  actualSignAmountCent?: number
  successfulRefundAmountCent?: number
  isEffectiveSigned?: boolean
  finalAfterSaleReason?: string
  finalAfterSaleStatus?: string
  /** 官方品质负反馈命中（强证据） */
  officialQualityBadCase?: boolean
  officialQualityReasons?: string[]
  officialQualityFeedbackContent?: string
  officialQualityFeedbackTime?: string
  officialQualitySourceBizId?: string
  officialQualityMatchStatus?: string
  officialQualityPackagePayTime?: string
  officialQualityItemId?: string
  officialQualityItemName?: string
  qualitySource?: 'official_bad_case' | 'after_sale' | 'both' | 'none'
  qualityMainSource?: 'official_bad_case' | 'after_sale' | 'none'
  qualityVerifySource?: 'after_sale_time_search' | 'after_sale_workbench' | 'none'
  qualityVerifyStatus?: 'verified' | 'official_only' | 'after_sale_only' | 'conflict' | 'unmatched' | 'none'
  qualityVerifyDisplayLabel?: string
  officialReasonText?: string
  afterSaleSuccessTime?: string
  suspectedQualityRefund?: boolean
  /** 统计周期内按售后成功/退款时间落入周期的退款金额（分） */
  statRangeRefundAmountCent?: number
}

export interface BusinessOverview {
  analysisRangeText: string
  gmvCent: number
  orderCount: number
  actualSignedCount: number
  actualSignedAmountCent: number
  returnCount: number
  returnAmountCent: number
  returnRate: number
  qualityReturnCount: number
  qualityReturnAmountCent: number
  qualityReturnRate: number
  settledAmountCent: number
  pendingAmountCent: number
  grossProfitCent: number
  grossProfitNote: string
  grossProfitBreakdown?: Record<string, unknown> | null
  /** 按订单月份归属的退款 */
  returnByOrderMonthCent?: number
  /** 按退款发生月份归属的退款 */
  returnByRefundMonthCent?: number
  abnormalOrderCount: number
  unassignedOrderCount: number
  billUnmatchedCount: number
  lastUpdatedAt?: string
  warnings: string[]
}

export interface AnchorSummary {
  anchorName: string
  color: string
  gmvCent: number
  gmvShare: number
  orderCount: number
  actualSignedCount: number
  actualSignedAmountCent: number
  actualSignedShare: number
  returnCount: number
  returnRate: number
  qualityReturnCount: number
  qualityReturnAmountCent: number
  settledAmountCent: number
  pendingAmountCent: number
  grossProfitCent: number
}

export interface BuyerReturnRankItem {
  buyerId: string
  returnCount: number
  returnAmountCent: number
  latestReturnTime: string
  orderCount?: number
  anchors?: string
}

export interface BuyerPaymentRankItem {
  buyerId: string
  paymentAmountCent: number
  orderCount: number
  latestOrderTime: string
  anchors: string
}

export interface BuyerQualityReturnRankItem {
  buyerId: string
  qualityReturnCount: number
  qualityReturnAmountCent: number
  reasonSummary: string
}

export interface ReturnDetailItem {
  orderId: string
  buyerId: string
  anchorName: string
  gmvCent: number
  reasonText: string
  isQualityReturn: boolean
}

export interface UnassignedOrderItem {
  orderId: string
  orderTimeText: string
  gmvCent: number
  reason: string
}

export interface AbnormalOrderItem {
  sourceRowIndex: number
  orderId: string
  errors: string[]
}

export interface BusinessAnalysisResult {
  overview: BusinessOverview
  anchorSummaries: AnchorSummary[]
  buyerReturnRanking: BuyerReturnRankItem[]
  buyerReturnCountRanking: BuyerReturnRankItem[]
  buyerPaymentRanking: BuyerPaymentRankItem[]
  buyerQualityReturnRanking: BuyerQualityReturnRankItem[]
  returnDetails: ReturnDetailItem[]
  unassignedOrders: UnassignedOrderItem[]
  abnormalOrders: AbnormalOrderItem[]
  errors: string[]
}

export interface LatestDownloadFiles {
  order?: { filePath: string; fileName: string; taskId: string }
  live?: { filePath: string; fileName: string; taskId: string }
  pendingSettlement?: { filePath: string; fileName: string; taskId: string }
  settledSettlement?: { filePath: string; fileName: string; taskId: string }
}
