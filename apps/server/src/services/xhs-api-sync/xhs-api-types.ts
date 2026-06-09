export type XhsApiKey =
  | 'order_list'
  | 'order_detail'
  | 'live_session_list'
  | 'live_overview'
  | 'live_traffic_core'
  | 'pending_settlement_list'
  | 'settled_settlement_list'
  | 'settlement_detail'

export type XhsPageMode = 'page_no' | 'pageNum' | 'page' | 'cursor' | 'none'

export type DetailSyncMode = 'none' | 'smart' | 'all'

export interface XhsApiDefinition {
  key: XhsApiKey
  name: string
  method: 'GET' | 'POST'
  url: string
  referer: string
  enabled: boolean
  needSign: boolean
  pageMode: XhsPageMode
  pageSize: number
}

export interface XhsApiRawSummary {
  code?: number | string
  success?: boolean
  msg?: string
  total?: number
  pageNum?: number
  pageSize?: number
  itemCount?: number
}

export interface XhsApiAuthError {
  kind: 'auth_expired' | 'suspected' | 'other'
  cookieStatus: 'valid' | 'invalid' | 'suspected' | 'unknown'
  apiKey: XhsApiKey
  /** 401/403/406/429：本轮同步应立即停止 */
  stopRound?: boolean
}

export interface XhsApiRequestResult<T = unknown> {
  ok: boolean
  data: T | null
  rawSummary: XhsApiRawSummary | null
  errorMessage: string | null
  authError?: XhsApiAuthError | null
  httpStatus?: number
  fatal?: boolean
}

export type XhsSyncJobType = 'manual' | 'scheduled' | 'auto_when_empty' | 'buyer_ranking_fill' | 'full_read'

export type XhsSyncJobStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'success_empty'
  | 'partial_success'
  | 'failed'
  | 'failed_auth'
  | 'skipped'

export type XhsSyncStep =
  | 'idle'
  | 'syncing_order_stats'
  | 'syncing_order_list'
  | 'syncing_order_detail'
  | 'syncing_live_list'
  | 'syncing_live_detail'
  | 'syncing_pending_settlement'
  | 'syncing_settled_settlement'
  | 'syncing_settlement_detail'
  | 'syncing_quality_badcase'
  | 'normalizing_data'
  | 'analyzing_business'
  | 'saving_snapshot'
  | 'completed'
  | 'failed'

export const XHS_SYNC_STEP_LABELS: Record<XhsSyncStep, string> = {
  idle: '准备同步',
  syncing_order_stats: '正在同步订单统计',
  syncing_order_list: '正在同步订单列表',
  syncing_order_detail: '正在选择性同步订单详情',
  syncing_live_list: '正在同步直播场次',
  syncing_live_detail: '正在选择性同步直播详情',
  syncing_pending_settlement: '正在同步待结算明细',
  syncing_settled_settlement: '正在同步已结算明细',
  syncing_settlement_detail: '正在选择性同步结算详情',
  syncing_quality_badcase: '正在同步官方品质反馈',
  normalizing_data: '正在标准化订单数据',
  analyzing_business: '正在生成经营看板',
  saving_snapshot: '正在保存看板快照',
  completed: '同步完成',
  failed: '同步失败',
}

export const XHS_API_NOT_CONFIGURED_MSG =
  '小红书接口尚未配置，请等待管理员补充接口抓包参数'

export const XHS_COOKIE_INVALID_MSG =
  '小红书登录状态可能已失效，请重新复制 Cookie'

export const XHS_SIGN_FAILED_MSG =
  '小红书签名失败，请检查 Cookie、a1、access-token 和 xhshow'

export const XHS_ORDER_DETAIL_PARTIAL_WARN =
  '部分订单详情同步失败，已使用订单列表数据继续分析'

export const MAX_ORDER_DETAIL_REQUESTS = 200
export const MAX_CONSECUTIVE_API_FAILURES = 5
export const MAX_ORDER_DETAIL_CONSECUTIVE_FAILURES = 5
export const SMART_SAMPLE_ORDER_DETAIL_LIMIT = 20
