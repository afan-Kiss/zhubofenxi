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
  | 'local_throttle'
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
  /** 每轮最多 claim 的订单数（多店合计） */
  globalPerMinute: number
  /** 每店每轮最多订单数（同店打成 1 次 HTTP） */
  perShopPerMinute: number
  /** 每轮最多处理店铺数（每店 1 次 HTTP） */
  maxShopsPerBatch: number
}

/** 批量 keywords：每店最多 15 单/请求，每轮最多 8 店 */
export const DEFAULT_AFTER_SALES_QUEUE_LIMITS: AfterSalesQueueRateLimits = {
  globalPerMinute: 60,
  perShopPerMinute: 15,
  maxShopsPerBatch: 8,
}

/** 官方 returns/v3 number=20，keywords 硬上限留余量 */
export const AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS = 15

export const AFTER_SALES_RUNNING_TIMEOUT_MS = 10 * 60 * 1000

export const AFTER_SALES_SHOP_SIGN_BLOCK_THRESHOLD = 5
export const AFTER_SALES_SHOP_AUTH_BLOCK_THRESHOLD = 3
