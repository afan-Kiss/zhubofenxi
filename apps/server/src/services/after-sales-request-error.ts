/**
 * 售后平台请求错误与 HTTP 计数语义
 *
 * requestAttempts  = 调用售后 HTTP 执行器次数（含本地冷却/熔断拦截）
 * networkRequests  = 真实发往小红书平台的次数
 * actualHttpRequests = 兼容字段，严格等于 networkRequests
 * locallyThrottled = 本地限流/冷却/熔断未发网次数
 */
export type AfterSalesRequestCauseCode =
  | 'http_429'
  | 'http_401'
  | 'http_403'
  | 'network_timeout'
  | 'sign_failed'
  | 'platform_business'
  | 'pagination_incomplete'
  | 'pagination_stalled'
  | 'parse_failed'
  | 'local_throttled'
  | 'local_circuit_open'
  | 'unknown'

export interface AfterSalesRequestCounters {
  requestAttempts: number
  networkRequests: number
  /** 兼容字段：必须始终等于 networkRequests */
  actualHttpRequests: number
  locallyThrottled: number
}

export function emptyAfterSalesRequestCounters(): AfterSalesRequestCounters {
  return {
    requestAttempts: 0,
    networkRequests: 0,
    actualHttpRequests: 0,
    locallyThrottled: 0,
  }
}

/** 保证 actualHttpRequests === networkRequests */
export function finalizeAfterSalesRequestCounters(
  c: Omit<AfterSalesRequestCounters, 'actualHttpRequests'> & {
    actualHttpRequests?: number
  },
): AfterSalesRequestCounters {
  return {
    requestAttempts: Math.max(0, c.requestAttempts),
    networkRequests: Math.max(0, c.networkRequests),
    actualHttpRequests: Math.max(0, c.networkRequests),
    locallyThrottled: Math.max(0, c.locallyThrottled),
  }
}

export function addAfterSalesRequestCounters(
  a: AfterSalesRequestCounters,
  b: Partial<AfterSalesRequestCounters>,
): AfterSalesRequestCounters {
  return finalizeAfterSalesRequestCounters({
    requestAttempts: a.requestAttempts + (b.requestAttempts ?? 0),
    networkRequests: a.networkRequests + (b.networkRequests ?? 0),
    locallyThrottled: a.locallyThrottled + (b.locallyThrottled ?? 0),
  })
}

export class AfterSalesRequestError extends Error {
  /** 请求执行器尝试次数（含本地拦截） */
  readonly requestAttempts: number
  /** 真实发往平台的网络请求次数 */
  readonly networkRequests: number
  /**
   * @deprecated 兼容旧字段：现严格等于 networkRequests（真实发网），不再等于 attempts
   */
  readonly httpRequests: number
  readonly locallyThrottled: number
  readonly page: number
  readonly causeCode: AfterSalesRequestCauseCode
  readonly networkSent: boolean
  readonly httpStatus?: number
  readonly platformCode?: string | number
  readonly retryable: boolean
  readonly keywords?: string
  readonly totalCount?: number | null
  readonly fetchedCount?: number
  readonly rawFetchedCount?: number
  readonly uniqueFetchedCount?: number
  readonly lastPage?: number

  constructor(params: {
    message: string
    requestAttempts?: number
    networkRequests?: number
    locallyThrottled?: number
    /** @deprecated 用 networkRequests；传入时仅作兼容，不再当作 attempts */
    httpRequests?: number
    page?: number
    causeCode?: AfterSalesRequestCauseCode
    networkSent?: boolean
    httpStatus?: number
    platformCode?: string | number
    retryable?: boolean
    keywords?: string
    totalCount?: number | null
    fetchedCount?: number
    rawFetchedCount?: number
    uniqueFetchedCount?: number
    lastPage?: number
  }) {
    super(params.message)
    this.name = 'AfterSalesRequestError'
    const attempts = Math.max(0, params.requestAttempts ?? 0)
    const network = Math.max(
      0,
      params.networkRequests ??
        (params.networkSent ? 1 : params.httpRequests != null ? params.httpRequests : 0),
    )
    const local =
      params.locallyThrottled ??
      (params.causeCode === 'local_throttled' || params.causeCode === 'local_circuit_open'
        ? Math.max(0, attempts - network)
        : 0)
    this.requestAttempts = attempts
    this.networkRequests = network
    this.httpRequests = network
    this.locallyThrottled = Math.max(0, local)
    this.page = params.page ?? 0
    this.causeCode = params.causeCode ?? 'unknown'
    this.networkSent = params.networkSent ?? network > 0
    this.httpStatus = params.httpStatus
    this.platformCode = params.platformCode
    this.retryable = params.retryable ?? true
    this.keywords = params.keywords
    this.totalCount = params.totalCount
    this.fetchedCount = params.fetchedCount
    this.rawFetchedCount = params.rawFetchedCount
    this.uniqueFetchedCount = params.uniqueFetchedCount
    this.lastPage = params.lastPage
  }

