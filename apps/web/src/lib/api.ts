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

async function parseJsonSafe<T>(res: Response): Promise<ApiResult<T>> {
  const text = await res.text()
  if (!text.trim()) {
    throw new ApiError(
      res.ok ? '接口返回为空' : `接口返回为空（HTTP ${res.status}）`,
      res.status || 502,
    )
  }
  let parsed: ApiBody<T>
  try {
    parsed = JSON.parse(text) as ApiBody<T>
  } catch {
    throw new ApiError(`接口返回非 JSON（HTTP ${res.status}）`, res.status || 502)
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

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(resolveApiPath(path), {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
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
}
