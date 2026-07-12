/** 售后工作台补查队列状态 */
export type AfterSalesQueueStatus =
  | 'pending'
  | 'running'
  | 'retry_wait'
  | 'done'
  | 'failed'
  | 'blocked'

/** 错误分类（决定进入 retry_wait / blocked / failed） */
export type AfterSalesQueueErrorType =
  | 'platform_cooling'
  | 'http_429'
  | 'http_502'
  | 'http_503'
  | 'http_504'
  | 'network_timeout'
  | 'sign_python2_interpreter'
  | 'sign_generation_failed'
  | 'sign_env_missing'
  | 'cookie_missing'
  | 'cookie_expired'
  | 'http_401'
  | 'http_403'
  | 'permanent_not_found'
  | 'permanent_invalid'
  | 'running_timeout'
  | 'unknown'

export type AfterSalesQueueDisposition = 'done' | 'retry_wait' | 'blocked' | 'failed'

export interface AfterSalesQueueRateLimits {
  globalPerMinute: number
  perShopPerMinute: number
}

export const DEFAULT_AFTER_SALES_QUEUE_LIMITS: AfterSalesQueueRateLimits = {
  globalPerMinute: 8,
  perShopPerMinute: 2,
}

export const AFTER_SALES_RUNNING_TIMEOUT_MS = 10 * 60 * 1000

export const AFTER_SALES_SHOP_SIGN_BLOCK_THRESHOLD = 5
export const AFTER_SALES_SHOP_AUTH_BLOCK_THRESHOLD = 3