  toCounters(): AfterSalesRequestCounters {
    return finalizeAfterSalesRequestCounters({
      requestAttempts: this.requestAttempts,
      networkRequests: this.networkRequests,
      locallyThrottled: this.locallyThrottled,
    })
  }
}

/** @deprecated 兼容名：现严格等于 networkRequests（真实发网），勿再当 attempts */
export function getAfterSalesHttpRequestCount(err: unknown): number {
  return getAfterSalesNetworkRequestCount(err)
}

export function getAfterSalesRequestAttemptCount(err: unknown): number {
  if (err instanceof AfterSalesRequestError) return err.requestAttempts
  return 0
}

export function getAfterSalesNetworkRequestCount(err: unknown): number {
  if (err instanceof AfterSalesRequestError) return err.networkRequests
  return 0
}

export function getAfterSalesLocallyThrottledCount(err: unknown): number {
  if (err instanceof AfterSalesRequestError) return err.locallyThrottled
  return 0
}

export type AfterSalesBackfillErrorKind =
  | 'LOCAL_THROTTLED'
  | 'LOCAL_CIRCUIT_OPEN'
  | 'PLATFORM_429'
  | 'AUTH'
  | 'NETWORK'
  | 'OTHER'

/**
 * 回填错误分类：优先结构化 causeCode；仅非 AfterSalesRequestError 时才字符串兜底。
 * causeCode=http_429 但未发网 → 降级 LOCAL_THROTTLED（不可能收到平台 429）。
 */
export function classifyAfterSalesBackfillError(error: unknown): AfterSalesBackfillErrorKind {
  if (error instanceof AfterSalesRequestError) {
    switch (error.causeCode) {
      case 'local_throttled':
        return 'LOCAL_THROTTLED'
      case 'local_circuit_open':
        return 'LOCAL_CIRCUIT_OPEN'
      case 'http_429':
        if (!error.networkSent || error.networkRequests <= 0) {
          return 'LOCAL_THROTTLED'
        }
        return 'PLATFORM_429'
      case 'http_401':
      case 'http_403':
      case 'sign_failed':
        return 'AUTH'
      case 'network_timeout':
        return 'NETWORK'
      default:
        break
    }
    if (error.httpStatus === 429) {
      if (!error.networkSent || error.networkRequests <= 0) return 'LOCAL_THROTTLED'
      return 'PLATFORM_429'
    }
    if (error.httpStatus === 401 || error.httpStatus === 403) return 'AUTH'
  }

  const msg = error instanceof Error ? error.message : String(error ?? '')
  // 本地控制优先于宽泛 429/冷却 匹配
  if (/local_throttl|页面接口禁止|JSONL.*冷却|冷却中/i.test(msg)) return 'LOCAL_THROTTLED'
  if (/local_circuit|接口熔断中|circuit_open/i.test(msg)) return 'LOCAL_CIRCUIT_OPEN'
  if (/\bHTTP\s*429\b|status\s*=?\s*429|Too Many Requests/i.test(msg)) return 'PLATFORM_429'
  if (/401|403|cookie_missing|cookie.*未配置|缺少 a1|登录失效|鉴权失败|签名失效/i.test(msg)) {
    return 'AUTH'
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(msg)) return 'NETWORK'
  return 'OTHER'
}

/** 伪平台429（未发网）检测，供日志 warning */
export function isFakePlatform429(error: unknown): boolean {
  return (
    error instanceof AfterSalesRequestError &&
    error.causeCode === 'http_429' &&
    (!error.networkSent || error.networkRequests <= 0)
  )
}

export function classifyThrownHttpCause(
  msg: string,
  httpStatus?: number | null,
): AfterSalesRequestCauseCode {
  if (httpStatus === 429 || /\bHTTP\s*429\b|status\s*=?\s*429|Too Many Requests/i.test(msg)) {
    return 'http_429'
  }
  if (httpStatus === 401 || /\b401\b/.test(msg)) return 'http_401'
  if (httpStatus === 403 || /\b403\b/.test(msg)) return 'http_403'
  if (/冷却中|local_throttle|页面接口禁止|JSONL.*冷却/i.test(msg)) return 'local_throttled'
  if (/接口熔断中|circuit_open|local_circuit/i.test(msg)) return 'local_circuit_open'
  if (/访问频繁|风险控制/i.test(msg)) return 'http_429'
  if (/cookie.*未配置|cookie_missing|缺少 a1/i.test(msg)) return 'http_401'
  if (/(cookie.*过期|cookie.*失效|登录失效|鉴权失败|签名失效)/i.test(msg)) return 'http_401'
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(msg)) {
    return 'network_timeout'
  }
  if (/签名|sign/i.test(msg)) return 'sign_failed'
  return 'unknown'
}
