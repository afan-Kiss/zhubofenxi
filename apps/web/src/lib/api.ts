export interface ApiSuccess<T> {
  ok: true
  success?: true
  data: T
}

export interface ApiFailure {
  ok: false
  success?: false
  message: string
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** 与后端同域部署；开发模式由 Vite 代理到 3001 */
export const API_PREFIX = '/api'

function resolveApiPath(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    throw new Error('API 必须使用相对路径，不要写死 localhost 或完整域名')
  }
  if (path.startsWith(API_PREFIX)) {
    return path
  }
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${API_PREFIX}${suffix}`
}

type ApiBody<T> = {
  ok?: boolean
  success?: boolean
  data?: T
  message?: string
}

function isSuccessBody(body: ApiBody<unknown>): boolean {
  return body.ok === true || body.success === true
}

function isFailureBody(body: ApiBody<unknown>): boolean {
  return body.ok === false || body.success === false
}

function gatewayErrorMessage(status: number): string | null {
  if (status === 502) return '服务暂时不可用，可能正在更新，请稍后重试'
  if (status === 503) return '服务繁忙，请稍后重试'
  if (status === 504) return '请求超时，请稍后重试'
  return null
}

async function parseJsonSafe<T>(res: Response): Promise<ApiResult<T>> {
  const text = await res.text()
  const gatewayMsg = gatewayErrorMessage(res.status)
  if (!text.trim()) {
    throw new ApiError(
      gatewayMsg || (res.ok ? '接口返回为空' : `接口返回为空（HTTP ${res.status}）`),
      res.status || 502,
    )
  }
  let parsed: ApiBody<T>
  try {
    parsed = JSON.parse(text) as ApiBody<T>
  } catch {
    throw new ApiError(
      gatewayMsg || `接口返回非 JSON（HTTP ${res.status}）`,
      res.status || 502,
    )
  }
  if (isSuccessBody(parsed) && parsed.data !== undefined) {
    return { ok: true, data: parsed.data as T }
  }
  if (isFailureBody(parsed)) {
    return {
      ok: false,
      message: parsed.message?.trim() || `请求失败（HTTP ${res.status}）`,
    }
  }
  if (res.ok) {
    throw new ApiError('接口返回格式异常', res.status)
  }
  return {
    ok: false,
    message: parsed.message?.trim() || `请求失败（HTTP ${res.status}）`,
  }
}

export type ApiRequestOptions = RequestInit & {
  /** 网关类错误（502/503/504）时自动重试次数，不含首次请求 */
  retryOnGateway?: number
}

function isGatewayRetryable(err: unknown): boolean {
  return err instanceof ApiError && [502, 503, 504].includes(err.status)
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { retryOnGateway = 0, ...fetchOptions } = options
  const maxAttempts = 1 + Math.max(0, retryOnGateway)
  let lastErr: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
    }
    try {
      let res: Response
      try {
        res = await fetch(resolveApiPath(path), {
          ...fetchOptions,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(fetchOptions.headers ?? {}),
          },
        })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        throw new ApiError('网络请求失败，请检查网络连接', 0)
      }

      const body = await parseJsonSafe<T>(res)
      if (!body.ok) {
        throw new ApiError(body.message, res.status)
      }
      return body.data
    } catch (e) {
      lastErr = e
      if (!isGatewayRetryable(e) || attempt >= maxAttempts - 1) throw e
    }
  }

  throw lastErr
}
