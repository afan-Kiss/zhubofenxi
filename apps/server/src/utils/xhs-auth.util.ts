export type CookieHealthStatus = 'valid' | 'invalid' | 'suspected' | 'unknown'

export type XhsAuthErrorCode = 'auth_expired' | 'suspected' | 'other'

const AUTH_EXPIRED_PATTERNS = [
  '未登录',
  '登录已失效',
  '登录过期',
  '请重新登录',
  '无权限',
  'auth expired',
  'token expired',
  'cookie invalid',
  'session expired',
  '登录状态',
  'not login',
  'not logged',
  'unauthorized',
  'forbidden',
]

const SUSPECTED_PATTERNS = [
  '风控',
  'risk',
  'verify',
  '账号异常',
  '权限不足',
  '访问受限',
  '操作频繁',
  'security',
  'captcha',
]

const XHS_AUTH_ERROR_CODES = new Set([
  -100,
  -101,
  -102,
  401,
  403,
  10001,
  10002,
  10003,
  10004,
  10005,
])

function normalizeText(input: string): string {
  return input.trim().toLowerCase()
}

function includesAny(text: string, patterns: string[]): boolean {
  const lower = normalizeText(text)
  return patterns.some((p) => lower.includes(normalizeText(p)))
}

function parseEnvelopeMessage(envelope?: {
  code?: number | string
  msg?: string
  message?: string
}): string {
  if (!envelope) return ''
  return String(envelope.msg ?? envelope.message ?? '').trim()
}

export interface XhsAuthCheckInput {
  httpStatus?: number
  bodyText?: string
  envelope?: { code?: number | string; msg?: string; message?: string; success?: boolean }
}

export interface XhsAuthCheckResult {
  expired: boolean
  suspected: boolean
  errorCode: XhsAuthErrorCode | null
  errorMessage: string | null
  cookieStatus: CookieHealthStatus | null
}

export const XHS_SYNC_STOP_HTTP_STATUSES = new Set([401, 403, 406, 429])

export function shouldStopSyncForHttpStatus(httpStatus: number): boolean {
  return XHS_SYNC_STOP_HTTP_STATUSES.has(httpStatus)
}

export function isXhsAuthExpired(input: XhsAuthCheckInput): XhsAuthCheckResult {
  const httpStatus = input.httpStatus ?? 0
  const bodyText = input.bodyText ?? ''
  const envelopeMsg = parseEnvelopeMessage(input.envelope)
  const combined = `${envelopeMsg} ${bodyText}`.trim()

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      expired: true,
      suspected: false,
      errorCode: 'auth_expired',
      errorMessage: envelopeMsg || bodyText.slice(0, 200) || `HTTP ${httpStatus}`,
      cookieStatus: 'invalid',
    }
  }

  if (httpStatus === 406 || httpStatus === 429) {
    return {
      expired: false,
      suspected: true,
      errorCode: 'suspected',
      errorMessage: envelopeMsg || bodyText.slice(0, 200) || `HTTP ${httpStatus}`,
      cookieStatus: 'suspected',
    }
  }

  const codeRaw = input.envelope?.code
  const codeNum =
    typeof codeRaw === 'number'
      ? codeRaw
      : typeof codeRaw === 'string' && codeRaw.trim()
        ? Number(codeRaw)
        : NaN
  if (!Number.isNaN(codeNum) && XHS_AUTH_ERROR_CODES.has(codeNum)) {
    return {
      expired: true,
      suspected: false,
      errorCode: 'auth_expired',
      errorMessage: envelopeMsg || `小红书错误码 ${codeNum}`,
      cookieStatus: 'invalid',
    }
  }

  if (includesAny(combined, AUTH_EXPIRED_PATTERNS)) {
    return {
      expired: true,
      suspected: false,
      errorCode: 'auth_expired',
      errorMessage: envelopeMsg || combined.slice(0, 200),
      cookieStatus: 'invalid',
    }
  }

  if (includesAny(combined, SUSPECTED_PATTERNS)) {
    return {
      expired: false,
      suspected: true,
      errorCode: 'suspected',
      errorMessage: envelopeMsg || combined.slice(0, 200),
      cookieStatus: 'suspected',
    }
  }

  return {
    expired: false,
    suspected: false,
    errorCode: null,
    errorMessage: null,
    cookieStatus: null,
  }
}

export class XhsAuthError extends Error {
  readonly kind: XhsAuthErrorCode
  readonly apiKey?: string
  readonly cookieStatus: CookieHealthStatus
  /** 401/403/406/429：本轮同步应立即停止，勿继续重试 */
  readonly stopRound: boolean
  readonly httpStatus?: number

  constructor(params: {
    message: string
    kind: XhsAuthErrorCode
    apiKey?: string
    cookieStatus?: CookieHealthStatus
    stopRound?: boolean
    httpStatus?: number
  }) {
    super(params.message)
    this.name = 'XhsAuthError'
    this.kind = params.kind
    this.apiKey = params.apiKey
    this.cookieStatus = params.cookieStatus ?? (params.kind === 'suspected' ? 'suspected' : 'invalid')
    this.stopRound = params.stopRound ?? false
    this.httpStatus = params.httpStatus
  }
}

export function classifyXhsErrorMessage(message: string): XhsAuthCheckResult {
  return isXhsAuthExpired({ bodyText: message })
}
