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
  /** 队列店铺与本地订单归属不一致/冲突：仅阻塞该任务，不熔断整店 Cookie */
  | 'ownership_integrity'
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

/** 批量 keywords：每店每次 10 单/请求（订单号必须与该店 cookie 对应），每轮最多 8 店 */
export const DEFAULT_AFTER_SALES_QUEUE_LIMITS: AfterSalesQueueRateLimits = {
  globalPerMinute: 40,
  perShopPerMinute: 10,
  maxShopsPerBatch: 8,
}

/** 官方 returns/v3 批量 keywords：每次固定最多 10 个订单号 */
export const AFTER_SALES_WORKBENCH_BATCH_MAX_ORDERS = 10

export const AFTER_SALES_RUNNING_TIMEOUT_MS = 10 * 60 * 1000

/** 临时失败（含本地栈溢出）最多自动重试次数，避免同一单刷几百次 */
export const AFTER_SALES_MAX_TEMPORARY_ATTEMPTS = 12

/** 明确的 call stack 类错误更早停，避免占调度名额 */
export const AFTER_SALES_MAX_STACK_OVERFLOW_ATTEMPTS = 5

export const AFTER_SALES_SHOP_SIGN_BLOCK_THRESHOLD = 5
export const AFTER_SALES_SHOP_AUTH_BLOCK_THRESHOLD = 3
