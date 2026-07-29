/**
 * 售后平台请求错误：携带已实际发出的 HTTP 次数，供上层统计与熔断。
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
  | 'unknown'

export class AfterSalesRequestError extends Error {
  readonly httpRequests: number
  readonly page: number
  readonly causeCode: AfterSalesRequestCauseCode
  readonly keywords?: string
  readonly totalCount?: number | null
  readonly fetchedCount?: number
  readonly lastPage?: number

  constructor(params: {
    message: string
    httpRequests: number
    page?: number
    causeCode?: AfterSalesRequestCauseCode
    keywords?: string
    totalCount?: number | null
    fetchedCount?: number
    lastPage?: number
  }) {
    super(params.message)
    this.name = 'AfterSalesRequestError'
    this.httpRequests = Math.max(0, params.httpRequests)
    this.page = params.page ?? 0
    this.causeCode = params.causeCode ?? 'unknown'
    this.keywords = params.keywords
    this.totalCount = params.totalCount
    this.fetchedCount = params.fetchedCount
    this.lastPage = params.lastPage
  }
}

export function getAfterSalesHttpRequestCount(err: unknown): number {
  if (err instanceof AfterSalesRequestError) return err.httpRequests
  return 0
}

export function classifyThrownHttpCause(msg: string): AfterSalesRequestCauseCode {
  if (/\b429\b|冷却|cooldown|访问频繁|风险控制/i.test(msg)) return 'http_429'
  if (/\b401\b|登录|cookie.*失效|鉴权/i.test(msg)) return 'http_401'
  if (/\b403\b/.test(msg)) return 'http_403'
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(msg)) {
    return 'network_timeout'
  }
  if (/签名|sign/i.test(msg)) return 'sign_failed'
  return 'unknown'
}
